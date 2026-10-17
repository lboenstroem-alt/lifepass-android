/**
 * The live page openers for plans, cards and co-pay: what each one asks
 * after its page, and what it hands the screen.
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { useAppStore } from '../../stores/appStore';
import { PLUS_SUBSCRIPTION } from '../../stores/__tests__/storeHarness';
import { cardSetupOnHostedPage, checkoutOnHostedPage, copayOnHostedPage, recheckPlanPurchase } from '../attempts';

import { freshPaymentsPerTest, MEMBER_A, signIn, storedRecords } from './paymentsHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false }));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

describe('card setup', () => {
  it('always confirms after the page, whichever link closed it', async () => {
    api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({ url: 'https://pay.kling.is/setup/s_1' }));
    api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: null }));
    for (const result of [
      { type: 'success', url: 'lifepass://card-setup-canceled' },
      { type: 'success', url: 'lifepass://card-setup-success' },
      { type: 'dismiss' },
    ] as WebBrowser.WebBrowserAuthSessionResult[]) {
      openAuthSession.mockResolvedValueOnce(result);
      await expect(cardSetupOnHostedPage({ memberId: MEMBER_A })).resolves.toEqual({ kind: 'confirmed', card: null });
    }
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(3);
    expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/setup/s_1', 'lifepass://card-setup-', {
      createTask: false,
    });
    expect(await storedRecords()).toEqual([]);
  });

  it('a setup that cannot start or a page that never opened is the add-failed answer, with nothing confirmed', async () => {
    api.on('POST', '/billing/payment-methods/setup-session', Reply.problem(503, 'internal_error'));
    await expect(cardSetupOnHostedPage({ memberId: MEMBER_A })).resolves.toMatchObject({ kind: 'notOpened' });
    expect(openAuthSession).not.toHaveBeenCalled();

    api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({ url: 'https://pay.kling.is/setup/s_2' }));
    openAuthSession.mockRejectedValueOnce(new Error('no browser'));
    await expect(cardSetupOnHostedPage({ memberId: MEMBER_A })).resolves.toMatchObject({ kind: 'notOpened' });
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(0);
    expect(await storedRecords()).toEqual([]);
  });

  it('a pull that fails still ends the page (Account re-reads billing)', async () => {
    api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({ url: 'https://pay.kling.is/setup/s_1' }));
    api.on('POST', '/billing/payment-methods/confirm', Reply.problem(503, 'internal_error'));
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    await expect(cardSetupOnHostedPage({ memberId: MEMBER_A })).resolves.toEqual({ kind: 'confirmed', card: undefined });
  });
});

describe('plan checkout', () => {
  const plan = { productSlug: 'plan-plus', planName: 'Plus', prePurchasePassIds: [], prePurchaseSubSlug: null };

  it('verifies after Done: the pull confirms a membership, and the screen is told when it starts', async () => {
    openAuthSession.mockResolvedValueOnce({ type: 'success', url: 'lifepass://payment-success' });
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    const verifying = jest.fn();
    await expect(
      checkoutOnHostedPage({ memberId: MEMBER_A, url: 'https://pay.kling.is/c/1', externalSessionId: SESSION, plan, onVerifying: verifying }),
    ).resolves.toEqual({ kind: 'verified', verification: { kind: 'confirmed' }, presented: false });
    expect(verifying).toHaveBeenCalledTimes(1);
    expect(api.sentAll('/payments/status')).toHaveLength(0);
  });

  it('the cancel link verifies nothing', async () => {
    openAuthSession.mockResolvedValueOnce({ type: 'success', url: 'lifepass://payment-canceled' });
    const verifying = jest.fn();
    await expect(
      checkoutOnHostedPage({ memberId: MEMBER_A, url: 'https://pay.kling.is/c/1', externalSessionId: SESSION, plan, onVerifying: verifying }),
    ).resolves.toEqual({ kind: 'verified', verification: { kind: 'cancelled' }, presented: false });
    expect(verifying).not.toHaveBeenCalled();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
  });

  it('a membership the pull cannot confirm is found by the status poll', async () => {
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on(
      'GET',
      '/payments/status',
      Reply.ok({ status: 'fulfilled', kind: 'subscription', slug: 'plan-plus', fulfilledAt: '2026-10-17T09:00:00.000Z', orderId: null, amountIsk: null }),
    );
    const result = await checkoutOnHostedPage({ memberId: MEMBER_A, url: 'https://pay.kling.is/c/1', externalSessionId: SESSION, plan });
    expect(result).toMatchObject({ verification: { kind: 'confirmed' } });
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(3);
    expect(api.sent('/payments/status').query).toEqual({ plan: 'plan-plus' });
  });

  it('a refused status check is the refusal, never claimed as bought', async () => {
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/payments/status', Reply.raw(504, '<html>504</html>'));
    const result = await checkoutOnHostedPage({ memberId: MEMBER_A, url: 'https://pay.kling.is/c/1', externalSessionId: SESSION, plan });
    expect(result).toMatchObject({ kind: 'verified', verification: { kind: 'failed' } });
  });

  it('a settling that throws lets the attempt go: the next page still opens, and the old record is settled first', async () => {
    const fallback = { memberId: MEMBER_A, url: 'https://www.lifepass.is/plans?completePurchase=plan-plus', externalSessionId: null, plan };
    const realRefresh = useAppStore.getState().refreshCredits;
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    useAppStore.setState({ refreshCredits: () => Promise.reject(new Error('the store broke')) });
    try {
      await expect(checkoutOnHostedPage(fallback)).rejects.toThrow('the store broke');
    } finally {
      useAppStore.setState({ refreshCredits: realRefresh });
    }
    // Saved for a later return to the app, and no longer anyone's.
    expect(await storedRecords()).toHaveLength(1);

    openAuthSession.mockResolvedValueOnce({ type: 'success', url: 'lifepass://payment-canceled' });
    await expect(checkoutOnHostedPage({ ...fallback, externalSessionId: SESSION })).resolves.toEqual({
      kind: 'verified',
      verification: { kind: 'cancelled' },
      presented: false,
    });
    expect(openAuthSession).toHaveBeenCalledTimes(2);
    expect(await storedRecords()).toEqual([]);
  });

  it('the web-first fallback checks the profile quietly, and the chip checks again', async () => {
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    const result = await checkoutOnHostedPage({ memberId: MEMBER_A, url: 'https://www.lifepass.is/plans?completePurchase=plan-plus', externalSessionId: null, plan });
    expect(result).toMatchObject({ verification: { kind: 'unverified' } });
    expect(api.sentAll('/profile', 'GET')).toHaveLength(3);

    api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
    await expect(recheckPlanPurchase(plan)).resolves.toEqual({ kind: 'confirmed' });
  });

  it('the chip is a short check: two profile reads, and the chip stays when nothing shows (iOS recheckPurchase)', async () => {
    await expect(recheckPlanPurchase(plan)).resolves.toEqual({ kind: 'unverified' });
    expect(api.sentAll('/profile', 'GET')).toHaveLength(2);
    expect(api.sentAll('/payments/status')).toHaveLength(0);
  });
});

describe('co-pay', () => {
  it('activation: the pull, then the plan re-read until it is there', async () => {
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    let reads = 0;
    api.on('GET', '/subscriptions', () => {
      reads += 1;
      return Reply.ok(reads < 2 ? null : PLUS_SUBSCRIPTION);
    });
    await expect(
      copayOnHostedPage({ memberId: MEMBER_A, purpose: 'activate', url: 'https://pay.kling.is/c/copay', externalSessionId: SESSION }),
    ).resolves.toEqual({ kind: 'returned', settled: true });
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(1);
    expect(await storedRecords()).toEqual([]);
  });

  it('a past-due share still past due is not settled, and nothing is said', async () => {
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/subscriptions', Reply.ok({ ...PLUS_SUBSCRIPTION, status: 'past_due' }));
    await expect(
      copayOnHostedPage({ memberId: MEMBER_A, purpose: 'retry', url: 'https://pay.kling.is/c/copay', externalSessionId: SESSION }),
    ).resolves.toEqual({ kind: 'returned', settled: false });
    // Four reads of the plan, then the credits.
    expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThanOrEqual(4);
  });
});
