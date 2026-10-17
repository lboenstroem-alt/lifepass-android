// @f4-stub (plan 3.0.3): how a Coach flow plugs into COACH-1's send pipeline; COACH-1 owns this file.
//
// iOS `CoachViewModel.send` runs one ordered pipeline for every typed message:
//
//   1. a flow with a question OPEN takes the words first, in this order:
//      the programme wizard, Adjust my plan (both read nothing typed: they
//      repeat their open question), the venue wizard (the words answer its
//      question), the day-plan wizard (only its class-type question takes
//      words; elsewhere it repeats the question);
//   2. then each flow may START from the words, in this order: the
//      programme wizard (a typed request for weeks only OFFERS it), the
//      day-plan wizard ("plan my day", "a hike"), the venue wizard (a venue
//      search);
//   3. anything left goes to the model (`/coach`), unless the free tier or
//      the daily cap has locked it. The wizards never call the model, so
//      they keep working at either lock.
//
// A flow is a module that exports a `CoachFlow`. COACH-1's store calls it;
// COACH-2 to COACH-5 fill the four flows. The message renderers are the
// flow's own bubbles (question chips, plan cards, proposal cards), keyed by
// the message kind the flow appends.
import type { ComponentType } from 'react';

export type CoachFlowId = 'venueWizard' | 'dayPlan' | 'program' | 'adjust';

/** Step 1's order: who takes typed words while their question is open. */
export const OPEN_QUESTION_ORDER: readonly CoachFlowId[] = ['program', 'adjust', 'venueWizard', 'dayPlan'];

/** Step 2's order: who may start from typed words. */
export const START_ORDER: readonly CoachFlowId[] = ['program', 'dayPlan', 'venueWizard'];

export interface CoachSendOptions {
  /** Off for prompts the app parks (Home's cards): a stray "plan" in the app's own wording must not start a wizard. */
  readonly detectPlanRequest: boolean;
  /** Off for parked prompts: a question about classes or a time goes to the chat. */
  readonly detectScheduleQuestion: boolean;
}

/** A message a flow added to the chat, as COACH-1's store keeps it. */
export interface CoachFlowMessage {
  readonly id: string;
  /** Which renderer draws it. */
  readonly kind: string;
  /** The flow's own data for the bubble. */
  readonly payload?: unknown;
}

export interface CoachMessageRendererProps {
  readonly message: CoachFlowMessage;
}

export interface CoachFlow {
  readonly id: CoachFlowId;
  /** True while this flow has a question open. */
  hasOpenQuestion(): boolean;
  /** Step 1: the words while a question is open. True when the flow took them. */
  takeTyped(text: string): boolean | Promise<boolean>;
  /** Step 2: start from the words. True when it started (or offered). */
  startFrom(text: string, options: CoachSendOptions): boolean | Promise<boolean>;
  /** Drop any open question (iOS `abandonOpenQuestions`), e.g. before a parked prompt. */
  abandon(): void;
  /** Forget everything (sign-out, a new chat). */
  reset(): void;
  /** The flow's bubbles, by message kind. */
  readonly renderers: Readonly<Record<string, ComponentType<CoachMessageRendererProps>>>;
}

/** A flow that takes nothing: what each flow file exports until its package lands. */
export function inactiveFlow(id: CoachFlowId): CoachFlow {
  return {
    id,
    hasOpenQuestion: () => false,
    takeTyped: () => false,
    startFrom: () => false,
    abandon: () => undefined,
    reset: () => undefined,
    renderers: {},
  };
}
