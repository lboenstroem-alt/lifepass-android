/**
 * Which of Plan's six bodies renders: the port of iOS `PlanSectionRule`
 * (Views/Plan/PlanView.swift, `ios-ux.md` 3.4), as a function so it can be
 * read and tested without standing up a screen.
 *
 * ENTITLEMENT IS ASKED BEFORE THE PROGRAMME, and that order is the whole
 * point of this function. The Today read answers with a `program` block for
 * any member whose consent stands (gate C exists precisely to serve a lapsed
 * member their own history). Asking "is there a programme?" first therefore
 * handed a not_member the ACTIVE PLAN body: the Today block, the week strip
 * and This plan, every button in them a 403. The gate card with their
 * nutrition, review and history under it is what that member gets, and what
 * the gate's own `plan.gate.history_line` promises.
 *
 * past_due is the one non-entitled access that keeps the plan body, read
 * only, with the payment banner over it, and only while a programme exists;
 * without one it is a gate like the others (`plan.gate.past_due_body`).
 */
import type { HealthAccess, ProgramStatus } from '../../../health';

/** Plan's six bodies (iOS `PlanSection`). */
export type PlanSection = 'loading' | 'error' | 'minor' | 'gate' | 'intro' | 'plan';

export interface PlanSectionInput {
  readonly access: HealthAccess;
  readonly hasConsent: boolean;
  /** The health store holds a Today read (or its cache): `today != null`. */
  readonly hasDay: boolean;
  readonly isLoading: boolean;
  readonly readFailed: boolean;
  /** A programme this tab still draws (`hasProgramToShow`). */
  readonly hasProgramToShow: boolean;
}

export function resolvePlanSection(input: PlanSectionInput): PlanSection {
  const { access, hasConsent, hasDay, isLoading, readFailed, hasProgramToShow } = input;
  if (access === 'minor') return 'minor';
  if (!hasDay) {
    if (isLoading) return 'loading';
    // An error only READS as an error for a member who should have had
    // something to show. The read runs for everyone whose consent stands
    // (the load sequence), lapsed members included, so the error block
    // belongs to all of them; a consent-less member has an empty day because
    // nothing was asked for, not because it failed.
    if (readFailed && hasConsent) return 'error';
  }
  if (access !== 'entitled' && access !== 'past_due') return 'gate';
  if (hasProgramToShow) return 'plan';
  if (access === 'past_due') return 'gate';
  return 'intro';
}

/**
 * A programme this tab still draws: active, paused OR completed.
 *
 * A programme past its end date reads `completed`. Asking only for a live
 * one would send every member who finishes a block to the gate or the intro
 * card, and the block-finished row with its "Start the next block" would
 * never be reachable by anyone.
 */
export function hasProgramToShow(status: ProgramStatus | null | undefined): boolean {
  return status === 'active' || status === 'paused' || status === 'completed';
}

/** `plan_viewed.state` (iOS `PlanSection.analyticsState`). */
export function planSectionAnalyticsState(section: PlanSection): string {
  switch (section) {
    case 'loading':
    case 'error':
    case 'intro':
      return 'no_plan';
    case 'minor':
      return 'minor';
    case 'gate':
      return 'gate';
    case 'plan':
      return 'active';
  }
}

/**
 * Scroll anchors (iOS `PlanSectionAnchor`): a notification tap can name the
 * section it lands on. `feedback` sits right after the weekly review.
 */
export const PLAN_SECTION_ANCHORS = ['nutrition', 'appleHealth', 'review', 'feedback', 'overview', 'history', 'footer'] as const;

export type PlanSectionAnchor = (typeof PLAN_SECTION_ANCHORS)[number];

/** An anchor by its name, or null (iOS `PlanSectionAnchor(rawValue:)`). */
export function planSectionAnchor(raw: string): PlanSectionAnchor | null {
  return (PLAN_SECTION_ANCHORS as readonly string[]).includes(raw) ? (raw as PlanSectionAnchor) : null;
}
