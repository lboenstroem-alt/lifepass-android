/**
 * The health consent's rules, apart from its sheet: which text version a
 * grant is recorded under, where it was asked, what the request carries, and
 * what each refusal means. Ported from iOS Views/Health/HealthConsentSheet.swift.
 *
 * WHY IT IS ITS OWN ACT, AND NEVER A LINE IN THE TERMS. Health data is special
 * category data (GDPR art. 9, lög 90/2018 11. gr.): consent must be separate,
 * specific and freely given. Nothing is pre-ticked, "Not now" costs the
 * member nothing, and turning it off deletes everything.
 *
 * THE VERSION IS THE TEXT. The server refuses a grant that names any version
 * it has not published (`ACCEPTED_HEALTH_CONSENT_VERSIONS`), which is the
 * point: a member can only consent to words they were shown. The text is
 * iOS's word for word (owner decision D15 is moot while Android ships no
 * Health Connect), less the two lines about Apple Health, which Android does
 * not show.
 */
import { isApiError, isProblem, type ApiError } from '../../api';
import type { HealthConsent } from '../models';

/** The consent text this build shows, which is the version every grant is recorded under. */
export const HealthConsentVersion = {
  current: '2026-09-v1',
  /**
   * The text that also names a meal description going to Anthropic
   * (`healthconsent.ai.describe`). Sent only while the server advertises
   * `meal_describe`, which it does only once this text is published.
   */
  withMealDescribe: '2026-09-v3',
  /**
   * The v3 text plus the line that names a plan change going to Anthropic
   * (`healthconsent.ai.plan_edit`), and the "never" line that says so. Sent
   * only while the server advertises `plan_edit`, which it does only once
   * this text is published (it keeps the description line too, so it is
   * shown with it whatever `meal_describe` says).
   */
  withPlanEdit: '2026-09-v4',
  /** The text the consent sheet shows, by what the server supports. */
  shown(supportsMealDescribe: boolean, supportsPlanEdit = false): string {
    if (supportsPlanEdit) return HealthConsentVersion.withPlanEdit;
    return supportsMealDescribe ? HealthConsentVersion.withMealDescribe : HealthConsentVersion.current;
  },
} as const;

/** Which screen asked. Drives analytics and the ledger's `source`. */
export type HealthConsentEntry = 'plan' | 'coach' | 'scan' | 'account';

/**
 * The Plan, Coach and Scan entries record `coach_intake`; Body and goals
 * records `account`. (The route also accepts `profile`, which is the web's.)
 */
export function consentSource(entry: HealthConsentEntry): 'account' | 'coach_intake' {
  return entry === 'account' ? 'account' : 'coach_intake';
}

/**
 * The grant's body. `ageAttested` is sent ONLY when the 18+ row was shown:
 * the server records `ageSource` from it, and a verified account must not
 * claim an attestation it never made.
 */
export function consentGrantBody(options: {
  entry: HealthConsentEntry;
  ageRowShown: boolean;
  supportsMealDescribe: boolean;
  supportsPlanEdit?: boolean;
}): { optedIn: true; version: string; source: 'account' | 'coach_intake'; ageAttested?: true } {
  return {
    optedIn: true,
    version: HealthConsentVersion.shown(options.supportsMealDescribe, options.supportsPlanEdit ?? false),
    source: consentSource(options.entry),
    ...(options.ageRowShown ? { ageAttested: true as const } : {}),
  };
}

/**
 * The withdrawal's body (iOS BodyAndGoalsView `withdrawalResponse`): the
 * version the member's consent was recorded under, else the current text's.
 * Never null: the route requires a version and answers a null with 400,
 * which would delete nothing. Withdrawal lives on Body and goals, so the
 * source is `account`; no age attestation is ever sent with it.
 */
export function consentWithdrawalBody(recordedVersion: string | null | undefined): {
  optedIn: false;
  version: string;
  source: 'account';
} {
  return { optedIn: false, version: recordedVersion ?? HealthConsentVersion.current, source: 'account' };
}

/**
 * The consent to show at once after a grant: the server's own answer where it
 * gave one, else what was sent. The profile read that follows replaces it
 * with the server's copy; until then a member who switched tracking back on
 * must not close the sheet onto a switch that still reads Off.
 */
export function consentToApply(
  recorded: HealthConsent | null,
  options: { ageRowShown: boolean; supportsMealDescribe: boolean; supportsPlanEdit?: boolean; now?: Date },
): HealthConsent {
  return {
    version: recorded?.version ?? HealthConsentVersion.shown(options.supportsMealDescribe, options.supportsPlanEdit ?? false),
    consentedAt: recorded?.consentedAt ?? options.now ?? new Date(),
    ageSource: recorded?.ageSource ?? (options.ageRowShown ? 'attestation' : 'kennitala'),
  };
}

/**
 * An account with no verified kennitala has no age the server can trust, so
 * it must attest. A verified one never sees the row, unless the server says
 * otherwise: `GET /profile` reports "verified" as "there is a verification",
 * while the consent route needs a kennitala it can read an age OUT of (a
 * system number or a company number has none), and answers
 * `health_age_attestation_required`. The server wins.
 */
export function needsAgeAttestation(kennitalaVerified: boolean, serverAskedToAttest: boolean): boolean {
  return serverAskedToAttest || !kennitalaVerified;
}

/** What the sheet does with a failed grant. */
export type ConsentFailure =
  /** Draw the 18+ row (if it was not there), outline it, and say why under it. */
  | { readonly kind: 'attest' }
  /** Show the under-18 card; the wipe and the profile read wait for the sheet to close. */
  | { readonly kind: 'minor'; readonly error: ApiError }
  /** The account is on its way out: say so, with Open Account where there is one. */
  | { readonly kind: 'pendingDeletion' }
  /** A sentence under the button. */
  | { readonly kind: 'message'; readonly key: string }
  /** The member walked away: say nothing. */
  | { readonly kind: 'silent' };

export function consentFailure(error: unknown): ConsentFailure {
  if (!isApiError(error)) return { kind: 'message', key: 'common.error_body' };
  if (isProblem(error, 'health_age_attestation_required')) return { kind: 'attest' };
  if (isProblem(error, 'health_minor_blocked')) return { kind: 'minor', error };
  if (isProblem(error, 'account_pending_deletion')) return { kind: 'pendingDeletion' };
  if (error.isOffline) return { kind: 'message', key: 'health.offline.action_hint' };
  if (isProblem(error, 'rate_limited')) return { kind: 'message', key: 'health.err.rate_limited' };
  if (error.isCancellation) return { kind: 'silent' };
  return { kind: 'message', key: 'common.error_body' };
}

/** The privacy policy the sheet links to. */
export const PRIVACY_POLICY_URL = 'https://www.lifepass.is/privacy';
