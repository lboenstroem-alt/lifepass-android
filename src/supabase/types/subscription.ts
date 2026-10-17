/**
 * The first Android build's plan type, kept for the screens that still import
 * it. The model and its helpers live in src/api/subscriptions.ts (iOS
 * `Subscription`); the dates are `Date`s there, read strictly from the API.
 */
import {
  isSubscriptionActive,
  isSubscriptionPastDue,
  planDisplayName,
  type Subscription,
} from '../../api/subscriptions';

export type { Subscription };
export { planDisplayName };

/** A plan the member holds: active, or in dunning. */
export function isActive(sub: Subscription): boolean {
  return isSubscriptionActive(sub);
}

/** Dunning: the monthly charge failed; access is suspended until cured. */
export function isPastDue(sub: Subscription): boolean {
  return isSubscriptionPastDue(sub);
}
