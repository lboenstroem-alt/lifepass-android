/**
 * Whether the Coach can change this member's plan right now (iOS
 * `PlanEditAvailability`). Three things must hold, all decided by the server
 * and read here: it advertises `plan_edit`; the member is entitled and
 * consent stands; a plan is running. A PAUSED plan is refused by the server
 * (resuming moves its days by whole weeks, so a preview could land on the
 * wrong dates), and the Coach says "Resume your plan to change it." instead
 * of sending anything.
 *
 * Read FRESH at every use, like the programme wizard's context: features,
 * consent and the plan can change under a chat that has been open on
 * another tab. An older server never advertises the feature, so a build
 * talking to it keeps today's Coach exactly.
 */
import type { HealthAccess, ProfileProgramSummary } from '../../../api/profile';
import { useHealthStore, type HealthDay, type ProgramSummary } from '../../../health';
import { selectHasHealthConsent, selectSupportsPlanEdit, useAppStore } from '../../../stores/appStore';

export type PlanEditAvailability =
  | { readonly kind: 'available'; readonly programId: string; readonly program: ProgramSummary | null; readonly day: HealthDay | null }
  /** The plan is paused: "Resume your plan to change it." */
  | { readonly kind: 'paused'; readonly programId: string }
  /** No feature, no consent, no membership, no live plan: the Coach behaves as before. */
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: PlanEditAvailability = { kind: 'unavailable' };

/**
 * The availability from what the stores hold (iOS
 * `PlanEditAvailability.resolve`). The plan is the Today read's when it has
 * a live one, the profile's otherwise (the Today read has not answered yet).
 * An active plan past its end reads `completed` on both, which is not live.
 */
export function resolvePlanEditAvailability(input: {
  readonly advertised: boolean;
  readonly hasConsent: boolean;
  readonly access: HealthAccess;
  /** The Today read's plan. */
  readonly dayProgram: Pick<ProgramSummary, 'id' | 'status'> | null;
  /** The Today read itself, handed on for the router's plan words. */
  readonly day?: HealthDay | null;
  readonly profileProgram: Pick<ProfileProgramSummary, 'id' | 'status'> | null;
}): PlanEditAvailability {
  if (!input.advertised || !input.hasConsent || input.access !== 'entitled') return UNAVAILABLE;
  const dayProgram = input.dayProgram;
  if (dayProgram?.status === 'active') {
    const day = input.day ?? null;
    return { kind: 'available', programId: dayProgram.id, program: day?.program ?? null, day };
  }
  if (dayProgram?.status === 'paused') return { kind: 'paused', programId: dayProgram.id };
  const profileProgram = input.profileProgram;
  if (profileProgram?.status === 'active') return { kind: 'available', programId: profileProgram.id, program: null, day: null };
  if (profileProgram?.status === 'paused') return { kind: 'paused', programId: profileProgram.id };
  return UNAVAILABLE;
}

/** The availability as the stores have it now. */
export function planEditAvailabilityFromStores(): PlanEditAvailability {
  const app = useAppStore.getState();
  const day = useHealthStore.getState().today;
  return resolvePlanEditAvailability({
    advertised: selectSupportsPlanEdit(app),
    hasConsent: selectHasHealthConsent(app),
    access: app.healthAccess,
    dayProgram: day?.program ?? null,
    day,
    profileProgram: app.profile?.health?.program ?? null,
  });
}

let override: (() => PlanEditAvailability) | null = null;

/** The availability, read now. */
export function planEditAvailability(): PlanEditAvailability {
  return override ? override() : planEditAvailabilityFromStores();
}

/** True while typed words may go to OP-58 (a running plan on a server that edits by chat). */
export function supportsPlanEdit(): boolean {
  return planEditAvailability().kind === 'available';
}

/** True while the Coach offers plan changes at all (running or paused: a paused plan is told how). */
export function offersPlanEdit(): boolean {
  return planEditAvailability().kind !== 'unavailable';
}

/** React: the availability's kind, redrawn whenever the stores behind it change. */
export function usePlanEditAvailabilityKind(): PlanEditAvailability['kind'] {
  const advertised = useAppStore(selectSupportsPlanEdit);
  const hasConsent = useAppStore(selectHasHealthConsent);
  const access = useAppStore((s) => s.healthAccess);
  const profileId = useAppStore((s) => s.profile?.health?.program?.id ?? null);
  const profileStatus = useAppStore((s) => s.profile?.health?.program?.status ?? null);
  const dayId = useHealthStore((s) => s.today?.program?.id ?? null);
  const dayStatus = useHealthStore((s) => s.today?.program?.status ?? null);
  return resolvePlanEditAvailability({
    advertised,
    hasConsent,
    access,
    dayProgram: dayId ? { id: dayId, status: dayStatus } : null,
    profileProgram: profileId ? { id: profileId, status: profileStatus } : null,
  }).kind;
}

/** React: the Coach offers plan changes (the chip, the Changes list, Adjust's new place). */
export function usePlanEditOffered(): boolean {
  return usePlanEditAvailabilityKind() !== 'unavailable';
}

/** React: a plan change can be sent now (Change with Coach, I don't have this): not on a paused plan. */
export function usePlanEditReady(): boolean {
  return usePlanEditAvailabilityKind() === 'available';
}

/** Tests: stand an availability up; null goes back to the stores. */
export function setPlanEditAvailabilityForTests(value: PlanEditAvailability | (() => PlanEditAvailability) | null): void {
  if (value === null) override = null;
  else if (typeof value === 'function') override = value;
  else override = () => value;
}
