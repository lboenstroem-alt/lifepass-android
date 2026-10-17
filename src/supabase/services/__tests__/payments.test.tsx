/**
 * The legacy checkout service, now a shim over F8's money rails, keeps its
 * old names for TopUpScreen and AccountScreen, with iOS's return rules: the
 * cancel link verifies nothing, a tab closed with no link is verified like
 * Done, a pass is confirmed from the profile, and the checkout is saved
 * before its page opens.
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import {
  flush,
  freshPaymentsPerTest,
  MEMBER_A,
  signIn,
  storedRecords,
  usageJSON,
} from '../../../payments/__tests__/paymentsHarness';
import { PAYMENT_SUCCESS_URL, settleHostedCheckout, startCheckout } from '../payments';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  api.on('POST', '/payments/checkout-sessions', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/cs_1', externalSessionId: SESSION }, 201));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

it('keeps the old return link name', () => {
  expect(PAYMENT_SUCCESS_URL).toBe('lifepass://payment-success');
});

it('the cancel link verifies nothing', async () => {
  signIn();
  openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-canceled' });
  await expect(startCheckout('plan-plus')).resolves.toBe('canceled');
  expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
  expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/c/cs_1', 'lifepass://payment-', { createTask: false });
  expect(await storedRecords()).toEqual([]);
});

it('a pass paid and closed with no link is confirmed from the profile, saved while the page was up', async () => {
  signIn(MEMBER_A, { usage: usageJSON([{ id: '11111111-1111-4111-8111-111111111111' }]) });
  let savedWhileOpen: unknown[] = [];
  openAuthSession.mockImplementation(async () => {
    savedWhileOpen = await storedRecords();
    return DISMISSED;
  });
  api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
  api.on(
    'GET',
    '/profile',
    Reply.ok({
      id: MEMBER_A,
      email: 'member@example.com',
      kennitalaVerified: false,
      marketingConsent: false,
      usage: usageJSON([{ id: '11111111-1111-4111-8111-111111111111' }, { id: '22222222-2222-4222-8222-222222222222' }]),
    }),
  );
  await expect(startCheckout('pass-day', { promotionCode: '  FRIMANNPASS ' })).resolves.toBe('fulfilled');
  expect(savedWhileOpen).toEqual([
    expect.objectContaining({
      rail: 'plan',
      externalSessionId: SESSION,
      plan: expect.objectContaining({ productSlug: 'pass-day', prePurchasePassIds: ['11111111-1111-4111-8111-111111111111'] }),
    }),
  ]);
  expect((api.sent('/payments/checkout-sessions').body as { promotionCode?: string }).promotionCode).toBe('FRIMANNPASS');
  expect(api.sentAll('/payments/status')).toHaveLength(0);
  expect(await storedRecords()).toEqual([]);
});

it('a co-pay page is pulled after any close', async () => {
  openAuthSession.mockResolvedValue(DISMISSED);
  api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
  await expect(settleHostedCheckout('https://pay.kling.is/c/copay', SESSION)).resolves.toBe('fulfilled');
  expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: SESSION });

  api.reset();
  api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
  openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-canceled' });
  await expect(settleHostedCheckout('https://pay.kling.is/c/copay', SESSION)).resolves.toBe('canceled');
  expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(3);
  await flush();
});

it('a page that never opened is a cancel', async () => {
  openAuthSession.mockRejectedValue(new Error('no browser'));
  await expect(settleHostedCheckout('https://pay.kling.is/c/copay', SESSION)).resolves.toBe('canceled');
  expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
});
