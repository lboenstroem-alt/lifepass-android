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
 *
 * NO HOST, NO GATE. The host (../HealthHost.tsx) registers itself when it
 * mounts (`attachMealGateHost`). With none mounted, `presentMealGate` answers
 * false and changes nothing, so the caller can show `MealGateSheet` itself
 * rather than leave the member with a meal screen that silently did nothing.
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

/** How many hosts are mounted: the app shell's one (a test may render its own). */
let hostsMounted = 0;

/** The host calls this when it mounts and the answer when it unmounts. */
export function attachMealGateHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted === 0) useMealGatePresenter.setState({ access: null, visible: false });
  };
}

/**
 * Shows the gate over whatever is on screen (iOS `MealGatePresenter.present`).
 * Answers false, and shows nothing, when no host is mounted.
 */
export function presentMealGate(access: HealthAccess): boolean {
  if (hostsMounted === 0) return false;
  useMealGatePresenter.setState({ access, visible: true });
  return true;
}

export function dismissMealGate(): void {
  useMealGatePresenter.setState({ visible: false });
}

/** Tests and the sign-out: nothing showing. */
export function resetMealGatePresenter(): void {
  useMealGatePresenter.setState({ access: null, visible: false });
}
