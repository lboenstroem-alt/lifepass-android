/**
 * Body and goals' words and rules, apart from the screen so each one is a
 * pure function a test can hold: the Android port of the computed properties
 * of iOS Views/Health/BodyAndGoalsView.swift.
 *
 * WHAT STAYS READABLE WHEN A MEMBERSHIP LAPSES. Consent, not membership, is
 * the legal basis for holding this data, so a lapsed member keeps every read,
 * the export, the per-row delete and the delete-everything button. What they
 * lose is writing: new weigh-ins and a new calorie goal need the full gate,
 * and the rows say so ("Needs an active membership") rather than refusing
 * after a tap.
 */
import type { HealthAccess, HealthConsent, ProfileHealthBlock, ProfileProgramSummary } from '../../api/profile';
import type { NutritionGoalView, TargetWeightView } from '../../health';
import { HealthFormat, type Lang } from '../../i18n';
import type { BodyAndGoalsAnchor } from '../../navigation/types';

import type { WeightTrendWeek, WeightTrendWeeks } from './api';
import { TargetWeightRules } from './sheets';

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

// ---------------------------------------------------------------------------
// Consent

/** Two consents are the same recorded consent (iOS `HealthConsent: Equatable`). */
export function sameConsent(a: HealthConsent | null | undefined, b: HealthConsent | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.version === b.version &&
    a.ageSource === b.ageSource &&
    (a.consentedAt?.getTime() ?? null) === (b.consentedAt?.getTime() ?? null)
  );
}

/**
 * THE WITHDRAWAL RESPONSE IS AUTHORITATIVE FOR THIS SCREEN (iOS `hasConsent`).
 *
 * `withdrawn` is the consent this page withdrew, once the server confirmed
 * it. It hides THAT consent and no other: a profile read already in flight
 * when the member tapped Delete everything can land afterwards with the old
 * consent in it, and the page must not draw the deleted weight again. A
 * consent given afterwards is a different value (its own `consentedAt`), so
 * it shows at once.
 */
export function hasStandingConsent(consent: HealthConsent | null | undefined, withdrawn: HealthConsent | null): boolean {
  if (!consent) return false;
  return !sameConsent(consent, withdrawn);
}

/** The tracking row's second line (iOS `trackingSubtitle`). */
export function trackingSubtitle(
  t: Translate,
  lang: Lang,
  facts: { readonly hasConsent: boolean; readonly consentedAt: Date | null; readonly access: HealthAccess },
): string {
  if (facts.hasConsent) {
    const date = facts.consentedAt ? HealthFormat.longDay(HealthFormat.serverDay(facts.consentedAt), lang) : '';
    return t('bodygoals.tracking_on', { date });
  }
  // Under 18 is its own refusal and never a membership problem: the page
  // shows the minor notice instead, and this keeps a 16 year old from ever
  // being told to buy a membership should the row become reachable.
  if (facts.access === 'minor') return t('health.minor.title');
  if (facts.access !== 'entitled') return t('bodygoals.need_membership');
  return t('bodygoals.tracking_off');
}

// ---------------------------------------------------------------------------
// Your body

/** "72,5 kg · 178 cm", "72,5 kg", or "Add weight and height" (iOS `latestTitle`). */
export function latestTitle(t: Translate, lang: Lang, latest: ProfileHealthBlock['latest'] | null | undefined): string {
  const kg = latest?.weightKg;
  if (kg === null || kg === undefined) return t('bodygoals.latest_none');
  const cm = latest?.heightCm;
  if (cm === null || cm === undefined) return HealthFormat.weight(kg, lang);
  return t('bodygoals.latest', { kg: HealthFormat.decimal(kg, lang), cm: HealthFormat.integer(cm, lang) });
}

/** The calorie goal's word key (`goal.*`), or null for none or a value this build does not know. */
export function goalWordKey(raw: string | null | undefined): string | null {
  switch (raw) {
    case 'lose':
      return 'goal.lose';
    case 'maintain':
      return 'goal.maintain';
    case 'gain':
      return 'goal.gain';
    default:
      return null;
  }
}

/** "Lose weight: about 1,750 to 1,950 kcal a day", the word alone, or "Not set" (iOS `goalSubtitle`). */
export function goalSubtitle(t: Translate, lang: Lang, goal: NutritionGoalView | null): string {
  const key = goalWordKey(goal?.goal);
  if (!goal || !key) return t('bodygoals.goal_none');
  const word = t(key);
  const target = goal.target;
  if (!target) return word;
  return t('bodygoals.goal_line', {
    goal: word,
    low: HealthFormat.integer(target.kcalLow, lang),
    high: HealthFormat.integer(target.kcalHigh, lang),
  });
}

/**
 * The goal line AND the reason it cannot be changed, in that order (iOS
 * `goalSubtitleWhenLapsed`): a lapsed member keeps every read and loses only
 * the write. With no goal stored, only the reason.
 */
export function goalSubtitleWhenLapsed(t: Translate, lang: Lang, goal: NutritionGoalView | null): string {
  const reason = t('bodygoals.need_membership');
  if (goal?.goal === null || goal?.goal === undefined) return reason;
  return `${goalSubtitle(t, lang, goal)} · ${reason}`;
}

/**
 * Whether the Target weight row shows (iOS `showsTargetRow`, `SPEC` 6.4): on a
 * server that has target weights, when there is one, or when a goal that
 * takes one is set (a lose or gain calorie goal, or a running plan that may
 * take one; a plan whose goal is not in hand yet counts as one that may, and
 * the sheet reads the day and decides).
 */
export function showsTargetRow(facts: {
  readonly supportsTargetWeight: boolean;
  readonly targetWeight: TargetWeightView | null;
  readonly calorieGoal: string | null | undefined;
  readonly livePlanMayTakeTarget: boolean;
}): boolean {
  if (!facts.supportsTargetWeight) return false;
  if (facts.targetWeight) return true;
  if (TargetWeightRules.directionForCalorieGoal(facts.calorieGoal) !== null) return true;
  return facts.livePlanMayTakeTarget;
}

/** The target row's second line (iOS `targetSubtitle`). */
export function targetSubtitle(t: Translate, lang: Lang, target: TargetWeightView | null): string {
  if (!target) return t('bodygoals.target_add');
  const kg = HealthFormat.decimal(target.targetWeightKg, lang);
  if (target.reachedAt) {
    return t('target.reached.line', { kg, date: HealthFormat.shortDay(target.reachedAt, lang) });
  }
  if (target.outsideHealthyRange === true) return t('target.unhealthy.short');
  if (target.eta) {
    return t('target.line_eta', { kg, low: String(target.eta.weeksLow), high: String(target.eta.weeksHigh) });
  }
  return t('target.line', { kg });
}

/**
 * The target the chart draws a line at: set, and inside a healthy weight (a
 * target the server ignores is not drawn as if it were a goal).
 */
export function chartTargetKg(supportsTargetWeight: boolean, target: TargetWeightView | null): number | null {
  if (!supportsTargetWeight || !target || target.outsideHealthyRange === true) return null;
  return target.targetWeightKg;
}

/**
 * Weeks with a real average, oldest first (iOS `chartWeeks`). A week the
 * member logged nothing in is a hole, not a zero: a line drawn through 0 kg
 * would be a chart of an error. The chart shows from two weeks.
 */
export function chartWeeks(trend: WeightTrendWeeks | null): WeightTrendWeek[] | null {
  if (!trend?.weeks) return null;
  return trend.weeks.filter((week) => week.avgKg !== null);
}

/** The fewest weeks with an average the chart is drawn for. */
export const CHART_MIN_WEEKS = 2;

/** `bodygoals.trend.*` for the server's direction (anything else reads as "about the same"). */
export function trendDirectionKey(direction: string | null | undefined): string {
  switch (direction) {
    case 'down':
      return 'bodygoals.trend.down';
    case 'up':
      return 'bodygoals.trend.up';
    default:
      return 'bodygoals.trend.same';
  }
}

/**
 * The chart's one sentence (iOS `chartAccessibilityValue`): from the first
 * week to the last, which way, and the target when one is drawn. A chart
 * TalkBack reads point by point is a list of weights read aloud in a gym.
 */
export function chartAccessibilityValue(
  t: Translate,
  lang: Lang,
  facts: { readonly first: number; readonly last: number; readonly direction: string | null; readonly targetKg: number | null },
): string {
  const trend = t('bodygoals.chart.a11y_value', {
    first: HealthFormat.decimal(facts.first, lang),
    last: HealthFormat.decimal(facts.last, lang),
    direction: t(trendDirectionKey(facts.direction)),
  });
  if (facts.targetKg === null) return trend;
  return `${trend} ${t('bodygoals.chart.a11y_target', { kg: HealthFormat.decimal(facts.targetKg, lang) })}`;
}

// ---------------------------------------------------------------------------
// Your plan

/** "Week 3 of 8", or null without both numbers (iOS `weekLine`). */
export function planWeekLine(t: Translate, program: Pick<ProfileProgramSummary, 'weekNo' | 'weeks'>): string | null {
  if (program.weekNo === null || program.weeks === null) return null;
  return t('plan.week_of', { week: String(program.weekNo), weeks: String(program.weeks) });
}

// ---------------------------------------------------------------------------
// Where the member came from

/** `body_goals_opened.entry` (iOS `BodyAndGoalsView.Entry`). */
export type BodyGoalsEntry = 'account' | 'plan' | 'banner';

/**
 * iOS passes the entry from the call site: Account's row says `account`;
 * Plan's routes say `plan` without an anchor (the gear, Manage your data)
 * and `banner` with one (the adopted banner's Change, the feedback's
 * settings). Here the screen reads it off the route below it.
 */
export function bodyGoalsEntry(previousRoute: string | null | undefined, anchor: BodyAndGoalsAnchor | undefined): BodyGoalsEntry {
  if (previousRoute === 'Account') return 'account';
  return anchor === undefined ? 'plan' : 'banner';
}

// ---------------------------------------------------------------------------
// What we store

/**
 * The consent sheet's own lines, reused word for word: a second wording of
 * the same promise is a second promise to keep in step (iOS `storeLines`).
 * Less the two about Apple Health (`healthconsent.store.apple_health`,
 * `ah.use.ai`), which Android does not show, as its consent sheet does not.
 */
export const STORE_LINE_KEYS: readonly string[] = [
  'healthconsent.store.body',
  'healthconsent.store.goals',
  'healthconsent.store.workouts',
  'healthconsent.store.meals',
  'healthconsent.ai.body',
  'healthconsent.ai.never_identity',
  'healthconsent.ai.never_numbers',
  'healthconsent.ai.never_text',
  'healthconsent.ai.never_location',
  'healthconsent.ai.photo',
];

/** How long each kind is kept: iOS `bodygoals.retention`, worded without Apple Health. */
export const RETENTION_KEY = 'bodygoals.android.retention';

/** The delete-everything question's body: iOS `bodygoals.delete_body`, worded without Apple Health. */
export const DELETE_BODY_KEY = 'bodygoals.android.delete_body';
