/**
 * Adjust my plan loads no UI at import (../platform.ts, ../../flows/adjust.ts):
 * the Coach's store loads every flow with the sign-in and sign-out hooks,
 * long before any screen, and a store, a register file or a background job
 * must be able to load it alone. The same check COACH-4 keeps for the
 * programme flow: every screen the flow opens or lands in, and the icon set,
 * is replaced by a stand-in that notes when it is evaluated.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the modules are required inside an isolated registry */

const loaded: string[] = [];

function noted(name: string): () => Record<string, unknown> {
  return () => {
    loaded.push(name);
    return {};
  };
}

const SCREENS: readonly (readonly [path: string, name: string])[] = [
  ['@expo/vector-icons', 'icons'],
  ['../../program/ProgramMultiChoiceBubble', 'multi-select bubble'],
  ['../../program/ProgramSummaryBubble', 'summary bubble'],
  ['../../program/ProgramProposalMessage', 'proposal message'],
  ['../../../plan/proposal/ProgramProposalCard', 'proposal card'],
  ['../../../body/sheets', 'body and target sheets'],
  ['../../../plan/days', 'day picker'],
  ['../../../feedback', 'monthly feedback'],
  ['../../../../screens/coach/MessageBubble', 'message bubble'],
];

beforeEach(() => {
  loaded.length = 0;
});

it('loads the flow, its face and its door without loading a screen', () => {
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    require('../../flows/adjust');
    require('../flow');
    require('../index');
    expect(loaded).toEqual([]);
  });
});

it('installs the programme gate\'s door as it loads', () => {
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    const handoff = require('../../program/adjustHandoff') as typeof import('../../program/adjustHandoff');
    handoff.installProgramAdjustHandoff(null);
    require('../../flows/adjust');
    expect(handoff.programAdjustHandoff()).not.toBeNull();
    expect(handoff.canRevise({ supportsPlanRevision: true })).toBe(true);
    expect(handoff.canRevise({ supportsPlanRevision: false })).toBe(false);
  });
});
