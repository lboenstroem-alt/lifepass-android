/**
 * The membership gate a member without a membership meets INSTEAD of any
 * meal screen (iOS `MealGateSheet`, ios-ux.md 11.6): never a page that then
 * fails. Its words depend on why the member is outside:
 *
 * | access             | body                       | button                       | opens    |
 * |--------------------|----------------------------|------------------------------|----------|
 * | `pass_only`        | `meal.gate.body_pass`      | See memberships              | Plans    |
 * | `company_inactive` | `meal.gate.body_company`   | Activate your company plan   | Account  |
 * | `past_due`         | `meal.gate.body_past_due`  | Fix payment                  | Account  |
 * | anything else      | `meal.gate.body`           | See memberships              | Plans    |
 *
 * A 403 from a meal call presents it over whatever is underneath
 * (`presentMealGate`): the screen that got the refusal is on its way out and
 * cannot present it itself.
 */
import { create } from 'zustand';

import type { HealthAccess } from '../models';

export interface MealGateCopy {
  readonly titleKey: 'meal.gate.title';
  readonly bodyKey: string;
  readonly ctaKey: string;
  /** Where the button goes: the membership catalogue, or Account to fix or activate. */
  readonly opens: 'plans' | 'account';
}

export function mealGateCopy(access: HealthAccess): MealGateCopy {
  switch (access) {
    case 'pass_only':
      return { titleKey: 'meal.gate.title', bodyKey: 'meal.gate.body_pass', ctaKey: 'plan.gate.cta_choose', opens: 'plans' };
    case 'company_inactive':
      return { titleKey: 'meal.gate.title', bodyKey: 'meal.gate.body_company', ctaKey: 'plan.gate.cta_company', opens: 'account' };
    case 'past_due':
      return { titleKey: 'meal.gate.title', bodyKey: 'meal.gate.body_past_due', ctaKey: 'health.past_due.cta', opens: 'account' };
    default:
      return { titleKey: 'meal.gate.title', bodyKey: 'meal.gate.body', ctaKey: 'plan.gate.cta_choose', opens: 'plans' };
  }
}

interface MealGatePresenterState {
  /** The access the gate shows; null when it is not up. Kept while it slides away. */
  readonly access: HealthAccess | null;
  readonly visible: boolean;
}

export const useMealGatePresenter = create<MealGatePresenterState>()(() => ({ access: null, visible: false }));

/** Shows the gate over whatever is on screen (iOS `MealGatePresenter.present`). */
export function presentMealGate(access: HealthAccess): void {
  useMealGatePresenter.setState({ access, visible: true });
}

export function dismissMealGate(): void {
  useMealGatePresenter.setState({ visible: false });
}

/** Tests and the sign-out: nothing showing. */
export function resetMealGatePresenter(): void {
  useMealGatePresenter.setState({ access: null, visible: false });
}
