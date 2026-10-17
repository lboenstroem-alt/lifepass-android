/**
 * The member's recurring plan, `GET /subscriptions`: the Android port of iOS
 * `Subscription` (Models/Subscription.swift) and the read half of
 * `SubscriptionService`.
 *
 * Credits and luxury are gone from the v1 API: what a member may do lives on
 * the profile's `usage` block. This model only describes the plan's
 * lifecycle: which product, its status, the billing period and cancellation.
 *
 * The answer is `null` when there is no plan. A read that FAILS is not "no
 * plan": the app store keeps the plan it knew (`appStore.loadSubscription`).
 */
import { apiGet } from './client';
import { parseIsoDate, wireId } from './wire';

export interface Subscription {
  /** The row id, referenced by `POST /subscriptions/cancel` and the co-pay retry. Lower case. */
  readonly id: string;
  readonly productSlug: string;
  readonly productName: string;
  /** `active` | `past_due`. Kept as a string, as iOS does. */
  readonly status: string;
  readonly currentPeriodStartsAt: Date;
  readonly currentPeriodEndsAt: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelledAt: Date | null;
}

/** A shape the decoder refuses; the API client turns it into `DecodingError`. */
export class SubscriptionShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected subscription shape at ${path}`);
    this.name = 'SubscriptionShapeError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SubscriptionShapeError(path);
  return value;
}

function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new SubscriptionShapeError(path);
  return parsed;
}

/** `GET /subscriptions`' `data`: null for no plan, else the plan read strictly. */
export function decodeSubscription(data: unknown): Subscription | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new SubscriptionShapeError('subscription');
  const raw = data as Record<string, unknown>;
  const id = string(raw.id, 'id');
  if (!UUID.test(id)) throw new SubscriptionShapeError('id');
  if (typeof raw.cancelAtPeriodEnd !== 'boolean') throw new SubscriptionShapeError('cancelAtPeriodEnd');
  return {
    id: wireId(id),
    productSlug: string(raw.productSlug, 'productSlug'),
    productName: string(raw.productName, 'productName'),
    status: string(raw.status, 'status'),
    currentPeriodStartsAt: date(raw.currentPeriodStartsAt, 'currentPeriodStartsAt'),
    currentPeriodEndsAt: date(raw.currentPeriodEndsAt, 'currentPeriodEndsAt'),
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd,
    cancelledAt: raw.cancelledAt === null || raw.cancelledAt === undefined ? null : date(raw.cancelledAt, 'cancelledAt'),
  };
}

/** `GET /subscriptions`: the current plan, or null when none is active. */
export function fetchActiveSubscription(options: { signal?: AbortSignal } = {}): Promise<Subscription | null> {
  return apiGet<Subscription | null>('/subscriptions', undefined, {
    signal: options.signal,
    decode: decodeSubscription,
  });
}

/**
 * A plan the member holds: active, or in dunning (`past_due`). Never use this
 * for the health gate: it is true in dunning, which is exactly when the plan
 * must freeze (see `resolveHealthAccess`).
 */
export function isSubscriptionActive(subscription: Subscription | null | undefined): boolean {
  return subscription?.status === 'active' || subscription?.status === 'past_due';
}

/** Dunning: the monthly charge failed and access is suspended until it is cured (`usage.tier` is null meanwhile). */
export function isSubscriptionPastDue(subscription: Subscription | null | undefined): boolean {
  return subscription?.status === 'past_due';
}

/**
 * Foundation's `String.capitalized` for a product slug: the first letter of
 * each word upper case, the rest lower case. Words break at anything that is
 * not a letter or a digit, except an apostrophe ("plan-gold" reads
 * "Plan-Gold"). Slugs are ASCII, so ASCII classes suffice.
 */
function capitalized(value: string): string {
  return value.replace(/[A-Za-z0-9']+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * The plan's marketing name: the API's `productName`, else a label from the
 * v1 slug. A product name, not copy, so it reads the same in both languages
 * (iOS `Subscription.planDisplayName`).
 */
export function planDisplayName(subscription: Pick<Subscription, 'productName' | 'productSlug'>): string {
  if (subscription.productName) return subscription.productName;
  switch (subscription.productSlug) {
    case 'plan-base':
    case 'plan-base-annual':
      return 'LifePass Base';
    case 'plan-plus':
    case 'plan-plus-annual':
      return 'LifePass Plus';
    case 'plan-max':
    case 'plan-max-annual':
      return 'LifePass Max';
    default:
      return capitalized(subscription.productSlug);
  }
}
