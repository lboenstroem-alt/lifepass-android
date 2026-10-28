/**
 * The plan-edit flow loads no UI at import (../platform.ts, ../../flows/planEdit.ts):
 * the Coach's store loads every flow with the sign-in and sign-out hooks,
 * long before any screen, and a store, a register file or a background job
 * must be able to load it alone. Its card, its consent bubble, the UI kit,
 * the runner and the icon set are replaced by stand-ins that note when they
 * are evaluated. Plan's door (../index.ts) loads none either.
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
  ['../PlanEditCard', 'preview card'],
  ['../PlanEditConsentBubble', 'consent bubble'],
  ['../../../../components/ui', 'UI kit'],
  ['../../../runner', 'runner'],
  ['../../../../health/ui', 'health screens'],
  ['../../../../screens/coach/MessageBubble', 'message bubble'],
  ['../../program/ProgramMultiChoiceBubble', 'multi-select bubble'],
  ['../../program/ProgramSummaryBubble', 'summary bubble'],
  ['../../program/ProgramProposalMessage', 'proposal message'],
  ['../../../plan/proposal/ProgramProposalCard', 'proposal card'],
  ['../../../body/sheets', 'body and target sheets'],
  ['../../../plan/days', 'day picker'],
  ['../../../feedback', 'monthly feedback'],
];

beforeEach(() => {
  loaded.length = 0;
});

it('loads the flow, its face and its door without loading a screen', () => {
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    require('../../flows/planEdit');
    require('../flow');
    require('../index');
    expect(loaded).toEqual([]);
  });
});
