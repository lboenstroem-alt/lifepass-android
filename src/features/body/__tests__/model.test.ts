/**
 * Body and goals' rules and words (iOS BodyAndGoalsView's computed
 * properties): the target-row rule, the tracking line, the body and goal
 * lines in both languages, the chart's data and sentence, the entry, the
 * withdrawn-consent rule and what "What we store" lists.
 */
import type { HealthConsent } from '../../../api/profile';
import type { NutritionGoalView, TargetWeightView } from '../../../health';
import { translate, type Lang } from '../../../i18n';
import {
  bodyGoalsEntry,
  chartAccessibilityValue,
  chartTargetKg,
  chartWeeks,
  goalSubtitle,
  goalSubtitleWhenLapsed,
  goalWordKey,
  hasStandingConsent,
  latestTitle,
  planWeekLine,
  RETENTION_KEY,
  sameConsent,
  showsTargetRow,
  STORE_LINE_KEYS,
  storeLineKeys,
  targetSubtitle,
  trackingSubtitle,
  trendDirectionKey,
} from '../model';

const tr = (lang: Lang) => (key: string, params?: Readonly<Record<string, string | number>>) => translate(key, lang, params);
const en = tr('en');
const is = tr('is');

const target = (overrides: Partial<TargetWeightView> = {}): TargetWeightView => ({
  targetWeightKg: 68,
  direction: 'lose',
  setAt: new Date('2026-08-01T09:00:00Z'),
  reachedAt: null,
  outsideHealthyRange: false,
  appliesTo: 'goal',
  eta: null,
  ...overrides,
});

const goal = (overrides: Partial<NutritionGoalView> = {}): NutritionGoalView => ({
  goal: 'lose',
  sex: 'female',
  ageBand: '25_34',
  activity: 'light',
  customKcal: null,
  target: { kcalLow: 1750, kcalHigh: 1950, proteinG: 110, basis: 'goal' },
  targetWithheld: null,
  updatedAt: null,
  ...overrides,
});

describe('the Target weight row (iOS showsTargetRow)', () => {
  const base = { supportsTargetWeight: true, targetWeight: null, calorieGoal: null, livePlanMayTakeTarget: false };

  it('never on a server without target weights, whatever else holds', () => {
    expect(showsTargetRow({ ...base, supportsTargetWeight: false, targetWeight: target(), calorieGoal: 'lose', livePlanMayTakeTarget: true })).toBe(false);
  });

  it('with a stored target', () => {
    expect(showsTargetRow({ ...base, targetWeight: target() })).toBe(true);
  });

  it('with a lose or gain calorie goal, not with maintain or none', () => {
    expect(showsTargetRow({ ...base, calorieGoal: 'lose' })).toBe(true);
    expect(showsTargetRow({ ...base, calorieGoal: 'gain' })).toBe(true);
    expect(showsTargetRow({ ...base, calorieGoal: 'maintain' })).toBe(false);
    expect(showsTargetRow({ ...base, calorieGoal: null })).toBe(false);
  });

  it('with a live plan that may take one (its goal loses or gains, or is not in hand yet)', () => {
    expect(showsTargetRow({ ...base, livePlanMayTakeTarget: true })).toBe(true);
    expect(showsTargetRow(base)).toBe(false);
  });
});

describe('the tracking line', () => {
  const consentedAt = new Date('2026-09-01T09:00:00Z');

  it('"On since 1 September" in the account language', () => {
    expect(trackingSubtitle(en, 'en', { hasConsent: true, consentedAt, access: 'entitled' })).toBe('On since 1 September');
    expect(trackingSubtitle(is, 'is', { hasConsent: true, consentedAt, access: 'past_due' })).toBe('Kveikt síðan 1. september');
  });

  it('off: the plain line for an entitled member, the membership reason for anyone else, the minor line for a minor', () => {
    expect(trackingSubtitle(en, 'en', { hasConsent: false, consentedAt: null, access: 'entitled' })).toBe(en('bodygoals.tracking_off'));
    expect(trackingSubtitle(en, 'en', { hasConsent: false, consentedAt: null, access: 'not_member' })).toBe('Needs an active membership');
    expect(trackingSubtitle(en, 'en', { hasConsent: false, consentedAt: null, access: 'unknown' })).toBe('Needs an active membership');
    expect(trackingSubtitle(en, 'en', { hasConsent: false, consentedAt: null, access: 'minor' })).toBe('For members aged 18 and over');
  });
});

describe('the consent this page withdrew', () => {
  const consent: HealthConsent = { version: '2026-09-v1', consentedAt: new Date('2026-09-01T09:00:00Z'), ageSource: 'kennitala' };

  it('hides that consent only: a stale read carrying it shows nothing, a new consent shows at once', () => {
    expect(hasStandingConsent(consent, null)).toBe(true);
    expect(hasStandingConsent({ ...consent, consentedAt: new Date(consent.consentedAt!.getTime()) }, consent)).toBe(false);
    expect(hasStandingConsent({ ...consent, consentedAt: new Date('2026-10-20T12:00:00Z') }, consent)).toBe(true);
    expect(hasStandingConsent(null, null)).toBe(false);
  });

  it('two consents are the same when every field is', () => {
    expect(sameConsent(consent, { ...consent })).toBe(true);
    expect(sameConsent(consent, { ...consent, ageSource: 'attestation' })).toBe(false);
    expect(sameConsent(null, null)).toBe(true);
    expect(sameConsent(consent, null)).toBe(false);
  });
});

describe('your body', () => {
  it('the latest weigh-in: weight and height, weight alone, or the ask', () => {
    expect(latestTitle(en, 'en', { weightKg: 72.5, heightCm: 178, measuredAt: null })).toBe('72.5 kg · 178 cm');
    expect(latestTitle(is, 'is', { weightKg: 72.5, heightCm: 178, measuredAt: null })).toBe('72,5 kg · 178 cm');
    expect(latestTitle(is, 'is', { weightKg: 72.5, heightCm: null, measuredAt: null })).toBe('72,5 kg');
    expect(latestTitle(en, 'en', { weightKg: null, heightCm: 178, measuredAt: null })).toBe('Add weight and height');
    expect(latestTitle(en, 'en', null)).toBe('Add weight and height');
  });

  it('the calorie goal line, with the range grouped in the account language', () => {
    expect(goalSubtitle(en, 'en', goal())).toBe('Lose weight: about 1,750 to 1,950 kcal a day');
    expect(goalSubtitle(is, 'is', goal())).toBe('Léttast: um 1.750 til 1.950 kcal á dag');
    expect(goalSubtitle(en, 'en', goal({ goal: 'maintain', target: null }))).toBe('Keep my weight');
    expect(goalSubtitle(en, 'en', goal({ goal: 'something_new' }))).toBe('Not set');
    expect(goalSubtitle(en, 'en', null)).toBe('Not set');
  });

  it('a lapsed member reads the goal AND why it cannot change; with no goal, only why', () => {
    expect(goalSubtitleWhenLapsed(en, 'en', goal())).toBe('Lose weight: about 1,750 to 1,950 kcal a day · Needs an active membership');
    expect(goalSubtitleWhenLapsed(en, 'en', null)).toBe('Needs an active membership');
    expect(goalSubtitleWhenLapsed(en, 'en', goal({ goal: null }))).toBe('Needs an active membership');
  });

  it('the goal words', () => {
    expect(['lose', 'maintain', 'gain', 'other', null].map(goalWordKey)).toEqual(['goal.lose', 'goal.maintain', 'goal.gain', null, null]);
  });

  it('the target line: add, reached, unhealthy, with an estimate, or the bare target', () => {
    expect(targetSubtitle(en, 'en', null)).toBe('Add a target weight');
    expect(targetSubtitle(en, 'en', target({ reachedAt: new Date('2026-09-17T08:00:00Z') }))).toBe('Reached 68 kg on Thu 17 Sept');
    expect(targetSubtitle(en, 'en', target({ outsideHealthyRange: true }))).toBe(en('target.unhealthy.short'));
    expect(targetSubtitle(is, 'is', target({ targetWeightKg: 68.5, eta: { weeksLow: 10, weeksHigh: 12 } }))).toBe(
      'Markþyngd 68,5 kg · um 10 til 12 vikur á þessum hraða',
    );
    expect(targetSubtitle(en, 'en', target())).toBe('Target 68 kg');
  });

  it('the chart draws a target only on a server that has them and only inside a healthy weight', () => {
    expect(chartTargetKg(true, target())).toBe(68);
    expect(chartTargetKg(false, target())).toBeNull();
    expect(chartTargetKg(true, target({ outsideHealthyRange: true }))).toBeNull();
    expect(chartTargetKg(true, null)).toBeNull();
  });

  it('the chart keeps only the weeks with an average: a hole, never a zero', () => {
    const weeks = [
      { weekStartsOn: '2026-08-03', avgKg: 74.8, count: 2 },
      { weekStartsOn: '2026-08-10', avgKg: null, count: 0 },
      { weekStartsOn: '2026-08-17', avgKg: 74.1, count: 1 },
    ];
    expect(chartWeeks({ weeks, latestAvgKg: 74.1, deltaKg: -0.7, direction: 'down' })?.map((w) => w.weekStartsOn)).toEqual([
      '2026-08-03',
      '2026-08-17',
    ]);
    expect(chartWeeks({ weeks: null, latestAvgKg: null, deltaKg: null, direction: null })).toBeNull();
    expect(chartWeeks(null)).toBeNull();
  });

  it('the chart is one sentence, with the target when one is drawn', () => {
    expect(chartAccessibilityValue(en, 'en', { first: 74.8, last: 72.5, direction: 'down', targetKg: null })).toBe(
      'From 74.8 kg to 72.5 kg, down.',
    );
    expect(chartAccessibilityValue(is, 'is', { first: 74.8, last: 72.5, direction: 'up', targetKg: 68 })).toBe(
      'Frá 74,8 kg í 72,5 kg, upp á við. Markþyngd 68 kíló.',
    );
    expect(['down', 'up', 'same', null, 'sideways'].map(trendDirectionKey)).toEqual([
      'bodygoals.trend.down',
      'bodygoals.trend.up',
      'bodygoals.trend.same',
      'bodygoals.trend.same',
      'bodygoals.trend.same',
    ]);
  });
});

describe('your plan and the entry', () => {
  it('"Week 3 of 8" only with both numbers', () => {
    expect(planWeekLine(en, { weekNo: 3, weeks: 8 })).toBe('Week 3 of 8');
    expect(planWeekLine(is, { weekNo: 3, weeks: 8 })).toBe('Vika 3 af 8');
    expect(planWeekLine(en, { weekNo: null, weeks: 8 })).toBeNull();
  });

  it('account from Account; plan without an anchor; banner with one (iOS PlanRoute.bodyAndGoals)', () => {
    expect(bodyGoalsEntry('Account', undefined)).toBe('account');
    expect(bodyGoalsEntry('Account', 'reminders')).toBe('account');
    expect(bodyGoalsEntry('PlanMain', undefined)).toBe('plan');
    expect(bodyGoalsEntry('PlanMain', 'reminders')).toBe('banner');
    expect(bodyGoalsEntry('FeedbackReport', 'feedback')).toBe('banner');
    expect(bodyGoalsEntry(null, undefined)).toBe('plan');
  });
});

describe('what we store', () => {
  it("is the consent sheet's own lines, without the two about Apple Health, then the retention", () => {
    expect(STORE_LINE_KEYS).not.toContain('healthconsent.store.apple_health');
    expect(STORE_LINE_KEYS).not.toContain('ah.use.ai');
    expect(STORE_LINE_KEYS).toHaveLength(10);
    expect(STORE_LINE_KEYS[0]).toBe('healthconsent.store.body');
    expect(STORE_LINE_KEYS[STORE_LINE_KEYS.length - 1]).toBe('healthconsent.ai.photo');
    expect(RETENTION_KEY).toBe('bodygoals.android.retention');
  });

  it('a member who gave the v4 consent (COACH-6) sees its lines: the new never line, then the description and the plan change after the photo', () => {
    expect(storeLineKeys('2026-09-v3')).toBe(STORE_LINE_KEYS);
    expect(storeLineKeys(null)).toBe(STORE_LINE_KEYS);
    const v4 = storeLineKeys('2026-09-v4');
    expect(v4).not.toContain('healthconsent.ai.never_text');
    expect(v4).toContain('healthconsent.ai.never_text_v4');
    expect(v4.slice(-3)).toEqual(['healthconsent.ai.photo', 'healthconsent.ai.describe', 'healthconsent.ai.plan_edit']);
  });

  it('nothing Android shows on Body and goals names Apple Health or Health Connect', () => {
    for (const lang of ['en', 'is'] as const) {
      for (const key of [...STORE_LINE_KEYS, RETENTION_KEY, 'bodygoals.android.delete_body', 'bodygoals.android.row_sub_off']) {
        const text = translate(key, lang);
        expect([key, text]).not.toEqual([key, key]);
        expect(text).not.toMatch(/Apple Health|Health Connect/);
      }
    }
  });
});
