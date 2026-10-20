/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Account screen's words, built from the member's plan, passes and usage
 * in a given language: the computed lines of iOS `AccountView`
 * (Views/Profile/AccountView.swift) as pure functions, so the tests read the
 * exact sentences the screen shows. The pass words themselves are
 * src/copy/passCopy (iOS `PassCopy`).
 *
 * The ` · ` separator is the Swift code's own, not copy.
 */
import type { ActivePass, Usage } from '../../api/profile';
import { isSubscriptionActive, isSubscriptionPastDue, planDisplayName, type Subscription } from '../../api/subscriptions';
import { PassCopy } from '../../copy/passCopy';
import { translate, type Lang } from '../../i18n';
import { formatDateTemplate } from '../../i18n/format';

/** What the member card and the Membership rows are built from. */
export interface MembershipFacts {
  /** `GET /subscriptions`; null for no plan (or not read yet, as iOS reads it). */
  readonly subscription: Subscription | null;
  /** The profile's `usage` block; null until the profile loads. */
  readonly usage: Usage | null;
  /** Active passes, in the order the door redeems them. */
  readonly passes: readonly ActivePass[];
}

const SEPARATOR = ' · ';

/** iOS `appState.hasActiveSubscription`: active, or in dunning. */
export function hasActiveSubscription(facts: Pick<MembershipFacts, 'subscription'>): boolean {
  return isSubscriptionActive(facts.subscription);
}

/**
 * The member card's kicker (iOS `PassCopy.accountKicker` with
 * `planName: hasActiveSubscription ? planLabel : nil`): "Plan · Plus", the
 * pass ("Adventurer pass") for a pass holder, else "Plan · None".
 */
export function memberCardKicker(facts: MembershipFacts, lang: Lang): string {
  const planName = facts.subscription && hasActiveSubscription(facts) ? planDisplayName(facts.subscription) : null;
  return PassCopy.accountKicker(planName, facts.passes, lang);
}

/**
 * The member card's serif line (iOS `AccountView.capsSummary`), in priority
 * order:
 * 1. a pass holder without a subscription: what THAT pass has left
 *    ("1 visit left"), never the sum over every pass (2.5.3);
 * 2. a tier: "Gym & studio 3 of 8 · Pool 2 of 4" from the lanes;
 * 3. the summed pass visits ("2 pass visits left");
 * 4. "No active membership".
 *
 * `home.pass_visits` is picked with the English rule in both languages, as
 * the Swift does (`ENGLISH_RULE_PLURALS` in src/i18n).
 */
export function capsSummary(facts: MembershipFacts, lang: Lang): string {
  const passLine = PassCopy.accountCardLine(hasActiveSubscription(facts), facts.passes, lang);
  if (passLine !== null) return passLine;
  const usage = facts.usage;
  if (usage && usage.tier !== null) {
    const parts: string[] = [];
    if (usage.network) {
      parts.push(translate('account.caps_gym', lang, { used: usage.network.used, cap: usage.network.cap }));
    }
    if (usage.pools) {
      parts.push(translate('account.caps_pool', lang, { used: usage.pools.used, cap: usage.pools.cap }));
    }
    if (parts.length > 0) return parts.join(SEPARATOR);
  }
  const passVisits = facts.passes.reduce((sum, pass) => sum + pass.visitsLeft, 0);
  if (passVisits > 0) {
    return passVisits === 1
      ? translate('home.pass_visits.one', lang)
      : translate('home.pass_visits.many', lang, { count: passVisits });
  }
  return translate('account.no_membership', lang);
}

/**
 * The renewal date on the member card: "7 Dec 2026" / "7. des. 2026".
 *
 * iOS writes `currentPeriodEndsAt.formatted(date: .abbreviated)`, which
 * follows the PHONE's region (an Icelandic iPhone reads "7. des. 2026").
 * Android writes it in the account language on Reykjavík's calendar, the
 * same way as the pass's "Valid until" line under it, so one card never
 * mixes two date styles (plan, account-member-card).
 */
export function renewalDate(date: Date, lang: Lang): string {
  return formatDateTemplate(date, 'dMMMy', lang);
}

/**
 * The small line under the serif one: "Renews 1 Oct 2026" for a member whose
 * plan is active, the headline pass's "Valid until 7 Dec 2026" for a pass
 * holder, else nothing. Never shown in dunning (the card shows the past-due
 * body instead).
 */
export function memberCardFootnote(facts: MembershipFacts, lang: Lang): string | null {
  const sub = facts.subscription;
  if (sub && isSubscriptionActive(sub)) {
    return translate('account.renews', lang, { date: renewalDate(sub.currentPeriodEndsAt, lang) });
  }
  const pass = PassCopy.accountPass(hasActiveSubscription(facts), facts.passes);
  return pass ? PassCopy.validUntilLine(pass, lang) : null;
}

/** Dunning: the card says access is paused and offers the fix (iOS `isPastDue`). */
export function isPastDue(facts: Pick<MembershipFacts, 'subscription'>): boolean {
  return isSubscriptionPastDue(facts.subscription);
}

/**
 * The "Change plan" row's subtitle (iOS `currentPlanAllowanceDescription`):
 * "Plus · 8 gym & studio / mo · 4 pool / mo" from the usage lanes, or the
 * plan name alone when the lanes are unknown (a plan in dunning reads none).
 */
export function planAllowanceDescription(subscription: Subscription, usage: Usage | null, lang: Lang): string {
  const parts = [planDisplayName(subscription)];
  if (usage?.network) parts.push(translate('account.allowance_gym', lang, { cap: usage.network.cap }));
  if (usage?.pools) parts.push(translate('account.allowance_pool', lang, { cap: usage.pools.cap }));
  return parts.join(SEPARATOR);
}

/** The Membership card's first row: Change plan for a plan holder, View plans for everyone else. */
export interface PlanRow {
  readonly kind: 'change' | 'view';
  readonly title: string;
  readonly subtitle: string;
}

export function planRow(facts: MembershipFacts, lang: Lang): PlanRow {
  const sub = facts.subscription;
  if (sub && isSubscriptionActive(sub)) {
    return {
      kind: 'change',
      title: translate('account.change_plan', lang),
      subtitle: planAllowanceDescription(sub, facts.usage, lang),
    };
  }
  return {
    kind: 'view',
    title: translate('account.view_plans', lang),
    subtitle: PassCopy.membershipRowSubtitle(facts.passes, lang),
  };
}

/** The member card's capsule: "Change plan" for a plan holder, else "View plans". */
export function plansButtonTitle(facts: Pick<MembershipFacts, 'subscription'>, lang: Lang): string {
  return translate(hasActiveSubscription(facts) ? 'account.change_plan' : 'account.view_plans', lang);
}

/**
 * The referral row's subtitle. Chosen as the Swift does, by `rewardsEarned`
 * compared with 0 and 1 in BOTH languages (`account.refer_earned` is an
 * English-rule pair, `ENGLISH_RULE_PLURALS` in src/i18n): 21 reads "21 free
 * visits", never the Icelandic singular.
 */
export function referralSubtitle(rewardsEarned: number, lang: Lang): string {
  if (rewardsEarned === 0) return translate('account.refer_sub', lang);
  if (rewardsEarned === 1) return translate('account.refer_earned.one', lang);
  return translate('account.refer_earned.many', lang, { count: rewardsEarned });
}

/**
 * What the share sheet carries. Android's share sheet ignores a separate URL
 * (iOS `ShareLink(item:message:)` sends both), so the link rides at the end
 * of the message.
 */
export function referralShareMessage(link: string, lang: Lang): string {
  return `${translate('account.refer_message', lang)} ${link}`;
}

/** The Language row's subtitle: "Saving…" while a change is on its way, else the language it speaks. */
export function languageRowSubtitle(language: Lang, saving: boolean, lang: Lang): string {
  if (saving) return translate('account.language_saving', lang);
  return translate(language === 'is' ? 'account.lang_is' : 'account.lang_en', lang);
}

/** Marks that belong to the character before them (combining diacritics, variation selectors). */
const COMBINING = /^[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f]$/;

/**
 * The avatar's letter (iOS `profile?.fullName?.prefix(1) ?? "L"`): the first
 * character of the name, "L" with no name at all.
 *
 * Swift's `prefix(1)` is the first grapheme, not the first code point. A name
 * stored decomposed ("A" then a combining acute) is composed first, and a
 * mark that has no composed form stays with its letter, so Android draws "Á"
 * where iOS does, never a bare "A".
 */
export function avatarInitial(fullName: string | null | undefined): string {
  if (fullName === null || fullName === undefined) return 'L';
  const characters = Array.from(fullName.normalize('NFC'));
  let initial = characters[0] ?? '';
  for (let i = 1; i < characters.length && COMBINING.test(characters[i]); i += 1) initial += characters[i];
  return initial;
}
