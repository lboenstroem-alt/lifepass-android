/**
 * What the programme wizard (and Adjust my plan, COACH-5) is told about the
 * member: iOS `ProgramContext` (Models/CoachProgramWizard.swift), which
 * `CoachView` builds from `AppState` as a closure, so it is read FRESH at
 * every gate: access and consent can change under a chat that has been
 * sitting open on another tab.
 *
 * Here it is read straight from the stores (`programContextFromStores`), and
 * a test stands a gate up in one line with `setProgramContextForTests`.
 */
import type { Usage } from '../../../api/profile';
import {
  isLiveStatus,
  selectHasLiveProgram,
  useHealthStore,
  type HealthAccess,
  type ProgramSummary,
  type TargetWeightView,
} from '../../../health';
import {
  selectIsKennitalaVerified,
  selectHasHealthConsent,
  selectSupportsPlanRevision,
  selectSupportsTargetWeight,
  useAppStore,
} from '../../../stores/appStore';
import { PROGRAM_KINDS, type ProgramKind } from './model';
import { feedbackFoodOffOnRefusal } from './platform';

export interface ProgramContext {
  readonly access: HealthAccess;
  readonly hasConsent: boolean;
  readonly hasSavedProposal: boolean;
  readonly hasLiveProgram: boolean;
  /**
   * The kinds the membership covers, which question 1 answers silently and
   * the summary shows as an editable row (5.4). The server filters again.
   */
  readonly kinds: readonly ProgramKind[];
  readonly isKennitalaVerified: boolean;
  readonly latestWeightKg: number | null;
  readonly latestHeightCm: number | null;
  /** The server advertises `target_weight` / `plan_revision` (`SPEC` 2.1). */
  readonly supportsTargetWeight: boolean;
  readonly supportsPlanRevision: boolean;
  /** The live plan as the Today read has it (goal, days, weeks), which Adjust my plan starts from. */
  readonly liveProgram: ProgramSummary | null;
  /** The live plan's id from the profile block, for when the Today read has not answered yet. */
  readonly liveProgramId: string | null;
  /** The member's standing target weight, from the Today read. */
  readonly standingTarget: TargetWeightView | null;
  /**
   * A local safety refusal should turn food and weight out of the monthly
   * feedback (`SPEC` 9.8): the server has the feedback, consent stands, and
   * the switch is on or was never chosen.
   */
  readonly turnsOffFeedbackFoodOnRefusal: boolean;
}

/** iOS `ProgramContext()`: what a context nobody filled in says. */
export const DEFAULT_PROGRAM_CONTEXT: ProgramContext = {
  access: 'unknown',
  hasConsent: false,
  hasSavedProposal: false,
  hasLiveProgram: false,
  kinds: PROGRAM_KINDS,
  isKennitalaVerified: false,
  latestWeightKg: null,
  latestHeightCm: null,
  supportsTargetWeight: false,
  supportsPlanRevision: false,
  liveProgram: null,
  liveProgramId: null,
  standingTarget: null,
  turnsOffFeedbackFoodOnRefusal: false,
};

/**
 * Gym and classes unless the network cap is zero, pool unless the pool cap is
 * zero, outdoors always. With no usage block at all, everything (iOS
 * `ProgramContext.kinds(for:)`; a lane the block leaves out is not a zero).
 */
export function kindsForUsage(usage: Usage | null | undefined): ProgramKind[] {
  if (!usage) return [...PROGRAM_KINDS];
  const result: ProgramKind[] = [];
  if (usage.network?.cap !== 0) result.push('gym', 'classes');
  if (usage.pools?.cap !== 0) result.push('pool');
  result.push('outdoors');
  return result;
}

/** The context as the app's stores have it now (iOS `CoachView`'s `vm.programContext`). */
export function programContextFromStores(): ProgramContext {
  const app = useAppStore.getState();
  const health = useHealthStore.getState();
  const profileHealth = app.profile?.health ?? null;
  const profileProgram = profileHealth?.program ?? null;
  const profileLive = isLiveStatus(profileProgram?.status ?? null);
  const dayProgram = health.today?.program ?? null;
  return {
    access: app.healthAccess,
    hasConsent: selectHasHealthConsent(app),
    hasSavedProposal: health.today?.proposal != null || profileHealth?.proposalId != null,
    hasLiveProgram: selectHasLiveProgram(health) || profileLive,
    kinds: kindsForUsage(app.profile?.usage),
    isKennitalaVerified: selectIsKennitalaVerified(app),
    latestWeightKg: profileHealth?.latest?.weightKg ?? null,
    latestHeightCm: profileHealth?.latest?.heightCm ?? null,
    supportsTargetWeight: selectSupportsTargetWeight(app),
    supportsPlanRevision: selectSupportsPlanRevision(app),
    liveProgram: dayProgram && isLiveStatus(dayProgram.status) ? dayProgram : null,
    liveProgramId: profileLive ? (profileProgram?.id ?? null) : null,
    standingTarget: health.today?.targetWeight ?? null,
    turnsOffFeedbackFoodOnRefusal: feedbackFoodOffOnRefusal(),
  };
}

let override: (() => ProgramContext) | null = null;

/** The context, read now. */
export function readProgramContext(): ProgramContext {
  return override ? override() : programContextFromStores();
}

/** Tests: stand a gate up (`{ access: 'entitled', hasConsent: true }`); null goes back to the stores. */
export function setProgramContextForTests(context: Partial<ProgramContext> | (() => ProgramContext) | null): void {
  if (context === null) override = null;
  else if (typeof context === 'function') override = context;
  else override = () => ({ ...DEFAULT_PROGRAM_CONTEXT, ...context });
}
