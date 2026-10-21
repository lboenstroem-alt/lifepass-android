/**
 * The web-first fallback on the Plans screen (`MerchantInfo.inAppKlingCheckout`
 * off, the escape hatch if the in-app rail ever has to be switched off): no
 * payment sheet (the web page has the mandate, the save-card opt-out and its
 * own code box), the web plans page with the product preselected, and on the
 * way back a short quiet check, then iOS's "Completed your purchase? Tap to
 * check" chip rather than a false alert. The chip confirms a purchase the
 * profile shows.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';
import { View } from 'react-native';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { DialogHost } from '../../../../components/ui/Dialog';
import { setCurrentLanguage, translate } from '../../../../i18n';
import type { RootRoutes } from '../../../../navigation/types';
import { freshPaymentsPerTest, usageJSON } from '../../../../payments/__tests__/paymentsHarness';
import { useAppStore } from '../../../../stores/appStore';
import { MEMBER_A, profileJSON } from '../../../../stores/__tests__/storeHarness';
import { resetPlanCatalog } from '../../catalogStore';
import PlansView from '../../PlansView';
import { CATALOGUE_WITHOUT_POOL } from '../../__tests__/fixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../../../kenni', () => ({ openKenniSheet: jest.fn() }));
jest.mock('../../../../config/merchantInfo', () => {
  const actual = jest.requireActual('../../../../config/merchantInfo');
  return { ...actual, MerchantInfo: { ...actual.MerchantInfo, inAppKlingCheckout: false } };
});

stubApiClientPerTest();
freshPaymentsPerTest();

const openPage = jest.mocked(WebBrowser.openAuthSessionAsync);
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const Stack = createNativeStackNavigator<RootRoutes>();
const navigationRef = createNavigationContainerRef<RootRoutes>();

const NEW_PASS = '22222222-2222-4222-8222-222222222222';

function Underneath() {
  return <View testID="underneath" />;
}

function profileWith(passes: string[]) {
  return profileJSON({ kennitalaVerified: false, usage: usageJSON(passes.map((id) => ({ id }))) });
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetPlanCatalog();
  setCurrentLanguage('en');
  openPage.mockReset();
  openPage.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
  const json = profileWith([]);
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: MEMBER_A, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok(json));
  api.on('GET', '/subscriptions', Reply.ok(null));
  api.on('GET', '/catalog/plans', Reply.ok(CATALOGUE_WITHOUT_POOL));
});

async function renderPasses() {
  await render(
    <>
      <NavigationContainer
        ref={navigationRef}
        initialState={{ index: 1, routes: [{ name: 'Main' }, { name: 'Plans', params: { segment: 'passes' } }] }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={Underneath} />
          <Stack.Screen name="Plans" component={PlansView} options={{ presentation: 'modal' }} />
        </Stack.Navigator>
      </NavigationContainer>
      <DialogHost />
    </>,
  );
  await act(async () => undefined);
}

it('opens the web plans page with no sheet, then offers the quiet chip; the chip finds the pass and welcomes the member', async () => {
  await renderPasses();
  await fireEvent.press(screen.getByTestId('plans.continue'));

  await waitFor(() => expect(openPage).toHaveBeenCalledTimes(1));
  expect(openPage.mock.calls[0][0]).toBe('https://www.lifepass.is/plans?completePurchase=pass-adventurer');
  expect(screen.queryByTestId(/^plans\.payment_sheet\./)).toBeNull();
  expect(api.sentAll('/payments/checkout-sessions')).toHaveLength(0);

  // Nothing on the profile after a short check: a price check, most likely.
  const chip = await screen.findByRole('button', { name: en('plans.check_purchase') });
  expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
  expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);

  api.on('GET', '/profile', Reply.ok(profileWith([NEW_PASS])));
  await fireEvent.press(chip);
  expect(await screen.findByText(en('plans.welcome_title'))).toBeOnTheScreen();
  expect(screen.getByText(en('plans.success.pass', { name: 'Adventurer' }))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: en('plans.check_purchase') })).toBeNull();
});

it('a check that finds nothing keeps the chip, quietly', async () => {
  await renderPasses();
  await fireEvent.press(screen.getByTestId('plans.continue'));
  const chip = await screen.findByRole('button', { name: en('plans.check_purchase') });
  const reads = api.sentAll('/profile', 'GET').length;
  await fireEvent.press(chip);
  await waitFor(() => expect(api.sentAll('/profile', 'GET').length).toBe(reads + 2));
  expect(await screen.findByRole('button', { name: en('plans.check_purchase') })).toBeOnTheScreen();
  expect(screen.queryByText(en('plans.welcome_title'))).toBeNull();
  expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
});
