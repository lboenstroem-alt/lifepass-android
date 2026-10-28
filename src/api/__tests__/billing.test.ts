/**
 * `GET /billing/summary` and `DELETE /billing/payment-method`: the model
 * (iOS `BillingSummary`, Services/SubscriptionService.swift) and the calls,
 * checked against the contract. Ports ContractFixtureTests'
 * testBillingSummaryReadsEveryKindAndDegradesAnUnknownOne.
 */
import { expectResponseDataValid, sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import {
  billingAmountIsk,
  billingCompanyDetails,
  capitalizedWords,
  decodeBillingSummary,
  fetchBillingSummary,
  paymentMethodDisplay,
  removeCard,
} from '../billing';
import { DecodingError, isProblem } from '../errors';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const company = {
  subscription: {
    kind: 'company',
    subscriptionId: '5F0C2A6E-8A51-4E0B-9D7E-2B9A1F3C4D10',
    productName: 'Plus',
    productSlug: 'plan-plus',
    status: 'active',
    amountIsk: 0,
    currentPeriodEndsAt: '2026-10-01T00:00:00Z',
    companyName: 'Acme ehf.',
    memberPriceIsk: 12000,
    subsidyIsk: 12000,
  },
  paymentMethod: null,
};

const selfPaid = {
  subscription: {
    kind: 'self',
    subscriptionId: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productName: 'Plus',
    productSlug: 'plan-plus',
    status: 'active',
    amountIsk: 14900,
    currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
  },
  paymentMethod: {
    id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
  },
};

describe('the billing summary', () => {
  it('reads every kind and degrades an unknown one (iOS ContractFixtureTests)', () => {
    const covered = decodeBillingSummary(company);
    expect(billingAmountIsk(covered.subscription)).toBe(0);
    expect(covered.paymentMethod).toBeNull(); // no card yet is a state, not an error
    expect(billingCompanyDetails(covered.subscription)).toEqual({
      companyName: 'Acme ehf.',
      memberPriceIsk: 12000,
      subsidyIsk: 12000,
    });

    const future = decodeBillingSummary({
      subscription: { kind: 'flex' },
      paymentMethod: { id: 'pm_1', brand: 'visa', last4: '4242' },
    });
    expect(future.subscription).toEqual({ kind: 'none' });
    expect(billingAmountIsk(future.subscription)).toBeNull();
    expect(future.paymentMethod && paymentMethodDisplay(future.paymentMethod)).toBe('Visa ···· 4242');
  });

  it('a self-paid plan carries its amount and its period; only a company plan carries company details', () => {
    const summary = decodeBillingSummary(selfPaid);
    expect(summary.subscription.kind).toBe('self');
    expect(billingAmountIsk(summary.subscription)).toBe(14900);
    expect(billingCompanyDetails(summary.subscription)).toBeNull();
    if (summary.subscription.kind !== 'self') throw new Error('expected self');
    expect(summary.subscription.details.currentPeriodEndsAt.toISOString()).toBe('2026-10-01T10:14:03.512Z');
    expect(summary.paymentMethod).toEqual({
      id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  });

  it('none is nothing to pay for, which is not the same as a 0 kr company plan', () => {
    const none = decodeBillingSummary({ subscription: { kind: 'none' }, paymentMethod: null });
    expect(billingAmountIsk(none.subscription)).toBeNull();
    expect(billingAmountIsk(decodeBillingSummary(company).subscription)).toBe(0);
  });

  it('a known kind is read strictly, so a summary the app cannot read fails rather than guesses', () => {
    const { amountIsk: _dropped, ...withoutAmount } = selfPaid.subscription;
    expect(() => decodeBillingSummary({ ...selfPaid, subscription: withoutAmount })).toThrow();
    expect(() =>
      decodeBillingSummary({ ...company, subscription: { ...company.subscription, subsidyIsk: '14900' } }),
    ).toThrow();
    expect(() => decodeBillingSummary({ paymentMethod: null })).toThrow();
    expect(() => decodeBillingSummary({ subscription: {}, paymentMethod: null })).toThrow();
    expect(() => decodeBillingSummary({ ...selfPaid, paymentMethod: { brand: 'visa' } })).toThrow();
  });

  it('a missing card member reads as no card', () => {
    const { paymentMethod: _card, ...noKey } = selfPaid;
    expect(decodeBillingSummary(noKey).paymentMethod).toBeNull();
  });

  it("the contract's own sample decodes", () => {
    const sample = sampleResponse('GET', '/billing/summary', 200, 'full');
    expect(() => decodeBillingSummary(sample)).not.toThrow();
    expectResponseDataValid('GET', '/billing/summary', 200, company);
    expectResponseDataValid('GET', '/billing/summary', 200, selfPaid);
  });
});

describe('the card on file, as the member reads it', () => {
  it('brand capitalised with the last four', () => {
    expect(paymentMethodDisplay({ brand: 'visa', last4: '4242' })).toBe('Visa ···· 4242');
    expect(paymentMethodDisplay({ brand: 'MASTERCARD', last4: '0005' })).toBe('Mastercard ···· 0005');
    expect(paymentMethodDisplay({ brand: 'american express', last4: '1000' })).toBe('American Express ···· 1000');
  });

  it('the brand alone without a last four, and "Card" without a brand', () => {
    expect(paymentMethodDisplay({ brand: 'visa', last4: null })).toBe('Visa');
    expect(paymentMethodDisplay({ brand: 'visa', last4: '' })).toBe('Visa');
    expect(paymentMethodDisplay({ brand: null, last4: '4242' })).toBe('Card ···· 4242');
    expect(paymentMethodDisplay({ brand: '', last4: null })).toBe('Card');
  });

  it('capitalises as Foundation does', () => {
    expect(capitalizedWords('plus')).toBe('Plus');
    expect(capitalizedWords('plan-gold')).toBe('Plan-Gold');
    expect(capitalizedWords('MAX')).toBe('Max');
  });
});

describe('the calls', () => {
  it('GET /billing/summary, signed in', async () => {
    api.on('GET', '/billing/summary', Reply.ok(selfPaid));
    const summary = await fetchBillingSummary();
    expect(summary.subscription.kind).toBe('self');
    const sent = expectSentToMatchContract('GET', '/billing/summary');
    expect(sent.headers.authorization).toBe('Bearer test-token');
  });

  it('an unreadable summary is a decoding error (Account then hides the section)', async () => {
    api.on('GET', '/billing/summary', Reply.ok({ subscription: { kind: 'self' } }));
    await expect(fetchBillingSummary()).rejects.toBeInstanceOf(DecodingError);
  });

  it('DELETE /billing/payment-method with no body', async () => {
    api.on('DELETE', '/billing/payment-method', Reply.ok({ removed: true }));
    await removeCard();
    const sent = expectSentToMatchContract('DELETE', '/billing/payment-method');
    expect(sent.rawBody ?? '').toBe('');
  });

  it('a removal the server refuses throws its code: the card is still saved', async () => {
    api.on('DELETE', '/billing/payment-method', Reply.problem(409, 'card_required_by_subscription'));
    const blocked = await removeCard().catch((error: unknown) => error);
    expect(isProblem(blocked, 'card_required_by_subscription')).toBe(true);

    api.on('DELETE', '/billing/payment-method', Reply.problem(502, 'card_removal_failed'));
    const failed = await removeCard().catch((error: unknown) => error);
    expect(isProblem(failed, 'card_removal_failed')).toBe(true);
  });
});
