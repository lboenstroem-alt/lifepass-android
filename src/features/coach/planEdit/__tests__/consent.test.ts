/**
 * The one-tap plan-change consent (../consent.ts): the v4 text, the age the
 * standing consent was given with carried forward (an attestation only when
 * the member made one), and each refusal as the bubble shows it.
 */
import { ProblemError } from '../../../../api';
import type { ConsentResult } from '../../../../health';
import { grantPlanEditConsent } from '../consent';

const RESULT: ConsentResult = {
  consent: null,
  deleted: null,
  optedIn: true,
  version: '2026-09-v4',
  consentedAt: new Date('2026-10-23T10:00:00Z'),
  ageSource: 'attestation',
};

function problem(status: number, slug: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status, detail: slug }, status);
}

describe('the plan-change consent', () => {
  it('grants v4, carrying an attestation forward only when the member made one', async () => {
    const grant = jest.fn(async () => RESULT);
    const outcome = await grantPlanEditConsent({ version: '2026-09-v3', consentedAt: null, ageSource: 'attestation' }, 'k1', grant);
    expect(grant).toHaveBeenCalledWith('2026-09-v4', true, 'k1');
    expect(outcome).toEqual({ kind: 'granted', consent: { version: '2026-09-v4', consentedAt: RESULT.consentedAt, ageSource: 'attestation' } });

    await grantPlanEditConsent({ version: '2026-09-v1', consentedAt: null, ageSource: 'kennitala' }, 'k2', grant);
    expect(grant).toHaveBeenLastCalledWith('2026-09-v4', false, 'k2');
  });

  it('an account that must attest goes to the full sheet; a minor or a pending deletion is refused; anything else keeps the button', async () => {
    const failing = (error: unknown) => async () => {
      throw error;
    };
    expect(await grantPlanEditConsent(null, 'k', failing(problem(400, 'health_age_attestation_required')))).toEqual({ kind: 'needsFullSheet' });
    expect((await grantPlanEditConsent(null, 'k', failing(problem(403, 'health_minor_blocked')))).kind).toBe('refused');
    expect((await grantPlanEditConsent(null, 'k', failing(problem(409, 'account_pending_deletion')))).kind).toBe('refused');
    expect(await grantPlanEditConsent(null, 'k', failing(problem(429, 'rate_limited')))).toEqual({ kind: 'failed', errorKey: 'health.err.rate_limited' });
    expect(await grantPlanEditConsent(null, 'k', failing(new Error('boom')))).toEqual({ kind: 'failed', errorKey: 'common.error_body' });
  });
});
