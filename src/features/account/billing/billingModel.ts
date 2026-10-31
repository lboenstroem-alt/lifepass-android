/**
 * What Account's billing section says, decided without React: the rules of
 * iOS `AccountView.billingSection` and `cardActions`
 * (Views/Profile/AccountView.swift), so the tests read exactly the lines the
 * section draws.
 *
 *   - Hidden entirely when there is nothing to say (no subscription and no
 *     card): a pass-only member is not shown an empty "Billing" heading.
 *   - "You pay": "ISK 14,900 / month", or, at 0, "Nothing — fully covered".
 *     0 kr is a REAL answer, not a missing one: the row says it plainly.
 *   - "Employer" (a company plan): "{company} covers {amount} of {full}", the
 *     arithmetic behind a subsidised price, without which a member sees a
 *     number far below the plan price and cannot tell whether it is right.
 *   - "Payment card": "Visa ···· 4242", or "No card on file", a statement
 *     of fact (a fully covered company member has no card on purpose).
 *   - Add card or Replace card always; Remove card only with a card AND
 *     nothing charged to it (hidden, not disabled, while a membership bills
 *     it: the server would refuse with 409 anyway). Replace stays on a live
 *     membership: it is the self-cure for an expiring or declined card.
 */
import {
  billingAmountIsk,
  billingCompanyDetails,
  paymentMethodDisplay,
  type BillingSummary,
} from '../../../api/billing';
import { isProblem } from '../../../api/errors';
import { iskPrefix, translate, type Lang } from '../../../i18n';

export interface BillingRow {
  /** Stable, for tests and TalkBack grouping. */
  readonly id: 'youPay' | 'employer' | 'card';
  readonly label: string;
  readonly value: string;
}

export interface BillingView {
  readonly rows: readonly BillingRow[];
  readonly hasCard: boolean;
  /** Remove card is offered: a card, and the membership charges nothing to it. */
  readonly canRemove: boolean;
}

/** Whether the section shows at all: an amount to state, or a card on file. */
export function showsBilling(summary: BillingSummary | null): summary is BillingSummary {
  return summary !== null && (billingAmountIsk(summary.subscription) !== null || summary.paymentMethod !== null);
}

/** The section's rows and actions, in `lang`; null when it is hidden. */
export function billingView(summary: BillingSummary | null, lang: Lang): BillingView | null {
  if (!showsBilling(summary)) return null;
  const rows: BillingRow[] = [];
  const amount = billingAmountIsk(summary.subscription);
  if (amount !== null) {
    rows.push({
      id: 'youPay',
      label: translate('account.billing_you_pay', lang),
      value:
        amount === 0
          ? translate('account.billing_free', lang)
          : `${iskPrefix(amount)}${translate('account.billing_per_month_suffix', lang)}`,
    });
  }
  const company = billingCompanyDetails(summary.subscription);
  if (company) {
    rows.push({
      id: 'employer',
      label: translate('account.billing_employer', lang),
      value: translate('account.billing_employer_covers', lang, {
        company: company.companyName,
        amount: iskPrefix(company.subsidyIsk),
        full: iskPrefix(company.memberPriceIsk),
      }),
    });
  }
  rows.push({
    id: 'card',
    label: translate('account.billing_card', lang),
    value: summary.paymentMethod ? paymentMethodDisplay(summary.paymentMethod) : translate('account.billing_no_card', lang),
  });
  const hasCard = summary.paymentMethod !== null;
  return { rows, hasCard, canRemove: hasCard && !((amount ?? 0) > 0) };
}

/**
 * The words for a removal the server refused. The card is still saved
 * either way (fail-closed): 409 `card_required_by_subscription` explains why;
 * anything else (502 `card_removal_failed`, offline) says nothing changed.
 */
export function removeFailureKey(error: unknown): string {
  return isProblem(error, 'card_required_by_subscription') ? 'account.card_remove_blocked' : 'account.card_remove_failed';
}
