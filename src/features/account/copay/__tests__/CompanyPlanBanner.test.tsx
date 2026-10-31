/**
 * The Account slots ACCT-3 fills: the company-plan banner (iOS
 * `companyPlanBanner`: a pending activation, else a pending invitation, else
 * nothing; read each time Account appears) and "Fix payment" (iOS's past-due
 * button), as a member sees and hears them, in both languages.
 */
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeSubscription } from '../../../../api/subscriptions';
import { DialogHost, dismissAllDialogs } from '../../../../components/ui/Dialog';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { closeKenniSheetRequest, openKenniSheet, useKenniSheetRequest } from '../../../kenni';
import { runSignOutCleaners } from '../../../../app/signOut';
import { flush, freshPaymentsPerTest, MEMBER_A, signIn } from '../../../../payments/__tests__/paymentsHarness';
import { useAppStore } from '../../../../stores/appStore';
import { PLUS_SUBSCRIPTION } from '../../../../stores/__tests__/storeHarness';
import { resetRetryEpisodesForTests } from '../../../../supabase/services/companyPlans';
import CompanyPlanBanner from '../../slots/CompanyPlanBanner';
import PastDueFix from '../../slots/PastDueFix';
import { reloadCopayContext, resetCopayContext } from '../contextSource';
import { SCREEN_READS_ON_APPEAR } from '../contextStore';
import { resetCopayBusyForTests, useCopayBusy } from '../copayFlows';
import { installCopayHooks } from '../register';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// expo-font (behind @expo/vector-icons, which the Kenni sheet draws) imports
// expo-asset, which npm left nested under expo/ where Jest cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);

const MEMBERSHIP = 'a1b2c3d4-0000-4000-8000-00000000c0de';

const activationJSON = {
  membershipId: MEMBERSHIP,
  fundingModel: 'co_pay',
  companyName: 'Acme ehf.',
  productSlug: 'plan-plus',
  productName: 'Plus',
  memberPriceIsk: 14_900,
  subsidyIsk: 10_000,
  shareIsk: 4_900,
  blocked: null,
};

stubApiClientPerTest();
freshPaymentsPerTest();

function answerContext(context: Record<string, unknown>): void {
  api.on('GET', '/company-plans/context', Reply.ok(context));
}

/** The account language is the profile's (F3 derives it on every store change). */
function speakIcelandic(): void {
  signIn(MEMBER_A, { locale: 'is' });
  api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: true, marketingConsent: false, locale: 'is' }));
}

async function settle(): Promise<void> {
  await act(() => flush(20));
}

/**
 * Account appears with the banner on it. The appearance read is the
 * banner's own until ACCT-1's screen makes it (copay/contextStore); then the
 * screen's focus read is stood in for here, so these tests hold either way.
 */
async function showBanner(): Promise<void> {
  await render(
    <>
      <CompanyPlanBanner />
      <DialogHost />
    </>,
  );
  if (SCREEN_READS_ON_APPEAR) await act(() => reloadCopayContext());
  await settle();
}

beforeEach(() => {
  signIn();
  resetCopayContext();
  resetCopayBusyForTests();
  resetRetryEpisodesForTests();
  installCopayHooks();
  setCurrentLanguage('en');
  api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: true, marketingConsent: false }));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

afterEach(() => {
  dismissAllDialogs();
  closeKenniSheetRequest();
});

describe('the company-plan banner', () => {
  it('a pending activation with a share: the kicker, the offer, "Activate · ISK 4,900/mo"', async () => {
    answerContext({ pendingInvite: null, pendingActivation: activationJSON });
    await showBanner();
    expect(screen.getByText(lookup('account.copay_kicker', 'en').toUpperCase())).toBeTruthy();
    expect(screen.getByText(lookup('account.copay_offer', 'en').replace('{company}', 'Acme ehf.').replace('{plan}', 'Plus'))).toBeTruthy();
    const cta = screen.getByTestId('copay.banner.activate');
    expect(cta.props.accessibilityLabel).toBe(lookup('account.copay_cta_share', 'en').replace('{price}', 'ISK 4,900'));
    expect(screen.queryByTestId('copay.banner.blocked')).toBeNull();
  });

  it('a zero share reads "Activate · included", in Icelandic too', async () => {
    speakIcelandic();
    answerContext({ pendingActivation: { ...activationJSON, shareIsk: 0, subsidyIsk: 14_900 } });
    await showBanner();
    expect(screen.getByText(lookup('account.copay_cta_free', 'is'))).toBeTruthy();
    expect(screen.getByText(lookup('account.copay_offer', 'is').replace('{company}', 'Acme ehf.').replace('{plan}', 'Plus'))).toBeTruthy();
  });

  it('blocked by a personal plan: why, and no button', async () => {
    answerContext({ pendingActivation: { ...activationJSON, blocked: 'existing_subscription' } });
    await showBanner();
    expect(screen.getByText(lookup('account.copay_blocked_sub', 'en'))).toBeTruthy();
    expect(screen.queryByTestId('copay.banner.activate')).toBeNull();
  });

  it('the CTA asks first, then reads "Processing…" while the activation runs', async () => {
    answerContext({ pendingActivation: activationJSON });
    let release: () => void = () => undefined;
    api.on('POST', '/company-plans/activate', async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return Reply.ok({ kind: 'provisioned', subscriptionId: PLUS_SUBSCRIPTION.id }, 201);
    });
    await showBanner();
    await fireEvent.press(screen.getByTestId('copay.banner.activate'));
    expect(screen.getByText(lookup('account.copay_confirm_title', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('copay.confirm.activate'));
    await settle();
    const cta = screen.getByTestId('copay.banner.activate');
    expect(cta.props.accessibilityLabel).toBe(lookup('common.processing', 'en'));
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    answerContext({ pendingInvite: null, pendingActivation: null });
    await act(async () => release());
    await settle();
    expect(useCopayBusy.getState().activating).toBe(false);
    expect(screen.queryByTestId('copay.banner.activation')).toBeNull();
  });

  it('a pending invitation (and no activation): the waiting copy and "Verify identity to claim"', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    await showBanner();
    expect(screen.getByText(lookup('account.copay_invite', 'en').replace('{company}', 'Acme ehf.'))).toBeTruthy();
    expect(screen.getByRole('button', { name: lookup('account.copay_invite_cta', 'en') })).toBeTruthy();
  });

  it('an activation wins over an invitation, as on iOS', async () => {
    answerContext({ pendingInvite: { companyName: 'Other ehf.' }, pendingActivation: activationJSON });
    await showBanner();
    expect(screen.getByTestId('copay.banner.activation')).toBeTruthy();
    expect(screen.queryByTestId('copay.banner.invite')).toBeNull();
  });

  it('Verify opens Kenni; when it closes, the profile and the context are read again', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    const { result } = await renderHook(() => useKenniSheetRequest());
    await showBanner();
    await fireEvent.press(screen.getByTestId('copay.banner.verify'));
    expect(result.current?.bodyKey).toBe('kenni.body');

    // The claim turned the invitation into a plan to accept.
    answerContext({ pendingInvite: null, pendingActivation: activationJSON });
    const profileReads = api.sentAll('/profile', 'GET').length;
    await act(async () => closeKenniSheetRequest());
    await settle();
    expect(api.sentAll('/profile', 'GET').length).toBe(profileReads + 1);
    expect(api.sentAll('/company-plans/context')).toHaveLength(2);
    expect(screen.getByTestId('copay.banner.activation')).toBeTruthy();
  });

  it('a Kenni sheet another part of Account opened (the identity row) re-reads the context when it closes', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    await showBanner();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);

    const identityRowClosed = jest.fn();
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose: identityRowClosed }));
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);

    // Verified there: the claim turned the invitation into a plan to accept.
    answerContext({ pendingInvite: null, pendingActivation: activationJSON });
    await act(async () => closeKenniSheetRequest());
    await settle();
    expect(identityRowClosed).toHaveBeenCalledTimes(1);
    expect(api.sentAll('/company-plans/context')).toHaveLength(2);
    expect(screen.getByTestId('copay.banner.activation')).toBeTruthy();
  });

  it('a Kenni sheet dropped by a sign-out reads nothing', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    const { result } = await renderHook(() => useKenniSheetRequest());
    await showBanner();
    await act(async () => openKenniSheet({ bodyKey: 'kenni.body', onClose: () => undefined }));
    await settle();
    expect(result.current).not.toBeNull();
    // The app state is cleared before the cleaners run (src/app/signOut.ts).
    await act(async () => {
      useAppStore.setState({ isAuthenticated: false, userId: null, profile: null });
      await runSignOutCleaners({ memberId: MEMBER_A });
    });
    await settle();
    expect(result.current).toBeNull();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
  });

  it('nothing to show, or a read that failed: nothing drawn', async () => {
    answerContext({ pendingInvite: null, pendingActivation: null });
    await showBanner();
    expect(screen.toJSON()).toBeNull();
    api.on('GET', '/company-plans/context', Reply.problem(404, 'not_found'));
    await showBanner();
    expect(screen.toJSON()).toBeNull();
  });

  (SCREEN_READS_ON_APPEAR ? it.skip : it)('is read each time the screen it sits on appears', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    const Stack = createNativeStackNavigator();
    function Account() {
      const navigation = useNavigation<{ navigate: (name: string) => void }>();
      return (
        <>
          <CompanyPlanBanner />
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Receipts')}>
            <Text>Receipts</Text>
          </Pressable>
        </>
      );
    }
    function Receipts() {
      const navigation = useNavigation();
      return (
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()}>
          <Text>Back</Text>
        </Pressable>
      );
    }
    await render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Account" component={Account} />
          <Stack.Screen name="Receipts" component={Receipts} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Receipts' }));
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(2);
  });
});

describe('the appearance read, once the Account screen makes it', () => {
  (SCREEN_READS_ON_APPEAR ? it : it.skip)('the banner reads nothing on its own: one read per appearance, the screen’s', async () => {
    answerContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null });
    await render(<CompanyPlanBanner />);
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(0);
  });
});

describe('Fix payment', () => {
  function holdSubscription(json: Record<string, unknown>): void {
    useAppStore.setState({ subscription: decodeSubscription(json), subscriptionLoaded: true });
  }

  it('is there only while the plan is past due', async () => {
    holdSubscription(PLUS_SUBSCRIPTION);
    await render(<PastDueFix />);
    expect(screen.queryByTestId('account.pastDue.fix')).toBeNull();
    await act(async () => holdSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' }));
    expect(screen.getByRole('button', { name: lookup('account.past_due_cta', 'en') })).toBeTruthy();
  });

  it('a new Account visit gets a new key; re-taps within one visit keep it', async () => {
    holdSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' });
    openAuthSession.mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult);
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900 }, 201));
    api.on('GET', '/subscriptions', Reply.ok({ ...PLUS_SUBSCRIPTION, status: 'past_due' }));

    const first = await render(<PastDueFix />);
    await fireEvent.press(screen.getByTestId('account.pastDue.fix'));
    await settle();
    await fireEvent.press(screen.getByTestId('account.pastDue.fix'));
    await settle();
    await act(async () => first.unmount());

    await render(<PastDueFix />);
    await fireEvent.press(screen.getByTestId('account.pastDue.fix'));
    await settle();
    const keys = api.sentAll('/company-plans/retry-payment').map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('reads "Processing…" until the payment is confirmed, in Icelandic too', async () => {
    speakIcelandic();
    holdSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' });
    let close: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
    openAuthSession.mockImplementationOnce(() => new Promise((resolve) => (close = resolve)));
    api.on(
      'POST',
      '/company-plans/retry-payment',
      Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: '0f1e2d3c-4b5a-4968-8776-655443322110' }, 201),
    );
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await render(<PastDueFix />);
    expect(screen.getByText(lookup('account.past_due_cta', 'is'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('account.pastDue.fix'));
    await settle();
    const button = screen.getByTestId('account.pastDue.fix');
    expect(button.props.accessibilityLabel).toBe(lookup('common.processing', 'is'));
    expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    await act(async () => close({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult));
    await settle();
    // Cured: the plan reads active, and the button is gone with the past-due state.
    expect(screen.queryByTestId('account.pastDue.fix')).toBeNull();
    expect(useCopayBusy.getState().retrying).toBe(false);
  });
});
