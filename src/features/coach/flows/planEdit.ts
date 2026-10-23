/**
 * The `planEdit` Coach flow (COACH-6): changing the running workout plan by
 * talking to the Coach, plugged into COACH-1's store. The flow itself is
 * ../planEdit/flow.ts; this file is only its `CoachFlow` face (./types.ts
 * explains the contract).
 *
 * - `planEdit.open` (after `adjust.open`): while a suggestion is open (a
 *   preview card waiting, a clarifying question, "Change my plan" tapped),
 *   the words refine it.
 * - `planEdit.start`: words the router reads as a plan change
 *   (../planEdit/intent.ts), or any words Adjust my plan handed on, go to
 *   OP-58. Never for a prompt the app parked.
 * - Either answers `'passed'` when the server says the words are not a plan
 *   change: the pipeline sends them on from the programme offer.
 * - `enter`: the empty state's "Change my plan", and a change parked by
 *   Plan ("Change with Coach") or the runner ("I don't have this").
 * - its own bubbles (the preview card, the consent tap, the notice), each
 *   loaded the first time one is drawn: the store loads every flow as the
 *   Coach's hooks load, long before any screen.
 *
 * Only while the server advertises `plan_edit` and a plan is live
 * (../planEdit/availability.ts): otherwise every step passes and the Coach
 * is exactly what it was.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the bubbles load when first drawn (see above) */
import { createElement, type ComponentType } from 'react';

import type * as CardModule from '../planEdit/PlanEditCard';
import type * as ConsentModule from '../planEdit/PlanEditConsentBubble';
import {
  abandonPlanEdit,
  enterParkedPlanEdit,
  hasOpenPlanEdit,
  PlanEditMessageKind,
  resetPlanEdit,
  selectPlanEditOption,
  startPlanEdit,
  startPlanEditFrom,
  takeTypedPlanEdit,
} from '../planEdit/flow';
import type { CoachFlow, CoachFlowEntry, CoachMessageRendererProps, CoachSendOptions, CoachStartContext } from './types';

type Renderer = ComponentType<CoachMessageRendererProps>;

function loadedOnFirstDraw(load: () => Renderer, name: string): Renderer {
  let component: Renderer | null = null;
  const Bubble = (props: CoachMessageRendererProps) => {
    component ??= load();
    return createElement(component, props);
  };
  Bubble.displayName = name;
  return Bubble;
}

export const planEditFlow: CoachFlow = {
  id: 'planEdit',

  // Never "in progress" in the sense that swallows words: an open
  // suggestion is an open question (`planEdit.open`).
  isActive: () => false,

  hasOpenQuestion: hasOpenPlanEdit,

  takeTyped: (text: string) => takeTypedPlanEdit(text),

  startFrom(text: string, options: CoachSendOptions, context: CoachStartContext) {
    const handedOn = context.handedOnFrom === 'adjust.open';
    if (!options.detectPlanRequest && !handedOn) return false;
    return startPlanEditFrom(text, { handedOn, abandonOpenQuestions: () => context.abandonOpenQuestions() });
  },

  abandon: abandonPlanEdit,

  reset: resetPlanEdit,

  renderers: {
    [PlanEditMessageKind.preview]: loadedOnFirstDraw(
      () => (require('../planEdit/PlanEditCard') as typeof CardModule).default,
      'PlanEditCard',
    ),
    [PlanEditMessageKind.notice]: loadedOnFirstDraw(
      () => (require('../planEdit/PlanEditCard') as typeof CardModule).PlanEditNotice,
      'PlanEditNotice',
    ),
    [PlanEditMessageKind.consent]: loadedOnFirstDraw(
      () => (require('../planEdit/PlanEditConsentBubble') as typeof ConsentModule).default,
      'PlanEditConsentBubble',
    ),
  },

  enter(entry: CoachFlowEntry) {
    switch (entry.kind) {
      case 'chip':
        return startPlanEdit(entry.userText);
      case 'planEdit':
        return enterParkedPlanEdit(entry.entry);
      default:
        return undefined;
    }
  },

  selectOption: selectPlanEditOption,

  healthWiped() {
    // Every bubble was health data: the flow forgets them (the store then
    // takes every health turn out of the chat).
    resetPlanEdit();
  },
};
