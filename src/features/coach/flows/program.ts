/**
 * The `program` Coach flow (plan 3.0.3; COACH-4): the four-week programme
 * wizard and its build, plugged into COACH-1's store. The wizard itself is
 * ../program/wizard.ts; this file is only its `CoachFlow` face (./types.ts
 * explains the contract).
 *
 * - `program.open` (the pipeline's first step): while the wizard is in
 *   progress, typed words are DROPPED, never kept: the hint once, then the
 *   open question again (ruling 2).
 * - `program.start`: a typed request for weeks ("a 4 week plan") OFFERS the
 *   wizard; nothing starts until a chip is tapped.
 * - `enter`: the empty state's "Get a 4-week plan", and the entries Plan,
 *   Home and the end of a block park.
 * - `selectOption`: every chip on a programme bubble, gate and error bubbles
 *   included (they outlive the wizard).
 * - its own bubbles: the multi-select, the summary and the proposal card,
 *   each loaded the first time one is drawn. The store loads every flow as
 *   the Coach's sign-in and sign-out hooks load, long before any screen, so
 *   a flow loads no UI of its own at import (../program/platform.ts says the
 *   same of the sheets the wizard opens).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the bubbles load when first drawn (see above) */
import { createElement, type ComponentType } from 'react';

import type * as MultiChoiceModule from '../program/ProgramMultiChoiceBubble';
import type * as ProposalModule from '../program/ProgramProposalMessage';
import type * as SummaryModule from '../program/ProgramSummaryBubble';
import { ProgramMessageKind } from '../program/messages';
import {
  abandonProgram,
  hasOpenProgramQuestion,
  isProgramActive,
  offerFromTyped,
  repeatOpenQuestion,
  resetProgram,
  selectProgramOption,
  startParkedProgram,
  startProgram,
} from '../program/wizard';
import type { CoachFlow, CoachFlowEntry, CoachMessageRendererProps, CoachSendOptions, CoachStartContext } from './types';

type Renderer = ComponentType<CoachMessageRendererProps>;

/** A renderer whose component is required when it first draws. */
function loadedOnFirstDraw(load: () => Renderer, name: string): Renderer {
  let component: Renderer | null = null;
  const Bubble = (props: CoachMessageRendererProps) => {
    component ??= load();
    return createElement(component, props);
  };
  Bubble.displayName = name;
  return Bubble;
}

export const programFlow: CoachFlow = {
  id: 'program',

  isActive: isProgramActive,

  hasOpenQuestion: hasOpenProgramQuestion,

  takeTyped() {
    // The words are the wizard's whatever happens, and they go nowhere.
    repeatOpenQuestion();
    return true;
  },

  startFrom(text: string, options: CoachSendOptions, context: CoachStartContext) {
    if (!options.detectPlanRequest) return false;
    return offerFromTyped(text, context);
  },

  abandon: abandonProgram,

  reset: resetProgram,

  renderers: {
    [ProgramMessageKind.multiSelect]: loadedOnFirstDraw(
      () => (require('../program/ProgramMultiChoiceBubble') as typeof MultiChoiceModule).default,
      'ProgramMultiChoiceBubble',
    ),
    [ProgramMessageKind.summary]: loadedOnFirstDraw(
      () => (require('../program/ProgramSummaryBubble') as typeof SummaryModule).default,
      'ProgramSummaryBubble',
    ),
    [ProgramMessageKind.proposal]: loadedOnFirstDraw(
      () => (require('../program/ProgramProposalMessage') as typeof ProposalModule).default,
      'ProgramProposalMessage',
    ),
  },

  enter(entry: CoachFlowEntry) {
    switch (entry.kind) {
      case 'chip':
        return startProgram({ entry: 'chip' });
      case 'parked':
        return startParkedProgram(entry.entry);
      case 'category':
        return undefined;
    }
  },

  selectOption: selectProgramOption,

  healthWiped() {
    // The answers were health data: the wizard stops (the store then takes
    // every health turn out of the chat).
    resetProgram();
  },
};
