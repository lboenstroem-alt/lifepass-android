/**
 * The programme flow loads no UI at import (../platform.ts, ../../flows/program.ts):
 * the Coach's store loads every flow with the sign-in and sign-out hooks,
 * long before any screen, and a store, a register file or a background job
 * must be able to load it alone.
 *
 * The test asserts what is LOADED, not what fails to load: every screen the
 * wizard draws or opens, and the icon set every screen draws with, is
 * replaced by a stand-in that notes when it is evaluated. Requiring the flow,
 * the wizard, the context and the package's door must evaluate none of them.
 * (It used to lean on `@expo/vector-icons` failing under Jest without an
 * `expo-asset` mock, a quirk of where npm put that package; a later fix to
 * Jest's resolution would have broken the test, or blinded it.)
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the modules are required inside an isolated registry */

const loaded: string[] = [];

/** A stand-in module that notes its own evaluation. */
function noted(name: string): () => Record<string, unknown> {
  return () => {
    loaded.push(name);
    return {};
  };
}

/** Everything that is UI, or brings UI with it, by the path this file resolves it from. */
const SCREENS: readonly (readonly [path: string, name: string])[] = [
  ['@expo/vector-icons', 'icons'],
  ['../ProgramMultiChoiceBubble', 'multi-select bubble'],
  ['../ProgramSummaryBubble', 'summary bubble'],
  ['../ProgramProposalMessage', 'proposal message'],
  ['../../../plan/proposal/ProgramProposalCard', 'proposal card'],
  ['../../../body/sheets', 'body sheet'],
  ['../../../plan/days', 'day picker'],
  ['../../../feedback', 'monthly feedback'],
  ['../../../../screens/coach/MessageBubble', 'message bubble'],
];

beforeEach(() => {
  loaded.length = 0;
});

it('loads the flow, the wizard, the context and the door without loading a screen', () => {
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    require('../../flows/program');
    require('../wizard');
    require('../context');
    require('../index');
    expect(loaded).toEqual([]);
  });
});

it('would notice a screen loaded at import', () => {
  // The premise of the test above: a bubble pulled in at import is seen,
  // through itself and through the icons it draws with.
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    jest.requireActual('../ProgramSummaryBubble');
    expect(loaded).toContain('icons');
  });
});
