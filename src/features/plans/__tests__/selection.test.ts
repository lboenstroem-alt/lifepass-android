/**
 * Which card is selected (iOS PlansView's `selectedPlanIndex` and its
 * `onChange` handlers): the popular card on each segment, and the selected
 * card kept when the catalogue changes the list under it.
 */
import { decodePlanCatalog } from '../catalog';
import { SUBSCRIPTION_PLANS } from '../plans';
import { displayedPlans, initialSegment, keptSelection, popularSlug, selectedPlanIn } from '../selection';
import { catalogue, CATALOGUE_WITHOUT_POOL, pass } from './fixtures';

describe('the selected card', () => {
  it('each segment starts on its popular card', () => {
    expect(popularSlug(displayedPlans('monthly', null))).toBe('plan-plus');
    expect(popularSlug(displayedPlans('passes', null))).toBe('pass-adventurer');
    expect(popularSlug([])).toBeNull();
  });

  it('the memberships never depend on the catalogue', () => {
    expect(displayedPlans('monthly', null)).toEqual(SUBSCRIPTION_PLANS);
    expect(displayedPlans('monthly', decodePlanCatalog(CATALOGUE_WITHOUT_POOL))).toEqual(SUBSCRIPTION_PLANS);
  });

  it('a selected pass stays selected when a catalogue load reorders the list under it', () => {
    const before = displayedPlans('passes', null);
    expect(before.map((p) => p.id).indexOf('pass-day-studio')).toBe(4);
    const after = displayedPlans(
      'passes',
      decodePlanCatalog(catalogue({ packs: [pass('pass-local', 28_900, 12, 90)] })),
    );
    expect(after.map((p) => p.id)).toEqual(['pass-local', 'pass-day-gym', 'pass-day-studio']);
    expect(keptSelection(after, 'pass-day-studio')).toBe('pass-day-studio');
    expect(selectedPlanIn(after, 'pass-day-studio')?.id).toBe('pass-day-studio');
  });

  it('a selected card that is gone falls back to the popular one, else the first', () => {
    const passes = displayedPlans('passes', decodePlanCatalog(CATALOGUE_WITHOUT_POOL));
    expect(keptSelection(passes, 'pass-day-pool')).toBe('pass-adventurer');
    const noPopular = displayedPlans('passes', decodePlanCatalog(catalogue({ packs: [pass('pass-local', 28_900, 12, 90)] })));
    expect(keptSelection(noPopular, 'pass-explorer')).toBe('pass-local');
    expect(keptSelection([], 'pass-explorer')).toBeNull();
    expect(selectedPlanIn([], null)).toBeNull();
  });

  it('opens on the segment asked for, or the one the asked-for card is on', () => {
    expect(initialSegment(undefined, undefined)).toBe('monthly');
    expect(initialSegment('passes', undefined)).toBe('passes');
    expect(initialSegment(undefined, 'pass-local')).toBe('passes');
    expect(initialSegment(undefined, 'plan-max')).toBe('monthly');
    expect(initialSegment('monthly', 'pass-local')).toBe('monthly');
  });
});
