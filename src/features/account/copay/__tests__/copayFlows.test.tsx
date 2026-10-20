/**
 * The co-pay flows on Account (iOS AccountView `activateCompanyPlan`,
 * `settleActivationReturn`, `retryCopayPayment`, `settleRetryReturn`): the
 * activation's confirm copy and body, provisioned against checkout, the
 * refusal slug table, the Kenni path and its re-reads, one retry key per
 * dunning episode, and the session hooks (sign-out, the recovery's presenter,
 * the episode ending once the plan reads cured).
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeSubscription } from '../../../../api/subscriptions';
import { runSignOutCleaners } from '../../../../app/signOut';
import { DialogHost, dismissAllDialogs } from '../../../../components/ui/Dialog';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { closeKenniSheetRequest, useKenniSheetRequest } from '../../../kenni';
import { presentResolution } from '../../../../payments/presenters';
import { flush, freshPaymentsPerTest, MEMBER_A, signIn, storedRecords } from '../../../../payments/__tests__/paymentsHarness';
import { useAppStore } from '../../../../stores/appStore';
import { PLUS_SUBSCRIPTION } from '../../../../stores/__tests__/storeHarness';
import {
  decodeCompanyPlanContext,
  hasRetryEpisode,
  resetRetryEpisodesForTests,
  retryEpisodeKey,
  type PendingActivation,
} from '../../../../supabase/services/companyPlans';
import { copayContext, resetCopayContext, useCopayContextStore } from '../contextSource';
import {
  activateCopayPlan,
  activationConfirmMessage,
  activationCta,
  confirmCopayActivation,
  fixPastDuePayment,
  resetCopayBusyForTests,
  useCopayBusy,
  useRetryEpisodeVisit,
} from '../copayFlows';
import { installCopayHooks } from '../register';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// expo-font (behind @expo/vector-icons, which the Kenni sheet draws) imports
// expo-asset, which npm left nested under expo/ where Jest cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

const MEMBERSHIP = 'a1b2c3d4-0000-4000-8000-00000000c0de';
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PAST_DUE = { ...PLUS_SUBSCRIPTION, status: 'past_due' };

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

/** The context as the screen last read it. */
function holdContext(json: Record<string, unknown>): PendingActivation | null {
  const context = decodeCompanyPlanContext(json);
  useCopayContextStore.setState({ context, failed: false });
  return context.pendingActivation;
}

function holdSubscription(json: Record<string, unknown> | null): void {
  useAppStore.setState({ subscription: json ? decodeSubscription(json) : null, subscriptionLoaded: true });
}

async function settle(): Promise<void> {
  await act(() => flush(20));
}

/** An Account visit showing "Fix payment" (the slot mounts this); unmount() is leaving Account. */
async function openAccountVisit(): Promise<{ unmount: () => void }> {
  return renderHook(() => useRetryEpisodeVisit());
}

/** Confirms that answer only once `release` is called (a page whose settle is still running). */
function holdConfirm(): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  api.on('POST', '/payments/checkout-sessions/confirm', async () => {
    await gate;
    return Reply.ok({ status: 'processing' });
  });
  return () => release();
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
  api.on('GET', '/company-plans/context', Reply.ok({ pendingInvite: null, pendingActivation: null }));
});

afterEach(() => {
  dismissAllDialogs();
  closeKenniSheetRequest();
});

describe('the activation copy', () => {
  const share = decodeCompanyPlanContext({ pendingActivation: activationJSON }).pendingActivation!;
  const free = decodeCompanyPlanContext({ pendingActivation: { ...activationJSON, shareIsk: 0, subsidyIsk: 14_900 } })
    .pendingActivation!;

  it('a share: "Activate · ISK 4,900/mo" and who pays the rest, ISK-prefixed in both languages', () => {
    expect(activationCta(share, 'en')).toBe(lookup('account.copay_cta_share', 'en').replace('{price}', 'ISK 4,900'));
    expect(activationCta(share, 'is')).toBe(lookup('account.copay_cta_share', 'is').replace('{price}', 'ISK 4,900'));
    expect(activationConfirmMessage(share, 'en')).toBe(
      lookup('account.copay_confirm_share', 'en')
        .replace('{company}', 'Acme ehf.')
        .replace('{plan}', 'Plus')
        .replace('{price}', 'ISK 4,900'),
    );
  });

  it('a zero share: "Activate · included" and the covered-in-full copy', () => {
    expect(activationCta(free, 'en')).toBe(lookup('account.copay_cta_free', 'en'));
    expect(activationConfirmMessage(free, 'is')).toBe(
      lookup('account.copay_confirm_free', 'is').replace('{company}', 'Acme ehf.').replace('{plan}', 'Plus'),
    );
  });
});

describe('activating a company plan', () => {
  it('asks first; Cancel sends nothing', async () => {
    const activation = holdContext({ pendingActivation: activationJSON })!;
    await render(<DialogHost />);
    await act(async () => confirmCopayActivation(activation));
    expect(screen.getByText(lookup('account.copay_confirm_title', 'en'))).toBeTruthy();
    expect(screen.getByText(activationConfirmMessage(activation, 'en'))).toBeTruthy();
    expect(screen.getByText(activationCta(activation, 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('copay.confirm.cancel'));
    await settle();
    expect(api.sentAll('/company-plans/activate')).toHaveLength(0);
  });

  it('provisioned: no page; the membership, the credits and the context are read again', async () => {
    holdContext({ pendingActivation: { ...activationJSON, shareIsk: 0, subsidyIsk: 14_900 } });
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'provisioned', subscriptionId: PLUS_SUBSCRIPTION.id }, 201));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await render(<DialogHost />);
    await act(async () => confirmCopayActivation(copayContext()!.pendingActivation!));
    await fireEvent.press(screen.getByTestId('copay.confirm.activate'));
    await settle();

    expect(openAuthSession).not.toHaveBeenCalled();
    const body = api.sent('/company-plans/activate').body as { membershipId: string };
    expect(body.membershipId).toBe(MEMBERSHIP);
    expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThanOrEqual(2);
    expect(api.sentAll('/profile', 'GET').length).toBeGreaterThanOrEqual(1);
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    expect(useAppStore.getState().subscription?.status).toBe('active');
    expect(copayContext()).toEqual({ pendingInvite: null, pendingActivation: null });
    expect(useCopayBusy.getState().activating).toBe(false);
  });

  it('checkout: the page, the pull after it closes, the plan read until it is there, then the context', async () => {
    holdContext({ pendingActivation: activationJSON });
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    let reads = 0;
    api.on('GET', '/subscriptions', () => {
      reads += 1;
      return Reply.ok(reads < 2 ? null : PLUS_SUBSCRIPTION);
    });
    let busyWhilePageOpen = false;
    openAuthSession.mockImplementationOnce(async () => {
      busyWhilePageOpen = useCopayBusy.getState().activating;
      return DISMISSED;
    });

    await act(() => activateCopayPlan());

    expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/c/copay', expect.any(String), expect.anything());
    expect(busyWhilePageOpen).toBe(true);
    expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: SESSION });
    expect(useAppStore.getState().subscription?.productSlug).toBe('plan-plus');
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    expect(useCopayBusy.getState().activating).toBe(false);
    expect(await storedRecords()).toEqual([]);
  });

  it('a second tap while one runs sends nothing', async () => {
    holdContext({ pendingActivation: activationJSON });
    let release: () => void = () => undefined;
    api.on('POST', '/company-plans/activate', async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return Reply.ok({ kind: 'provisioned', subscriptionId: PLUS_SUBSCRIPTION.id }, 201);
    });
    const first = activateCopayPlan();
    await act(() => flush());
    await act(() => activateCopayPlan());
    release();
    await act(() => first);
    expect(api.sentAll('/company-plans/activate')).toHaveLength(1);
  });

  describe('the refusals', () => {
    async function refusedWith(status: number, slug: string): Promise<void> {
      holdContext({ pendingActivation: activationJSON });
      api.on('POST', '/company-plans/activate', Reply.problem(status, slug));
      await render(<DialogHost />);
      await act(() => activateCopayPlan());
      await settle();
    }

    it('kennitala_verification_required opens Kenni (the membership body); its close re-reads the profile and the context', async () => {
      const { result } = await renderHook(() => useKenniSheetRequest());
      await refusedWith(403, 'kennitala_verification_required');
      expect(result.current?.bodyKey).toBe('kenni.body');
      expect(screen.queryByText(lookup('account.cancel_failed_title', 'en'))).toBeNull();

      const profileReads = api.sentAll('/profile', 'GET').length;
      await act(async () => closeKenniSheetRequest());
      await settle();
      expect(api.sentAll('/profile', 'GET').length).toBe(profileReads + 1);
      expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    });

    it('subscription_already_exists_for_profile says the plan can be activated once the current one ends', async () => {
      await refusedWith(409, 'subscription_already_exists_for_profile');
      expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
      expect(screen.getByText(lookup('account.copay_blocked_sub', 'en'))).toBeTruthy();
    });

    it('copay_membership_not_eligible re-reads the context and says nothing', async () => {
      await refusedWith(404, 'copay_membership_not_eligible');
      expect(api.sentAll('/company-plans/context')).toHaveLength(1);
      expect(screen.queryByText(lookup('account.cancel_failed_title', 'en'))).toBeNull();
    });

    it('anything else reads as the error, in the member’s words', async () => {
      await refusedWith(409, 'checkout_session_conflict');
      expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
      expect(api.sentAll('/company-plans/context')).toHaveLength(0);
    });

    it('hyphenated spellings of the codes count', async () => {
      await refusedWith(409, 'subscription-already-exists-for-profile');
      expect(screen.getByText(lookup('account.copay_blocked_sub', 'en'))).toBeTruthy();
    });
  });

  it('a page that never opened says so, and the plan is still waiting', async () => {
    holdContext({ pendingActivation: activationJSON });
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    openAuthSession.mockRejectedValueOnce(new Error('no browser'));
    await render(<DialogHost />);
    await act(() => activateCopayPlan());
    await settle();
    expect(screen.getByText(lookup('error.generic', 'en'))).toBeTruthy();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
  });

  it('nothing to activate, nothing sent', async () => {
    await act(() => activateCopayPlan());
    expect(api.sentAll('/company-plans/activate')).toHaveLength(0);
  });

  it('while another hosted page is up, no session is minted for a page that cannot open', async () => {
    holdContext({ pendingActivation: activationJSON });
    holdSubscription(PAST_DUE);
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900 }, 201));
    let closePage: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
    openAuthSession.mockImplementationOnce(() => new Promise((resolve) => (closePage = resolve)));
    const retry = fixPastDuePayment();
    await settle();
    expect(openAuthSession).toHaveBeenCalledTimes(1);

    await act(() => activateCopayPlan());
    expect(api.sentAll('/company-plans/activate')).toHaveLength(0);
    expect(useCopayBusy.getState().activating).toBe(false);

    await act(async () => closePage(DISMISSED));
    await act(() => retry);
  });

  it('F8 busy (another payment still settling): the state is read again, and a plan still waiting says the tap did nothing', async () => {
    holdContext({ pendingActivation: activationJSON });
    holdSubscription(PAST_DUE);
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: SESSION }, 201));
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    api.on('GET', '/company-plans/context', Reply.ok({ pendingActivation: activationJSON }));
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    const release = holdConfirm();
    openAuthSession.mockResolvedValue(DISMISSED);
    await render(<DialogHost />);
    const retry = fixPastDuePayment();
    await settle();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(1);

    await act(() => activateCopayPlan());
    await settle();
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(lookup('error.generic', 'en'))).toBeTruthy();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    expect(useCopayBusy.getState().activating).toBe(false);

    release();
    await act(() => retry);
  });

  it('F8 busy, but the plan turns out to be there already: nothing is said', async () => {
    holdContext({ pendingActivation: activationJSON });
    holdSubscription(PAST_DUE);
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: SESSION }, 201));
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    const release = holdConfirm();
    openAuthSession.mockResolvedValue(DISMISSED);
    await render(<DialogHost />);
    const retry = fixPastDuePayment();
    await settle();

    await act(() => activateCopayPlan());
    await settle();
    expect(screen.queryByText(lookup('error.generic', 'en'))).toBeNull();
    expect(copayContext()).toEqual({ pendingInvite: null, pendingActivation: null });

    release();
    await act(() => retry);
  });
});

describe('fixing a past-due payment', () => {
  const checkout = { checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: SESSION };

  beforeEach(() => {
    holdSubscription(PAST_DUE);
    api.on('POST', '/company-plans/retry-payment', Reply.ok(checkout, 201));
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    openAuthSession.mockResolvedValue(DISMISSED);
  });

  it('two taps in one episode send the same key; once cured, the next episode has a new key', async () => {
    await openAccountVisit();
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    await act(() => fixPastDuePayment());
    await act(() => fixPastDuePayment());
    const [first, second] = api.sentAll('/company-plans/retry-payment').map((r) => r.headers['idempotency-key']);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(api.sent('/company-plans/retry-payment').body).toEqual({ subscriptionId: PLUS_SUBSCRIPTION.id });

    // The share is paid: the plan reads active again and the episode ends.
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await act(() => fixPastDuePayment());
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(false);

    // A month later it is past due again: a new episode, a new key.
    holdSubscription(PAST_DUE);
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    await act(() => fixPastDuePayment());
    const keys = api.sentAll('/company-plans/retry-payment').map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(4);
    expect(keys[2]).toBe(first);
    expect(keys[3]).not.toBe(first);
  });

  it('leaving Account ends the episode: the next visit sends a new key (iOS: a new AccountView, a new key)', async () => {
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    const visit = await openAccountVisit();
    await act(() => fixPastDuePayment());
    await act(() => fixPastDuePayment());
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(true);

    // The page was closed unpaid; the member leaves Account and comes back days later.
    await act(async () => visit.unmount());
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(false);
    await openAccountVisit();
    await act(() => fixPastDuePayment());
    const [first, second, third] = api.sentAll('/company-plans/retry-payment').map((r) => r.headers['idempotency-key']);
    expect(second).toBe(first);
    expect(third).toBeTruthy();
    expect(third).not.toBe(first);
  });

  it('leaving Account while the payment is still settling ends the episode once it is done', async () => {
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    const release = holdConfirm();
    const visit = await openAccountVisit();
    const running = fixPastDuePayment();
    await settle();
    await act(async () => visit.unmount());
    // Still in use by the payment that is settling.
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(true);
    release();
    await act(() => running);
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(false);
  });

  it('F8 busy (another payment still settling) and still past due: says the tap did nothing', async () => {
    holdContext({ pendingActivation: activationJSON });
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    const release = holdConfirm();
    await render(<DialogHost />);
    const activating = activateCopayPlan();
    await settle();

    await act(() => fixPastDuePayment());
    await settle();
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(lookup('error.generic', 'en'))).toBeTruthy();
    expect(useCopayBusy.getState().retrying).toBe(false);

    release();
    await act(() => activating);
  });

  it('closing the tab with no link at all still confirms the session, then re-reads the plan', async () => {
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    await act(() => fixPastDuePayment());
    expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/c/retry', expect.any(String), expect.anything());
    // Still processing: the pull is tried three times (iOS, 2 s apart), then the plan is polled.
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(3);
    expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: SESSION });
    expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThanOrEqual(4);
    expect(useCopayBusy.getState().retrying).toBe(false);
  });

  it('copay_subscription_not_found: a personal plan, "we will retry automatically"', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.problem(404, 'copay_subscription_not_found'));
    await render(<DialogHost />);
    await act(() => fixPastDuePayment());
    await settle();
    expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('account.past_due_auto_retry', 'en'))).toBeTruthy();
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it.each(['copay_subscription_not_past_due', 'copay_membership_not_eligible', 'copay_share_zero'])(
    '%s: the state moved, so the plan and the credits are re-read and nothing is said',
    async (slug) => {
      api.on('POST', '/company-plans/retry-payment', Reply.problem(409, slug));
      api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
      await render(<DialogHost />);
      await act(() => fixPastDuePayment());
      await settle();
      expect(screen.queryByText(lookup('account.cancel_failed_title', 'en'))).toBeNull();
      expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThanOrEqual(2);
      expect(api.sentAll('/profile', 'GET').length).toBeGreaterThanOrEqual(1);
      expect(openAuthSession).not.toHaveBeenCalled();
    },
  );

  it('anything else reads as the error; the key is kept for the next tap', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.problem(409, 'checkout_session_conflict'));
    await render(<DialogHost />);
    await act(() => fixPastDuePayment());
    await settle();
    expect(screen.getByText(lookup('account.cancel_failed_title', 'en'))).toBeTruthy();
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(true);
  });

  it('only a past-due plan has anything to fix', async () => {
    holdSubscription(PLUS_SUBSCRIPTION);
    await act(() => fixPastDuePayment());
    holdSubscription(null);
    await act(() => fixPastDuePayment());
    expect(api.sentAll('/company-plans/retry-payment')).toHaveLength(0);
  });
});

describe('the session hooks', () => {
  it('sign-out forgets the context and every episode', async () => {
    holdContext({ pendingInvite: { companyName: 'Acme ehf.' } });
    holdSubscription(PAST_DUE);
    retryEpisodeKey(PLUS_SUBSCRIPTION.id);
    await runSignOutCleaners({ memberId: MEMBER_A });
    expect(copayContext()).toBeNull();
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(false);
  });

  it('sign-out frees the buttons at once; the last member’s flow ending later leaves the next member’s alone', async () => {
    holdSubscription(PAST_DUE);
    api.on('GET', '/subscriptions', Reply.ok(PAST_DUE));
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: SESSION }, 201));
    const release = holdConfirm();
    openAuthSession.mockResolvedValue(DISMISSED);
    const running = fixPastDuePayment();
    await settle();
    expect(useCopayBusy.getState().retrying).toBe(true);

    await act(() => runSignOutCleaners({ memberId: MEMBER_A }));
    expect(useCopayBusy.getState()).toEqual({ activating: false, retrying: false });

    // The next member's own flow is running when the last one's ends.
    useCopayBusy.setState({ retrying: true });
    release();
    await act(() => running);
    expect(useCopayBusy.getState().retrying).toBe(true);
  });

  it('an episode ends as soon as any read shows the plan no longer past due', () => {
    holdSubscription(PAST_DUE);
    retryEpisodeKey(PLUS_SUBSCRIPTION.id);
    holdSubscription(PAST_DUE);
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(true);
    holdSubscription(PLUS_SUBSCRIPTION);
    expect(hasRetryEpisode(PLUS_SUBSCRIPTION.id)).toBe(false);
  });

  it('an activation the recovery settled after a cold start re-reads the context, quietly', async () => {
    await render(<DialogHost />);
    await act(async () =>
      presentResolution(
        {
          rail: 'copay',
          record: {
            v: 1,
            attemptId: 'attempt-1',
            memberId: MEMBER_A,
            startedAt: new Date().toISOString(),
            rail: 'copay',
            purpose: 'activate',
            externalSessionId: SESSION,
          },
          settled: true,
        },
        { checkAgain: () => undefined },
      ),
    );
    await settle();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    expect(screen.queryByText(lookup('account.cancel_failed_title', 'en'))).toBeNull();
  });
});
