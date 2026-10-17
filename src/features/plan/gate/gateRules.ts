/**
 * What the gate card says and offers for each access value (iOS
 * PlanGateCards.swift, `ios-ux.md` 3.6.1), pure so the table can be read and
 * tested on its own.
 *
 * THE GATE'S ONE RULE: the plan and the food log are INCLUDED with a
 * membership, never "unlocked". Nothing was taken away from the person
 * reading it, and the copy must not imply it was. That is why the example
 * week is shown in full rather than blurred: a locked-looking preview says
 * "you are missing out", and what is true is "this comes with the
 * membership".
 */
import type { HealthAccess, SessionKind } from '../../../health';
import type { Lang } from '../../../i18n';

/** A button on the gate, as `plan_gate_cta_tapped.cta` names it. */
export type GateCta = 'company' | 'fix_payment' | 'choose' | 'trial' | 'day_plan';

/**
 * The gate's buttons, in the order they are drawn.
 *
 * A company member whose employer's plan lapsed is sent to Account to
 * activate it, and a member whose payment failed to Account to fix it: in
 * both cases buying a second membership would be the wrong answer. Everyone
 * else sees the memberships, the free trial ONLY when the server says this
 * account may start one, and the Coach's day plans (which a visitor pass
 * includes).
 */
export function gateActions(access: HealthAccess, trialEligible: boolean): readonly GateCta[] {
  switch (access) {
    case 'company_inactive':
      return ['company'];
    case 'past_due':
      return ['fix_payment'];
    default:
      return trialEligible ? ['choose', 'trial', 'day_plan'] : ['choose', 'day_plan'];
  }
}

/** The gate's body line: past_due is told what is wrong, everyone else what is included. */
export function gateBodyKey(access: HealthAccess): 'plan.gate.past_due_body' | 'plan.gate.body' {
  return access === 'past_due' ? 'plan.gate.past_due_body' : 'plan.gate.body';
}

/** A visitor pass holder is told their pass already includes the Coach's day plans. */
export function showsPassLine(access: HealthAccess): boolean {
  return access === 'pass_only';
}

/** The words each button wears. */
export const GATE_CTA_KEYS: Readonly<Record<GateCta, string>> = {
  company: 'plan.gate.cta_company',
  fix_payment: 'health.past_due.cta',
  choose: 'plan.gate.cta_choose',
  trial: 'plan.gate.cta_trial',
  day_plan: 'plan.gate.day_plan',
};

/**
 * The gate's three bullets. iOS's third names Apple Health ("Your sleep and
 * steps from Apple Health"); Android reads no Health Connect (owner
 * decision), so it says what this app does give a member next to the plan:
 * the weekly review.
 */
export const GATE_BULLETS: readonly { readonly icon: 'calendar-outline' | 'restaurant-outline' | 'stats-chart-outline'; readonly key: string }[] = [
  { icon: 'calendar-outline', key: 'plan.gate.b1' },
  { icon: 'restaurant-outline', key: 'plan.gate.b2' },
  { icon: 'stats-chart-outline', key: 'plan.gate.b3_android' },
];

/** One row of the example week. */
export interface SampleRow {
  /** ISO weekday, 1 = Monday. */
  readonly weekday: number;
  readonly kind: SessionKind;
  readonly titleKey: string;
  readonly minutes: number | null;
}

/** The example week, in full: Mon strength 40, Wed swim 30, Fri class 45, Sat hike 60, rest between. */
export const SAMPLE_WEEK: readonly SampleRow[] = [
  { weekday: 1, kind: 'strength', titleKey: 'plan.gate.sample.mon', minutes: 40 },
  { weekday: 2, kind: 'rest', titleKey: 'plan.today.rest_title', minutes: null },
  { weekday: 3, kind: 'swim', titleKey: 'plan.gate.sample.wed', minutes: 30 },
  { weekday: 4, kind: 'rest', titleKey: 'plan.today.rest_title', minutes: null },
  { weekday: 5, kind: 'class', titleKey: 'plan.gate.sample.fri', minutes: 45 },
  { weekday: 6, kind: 'hike', titleKey: 'plan.gate.sample.sat', minutes: 60 },
  { weekday: 7, kind: 'rest', titleKey: 'plan.today.rest_title', minutes: null },
];

/**
 * The free trial's page. The app has no trial flow of its own (nor has
 * iOS): the web flow shows the trial terms, which is the version a member
 * has to agree to.
 */
export function trialUrl(language: Lang): string {
  return `https://www.lifepass.is/${language}/plans?trial=1`;
}
