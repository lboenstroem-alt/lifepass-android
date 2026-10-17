/**
 * The words for a member's visitor pass, and for what covers a walk-in, in a
 * given language: the Android port of iOS `PassCopy` (Services/PassCopy.swift).
 *
 * Built from a `lang` rather than the app store so the tests read exactly the
 * sentences the screens show; screens pass the store's language
 * (`useT().language`).
 *
 * NO DASHES. The web scan card says "Covered by your Adventurer pass — uses
 * 1 of 6 visits"; the app's member copy has no em or en dashes, so the same
 * sentence takes a colon here. The words are otherwise the web's.
 *
 * Every word comes from the generated iOS tables. The ` · ` separator and the
 * "LifePass" fallback tier name are the iOS code's own, not copy.
 */
import { formatDateTemplate } from '../i18n/format';
import { pluralKey, translate, type Lang } from '../i18n';

/** A pass as `GET /profile`'s `usage.passes` lists it (src/api/profile `ActivePass`). */
export interface PassForCopy {
  /** `day` | `explorer` | `adventurer` | `local` | `lagoon_duo`; anything else is "your pass". */
  readonly type: string;
  readonly visitsLeft: number;
  readonly expiresAt: Date;
}

/**
 * What covers a walk-in (iOS `WalkInCoverage`), as the walk-in preview and
 * the check-in answer carry it in `coveredBy`. Structural, so the walk-in
 * decoder's own type (F6, CHECKIN-2) passes straight in.
 */
export type CoverageForCopy =
  | {
      readonly kind: 'pass';
      readonly passType: string;
      readonly visitsTotal: number;
      /** What the pass has left once this visit is counted. */
      readonly visitsLeftAfter: number;
    }
  | {
      readonly kind: 'subscription';
      /** "Plus"; null only if the subscription lapsed mid-request. */
      readonly tierName: string | null;
      /** `network` (gyms and studios) | `pool`. */
      readonly lane: string | null;
      /** The lane's monthly visits left after this one; null when unknown. */
      readonly visitsLeftAfter: number | null;
    }
  | { readonly kind: 'money' };

/** The pass types the API names. Anything else is "your pass". */
export const NAMED_PASS_TYPES: ReadonlySet<string> = new Set(['day', 'explorer', 'adventurer', 'local', 'lagoon_duo']);

function known(type: string): string {
  return NAMED_PASS_TYPES.has(type) ? type : 'other';
}

function fill(key: string, lang: Lang, params?: Record<string, string>): string {
  return translate(key, lang, params);
}

// MARK: Naming a pass

/** "Adventurer pass" / "Adventurer-passi": the pass on its own. */
export function passName(type: string, lang: Lang): string {
  return fill(`usage.pass.${known(type)}`, lang);
}

/**
 * "your Adventurer pass" / "Adventurer-passanum þínum": the pass inside a
 * sentence after "Covered by" / "Innifalið í". Icelandic needs the dative
 * there, so it is its own key per type rather than the name with words
 * around it.
 */
export function passInSentence(type: string, lang: Lang): string {
  return fill(`checkin.cover.pass_name.${known(type)}`, lang);
}

/** "6 visits" / "6 heimsóknum" (dative after "af"), with Icelandic number agreement. */
function visitsOf(count: number, lang: Lang): string {
  return fill(pluralKey('checkin.cover.visits', count, lang), lang, { count: String(count) });
}

// MARK: Before the visit

/**
 * The line that answers "do I have to pay?" before the member taps anything:
 * - "Covered by your Adventurer pass: uses 1 of 6 visits (5 left after)"
 * - "Included in your Plus membership: uses 1 of your monthly visits (7 left after)"
 *
 * null when nothing the member holds covers the visit (money), and for an
 * older server that sends no `coveredBy`.
 */
export function coverageLine(coverage: CoverageForCopy | null | undefined, lang: Lang): string | null {
  if (!coverage) return null;
  switch (coverage.kind) {
    case 'pass': {
      const left =
        coverage.visitsLeftAfter > 0
          ? fill('checkin.cover.left', lang, { count: String(coverage.visitsLeftAfter) })
          : fill('checkin.cover.left_none', lang);
      return fill('checkin.cover.pass', lang, {
        pass: passInSentence(coverage.passType, lang),
        visits: visitsOf(coverage.visitsTotal, lang),
        left,
      });
    }
    case 'subscription': {
      const tier = tierName(coverage.tierName);
      if (coverage.visitsLeftAfter === null || coverage.visitsLeftAfter === undefined) {
        return fill('checkin.cover.subscription_plain', lang, { tier });
      }
      const left =
        coverage.visitsLeftAfter > 0
          ? fill('checkin.cover.left', lang, { count: String(coverage.visitsLeftAfter) })
          : fill('checkin.cover.left_none', lang);
      return fill('checkin.cover.subscription', lang, { tier, left });
    }
    default:
      return null;
  }
}

/** The membership's name in "your Plus membership"; "LifePass" when the server could not name the tier. */
function tierName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? 'LifePass' : trimmed;
}

// MARK: After the visit

/**
 * The success screen's "Balance after":
 * - "5 of 6 visits left on your Adventurer pass"
 * - "7 gym & studio visits left this period"
 *
 * null when there is no balance to state (money, an unknown monthly balance,
 * an older server).
 */
export function balanceAfter(coverage: CoverageForCopy | null | undefined, lang: Lang): string | null {
  if (!coverage) return null;
  switch (coverage.kind) {
    case 'pass': {
      const name = passInSentence(coverage.passType, lang);
      if (coverage.visitsLeftAfter <= 0) return fill('checkin.balance.pass_none', lang, { pass: name });
      return fill('checkin.balance.pass', lang, {
        left: String(coverage.visitsLeftAfter),
        visits: visitsOf(coverage.visitsTotal, lang),
        pass: name,
      });
    }
    case 'subscription': {
      const left = coverage.visitsLeftAfter;
      if (left === null || left === undefined) return null;
      const lane = coverage.lane === 'pool' ? 'pool' : 'network';
      if (left <= 0) return fill(`checkin.balance.${lane}_none`, lang);
      return fill(pluralKey(`checkin.balance.${lane}`, left, lang), lang, { count: String(left) });
    }
    default:
      return null;
  }
}

// MARK: The account screen

/**
 * The pass the member's next visit uses. The server lists active passes in
 * the order the door redeems them, so it is the first, as on the web
 * dashboard's "Your pass" card.
 */
export function headlinePass<P extends PassForCopy>(passes: readonly P[]): P | null {
  return passes[0] ?? null;
}

/** "5 visits left" / "5 heimsóknir eftir" ("21 heimsókn eftir"). */
export function visitsLeft(count: number, lang: Lang): string {
  return fill(pluralKey('account.pass_visits_left', count, lang), lang, { count: String(count) });
}

/** "7 Dec 2026" / "7. des. 2026", on Reykjavík's calendar. */
export function passDate(date: Date, lang: Lang): string {
  return formatDateTemplate(date, 'dMMMy', lang);
}

/** "Valid until 7 Dec 2026", the line under the pass on the member card. */
export function validUntilLine(pass: PassForCopy, lang: Lang): string {
  return fill('account.pass_valid_until_line', lang, { date: passDate(pass.expiresAt, lang) });
}

/**
 * "Adventurer pass · 5 visits left · valid until 7 Dec 2026": what the
 * Membership row says for a member with a pass and no subscription, where it
 * used to say "No active membership".
 */
export function accountSummary(pass: PassForCopy, lang: Lang): string {
  return [
    passName(pass.type, lang),
    visitsLeft(pass.visitsLeft, lang),
    fill('account.pass_valid_until', lang, { date: passDate(pass.expiresAt, lang) }),
  ].join(' · ');
}

/**
 * The pass the Account screen leads with: only for a member with no
 * subscription (a subscriber's card stays about the plan, as on the web),
 * and only while one is active.
 */
export function accountPass<P extends PassForCopy>(hasSubscription: boolean, passes: readonly P[]): P | null {
  return hasSubscription ? null : headlinePass(passes);
}

/**
 * The member card's line under a pass holder's kicker: what THAT pass has
 * left ("1 visit left"), so the kicker, this line and "Valid until" are about
 * one pass. A sum over every pass under "Explorer pass" read as six visits on
 * an Explorer pass that has one. null for a subscriber or someone with no
 * pass: the card keeps its lanes.
 */
export function accountCardLine(hasSubscription: boolean, passes: readonly PassForCopy[], lang: Lang): string | null {
  const pass = accountPass(hasSubscription, passes);
  return pass ? visitsLeft(pass.visitsLeft, lang) : null;
}

/**
 * The member card's kicker: "Plan · Plus" for a subscriber, the pass
 * ("Adventurer pass") for a pass holder, "Plan · None" for neither.
 */
export function accountKicker(planName: string | null | undefined, passes: readonly PassForCopy[], lang: Lang): string {
  if (planName !== null && planName !== undefined) return `${fill('account.plan', lang)} · ${planName}`;
  const pass = headlinePass(passes);
  if (pass) return passName(pass.type, lang);
  return `${fill('account.plan', lang)} · ${fill('account.none', lang)}`;
}

/** The "View plans" row's subtitle with no subscription: the pass, or "No active membership". */
export function membershipRowSubtitle(passes: readonly PassForCopy[], lang: Lang): string {
  const pass = headlinePass(passes);
  return pass ? accountSummary(pass, lang) : fill('account.no_membership', lang);
}

/** Everything above under one name, as the Swift `enum PassCopy` reads at call sites. */
export const PassCopy = {
  namedTypes: NAMED_PASS_TYPES,
  name: passName,
  inSentence: passInSentence,
  coverageLine,
  balanceAfter,
  headlinePass,
  visitsLeft,
  date: passDate,
  validUntilLine,
  accountSummary,
  accountPass,
  accountCardLine,
  accountKicker,
  membershipRowSubtitle,
} as const;
