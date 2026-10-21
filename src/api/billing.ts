/**
 * What the member pays and what it is charged to: `GET /billing/summary` and
 * `DELETE /billing/payment-method`, the Android port of the billing half of
 * iOS `SubscriptionService` (Services/SubscriptionService.swift).
 *
 * Adding or replacing the card (`POST /billing/payment-methods/setup-session`
 * and `/confirm`) is the money rail's (src/payments: `cardSetupOnHostedPage`),
 * so the page, its verified confirm and its recovery after process death are
 * one rail. Only the read and the removal live here.
 *
 * ONE READ, NOT THREE. The summary answers together what only makes sense
 * together: a 0 kr amount reads as a bug unless the employer's share is
 * beside it, and "no card on file" reads as an error unless the member can
 * see nothing is being charged.
 *
 * THE TAGGED UNION. `subscription` is `none` | `self` | `company`, decoded by
 * hand (as iOS does) because an UNKNOWN future `kind` must degrade to `none`
 * rather than fail: this rides the Account screen, which must render whatever
 * a newer server invents. A known kind is read strictly (a `self` without its
 * amount fails the read, and Account then hides the section rather than guess).
 */
import { apiDelete, apiGet } from './client';
import { parseIsoDate, wireId } from './wire';

/** What both paying kinds carry. */
export interface BillingDetails {
  readonly subscriptionId: string;
  readonly productName: string;
  /** `active` | `past_due`; kept as a string. */
  readonly status: string;
  /**
   * What the MEMBER is charged each period. For a company plan this is the
   * member's share, frequently 0, never the list price.
   */
  readonly amountIsk: number;
  readonly currentPeriodEndsAt: Date;
}

/** The arithmetic behind a subsidised price. */
export interface BillingCompanyDetails {
  readonly companyName: string;
  /** The plan's full price before the employer's contribution. */
  readonly memberPriceIsk: number;
  readonly subsidyIsk: number;
}

export type BillingSubscription =
  | { readonly kind: 'none' }
  | { readonly kind: 'self'; readonly details: BillingDetails }
  | { readonly kind: 'company'; readonly details: BillingDetails; readonly company: BillingCompanyDetails };

/** The card charges land on. Every column but the id may be null at the provider. */
export interface BillingPaymentMethod {
  readonly id: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expMonth: number | null;
  readonly expYear: number | null;
}

export interface BillingSummary {
  readonly subscription: BillingSubscription;
  /**
   * The card, or null. NULL IS A LEGITIMATE STATE, not an error: a member
   * whose employer covers the whole price is provisioned with no card by
   * design, and a card is collected at their first real charge.
   */
  readonly paymentMethod: BillingPaymentMethod | null;
}

/** A shape the decoder refuses; the API client turns it into `DecodingError`. */
export class BillingShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected billing shape at ${path}`);
    this.name = 'BillingShapeError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BillingShapeError(path);
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new BillingShapeError(path);
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new BillingShapeError(path);
  return value;
}

function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new BillingShapeError(path);
  return parsed;
}

/** Absent or null is null; any other wrong type fails the read (Swift's optional members). */
function optional<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
  return value === undefined || value === null ? null : read(value, path);
}

function decodeDetails(raw: Json): BillingDetails {
  return {
    subscriptionId: wireId(string(raw.subscriptionId, 'subscription.subscriptionId')),
    productName: string(raw.productName, 'subscription.productName'),
    status: string(raw.status, 'subscription.status'),
    amountIsk: int(raw.amountIsk, 'subscription.amountIsk'),
    currentPeriodEndsAt: date(raw.currentPeriodEndsAt, 'subscription.currentPeriodEndsAt'),
  };
}

function decodeSubscriptionUnion(value: unknown): BillingSubscription {
  const raw = object(value, 'subscription');
  const kind = string(raw.kind, 'subscription.kind');
  switch (kind) {
    case 'self':
      return { kind: 'self', details: decodeDetails(raw) };
    case 'company':
      return {
        kind: 'company',
        details: decodeDetails(raw),
        company: {
          companyName: string(raw.companyName, 'subscription.companyName'),
          memberPriceIsk: int(raw.memberPriceIsk, 'subscription.memberPriceIsk'),
          subsidyIsk: int(raw.subsidyIsk, 'subscription.subsidyIsk'),
        },
      };
    default:
      // `none`, and anything a newer server invents.
      return { kind: 'none' };
  }
}

function decodePaymentMethod(value: unknown, path: string): BillingPaymentMethod {
  const raw = object(value, path);
  return {
    id: string(raw.id, `${path}.id`),
    brand: optional(raw.brand, `${path}.brand`, string),
    last4: optional(raw.last4, `${path}.last4`, string),
    expMonth: optional(raw.expMonth, `${path}.expMonth`, int),
    expYear: optional(raw.expYear, `${path}.expYear`, int),
  };
}

/** `GET /billing/summary`'s `data`, read as iOS reads `BillingSummary`. */
export function decodeBillingSummary(data: unknown): BillingSummary {
  const raw = object(data, 'billing');
  return {
    subscription: decodeSubscriptionUnion(raw.subscription),
    paymentMethod: optional(raw.paymentMethod, 'paymentMethod', decodePaymentMethod),
  };
}

/**
 * What the member pays per period, or null when there is nothing to pay for
 * (no subscription at all, which is not the same as a 0 kr company plan).
 */
export function billingAmountIsk(subscription: BillingSubscription): number | null {
  return subscription.kind === 'none' ? null : subscription.details.amountIsk;
}

/** The employer's side of a company plan, or null for any other kind. */
export function billingCompanyDetails(subscription: BillingSubscription): BillingCompanyDetails | null {
  return subscription.kind === 'company' ? subscription.company : null;
}

/**
 * Foundation's `String.capitalized`: the first letter of each word upper
 * case, the rest lower case. Words break at anything that is not a letter or
 * a digit, except an apostrophe. Card brands and tier slugs are ASCII, so
 * ASCII classes suffice (the same rule as src/api/subscriptions).
 */
export function capitalizedWords(value: string): string {
  return value.replace(/[A-Za-z0-9']+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * The card's brand when the provider sent none. iOS writes this English word
 * in code, not in its string tables, and shows it in both languages: a card
 * label is printed on the card, like the brand it stands in for.
 */
const CARD_FALLBACK = 'Card';

/**
 * "Visa ···· 4242", or a plain fallback when the provider gave neither brand
 * nor last four (both columns are nullable): "Visa", or "Card ···· 4242", or
 * "Card" (iOS `BillingSummary.PaymentMethod.display`).
 */
export function paymentMethodDisplay(method: Pick<BillingPaymentMethod, 'brand' | 'last4'>): string {
  const name = capitalizedWords(method.brand ? method.brand : CARD_FALLBACK);
  if (!method.last4) return name;
  return `${name} ···· ${method.last4}`;
}

/** `GET /billing/summary`: the member's own money state in one call. */
export function fetchBillingSummary(options: { signal?: AbortSignal } = {}): Promise<BillingSummary> {
  return apiGet<BillingSummary>('/billing/summary', undefined, {
    signal: options.signal,
    decode: decodeBillingSummary,
  });
}

/**
 * `DELETE /billing/payment-method`: removes the saved card. The server refuses
 * with `409 card_required_by_subscription` while an active membership bills
 * it, and fails CLOSED on provider errors (`502 card_removal_failed`): a
 * thrown error here means the card is STILL saved, never half removed.
 */
export async function removeCard(): Promise<void> {
  await apiDelete('/billing/payment-method', undefined, {
    decode: (data) => {
      const answer = object(data, 'removal');
      if (typeof answer.removed !== 'boolean') throw new BillingShapeError('removed');
      return answer.removed;
    },
  });
}
