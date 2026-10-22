/**
 * The `dayPlan` Coach flow (plan 3.0.3), filled by COACH-3 and run by
 * COACH-1's store: the day-plan wizard (../dayPlan/wizard.ts) and its plan
 * cards (../planCards). ./types.ts explains the contract.
 *
 * - `dayPlan.open` (the pipeline's fifth step): while the wizard has its
 *   question open, the class-type question takes typed words as its answer
 *   and any other question drops them (a hint once per wizard) and is asked
 *   again. Gated on the open question, not on the wizard being in progress:
 *   once the last answer is in, typed words go on as usual.
 * - `dayPlan.start` (the sixth step, only for typed words): words that ask
 *   for a day start the wizard with what they already answer, after
 *   abandoning every open question.
 * - `enter`: the empty state's "Plan my day" chip (the store abandoned every
 *   open question first).
 * - `selectOption`: a chip on the wizard's question.
 * - The plan message (`PLAN_MESSAGE_KIND`) is drawn by `PlanMessage`, loaded
 *   on first draw (../planCards/index.ts says why).
 *
 * Other flows start a fresh wizard from a chip they draw themselves (the
 * programme gate's "Plan my day") with `startDayPlanFromChip`.
 */
import { PlanMessageRenderer } from '../planCards';
import {
  answerDayPlan,
  dayPlanHasOpenQuestion,
  enterDayPlan,
  isDayPlanActive,
  PLAN_MESSAGE_KIND,
  resetDayPlan,
  startDayPlanFromWords,
  takeTypedForDayPlan,
} from '../dayPlan/wizard';
import type { CoachFlow, CoachFlowEntry, CoachSendOptions, CoachStartContext } from './types';

export { restartDayPlan, startDayPlanFromChip } from '../dayPlan/wizard';

export const dayPlanFlow: CoachFlow = {
  id: 'dayPlan',

  isActive: isDayPlanActive,

  hasOpenQuestion: dayPlanHasOpenQuestion,

  takeTyped(text: string) {
    return takeTypedForDayPlan(text);
  },

  startFrom(text: string, _options: CoachSendOptions, context: CoachStartContext) {
    // The pipeline runs this step only for typed words (`detectPlanRequest`).
    return startDayPlanFromWords(text, () => context.abandonOpenQuestions());
  },

  abandon: resetDayPlan,

  reset: resetDayPlan,

  renderers: { [PLAN_MESSAGE_KIND]: PlanMessageRenderer },

  enter(entry: CoachFlowEntry) {
    if (entry.kind !== 'chip') return;
    enterDayPlan(entry.userText);
  },

  selectOption(messageId: string, value: string, label: string) {
    return answerDayPlan(messageId, value, label);
  },
};
