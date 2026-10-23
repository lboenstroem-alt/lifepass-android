/**
 * Whether the Coach changes the plan by chat right now (spec "GATING"): the
 * server advertises `plan_edit`, health consent stands, and the cached plan
 * is live. A paused plan is not changed (resuming moves its days by whole
 * weeks, so a preview would be wrong by the time it is applied): the Coach
 * says "Resume your plan to change it." instead.
 *
 * Read FRESH at every use, like the programme wizard's context: features,
 * consent and the plan can change under a chat that has been open on
 * another tab. An older server never advertises the feature, so a build
 * talking to it keeps today's Coach exactly.
 */
import { isLiveProgramStatus } from '../../../api/profile';
import { useHealthStore, type HealthDay, type ProgramSummary } from '../../../health';
import { selectHasHealthConsent, selectSupportsPlanEdit, useAppStore } from '../../../stores/appStore';

export type PlanEditAvailability =
  | { readonly kind: 'available'; readonly programId: string; readonly program: ProgramSummary | null; readonly day: HealthDay | null }
  /** The plan is paused: "Resume your plan to change it." */
  | { readonly kind: 'paused'; readonly programId: string }
  /** No feature, no consent, no live plan: the Coach behaves as before. */
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: PlanEditAvailability = { kind: 'unavailable' };

/** The availability as the stores have it now. */
export function planEditAvailabilityFromStores(): PlanEditAvailability {
  const app = useAppStore.getState();
  if (!selectSupportsPlanEdit(app) || !selectHasHealthConsent(app)) return UNAVAILABLE;
  if (app.healthAccess === 'minor') return UNAVAILABLE;
  const day = useHealthStore.getState().today;
  const cached = day?.program ?? null;
  if (cached && isLiveProgramStatus(cached.status)) {
    if (cached.status === 'paused') return { kind: 'paused', programId: cached.id };
    return { kind: 'available', programId: cached.id, program: cached, day };
  }
  // The Today read has not answered yet: the profile's plan, when it says live.
  const profileProgram = app.profile?.health?.program ?? null;
  if (profileProgram && isLiveProgramStatus(profileProgram.status ?? null)) {
    if (profileProgram.status === 'paused') return { kind: 'paused', programId: profileProgram.id };
    return { kind: 'available', programId: profileProgram.id, program: null, day: null };
  }
  return UNAVAILABLE;
}

let override: (() => PlanEditAvailability) | null = null;

/** The availability, read now. */
export function planEditAvailability(): PlanEditAvailability {
  return override ? override() : planEditAvailabilityFromStores();
}

/** True while typed words may go to OP-58 (a live, running plan on a server that edits by chat). */
export function supportsPlanEdit(): boolean {
  return planEditAvailability().kind === 'available';
}

/** True while the Coach offers plan changes at all (running or paused: a paused plan is told how). */
export function offersPlanEdit(): boolean {
  return planEditAvailability().kind !== 'unavailable';
}

/**
 * React: "Change my plan" and "Change with Coach" show (the Coach's empty
 * state, Plan's Today card and preview, the runner's swap sheet).
 */
export function usePlanEditOffered(): boolean {
  const supports = useAppStore(selectSupportsPlanEdit);
  const consent = useAppStore(selectHasHealthConsent);
  const minor = useAppStore((s) => s.healthAccess === 'minor');
  const todayLive = useHealthStore((s) => isLiveProgramStatus(s.today?.program?.status ?? null));
  const profileLive = useAppStore((s) => isLiveProgramStatus(s.profile?.health?.program?.status ?? null));
  return supports && consent && !minor && (todayLive || profileLive);
}

/** Tests: stand an availability up; null goes back to the stores. */
export function setPlanEditAvailabilityForTests(value: PlanEditAvailability | (() => PlanEditAvailability) | null): void {
  if (value === null) override = null;
  else if (typeof value === 'function') override = value;
  else override = () => value;
}
