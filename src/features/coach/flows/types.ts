// How a Coach flow plugs into COACH-1's store (plan 3.0.3); COACH-1 owns this file.
//
// iOS `CoachViewModel.send(_:detectPlanRequest:detectScheduleQuestion:)` runs
// ONE ordered pipeline for every typed message. Each step is either a flow
// with a question OPEN taking the words, or a flow STARTING from them, and
// the two kinds interleave (`SEND_PIPELINE`):
//
//   1. program.open      the programme wizard has a question open: it reads
//                        nothing typed, says so once and repeats its question;
//   2. adjust.open       Adjust my plan has a question open: the same (tap to choose);
//   3. program.start     a typed request for WEEKS ("a 4 week plan") OFFERS
//                        the programme wizard. Only with `detectPlanRequest`.
//                        It comes BEFORE the venue and day-plan wizards' open
//                        questions: asked for weeks mid-wizard, the member is
//                        offered the programme, never has the words taken as
//                        a venue answer or the day-plan question re-asked;
//   4. venueWizard.open  the venue wizard has a question open: the words answer it;
//   5. dayPlan.open      the day-plan wizard has a question open: its
//                        class-type question takes the words as the answer;
//                        any other question drops them (a hint once per
//                        flow) and is asked again under them;
//   6. dayPlan.start     "plan my day", "a hike", "hvað á ég að gera í dag"
//                        start the day-plan wizard with what the words already
//                        answer. Only with `detectPlanRequest`;
//   7. venueWizard.start a venue search starts the venue wizard. With
//                        `detectScheduleQuestion` a question about classes
//                        or a time is left for the chat (the wizard only
//                        finds places); without it, any venue type starts it.
//
// A start that takes the words in steps 3 and 6 first ABANDONS every open
// question (iOS `abandonOpenQuestions`: every flow dropped, every unanswered
// question bubble closed), BEFORE it appends anything, so its own new
// question stays open. The flow decides whether the words start it, so the
// pipeline hands it `abandonOpenQuestions` to call at that moment.
//
// The words reach the model (`/coach`) only when no step took them AND the
// AI path is not locked (the free tier or the daily cap): a locked AI path
// drops them. The wizards never call the model, so they keep working at
// either lock. A prompt the app parks (Home's cards) is sent after
// `abandonOpenQuestions`, with both detect options off.
//
// A flow is a module that exports a `CoachFlow`. COACH-1's store runs the
// pipeline (`runSendPipeline`); COACH-2 to COACH-5 fill the four flows. The
// message renderers are the flow's own bubbles (plan cards, proposal cards,
// multi-selects), keyed by the message kind the flow appends.
//
// WHAT A FLOW WORKS WITH. Everything a flow does to the chat goes through the
// store's host (`coachHost()` in ../store/host.ts): append and update
// messages (a QUESTION bubble is a message with `options`, drawn by COACH-1's
// question bubble and answered back through `selectOption` below), the
// typing dots and the chat generation (`host.busy()`), the AI locks, the
// model history, and the one-shot routes (Plans, Account, the Plan tab). A
// flow keeps its own state (what it has asked, the answers) and resets it in
// `abandon` and `reset`.
//
// HOW A FLOW IS ENTERED. Typed words reach it through the pipeline above. A
// tap reaches it through `enter` (a category tile, an empty-state chip, a
// parked entry from another tab) and `selectOption` (a chip on a question
// bubble the flow asked: the message carries `flow`, so the tap goes back to
// the flow that asked it, iOS `selectOption`'s routing). The store checks
// `!isTyping` and abandons every open question before `enter`, as each iOS
// entry point does first.
import type { ComponentType } from 'react';

import type { CoachProgramEntry } from '../../../stores/intentStore';

export type CoachFlowId = 'venueWizard' | 'dayPlan' | 'program' | 'adjust';

/** One step of the send pipeline: a flow, and whether it takes words for an open question or starts from them. */
export type CoachSendStep =
  | 'program.open'
  | 'adjust.open'
  | 'program.start'
  | 'venueWizard.open'
  | 'dayPlan.open'
  | 'dayPlan.start'
  | 'venueWizard.start';

/** The send pipeline, in iOS `CoachViewModel.send`'s order. The first step that takes the words ends it. */
export const SEND_PIPELINE: readonly CoachSendStep[] = [
  'program.open',
  'adjust.open',
  'program.start',
  'venueWizard.open',
  'dayPlan.open',
  'dayPlan.start',
  'venueWizard.start',
];

/** The steps that run only when the words may start a wizard (`detectPlanRequest`). */
export const PLAN_REQUEST_STEPS: readonly CoachSendStep[] = ['program.start', 'dayPlan.start'];

/** A step's flow and kind. */
export function sendStepParts(step: CoachSendStep): { readonly flow: CoachFlowId; readonly phase: 'open' | 'start' } {
  const [flow, phase] = step.split('.') as [CoachFlowId, 'open' | 'start'];
  return { flow, phase };
}

export interface CoachSendOptions {
  /** Off for prompts the app parks (Home's cards): a stray "plan" in the app's own wording must not start a wizard. */
  readonly detectPlanRequest: boolean;
  /** Off for parked prompts: a question about classes or a time goes to the chat. */
  readonly detectScheduleQuestion: boolean;
}

/** What the pipeline hands a flow that may start. */
export interface CoachStartContext {
  /**
   * iOS `abandonOpenQuestions`: drops every flow's open question and closes
   * every unanswered question bubble. The programme offer and the day-plan
   * start call it once they know the words start them, BEFORE appending
   * anything; the venue wizard does not (no question can be open by then).
   */
  abandonOpenQuestions(): void;
}

/**
 * A flow's own bubble, as COACH-1's store keeps it (a `CoachMessage` with a
 * `kind`; see ../store/messages.ts for the whole message).
 */
export interface CoachFlowMessage {
  readonly id: string;
  /** Which renderer draws it. */
  readonly kind: string;
  /** The flow's own data for the bubble. */
  readonly payload?: unknown;
  /** The text the bubble keeps when the chat is saved (a plan's intro), or its caption. */
  readonly text: string;
  /** The health lane: never saved, never sent to the model, wiped with the health data. */
  readonly isHealth?: boolean;
}

export interface CoachMessageRendererProps {
  readonly message: CoachFlowMessage;
  /** A reply or a build is in flight (iOS `isBusy: vm.isTyping`): chips that would call out wait. */
  readonly busy: boolean;
}

/**
 * The venue wizard's categories (iOS `venueQuestions` keys): what a category
 * tile, the strip and the lagoon chip start (`CoachViewModel.wizardCategory`).
 */
export type CoachWizardCategory = 'swimming' | 'gym' | 'spa' | 'yoga' | 'golf' | 'lagoon';

/**
 * A tap that starts a flow (never typed words: those go through the pipeline).
 *
 * - `category`: a category tile, the strip after a search, or the lagoon
 *   chip. The venue wizard, under `userText` (the tile's own label, so an
 *   Icelandic member sees an Icelandic bubble). iOS `startSearch`.
 * - `chip`: the empty state's full-width chips: "Plan my day" (the day-plan
 *   wizard), "Get a 4-week plan" (the programme wizard), "Adjust my plan"
 *   (Adjust my plan). `userText` is the chip's label for the member's bubble.
 *   iOS `startPlan(labelKey:)`, `startProgram(entry: .chip)`, `startAdjust()`.
 * - `parked`: an entry another tab parked (Plan's intro card, Home, the end
 *   of a block, a feedback line's Adjust). The programme flow takes
 *   `planTab`, `home` and `nextBlock`; Adjust my plan takes `adjust`. iOS
 *   `startProgram(parked:)`, after the store has waited out a reply in flight.
 */
export type CoachFlowEntry =
  | { readonly kind: 'category'; readonly category: CoachWizardCategory; readonly userText: string }
  | { readonly kind: 'chip'; readonly userText: string }
  | { readonly kind: 'parked'; readonly entry: CoachProgramEntry };

export interface CoachFlow {
  readonly id: CoachFlowId;
  /** True while this flow has a question open. */
  hasOpenQuestion(): boolean;
  /** An `.open` step: the words while a question is open. True when the flow took them. */
  takeTyped(text: string): boolean | Promise<boolean>;
  /** A `.start` step: start from the words. True when it started (or offered). */
  startFrom(text: string, options: CoachSendOptions, context: CoachStartContext): boolean | Promise<boolean>;
  /** Drop this flow's open question and state (part of `abandonOpenQuestions`). */
  abandon(): void;
  /** Forget everything (sign-out, a new chat). */
  reset(): void;
  /** The flow's bubbles, by message kind. */
  readonly renderers: Readonly<Record<string, ComponentType<CoachMessageRendererProps>>>;
  /**
   * A tap that starts this flow (see `CoachFlowEntry`). The store has checked
   * that no reply is in flight and abandoned every open question first.
   * Absent: the flow has no button entry (or has not landed yet), and the tap
   * does nothing.
   */
  enter?(entry: CoachFlowEntry): void | Promise<void>;
  /**
   * A chip on a question bubble this flow asked (`message.flow === id`):
   * `value` is the option's wire value, `label` what the member saw (or the
   * text typed into an "Other" field, for both). The flow checks that the
   * bubble is still its open question (iOS: "only the CURRENT flow's open
   * question may answer").
   */
  selectOption?(messageId: string, value: string, label: string): void | Promise<void>;
  /**
   * The health data on this phone was wiped (tracking switched off, here or
   * elsewhere; iOS `.healthLocalDataWiped`). The store has already removed
   * every `isHealth` turn from the chat; a flow that holds health answers
   * (the programme wizard, Adjust my plan) ends here.
   */
  healthWiped?(): void;
}

/**
 * Runs the send pipeline over the four flows. Returns the step that took the
 * words, or null: then the words go to the model, unless the AI path is
 * locked (COACH-1's store decides; this never calls the model).
 */
export async function runSendPipeline(
  flows: Readonly<Record<CoachFlowId, CoachFlow>>,
  text: string,
  options: CoachSendOptions,
  context: CoachStartContext,
): Promise<CoachSendStep | null> {
  for (const step of SEND_PIPELINE) {
    const { flow, phase } = sendStepParts(step);
    const target = flows[flow];
    if (phase === 'open') {
      if (target.hasOpenQuestion() && (await target.takeTyped(text))) return step;
      continue;
    }
    if (PLAN_REQUEST_STEPS.includes(step) && !options.detectPlanRequest) continue;
    if (await target.startFrom(text, options, context)) return step;
  }
  return null;
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
