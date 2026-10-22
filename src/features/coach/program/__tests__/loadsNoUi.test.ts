/**
 * The programme flow loads no UI at import (../platform.ts, ../../flows/program.ts):
 * the Coach's store loads every flow with the sign-in and sign-out hooks,
 * long before any screen, and a store, a register file or a background job
 * must be able to load it alone.
 *
 * No `expo-asset` mock here, on purpose: `@expo/vector-icons` (which every
 * sheet and bubble draws with) cannot load under Jest without one, so any
 * screen pulled in at import fails this file.
 */
it('loads the flow, the wizard and the context without loading a screen', () => {
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    expect(() => require('../../flows/program')).not.toThrow();
    expect(() => require('../wizard')).not.toThrow();
    expect(() => require('../context')).not.toThrow();
    expect(() => require('../index')).not.toThrow();
    // The premise: a screen does fail to load here.
    expect(() => require('../ProgramSummaryBubble')).toThrow(/expo-asset/);
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
});
