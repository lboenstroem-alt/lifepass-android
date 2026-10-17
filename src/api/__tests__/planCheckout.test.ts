/**
 * Plan and pass checkout on the wire: the F8 ports of iOS
 * ContractFixtureTests.testPlanCheckoutReturnsToTheApp and the
 * `PaymentService` rules PlansCheckoutTests rely on (an explicit fulfilled
 * only, a missing route degrades to the polls, the status poll's back-off).
 */
import { api, Reply } from '@test/server';

import { MerchantInfo } from '../../config/merchantInfo';
import { lookup } from '../../i18n';
import { NO_WAITS, setPaymentTimingForTests } from '../../payments/timing';
import { refusalMessage } from '../errorFormatter';
import { LocalizedError, ProblemError } from '../errors';
import {
  checkoutBody,
  confirmCheckout,
  confirmCheckoutWithRetries,
  createCheckout,
  pollPaymentStatus,
} from '../planCheckout';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';

beforeEach(() => setPaymentTimingForTests(NO_WAITS));
afterEach(() => setPaymentTimingForTests(null));

describe('creating a checkout', () => {
  it('returns to the app, with the documents the purchase is agreed under (testPlanCheckoutReturnsToTheApp)', async () => {
    api.on(
      'POST',
      '/payments/checkout-sessions',
      Reply.ok(
        {
          checkoutSessionId: '1f1e2d3c-4b5a-4968-8776-655443322110',
          checkoutUrl: 'https://pay.kling.is/c/cs_1',
          externalSessionId: SESSION,
          orderId: '2f1e2d3c-4b5a-4968-8776-655443322110',
        },
        201,
      ),
    );
    const session = await createCheckout('plan-plus');
    expect(session).toEqual({ url: 'https://pay.kling.is/c/cs_1', externalSessionId: SESSION });

    const request = expectSentToMatchContract('POST', '/payments/checkout-sessions');
    const body = request.body as Record<string, unknown>;
    expect(body.productSlug).toBe('plan-plus');
    expect(body.successUrl).toBe('lifepass://payment-success');
    expect(body.cancelUrl).toBe('lifepass://payment-canceled');
    const terms = body.terms as Record<string, unknown>;
    expect(Object.keys(terms).sort()).toEqual(['acceptedAt', 'privacyVersion', 'termsVersion']);
    expect(terms.privacyVersion).toBe(MerchantInfo.privacyVersion);
    expect(terms.termsVersion).toBe(MerchantInfo.termsVersion);
    expect(terms.acceptedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing the member did not choose.
    expect(body).not.toHaveProperty('saveCard');
    expect(body).not.toHaveProperty('promotionCode');
  });

  it('a new key per checkout: a retry can never open a second order under the first one', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/1', externalSessionId: SESSION }, 201));
    await createCheckout('pass-day');
    await createCheckout('pass-day');
    const keys = api.sentAll('/payments/checkout-sessions').map((r) => r.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(2);
  });

  it('carries the pass card consent and a discount code only when given', () => {
    const at = new Date('2026-10-17T09:30:00.250Z');
    expect(checkoutBody('pass-explorer', { saveCard: false, promotionCode: 'FRIMANNPASS' }, at)).toEqual({
      productSlug: 'pass-explorer',
      successUrl: 'lifepass://payment-success',
      cancelUrl: 'lifepass://payment-canceled',
      saveCard: false,
      promotionCode: 'FRIMANNPASS',
      terms: { acceptedAt: '2026-10-17T09:30:00Z', privacyVersion: '2026-09-v12', termsVersion: '2026-09-v6' },
    });
    expect(checkoutBody('plan-plus', { saveCard: null, promotionCode: '' }, at)).not.toHaveProperty('promotionCode');
  });

  it('takes the older `url` key, and a checkout with no page is the app’s own sentence', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.ok({ url: 'https://pay.kling.is/c/2' }, 201));
    await expect(createCheckout('plan-base')).resolves.toEqual({ url: 'https://pay.kling.is/c/2', externalSessionId: null });

    api.on('POST', '/payments/checkout-sessions', Reply.ok({ externalSessionId: SESSION }, 201));
    const error = await createCheckout('plan-base').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocalizedError);
    expect((error as Error).message).toBe(lookup('payment.err.checkout', 'en'));
  });

  it('a refused discount code is thrown as the problem, for the code box to read', async () => {
    api.on('POST', '/payments/checkout-sessions', Reply.problem(400, 'discount_code_expired'));
    const error = await createCheckout('pass-day', { promotionCode: 'OLD' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).slug).toBe('discount_code_expired');
  });
});

describe('the verified pull', () => {
  it('is true only on an explicit fulfilled status', async () => {
    for (const [status, expected] of [
      ['fulfilled', true],
      ['completed', true],
      ['paid', true],
      ['already_fulfilled', true],
      ['FULFILLED', true],
      ['processing', false],
      ['expired', false],
      ['failed', false],
    ] as const) {
      api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status }));
      await expect(confirmCheckout(SESSION)).resolves.toBe(expected);
    }
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({}));
    await expect(confirmCheckout(SESSION)).resolves.toBe(false);
    const sent = api.sent('/payments/checkout-sessions/confirm');
    expect(sent.body).toEqual({ externalSessionId: SESSION });
    expect(sent.headers['idempotency-key']).toBeDefined();
  });

  it('a server without the route falls back to the polls; any other refusal is thrown', async () => {
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.problem(404, 'not_found'));
    await expect(confirmCheckout(SESSION)).resolves.toBe(false);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.raw(405, 'Method Not Allowed', 'text/plain'));
    await expect(confirmCheckout(SESSION)).resolves.toBe(false);
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.problem(503, 'internal_error'));
    await expect(confirmCheckout(SESSION)).rejects.toBeInstanceOf(ProblemError);
  });

  it('is tried three times, a throw counting as not yet', async () => {
    let n = 0;
    api.on('POST', '/payments/checkout-sessions/confirm', () => {
      n += 1;
      return n === 1 ? Reply.problem(503, 'internal_error') : n === 2 ? Reply.ok({ status: 'processing' }) : Reply.ok({ status: 'fulfilled' });
    });
    await expect(confirmCheckoutWithRetries(SESSION)).resolves.toBe(true);
    expect(n).toBe(3);

    n = 0;
    api.on('POST', '/payments/checkout-sessions/confirm', () => {
      n += 1;
      return Reply.ok({ status: 'processing' });
    });
    await expect(confirmCheckoutWithRetries(SESSION)).resolves.toBe(false);
    expect(n).toBe(3);
  });
});

describe('the status poll', () => {
  it('asks for the purchased plan until it is fulfilled', async () => {
    let n = 0;
    api.on('GET', '/payments/status', () => {
      n += 1;
      return n < 3
        ? Reply.ok({ status: 'pending' })
        : Reply.ok({
            status: 'fulfilled',
            kind: 'subscription',
            slug: 'plan-plus',
            fulfilledAt: '2026-10-17T09:30:00.000Z',
            orderId: null,
            amountIsk: null,
          });
    });
    await expect(pollPaymentStatus('plan-plus')).resolves.toBe(true);
    expect(n).toBe(3);
    const sent = expectSentToMatchContract('GET', '/payments/status');
    expect(sent.query).toEqual({ plan: 'plan-plus' });
  });

  it('gives up after its attempts, and throws a refusal for the screen to word', async () => {
    api.on('GET', '/payments/status', Reply.ok({ status: 'pending' }));
    await expect(pollPaymentStatus('plan-plus', 4)).resolves.toBe(false);
    expect(api.sentAll('/payments/status')).toHaveLength(4);

    api.on('GET', '/payments/status', Reply.raw(504, '<html><body><h1>504 Gateway Timeout</h1></body></html>'));
    const error = await pollPaymentStatus('plan-plus').catch((e: unknown) => e);
    // In the member's words, never "HTTP 504" (testAGatewayPageOnTheReturnsStatusCheckIsNeverAnHTTPCode).
    expect(refusalMessage(error)).toBe(lookup('error.server', 'en'));
    expect(refusalMessage(error)).not.toMatch(/504|HTTP/);
  });
});
