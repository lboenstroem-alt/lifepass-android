/**
 * Which card is selected on the Plans screen (iOS `PlansView`'s
 * `selectedPlanIndex` and its two `onChange` handlers).
 *
 * - Switching segment selects that segment's popular card (Plus, Adventurer),
 *   found by the flag rather than an index so reordering can't drift it.
 * - When the list on screen changes (the catalogue arrived or was re-read
 *   and listed other passes), the card that was selected stays selected,
 *   wherever it now sits; if it is gone, the popular card is selected.
 */
import type { PlanCatalog } from './catalog';
import { SUBSCRIPTION_PLANS, visitorPasses, type Plan } from './plans';

/** The two halves of the screen (iOS `selectedPlanCategory` 0 and 1). */
export type PlansSegmentValue = 'monthly' | 'passes';

/** The cards a segment shows: the memberships, or the passes the catalogue sells. */
export function displayedPlans(segment: PlansSegmentValue, catalog: PlanCatalog | null): Plan[] {
  return segment === 'monthly' ? [...SUBSCRIPTION_PLANS] : visitorPasses(catalog);
}

/** The popular card's slug, else the first card's; null for an empty list. */
export function popularSlug(plans: readonly Plan[]): string | null {
  return (plans.find((plan) => plan.isPopular) ?? plans[0])?.id ?? null;
}

/**
 * The slug that is selected once `plans` is on screen: `selected` while it is
 * still listed, else the popular card.
 */
export function keptSelection(plans: readonly Plan[], selected: string | null): string | null {
  if (selected !== null && plans.some((plan) => plan.id === selected)) return selected;
  return popularSlug(plans);
}

/** The selected card itself (null when the list is empty). */
export function selectedPlanIn(plans: readonly Plan[], selected: string | null): Plan | null {
  return plans.find((plan) => plan.id === selected) ?? plans[0] ?? null;
}

/**
 * The segment Plans opens on: the one asked for, else the one the asked-for
 * card belongs to, else the memberships (iOS always opens on them).
 */
export function initialSegment(segment: PlansSegmentValue | undefined, slug: string | undefined): PlansSegmentValue {
  if (segment) return segment;
  if (slug?.startsWith('pass-')) return 'passes';
  return 'monthly';
}
