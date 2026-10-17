/**
 * What the Plan & usage page shows, decided without React: the rules of iOS
 * `CreditsDetailView` (Views/Profile/CreditDetailView.swift), the member's
 * caps and usage dashboard ("This period"), mirroring the web customer
 * dashboard. v1 has no credit wallet: this is where "top-up" lives now.
 *
 * Everything is read from the app store (`GET /profile`'s `usage` block and
 * `GET /subscriptions`); the page asks the server nothing of its own. A
 * missing usage block (null on the profile) degrades this page only.
 */
import { capitalizedWords } from '../../../api/billing';
import type { Usage, UsageLane } from '../../../api/profile';
import { isSubscriptionActive, isSubscriptionPastDue, planDisplayName, type Subscription } from '../../../api/subscriptions';
import { formatDatePattern } from '../../../i18n/format';
import { iskPrefix, type Lang } from '../../../i18n';

/**
 * "1 Jun 2026" / "1 jún. 2026": iOS pins the pattern "d MMM yyyy" (is_IS or
 * en_GB month words, in the account language), the web's day, short month,
 * year; a pinned pattern puts no dot after the Icelandic day. Read on the
 * Reykjavik calendar (UTC all year), as every server date in the app is.
 */
export function usageDate(date: Date, lang: Lang): string {
  return formatDatePattern(date, 'd MMM yyyy', lang === 'is' ? 'is' : 'en');
}

/** The warning at the top: a live booking block, else active strikes, else none. */
export type UsageBanner =
  | { readonly kind: 'block'; readonly until: Date }
  | { readonly kind: 'strikes'; readonly active: number; readonly threshold: number }
  | null;

/**
 * Only a block whose `until` is still in the future is real: an elapsed block
 * lifts automatically server-side, so a past date is a stale value that must
 * never read as an active ban.
 */
export function usageBanner(usage: Usage | null, now: Date = new Date()): UsageBanner {
  const until = usage?.block.until;
  if (until && until.getTime() > now.getTime()) return { kind: 'block', until };
  const strikes = usage?.strikes;
  if (strikes && strikes.active >= 1) return { kind: 'strikes', active: strikes.active, threshold: strikes.threshold };
  return null;
}

/** "Plan": the subscription's display name while it is live, else the capitalised tier, else a dash. */
export function usagePlanName(subscription: Subscription | null, usage: Usage | null): string {
  if (subscription && isSubscriptionActive(subscription)) {
    const name = planDisplayName(subscription);
    if (name) return name;
  }
  if (usage?.tier !== null && usage?.tier !== undefined) return capitalizedWords(usage.tier);
  return '—';
}

/**
 * The one top-up prompt, in the web's priority: out of gym and studio visits
 * with a gym price, else out of pool visits with a pool price, else none.
 */
export function topUpPrompt(usage: Usage): { readonly key: string; readonly price: string } | null {
  const { network, pools } = usage;
  const { gym, pool } = usage.topup.prices;
  if (network && network.used >= network.cap && gym !== null) return { key: 'usage.topup.gym', price: iskPrefix(gym) };
  if (pools && pools.used >= pools.cap && pool !== null) return { key: 'usage.topup.pool', price: iskPrefix(pool) };
  return null;
}

/** A lane's bar and its words: what is left, whether it is at the limit, how full the bar is. */
export interface LaneMeter {
  readonly remaining: number;
  readonly atLimit: boolean;
  /** 0 to 1; 0 for a zero cap. */
  readonly fraction: number;
}

export function laneMeter(used: number, cap: number): LaneMeter {
  return {
    remaining: Math.max(0, cap - used),
    atLimit: used >= cap,
    fraction: cap > 0 ? Math.min(1, used / cap) : 0,
  };
}

export function meterOf(lane: UsageLane): LaneMeter {
  return laneMeter(lane.used, lane.cap);
}

/**
 * What stands in for the plan when there is no tier and no pass. A past-due
 * membership also reads tier null on `/profile` (access is suspended during
 * dunning): that member still HAS a plan, so they see the payment issue, not
 * the misleading "not on a plan yet".
 */
export function usageEmptyState(
  usage: Usage | null,
  passCount: number,
  subscription: Subscription | null,
): 'pastDue' | 'noPlan' | null {
  if ((usage?.tier ?? null) !== null || passCount > 0) return null;
  return isSubscriptionPastDue(subscription) ? 'pastDue' : 'noPlan';
}
