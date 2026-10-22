/**
 * The `adjust` Coach flow (plan 3.0.3; COACH-5): Adjust my plan, plugged into
 * COACH-1's store. The flow itself is ../adjust/flow.ts; this file is only
 * its `CoachFlow` face (./types.ts explains the contract).
 *
 * - `adjust.open` (the pipeline's second step): while the flow is open,
 *   typed words are DROPPED, never kept: the hint once, then the open
 *   question again. It is tap to choose.
 * - It never starts from typed words: only a tap opens it (`enter`): the
 *   empty state's "Adjust my plan", and a monthly feedback line's Adjust,
 *   which another tab parks. A programme gate bubble's "Adjust my plan" comes
 *   in through COACH-4's handoff, installed below as this module loads (the
 *   store loads every flow, so the door is there before any gate is drawn).
 * - `selectOption`: every chip on a bubble it asked. iOS answers every
 *   programme and adjust chip in one handler; a chip that is not an
 *   `adjust.` value goes on to the programme wizard's.
 * - It has no bubbles of its own: its questions are COACH-1's question
 *   bubbles, and a revision lands as the programme's proposal card.
 */
import { installProgramAdjustHandoff } from '../program';
import {
  abandonAdjust,
  beginAdjust,
  hasOpenAdjustQuestion,
  isAdjustActive,
  repeatOpenAdjustQuestion,
  resetAdjust,
  selectAdjustOption,
  startAdjust,
} from '../adjust/flow';
import { AdjustOptionValue } from '../adjust/model';
import { coachHost } from '../store/host';
import { programFlow } from './program';
import type { CoachFlow, CoachFlowEntry } from './types';

export const adjustFlow: CoachFlow = {
  id: 'adjust',

  isActive: isAdjustActive,

  hasOpenQuestion: hasOpenAdjustQuestion,

  takeTyped() {
    // The words are the flow's whatever happens, and they go nowhere.
    repeatOpenAdjustQuestion();
    return true;
  },

  startFrom() {
    return false;
  },

  abandon: abandonAdjust,

  reset: resetAdjust,

  renderers: {},

  enter(entry: CoachFlowEntry) {
    switch (entry.kind) {
      case 'chip':
        return startAdjust(entry.userText);
      case 'parked':
        // A feedback line's Adjust. Nothing from the report comes with it:
        // the member's bubble is the fixed chip label.
        if (entry.entry.kind !== 'adjust') return undefined;
        return startAdjust(coachHost().t('coach.chip.adjust_plan'));
      case 'category':
        return undefined;
    }
  },

  selectOption(messageId: string, value: string, label: string) {
    if (!value.startsWith(AdjustOptionValue.prefix)) return programFlow.selectOption?.(messageId, value, label);
    return selectAdjustOption(messageId, value, label);
  },

  healthWiped() {
    // The choices were health data: the flow stops (the store then takes
    // every health turn out of the chat).
    resetAdjust();
  },
};

// The programme wizard's running-plan gate hands "Adjust my plan" here.
installProgramAdjustHandoff({ begin: (context, entry) => beginAdjust(context, entry) });
