/**
 * "Scan your meal" on the Scan tab (iOS CheckInView's meal button, and
 * MealFlowsUITests testTheScanTabMealButtonOpensTheMealPage,
 * testSomeoneWithoutAMembershipMeetsTheGate, testAMemberUnder18HasNoMealButton):
 * its look by access, the gate and the pill once seen, consent first, and
 * the mode the page opens in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { UiKitProvider } from '../../../components/ui';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { openHealthConsent } from '../../../health/consent/presenter';
import { scanMealGateSeenKey } from '../../../health/localKeys';
import { runHealthWipeHooks } from '../../../health/wipe';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../lib/analytics';
import { navigationRef } from '../../../navigation/navigationRef';
import type { MealCaptureParams } from '../../../navigation/types';
import { resetAppStoreForTests } from '../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../stores/intentStore';
import { ENTITLED, MEMBER, signIn } from '../capture/__tests__/mealFixtures';
import { LAST_MODE_KEY } from '../capture/lastMode';
import { markScanGateSeen, resetScanGateSeenForTests } from '../capture/scanGateSeen';
import ScanMealEntry, { mealButtonStyle } from '../ScanMealEntry';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('expo-camera', () => ({ Camera: { getCameraPermissionsAsync: jest.fn(async () => ({ granted: true })) } }));
jest.mock('../../../health/consent/presenter', () => ({
  ...jest.requireActual('../../../health/consent/presenter'),
  openHealthConsent: jest.fn(() => true),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const camera = require('expo-camera') as { Camera: { getCameraPermissionsAsync: jest.Mock } };

const Stack = createNativeStackNavigator();
let opened: MealCaptureParams[] = [];

function ScanTab() {
  return <ScanMealEntry />;
}

function MealPage() {
  const route = useRoute();
  opened.push(route.params as MealCaptureParams);
  return <Text>Meal page</Text>;
}

function Plans() {
  return <Text>Plans page</Text>;
}

async function renderEntry() {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ScanMain" component={ScanTab} />
          <Stack.Screen name="MealCapture" component={MealPage} />
          <Stack.Screen name="Plans" component={Plans} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

let events: { event: string; params: AnalyticsParams }[] = [];

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetScanGateSeenForTests();
  opened = [];
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
  camera.Camera.getCameraPermissionsAsync.mockResolvedValue({ granted: true });
});

afterEach(() => {
  setAnalyticsObserver(null);
});

// The library's AsyncStorage mock: its functions are already jest mocks.
const storage = AsyncStorage as unknown as { getItem: jest.Mock };

/** The reads of the gate-seen flag so far. */
const gateReads = (): number => storage.getItem.mock.calls.filter(([key]) => key === scanMealGateSeenKey(MEMBER)).length;

describe('its look', () => {
  it('full for members, hidden for minors, a pill for others once the gate was seen', () => {
    expect(mealButtonStyle('entitled', true)).toBe('full');
    expect(mealButtonStyle('minor', false)).toBe('hidden');
    expect(mealButtonStyle('pass_only', false)).toBe('full');
    expect(mealButtonStyle('not_member', true)).toBe('compact');
    expect(mealButtonStyle('past_due', true)).toBe('compact');
    // Not read yet: nothing for those it matters to, the card for a member.
    expect(mealButtonStyle('not_member', null)).toBe('hidden');
    expect(mealButtonStyle('entitled', null)).toBe('full');
  });

  it('a member under 18 has no meal button', async () => {
    signIn({ access: 'minor', consent: null });
    await renderEntry();
    expect(screen.queryByTestId('scan.meal.button')).toBeNull();
    expect(screen.queryByTestId('scan.meal.pill')).toBeNull();
  });

  it('is drawn at half strength and does nothing while a walk-in is in flight', async () => {
    signIn();
    await render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ScanMain">{() => <ScanMealEntry disabled />}</Stack.Screen>
          <Stack.Screen name="MealCapture" component={MealPage} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    expect(opened).toEqual([]);
    expect(screen.getByTestId('scan.meal.button').props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('a tap', () => {
  it('a member with consent gets the meal page, in the last mode used, today, slot by the clock', async () => {
    signIn();
    await AsyncStorage.setItem(LAST_MODE_KEY, 'barcode');
    await renderEntry();
    expect(screen.getByLabelText('Scan your meal. Photo, barcode or search')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    await waitFor(() => expect(screen.getByText('Meal page')).toBeOnTheScreen());
    expect(opened[0]).toMatchObject({ origin: 'scanTab', mode: 'barcode' });
    expect(opened[0]?.slot).toBeUndefined();
    expect(events).toContainEqual({ event: 'scan_meal_tapped', params: { outcome: 'opened', mode: 'full' } });
  });

  it('opens the page in the same turn as the tap: nothing is awaited while a code in view could still be read', async () => {
    signIn();
    await AsyncStorage.setItem(LAST_MODE_KEY, 'barcode');
    await renderEntry();
    // Were the tap to ask for the permission first, the page would not be
    // there until that answer came.
    camera.Camera.getCameraPermissionsAsync.mockImplementation(() => new Promise(() => undefined));
    // The press handler runs before `fireEvent.press` returns: the page is
    // already the current route, before anything could be awaited.
    const pressed = fireEvent.press(screen.getByTestId('scan.meal.button'));
    expect(navigationRef.getCurrentRoute()?.name).toBe('MealCapture');
    expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ origin: 'scanTab', mode: 'barcode' });
    await pressed;
    expect(screen.getByText('Meal page')).toBeOnTheScreen();
  });

  it('a mode chosen on the page is the next opening’s, read when the Scan tab is back in focus', async () => {
    signIn();
    await AsyncStorage.setItem(LAST_MODE_KEY, 'photo');
    await renderEntry();
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    expect(opened[0]?.mode).toBe('photo');
    // The page switched to Search, then closed.
    await AsyncStorage.setItem(LAST_MODE_KEY, 'search');
    await act(async () => {
      (navigationRef.goBack as () => void)();
    });
    await act(async () => undefined);
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    expect(opened.at(-1)?.mode).toBe('search');
  });

  it('opens in Search when the camera is not allowed', async () => {
    signIn();
    camera.Camera.getCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await AsyncStorage.setItem(LAST_MODE_KEY, 'photo');
    await renderEntry();
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    await waitFor(() => expect(opened[0]?.mode).toBe('search'));
  });

  it('a member without consent meets the consent sheet first, then the page', async () => {
    signIn({ access: 'entitled', consent: null });
    await renderEntry();
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.button')));
    expect(opened).toEqual([]);
    expect(openHealthConsent).toHaveBeenCalledWith(expect.objectContaining({ entry: 'scan' }));
    expect(events).toContainEqual({ event: 'scan_meal_tapped', params: { outcome: 'consent', mode: 'full' } });
    // Granted: the page.
    signIn(ENTITLED);
    const request = (openHealthConsent as jest.Mock).mock.calls.at(-1)![0] as { onGranted: () => void };
    await act(async () => request.onGranted());
    await waitFor(() => expect(screen.getByText('Meal page')).toBeOnTheScreen());
  });

  it('someone without a membership meets the gate, never a page; once seen the button becomes the pill', async () => {
    signIn({ access: 'not_member', consent: null });
    await renderEntry();
    await act(async () => fireEvent.press(await screen.findByTestId('scan.meal.button')));
    expect(screen.getByText('Included with a LifePass membership')).toBeOnTheScreen();
    expect(screen.getByText('Log meals with a photo, a barcode or a quick search, next to your plan.')).toBeOnTheScreen();
    expect(opened).toEqual([]);
    expect(events).toContainEqual({ event: 'scan_meal_tapped', params: { outcome: 'gate', mode: 'full' } });
    await act(async () => fireEvent.press(screen.getByText('Cancel')));
    await waitFor(() => expect(screen.getByTestId('scan.meal.pill')).toBeOnTheScreen());
    expect(await AsyncStorage.getItem(scanMealGateSeenKey(MEMBER))).toBe('true');
    await act(async () => fireEvent.press(screen.getByTestId('scan.meal.pill')));
    expect(events).toContainEqual({ event: 'scan_meal_tapped', params: { outcome: 'gate', mode: 'compact' } });
  });

  it('someone who has seen the gate never gets the full card first: nothing until the flag is read, and later visits know it at once', async () => {
    signIn({ access: 'not_member', consent: null });
    await AsyncStorage.setItem(scanMealGateSeenKey(MEMBER), 'true');
    let answer: (value: string | null) => void = () => undefined;
    const read = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve;
        }),
    );
    storage.getItem.mockImplementationOnce(read);
    await renderEntry();
    expect(read).toHaveBeenCalledWith(scanMealGateSeenKey(MEMBER));
    expect(screen.queryByTestId('scan.meal.button')).toBeNull();
    expect(screen.queryByTestId('scan.meal.pill')).toBeNull();
    await act(async () => answer('true'));
    expect(screen.getByTestId('scan.meal.pill')).toBeOnTheScreen();
    expect(screen.queryByTestId('scan.meal.button')).toBeNull();

    // The next visit to the Scan tab: the pill from the first frame, with no read at all.
    await screen.unmount();
    const before = gateReads();
    await render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ScanMain" component={ScanTab} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    expect(screen.getByTestId('scan.meal.pill')).toBeOnTheScreen();
    expect(gateReads()).toBe(before);
  });

  it('a health wipe forgets that the gate was seen', async () => {
    signIn({ access: 'not_member', consent: null });
    markScanGateSeen(MEMBER);
    await renderEntry();
    expect(screen.getByTestId('scan.meal.pill')).toBeOnTheScreen();
    // The wipe removes the key, then its hooks run.
    await AsyncStorage.removeItem(scanMealGateSeenKey(MEMBER));
    await act(async () => runHealthWipeHooks({ profileId: MEMBER, reason: 'withdrawn' }));
    await waitFor(() => expect(screen.getByTestId('scan.meal.button')).toBeOnTheScreen());
    expect(screen.queryByTestId('scan.meal.pill')).toBeNull();
  });

  it('the gate’s button opens the memberships for a pass holder', async () => {
    signIn({ access: 'pass_only', consent: null });
    await renderEntry();
    await act(async () => fireEvent.press(await screen.findByTestId('scan.meal.button')));
    expect(screen.getByText('Your visitor pass covers venues and day plans. The food log is included with a membership.')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealgate.cta')));
    await waitFor(() => expect(screen.getByText('Plans page')).toBeOnTheScreen());
  });

  it('floats on the camera while it is live', async () => {
    signIn();
    useIntentStore.setState({ scanCameraLive: true });
    await renderEntry();
    expect(screen.getByTestId('scan.meal.button')).toBeOnTheScreen();
  });
});
