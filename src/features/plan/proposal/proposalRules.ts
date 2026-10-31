/**
 * The proposal card's rules (iOS ProgramProposalCard.swift), pure so they
 * can be tested on their own.
 *
 * RULING 2 IS THE SHAPE OF THE CARD. A generated plan is SAVED the moment it
 * comes back, as a proposal, and the member decides whether it becomes
 * theirs. Nothing offers to regenerate it: "Build my plan" again would spend
 * another Coach question on a different plan, and the member would learn to
 * reroll instead of to edit. Not now keeps it; Discard removes it and the
 * weight entered for it.
 */
import type { ApiError } from '../../../api';
import type { ProgramSummary } from '../../../health';

// ---------------------------------------------------------------------------
// Outcomes

/** What became of a proposal, so the card can collapse to one honest line and stay collapsed through every redraw. */
export type ProposalOutcome = 'started' | 'saved' | 'discarded' | 'changed';

export const PROPOSAL_OUTCOMES: readonly ProposalOutcome[] = ['started', 'saved', 'discarded', 'changed'];

/** The collapsed card's line. */
export function outcomeCopyKey(outcome: ProposalOutcome): string {
  return `program.proposal.${outcome}`;
}

/** Only a discarded plan has nowhere to go: every other collapsed card offers Open Plan. */
export function offersOpenPlan(outcome: ProposalOutcome): boolean {
  return outcome !== 'discarded';
}

// ---------------------------------------------------------------------------
// Words that differ for a revision (Adjust my plan)

/** "Your 4-week plan", or "Updated plan · 4 weeks" for a revision. */
export function kickerKey(program: Pick<ProgramSummary, 'revisionOf'>): string {
  return program.revisionOf !== null ? 'program.revision.kicker' : 'program.proposal.kicker';
}

/** A revision is switched to, not started (`SPEC` 6.8). */
export function startKey(program: Pick<ProgramSummary, 'revisionOf'>): string {
  return program.revisionOf !== null ? 'program.revision.start' : 'program.proposal.start';
}

// ---------------------------------------------------------------------------
// Start

/**
 * What a tap on Start does first.
 *
 * - `switch`: A REVISION ALWAYS ASKS ("Switch to the updated plan?"), whatever
 *   the store believes about a live plan. It exists to replace the plan it
 *   revises, so there is no start without the member saying yes to ending
 *   that one.
 * - `replace`: a live plan is known: "Replace your current plan?" first.
 * - `adopt`: no question; a 409 `program_already_active` from the server
 *   still opens the replace question (`adoptFailure`).
 */
export type StartDecision = 'switch' | 'replace' | 'adopt';

export function startDecision(program: Pick<ProgramSummary, 'revisionOf'>, hasLiveProgram: boolean): StartDecision {
  if (program.revisionOf !== null) return 'switch';
  return hasLiveProgram ? 'replace' : 'adopt';
}

/**
 * Start in the weeks screen (iOS `ProgramOverviewView`'s `onStart` from the
 * card): a revision asks first; anything else adopts at once, and a running
 * plan the store did not know about is the server's 409.
 */
export function overviewStartDecision(program: Pick<ProgramSummary, 'revisionOf'>): StartDecision {
  return program.revisionOf !== null ? 'switch' : 'adopt';
}

// ---------------------------------------------------------------------------
// Refusals

/**
 * Why an adopt did not go through (iOS `adopt`'s catch, in its order):
 * - `alreadyActive`: a plan is running: ask to replace it, then post again
 *   with `replaceActive: true`;
 * - `stale`: a revision whose plan has ended since; the card stays, so the
 *   member can discard it or make a new plan;
 * - `changed`: discarded, finished, adopted or deleted elsewhere;
 * - `offline`: no answer;
 * - `other`: anything else (the health store hears it first).
 */
export type AdoptFailure = 'alreadyActive' | 'stale' | 'changed' | 'offline' | 'other';

export function adoptFailure(error: unknown): AdoptFailure {
  const apiError = asApiError(error);
  if (!apiError) return 'other';
  if (apiError.isProblem('program_already_active')) return 'alreadyActive';
  if (apiError.isProblem('program_action_not_allowed') && apiError.reason === 'revision_stale') return 'stale';
  if (apiError.isProblem('program_action_not_allowed', 'health_program_not_found')) return 'changed';
  if (apiError.isOffline) return 'offline';
  return 'other';
}

/** Why a discard did not go through: changed elsewhere, offline, or anything else. */
export type DiscardFailure = 'changed' | 'offline' | 'other';

export function discardFailure(error: unknown): DiscardFailure {
  const apiError = asApiError(error);
  if (!apiError) return 'other';
  if (apiError.isProblem('program_action_not_allowed', 'health_program_not_found')) return 'changed';
  if (apiError.isOffline) return 'offline';
  return 'other';
}

/** The inline line a refusal leaves on the card (none: a question or a collapse answers it instead). */
export function failureErrorKey(failure: AdoptFailure | DiscardFailure): string | null {
  switch (failure) {
    case 'stale':
      return 'program.revision.stale';
    case 'offline':
      return 'health.offline.action_hint';
    case 'other':
      return 'common.error_body';
    case 'alreadyActive':
    case 'changed':
      return null;
  }
}

function asApiError(error: unknown): ApiError | null {
  const candidate = error as Partial<ApiError> | null;
  return candidate && typeof candidate.isProblem === 'function' ? (candidate as ApiError) : null;
}

// ---------------------------------------------------------------------------
// Workout day reminders

/** 07:00, the default Body and goals shows for the same preference: one member, one default (iOS `defaultWorkoutMinutes`). */
export const DEFAULT_REMINDER_MINUTES = 7 * 60;

/** 06:00 to 10:00 in half hours (iOS `reminderChoices`). */
export const REMINDER_CHOICES: readonly number[] = Array.from({ length: 9 }, (_, index) => 6 * 60 + index * 30);

/** "07:00": the time menu's label (iOS `String(format: "%02d:%02d")`), the same in both languages. */
export function reminderTimeLabel(minutes: number): string {
  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Whether Plan's adopted banner must say notifications are off: the member
 * left the toggle on, and the phone will deliver nothing. A toggle turned
 * off promises nothing, so it is never "denied".
 */
export function notificationsDeniedAfterAdopt(remindersOn: boolean, notesWillArrive: boolean): boolean {
  return remindersOn && !notesWillArrive;
}
