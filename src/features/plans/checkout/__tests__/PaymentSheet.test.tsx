/**
 * The checkout on the Plans screen, through the real screen in a native
 * stack (iOS PlansView's payment sheet, 2.5.2 and 2.5.5): the mandate and the
 * save-card switch per plan, the code box and its refusals (kept open, read
 * out, Clear code), the synchronous double-tap guard, the sheet held while
 * the checkout is created, the order of what follows its close (the page,
 * "Confirming your payment…", the welcome; the payment alert with its next
 * step; the Kenni sheet with the code kept), and the overlay's escape hatch.
 *
 * The stub server answers every call; the Custom Tab is a mock.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';
import * as ReactNative from 'react-native';
import { AccessibilityInfo, DeviceEventEmitter, View } from 'react-native';

import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { DialogHost } from '../../../../components/ui/Dialog';
import { setCurrentLanguage, translate } from '../../../../i18n';
import type { RootModalProps, RootRoutes } from '../../../../navigation/types';
import { freshPaymentsPerTest, usageJSON } from '../../../../payments/__tests__/paymentsHarness';
import { useAppStore } from '../../../../stores/appStore';
import { MEMBER_A, profileJSON } from '../../../../stores/__tests__/storeHarness';
import { openKenniSheet, type KenniSheetOptions } from '../../../kenni';
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

stubApiClientPerTest();
freshPaymentsPerTest();

const openKenni = jest.mocked(openKenniSheet);
const openPage = jest.mocked(WebBrowser.openAuthSessionAsync);
const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
const setFocus = jest.mocked(AccessibilityInfo.setAccessibilityFocus);
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

const Stack = createNativeStackNavigator<RootRoutes>();
const navigationRef = createNavigationContainerRef<RootRoutes>();
const currentRoute = () => navigationRef.getCurrentRoute()?.name;

const PASS_A = '11111111-1111-4111-8111-111111111111';
const OPENED = Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/cs_1', externalSessionId: 'cs_1' }, 201);

function Underneath() {
  return <View testID="underneath" />;
}

function AccountStandIn() {
  return <View testID="account" />;
}

function signIn(verified = true, passes: string[] = []) {
  const json = profileJSON({ kennitalaVerified: verified, usage: usageJSON(passes.map((id) => ({ id }))) });
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: MEMBER_A, profile: decodeProfile(json) });
  api.on('GET', '/profile', Reply.ok(json));
}

async function renderPlans(params?: RootModalProps<'Plans'>['route']['params']) {
  await render(
    <>
      <NavigationContainer
        ref={navigationRef}
        initialState={{ index: 1, routes: [{ name: 'Main' }, { name: 'Plans', params }] }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={Underneath} />
          <Stack.Screen name="Plans" component={PlansView} options={{ presentation: 'modal' }} />
          {/* A refusal's "Manage membership" opens Account where Plans can reach it. */}
          <Stack.Screen name={'Account' as keyof RootRoutes} component={AccountStandIn} />
        </Stack.Navigator>
      </NavigationContainer>
      <DialogHost />
    </>,
  );
  await act(async () => undefined);
}

async function pressBack(): Promise<void> {
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
}

const continueButton = () => screen.getByTestId('plans.continue');
const payButton = () => screen.getByTestId('plans.mandate.continue');
const codeBox = () => screen.getByTestId('plans.promo.input');
const sheetFor = (slug: string) => screen.queryByTestId(`plans.payment_sheet.${slug}`);
const checkouts = () => api.sentAll('/payments/checkout-sessions', 'POST');
const checkoutBody = (n = 0) => checkouts()[n].body as Record<string, unknown>;
const lastSheet = () => bottomSheetMock.latest();

beforeEach(() => {
  bottomSheetMock.reset();
  resetPlanCatalog();
  setCurrentLanguage('en');
  openKenni.mockReset();
  openPage.mockReset();
  announce.mockClear();
  setFocus.mockClear();
  signIn();
  api.on('GET', '/catalog/plans', Reply.ok(CATALOGUE_WITHOUT_POOL));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

afterEach(() => setCurrentLanguage('en'));

describe('the payment sheet', () => {
  it('a pass: the full-height sheet with the pass mandate, the save-card switch ON and the pass hint; nothing sent yet', async () => {
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());

    expect(sheetFor('pass-adventurer')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en('plans.mandate.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plans.mandate.pass'))).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: en('plans.mandate.save_card') })).toBeChecked();
    expect(screen.getByText(en('plans.promo.hint_pass'))).toBeOnTheScreen();
    expect(codeBox()).toHaveProp('placeholder', en('plans.promo.placeholder'));
    expect(codeBox()).toHaveProp('autoCapitalize', 'characters');
    expect(codeBox()).toHaveProp('autoCorrect', false);
    expect(codeBox()).toHaveProp('accessibilityLabel', en('plans.promo.label'));
    expect(screen.getByRole('button', { name: en('plans.mandate.continue') })).toBeOnTheScreen();
    expect(lastSheet()?.snapPoints).toEqual(['100%']);
    expect(checkouts()).toHaveLength(0);
  });

  it('a membership: the half-height sheet with the membership mandate, no switch, and the union hint', async () => {
    await renderPlans();
    await fireEvent.press(continueButton());
    expect(sheetFor('plan-plus')).toBeOnTheScreen();
    expect(screen.getByText(en('plans.mandate.subscription'))).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(en('plans.promo.hint'))).toBeOnTheScreen();
    expect(lastSheet()?.snapPoints).toEqual(['50%']);
  });

  it('the pass switch turned off sends saveCard:false; the next sheet has it back ON', async () => {
    answerAndReturn(Reply.problem(409, 'order_create_failed'));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    await fireEvent.press(screen.getByRole('switch', { name: en('plans.mandate.save_card') }));
    expect(screen.getByRole('switch', { name: en('plans.mandate.save_card') })).not.toBeChecked();
    await fireEvent.press(payButton());
    await waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkoutBody().saveCard).toBe(false);
    expect(checkoutBody().productSlug).toBe('pass-adventurer');

    // The refusal's alert, answered; a fresh sheet resets the consent.
    await fireEvent.press(await screen.findByRole('button', { name: en('common.ok') }));
    await fireEvent.press(continueButton());
    expect(screen.getByRole('switch', { name: en('plans.mandate.save_card') })).toBeChecked();
    await fireEvent.press(payButton());
    await waitFor(() => expect(checkouts()).toHaveLength(2));
    expect(checkoutBody(1).saveCard).toBe(true);
  });

  it('a membership sends no save-card flag, and its typed code normalised', async () => {
    answerAndReturn(Reply.problem(409, 'order_create_failed'));
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.changeText(codeBox(), ' frimann pass\n');
    await fireEvent.press(payButton());
    await waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkoutBody()).not.toHaveProperty('saveCard');
    expect(checkoutBody().promotionCode).toBe('FRIMANNPASS');
  });

  it('closes by back when nothing is in flight, and nothing is sent', async () => {
    await renderPlans();
    await fireEvent.press(continueButton());
    await pressBack();
    expect(sheetFor('plan-plus')).toBeNull();
    expect(currentRoute()).toBe('Plans');
    expect(checkouts()).toHaveLength(0);
  });
});

describe('the discount code', () => {
  it('a refused code is answered under the box: the sheet stays, the code stays, it is read out, and Clear code empties it', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(400, 'discount_code_expired'));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    await fireEvent.changeText(codeBox(), 'partner10');
    await fireEvent.press(payButton());

    const message = en('plans.promo.err.expired');
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(sheetFor('pass-adventurer')).toBeOnTheScreen();
    expect(codeBox()).toHaveProp('value', 'partner10');
    expect(codeBox()).toHaveProp('accessibilityHint', message);
    expect(screen.queryByText(en('plans.promo.hint_pass'))).toBeNull();
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
    expect(announce).toHaveBeenCalledWith(message);
    expect(checkouts()).toHaveLength(1);

    // The same refusal again is still news to the listener.
    await fireEvent.press(payButton());
    await waitFor(() => expect(checkouts()).toHaveLength(2));
    await waitFor(() => expect(announce.mock.calls.filter(([said]) => said === message)).toHaveLength(2));

    // The test renderer has no native views: give the box a tag.
    const reactNative: typeof ReactNative = jest.requireActual('react-native');
    jest.spyOn(reactNative, 'findNodeHandle').mockImplementation(((instance: unknown) =>
      instance != null ? 77 : null) as typeof ReactNative.findNodeHandle);
    setFocus.mockClear();
    jest.useFakeTimers();
    try {
      await fireEvent.press(screen.getByRole('button', { name: en('plans.promo.clear') }));
      expect(codeBox()).toHaveProp('value', '');
      expect(screen.queryByText(message)).toBeNull();
      expect(screen.getByText(en('plans.promo.hint_pass'))).toBeOnTheScreen();
      // TalkBack goes on from the empty box, a moment later.
      expect(setFocus).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(150));
      expect(setFocus).toHaveBeenCalledWith(77);
    } finally {
      jest.useRealTimers();
    }

    // Continuing now pays the full price, by the member's choice: no code sent.
    api.on('POST', '/payments/checkout-sessions', Reply.problem(409, 'order_create_failed'));
    await fireEvent.press(payButton());
    await waitFor(() => expect(checkouts()).toHaveLength(3));
    expect(checkoutBody(2)).not.toHaveProperty('promotionCode');
  });

  it('editing the code withdraws the refusal', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(400, 'discount_code_invalid'));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    await fireEvent.changeText(codeBox(), 'PARTNER1O');
    await fireEvent.press(payButton());
    expect(await screen.findByText(en('plans.promo.err.invalid'))).toBeOnTheScreen();
    await fireEvent.changeText(codeBox(), 'PARTNER10');
    expect(screen.queryByText(en('plans.promo.err.invalid'))).toBeNull();
    expect(codeBox().props.accessibilityHint).toBeUndefined();
  });

  it('a malformed code is refused on the phone with no request', async () => {
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    await fireEvent.changeText(codeBox(), 'kóði');
    await fireEvent.press(payButton());
    expect(await screen.findByText(en('plans.promo.err.format'))).toBeOnTheScreen();
    expect(checkouts()).toHaveLength(0);
  });

  it('reads Icelandic: the mandate, the switch, the box and the refusal', async () => {
    setCurrentLanguage('is');
    api.on('POST', '/payments/checkout-sessions', Reply.problem(400, 'discount_code_not_valid_for_product'));
    await renderPlans({ segment: 'passes' });
    await fireEvent.press(continueButton());
    expect(screen.getByText(is('plans.mandate.title'))).toBeOnTheScreen();
    expect(screen.getByText(is('plans.mandate.pass'))).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: is('plans.mandate.save_card') })).toBeOnTheScreen();
    expect(screen.getByText(is('plans.promo.hint_pass'))).toBeOnTheScreen();
    await fireEvent.changeText(codeBox(), 'PARTNER10');
    await fireEvent.press(payButton());
    expect(await screen.findByText('Ekki er hægt að nota þennan kóða fyrir þennan passa.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hreinsa kóða' })).toBeOnTheScreen();
  });
});

describe('while the checkout is created', () => {
  it('two quick taps make one session; the sheet and Plans cannot be closed; the box takes no input', async () => {
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions', async () => {
      await answered;
      return Reply.problem(409, 'order_create_failed');
    });
    await renderPlans();
    await fireEvent.press(continueButton());
    // Two taps in one frame: the second lands before any re-render could hold the button.
    const press = onPressOf(payButton());
    await act(async () => {
      press();
      press();
    });
    await waitFor(() => expect(checkouts()).toHaveLength(1));

    expect(payButton()).toBeDisabled();
    // One name for TalkBack while the spinner shows.
    expect(payButton()).toHaveProp('accessibilityLabel', en('plans.mandate.continue'));
    expect(codeBox()).toHaveProp('editable', false);
    expect(lastSheet()?.enablePanDownToClose).toBe(false);
    await pressBack();
    expect(sheetFor('plan-plus')).toBeOnTheScreen();
    expect(currentRoute()).toBe('Plans');

    await act(async () => answer());
    // Not about the code: the sheet closes first, then the payment alert.
    expect(await screen.findByText(en('plans.payment_issue'))).toBeOnTheScreen();
    expect(screen.getByText(en('error.refusal_fallback'))).toBeOnTheScreen();
    expect(sheetFor('plan-plus')).toBeNull();
    expect(checkouts()).toHaveLength(1);
  });
});

describe('after the sheet', () => {
  it('opens the page, confirms the payment under "Confirming your payment…", and welcomes the member; the welcome closes Plans', async () => {
    api.on('POST', '/payments/checkout-sessions', OPENED);
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions/confirm', async () => {
      await answered;
      return Reply.ok({ status: 'fulfilled' });
    });
    openPage.mockResolvedValue({ type: 'success', url: 'lifepass://payment-success' } as WebBrowser.WebBrowserAuthSessionResult);
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());

    await waitFor(() => expect(openPage).toHaveBeenCalledWith('https://pay.kling.is/c/cs_1', 'lifepass://payment-', { createTask: false }));
    expect(sheetFor('plan-plus')).toBeNull();
    expect(await screen.findByText(en('plans.confirming'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.confirming_sub'))).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(en('plans.confirming'));
    // The Continue cluster gives way to the overlay; Plans stays.
    expect(screen.queryByTestId('plans.continue')).toBeNull();
    await pressBack();
    expect(currentRoute()).toBe('Plans');

    await act(async () => answer());
    expect(await screen.findByText(en('plans.welcome_title'))).toBeOnTheScreen();
    expect(screen.getByText(en('plans.success.subscription', { name: 'Plus' }))).toBeOnTheScreen();
    expect(screen.queryByText(en('plans.confirming'))).toBeNull();
    const reads = api.sentAll('/subscriptions', 'GET').length;
    await fireEvent.press(screen.getByRole('button', { name: en('plans.welcome_cta') }));
    expect(currentRoute()).toBe('Main');
    expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThan(reads);
  });

  it('a pass bought is welcomed as a pass, from the profile', async () => {
    signIn(true, [PASS_A]);
    api.on('POST', '/payments/checkout-sessions', OPENED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    openPage.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
    await renderPlans({ segment: 'passes' });
    api.on(
      'GET',
      '/profile',
      Reply.ok(profileJSON({ kennitalaVerified: true, usage: usageJSON([{ id: PASS_A }, { id: 'b2b2b2b2-2222-4222-8222-222222222222' }]) })),
    );
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());
    expect(await screen.findByText(en('plans.success.pass', { name: 'Adventurer' }))).toBeOnTheScreen();
    expect(api.sentAll('/payments/status')).toHaveLength(0);
  });

  it('the overlay’s Cancel lets the member go on while the check runs; Continue brings the overlay back, not a second sheet', async () => {
    api.on('POST', '/payments/checkout-sessions', OPENED);
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.on('POST', '/payments/checkout-sessions/confirm', async () => {
      await answered;
      return Reply.ok({ status: 'fulfilled' });
    });
    openPage.mockResolvedValue({ type: 'success', url: 'lifepass://payment-success' } as WebBrowser.WebBrowserAuthSessionResult);
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());
    await screen.findByText(en('plans.confirming'));

    await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
    expect(screen.queryByText(en('plans.confirming'))).toBeNull();
    expect(continueButton()).toBeEnabled();

    await fireEvent.press(continueButton());
    expect(sheetFor('plan-plus')).toBeNull();
    expect(screen.getByText(en('plans.confirming'))).toBeOnTheScreen();

    // Hardware back on the overlay is its Cancel.
    await fireEvent(screen.getByTestId('plans.confirming'), 'requestClose');
    expect(screen.queryByText(en('plans.confirming'))).toBeNull();

    await act(async () => answer());
    expect(await screen.findByText(en('plans.welcome_title'))).toBeOnTheScreen();
    expect(checkouts()).toHaveLength(1);
  });

  it('a purchase refusal keeps its next step: Manage membership opens Account', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(409, 'subscription_already_exists_for_profile'));
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());
    const alert = await screen.findByTestId('plans.payment_issue');
    expect(within(alert).getByText(en('plans.payment_issue'))).toBeOnTheScreen();
    expect(within(alert).getByText(en('refusal.has_membership'))).toBeOnTheScreen();
    expect(within(alert).queryByText(/409|subscription_already/)).toBeNull();
    await fireEvent.press(within(alert).getByRole('button', { name: en('refusal.cta.manage_membership') }));
    expect(currentRoute()).toBe('Account');
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();
  });

  it('a trial that is gone offers no "See plans" here: only OK', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(409, 'trial_no_longer_available'));
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());
    const alert = await screen.findByTestId('plans.payment_issue');
    expect(within(alert).getByText(en('refusal.trial_gone'))).toBeOnTheScreen();
    expect(within(alert).queryByRole('button', { name: en('booking.err.view_plans') })).toBeNull();
    expect(within(alert).getAllByRole('button')).toHaveLength(1);
  });

  it('the server asking for Kenni closes the sheet, parks the SUBMITTED plan with the typed code, and the code is back in the box on resume', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(403, 'kennitala_verification_required'));
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: false })));
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.changeText(codeBox(), 'frimannpass');
    await fireEvent.press(payButton());
    await waitFor(() => expect(openKenni).toHaveBeenCalledTimes(1));
    expect(sheetFor('plan-plus')).toBeNull();
    expect(screen.queryByText(en('plans.payment_issue'))).toBeNull();

    // Verified in the sheet: the purchase resumes at the payment sheet, code and all, and waits for a tap.
    api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
    const options: KenniSheetOptions = openKenni.mock.calls[0][0];
    await act(async () => options.onClose());
    await waitFor(() => expect(sheetFor('plan-plus')).toBeOnTheScreen());
    expect(codeBox()).toHaveProp('value', 'frimannpass');
    expect(checkouts()).toHaveLength(1);
  });

  it('a pass off sale is the payment alert after the sheet, and its card goes', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(404, 'product_not_on_sale'));
    await renderPlans({ segment: 'passes', slug: 'pass-local' });
    await fireEvent.press(continueButton());
    api.on('GET', '/catalog/plans', Reply.ok({ ...CATALOGUE_WITHOUT_POOL, packs: CATALOGUE_WITHOUT_POOL.packs.filter((p) => p.slug !== 'pass-local') }));
    await fireEvent.press(payButton());
    expect(await screen.findByText(en('plans.err.not_on_sale'))).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('plans.card.pass-local')).toBeNull());
  });

  it('a page that could not open says so, and nothing is verified', async () => {
    api.on('POST', '/payments/checkout-sessions', OPENED);
    openPage.mockRejectedValue(new Error('no browser'));
    await renderPlans();
    await fireEvent.press(continueButton());
    await fireEvent.press(payButton());
    expect(await screen.findByText(en('payment.err.checkout'))).toBeOnTheScreen();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
  });
});

/**
 * The press handler behind a host element, as React Native calls it: two calls
 * in one act are two taps in one frame, before any re-render.
 */
function onPressOf(element: unknown): () => void {
  type Fiber = { return: Fiber | null; memoizedProps?: { onPress?: unknown } };
  let fiber = (element as { unstable_fiber?: Fiber }).unstable_fiber ?? null;
  for (; fiber; fiber = fiber.return) {
    const onPress = fiber.memoizedProps?.onPress;
    if (typeof onPress === 'function') return () => (onPress as () => void)();
  }
  throw new Error('no press handler');
}

/** The create answers `reply`; any page that opens is closed at once. */
function answerAndReturn(reply: ReturnType<typeof Reply.ok>): void {
  api.on('POST', '/payments/checkout-sessions', reply);
  openPage.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
}
