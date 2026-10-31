/**
 * The one-tap plan-change consent (../consent.ts): the v4 text, the age the
 * standing consent was given with carried forward (an attestation only when
 * the member made one), and each refusal as the bubble shows it.
 */
import { ProblemError } from '../../../../api';
import { HealthConsentVersion, type ConsentResult } from '../../../../health';
import { translate } from '../../../../i18n';
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
    const standing = { version: '2026-09-v3', consentedAt: null, ageSource: 'kennitala' as const };
    expect(await grantPlanEditConsent(standing, 'k', failing(problem(400, 'health_age_attestation_required')))).toEqual({ kind: 'needsFullSheet' });
    expect((await grantPlanEditConsent(standing, 'k', failing(problem(403, 'health_minor_blocked')))).kind).toBe('refused');
    expect((await grantPlanEditConsent(standing, 'k', failing(problem(409, 'account_pending_deletion')))).kind).toBe('refused');
    expect(await grantPlanEditConsent(standing, 'k', failing(problem(429, 'rate_limited')))).toEqual({ kind: 'failed', errorKey: 'health.err.rate_limited' });
    expect(await grantPlanEditConsent(standing, 'k', failing(new Error('boom')))).toEqual({ kind: 'failed', errorKey: 'common.error_body' });
  });

  it('with no standing consent (withdrawn since) only the full sheet may take it: nothing is granted with one tap', async () => {
    const grant = jest.fn(async () => RESULT);
    expect(await grantPlanEditConsent(null, 'k', grant)).toEqual({ kind: 'needsFullSheet' });
    expect(grant).not.toHaveBeenCalled();
  });
});

describe('the v4 consent words', () => {
  // One text per consent version: the app's v4 lines are the web's
  // (monorepo apps/web common.{en,is}.json, health.consent.ai.plan_edit and
  // health.consent.ai.never_text) word for word, and v4 keeps v3's warning
  // about chat messages.
  it('are the web text of 2026-09-v4', () => {
    // Word for word, both languages (the web's health-i18n.test.ts pins the same text).
    expect(translate('healthconsent.ai.plan_edit', 'en')).toBe(
      "If you ask the Coach to change your workout plan, your words and the plan (its exercises, sets and rest, and the names and notes you wrote for your own exercises) go to Anthropic only to make the change. Never your safety answers, body measurements or dates, and never your name, email or any account ID. Anthropic may not train on them and deletes them within 30 days, apart from the exceptions in our privacy policy. We don't keep your words. A change you apply is kept with your plan, including the names and notes you wrote for your own exercises, and a suggestion you don't apply is deleted within 24 hours.",
    );
    expect(translate('healthconsent.ai.plan_edit', 'is')).toBe(
      "Ef þú biður ráðgjafann að breyta æfingaáætluninni fara orðin þín og áætlunin (æfingar hennar, sett og hvíld, og nöfn og athugasemdir sem þú skrifaðir fyrir eigin æfingar) til Anthropic eingöngu til að gera breytinguna. Aldrei svör þín við öryggisspurningunum, líkamsmælingar eða dagsetningar, og aldrei nafnið þitt, netfang eða auðkenni aðgangs. Anthropic má ekki nota þau til þjálfunar og eyðir þeim innan 30 daga, með þeim undantekningum sem koma fram í persónuverndarstefnunni. Við geymum ekki orðin þín. Breyting sem þú staðfestir er geymd með áætluninni, þar á meðal nöfn og athugasemdir sem þú skrifaðir fyrir eigin æfingar, og tillögu sem þú staðfestir ekki er eytt innan sólarhrings.",
    );
    expect(translate('healthconsent.ai.never_text_v4', 'en')).toBe(
      'Never notes or anything you type when a plan is made, apart from a change you ask the Coach to make (below). Coach chat messages are sent as you write them, so leave health details out of chat.',
    );
    expect(translate('healthconsent.ai.never_text_v4', 'is')).toBe(
      'Aldrei athugasemdir eða neitt sem þú skrifar þegar áætlun er búin til, nema breyting sem þú biður ráðgjafann að gera (sjá hér að neðan). Skilaboð í spjalli við ráðgjafann eru send eins og þú skrifar þau, svo slepptu heilsuupplýsingum þar.',
    );
  });

  it('a consent from before v3 has not seen the describe line that v4 carries', () => {
    expect(HealthConsentVersion.coversMealDescribe('2026-09-v1')).toBe(false);
    expect(HealthConsentVersion.coversMealDescribe('2026-09-v2')).toBe(false);
    expect(HealthConsentVersion.coversMealDescribe(null)).toBe(false);
    expect(HealthConsentVersion.coversMealDescribe('2026-09-v3')).toBe(true);
    expect(HealthConsentVersion.coversMealDescribe('2026-09-v4')).toBe(true);
  });
});
