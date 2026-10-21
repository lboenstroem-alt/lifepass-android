/**
 * The billing section's rules (iOS AccountView.billingSection / cardActions),
 * without React: when it shows, its rows in both languages, and when Remove
 * is offered.
 */
import { decodeBillingSummary } from '../../../../api/billing';
import { ProblemError, TransportError } from '../../../../api/errors';
import { billingView, removeFailureKey, showsBilling } from '../billingModel';

const details = {
  subscriptionId: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
  productName: 'Plus',
  productSlug: 'plan-plus',
  status: 'active',
  currentPeriodEndsAt: '2026-10-01T00:00:00Z',
};
const card = { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: null, expYear: null };

const summary = (subscription: object, paymentMethod: object | null = null) =>
  decodeBillingSummary({ subscription, paymentMethod });

describe('showsBilling', () => {
  it('hides for nothing to pay and no card, and for no answer', () => {
    expect(showsBilling(null)).toBe(false);
    expect(showsBilling(summary({ kind: 'none' }))).toBe(false);
    expect(billingView(summary({ kind: 'none' }), 'en')).toBeNull();
  });

  it('shows for an amount (even 0) or a card', () => {
    expect(showsBilling(summary({ kind: 'self', ...details, amountIsk: 0 }))).toBe(true);
    expect(showsBilling(summary({ kind: 'none' }, card))).toBe(true);
  });
});

describe('billingView', () => {
  it('a 0 kr plan reads billing_free, not hidden', () => {
    const view = billingView(summary({ kind: 'self', ...details, amountIsk: 0 }), 'en')!;
    expect(view.rows).toEqual([
      { id: 'youPay', label: 'You pay', value: 'Nothing — fully covered' },
      { id: 'card', label: 'Payment card', value: 'No card on file' },
    ]);
    expect(view.hasCard).toBe(false);
    expect(view.canRemove).toBe(false);
  });

  it('a co-pay share with its employer arithmetic, in Icelandic', () => {
    const view = billingView(
      summary({ kind: 'company', ...details, amountIsk: 3000, companyName: 'Acme ehf.', memberPriceIsk: 12000, subsidyIsk: 9000 }, card),
      'is',
    )!;
    expect(view.rows).toEqual([
      { id: 'youPay', label: 'Þú greiðir', value: 'ISK 3,000 / mán.' },
      { id: 'employer', label: 'Vinnuveitandi', value: 'Acme ehf. greiðir ISK 9,000 af ISK 12,000' },
      { id: 'card', label: 'Greiðslukort', value: 'Visa ···· 4242' },
    ]);
    // A share is charged to the card: Remove is hidden.
    expect(view.canRemove).toBe(false);
  });

  it('Remove only with a card and nothing charged to it', () => {
    expect(billingView(summary({ kind: 'none' }, card), 'en')!.canRemove).toBe(true);
    expect(billingView(summary({ kind: 'self', ...details, amountIsk: 0 }, card), 'en')!.canRemove).toBe(true);
    expect(billingView(summary({ kind: 'self', ...details, amountIsk: 1 }, card), 'en')!.canRemove).toBe(false);
  });
});

describe('removeFailureKey', () => {
  it('409 card_required_by_subscription has its own words; anything else says nothing changed', () => {
    const problem = (slug: string, status: number) =>
      new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);
    expect(removeFailureKey(problem('card_required_by_subscription', 409))).toBe('account.card_remove_blocked');
    expect(removeFailureKey(problem('card_removal_failed', 502))).toBe('account.card_remove_failed');
    expect(removeFailureKey(problem('no_card_on_file', 404))).toBe('account.card_remove_failed');
    expect(removeFailureKey(new TransportError('offline'))).toBe('account.card_remove_failed');
  });
});
