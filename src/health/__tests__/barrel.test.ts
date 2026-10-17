/**
 * The health barrel and the register file load no UI: a store, a register
 * file (loaded with every session hook) or a background job imports them,
 * and a component library there would fail where its native half is missing
 * and slow every launch. The screens are in ../ui.ts.
 */
it('the barrel, the register file and the background task load without any component', () => {
  jest.isolateModules(() => {
    jest.doMock('@expo/vector-icons', () => {
      throw new Error('a component was loaded');
    });
    jest.doMock('../../components/ui', () => {
      throw new Error('the UI kit was loaded');
    });
    /* eslint-disable @typescript-eslint/no-require-imports */
    expect(() => require('..')).not.toThrow();
    expect(() => require('../register')).not.toThrow();
    expect(() => require('../../notifications/register')).not.toThrow();
    expect(() => require('../../background/task')).not.toThrow();
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
});
