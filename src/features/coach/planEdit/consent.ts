/**
 * The one-tap consent before a member's first plan change in chat (409
 * `plan_edit_consent_required`): the pattern of "Describe what you ate"
 * (../../meals/describe/describeModel.ts `grantDescribeConsent`), under the
 * text that names a plan change (`HealthConsentVersion.withPlanEdit`,
 * 2026-09-v4). A member whose consent predates the feature (v1 to v3)
 * accepts the new line with one tap: a new ledger row through the same
 * grant route, with the age the standing consent was given with carried
 * forward (an attestation only if they made one; a verified kennitala never
 * claims one). Then the SAME words go again with the SAME key.
 */
import { isApiError, type ApiError } from '../../../api';
import {
  consentSource,
  grantedConsent,
  HealthConsentVersion,
  setHealthConsent,
  type ConsentResult,
  type HealthConsent,
} from '../../../health';

/** The consent route, as the bubble calls it (a function so the tests can answer it). */
export type PlanEditConsentGrant = (version: string, ageAttested: boolean, idempotencyKey: string) => Promise<ConsentResult>;

/** `POST /profile/health-consent` from the Coach (`coach_intake`). */
export const livePlanEditConsentGrant: PlanEditConsentGrant = (version, ageAttested, idempotencyKey) =>
  setHealthConsent(
    { optedIn: true, version, source: consentSource('coach'), ...(ageAttested ? { ageAttested: true as const } : {}) },
    idempotencyKey,
  );

export type PlanEditConsentOutcome =
  | { readonly kind: 'granted'; readonly consent: HealthConsent }
  /** The account has to attest its age: only the full consent sheet has that row. */
  | { readonly kind: 'needsFullSheet' }
  /** A sentence under the button (`errorKey`), and the button stays. */
  | { readonly kind: 'failed'; readonly errorKey: string }
  /** A minor, a pending deletion, no membership: every health screen's own rules. */
  | { readonly kind: 'refused'; readonly error: ApiError };

/** Grants the v4 consent once (`idempotencyKey` is the bubble's, so a double tap writes one row). */
export async function grantPlanEditConsent(
  standing: HealthConsent | null,
  idempotencyKey: string,
  grant: PlanEditConsentGrant = livePlanEditConsentGrant,
  now: () => Date = () => new Date(),
): Promise<PlanEditConsentOutcome> {
  const attested = standing?.ageSource === 'attestation';
  try {
    const result = await grant(HealthConsentVersion.withPlanEdit, attested, idempotencyKey);
    const recorded = grantedConsent(result);
    return {
      kind: 'granted',
      consent: {
        version: recorded?.version ?? HealthConsentVersion.withPlanEdit,
        consentedAt: recorded?.consentedAt ?? now(),
        ageSource: recorded?.ageSource ?? standing?.ageSource ?? null,
      },
    };
  } catch (error) {
    if (!isApiError(error)) return { kind: 'failed', errorKey: 'common.error_body' };
    if (error.isProblem('health_age_attestation_required')) return { kind: 'needsFullSheet' };
    if (error.isProblem('health_minor_blocked', 'account_pending_deletion', 'no_active_plan_or_pass')) {
      return { kind: 'refused', error };
    }
    if (error.isOffline) return { kind: 'failed', errorKey: 'health.offline.action_hint' };
    if (error.isProblem('rate_limited')) return { kind: 'failed', errorKey: 'health.err.rate_limited' };
    return { kind: 'failed', errorKey: 'common.error_body' };
  }
}
