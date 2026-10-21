/**
 * The opener's entry (../index.ts) loads no UI: src/navigation/refusalSteps.ts
 * imports `openAccountDeletion` from it, and navigation code must not pull
 * in the sheet, the bottom sheet library, the health store or the app store
 * by importing a function. The UI has its own entry (../ui.ts).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each case loads the entry fresh */

const refuse = (what: string) => () => {
  throw new Error(`the opener's entry loaded ${what}`);
};

it('the opener loads none of the sheet', () => {
  jest.isolateModules(() => {
    jest.doMock('../AccountDeletionSheet', refuse('the sheet'));
    jest.doMock('../AccountDeletionHost', refuse('the host'));
    jest.doMock('@gorhom/bottom-sheet', refuse('the bottom sheet'));
    jest.doMock('../../../../health', refuse('the health store'));
    jest.doMock('../../../../stores/appStore', refuse('the app store'));
    const entry = require('..') as typeof import('..');
    expect(Object.keys(entry).sort()).toEqual(['isAccountDeletionHostMounted', 'openAccountDeletion']);
  });
});

it('the UI entry publishes the host and the sheet', () => {
  jest.isolateModules(() => {
    jest.doMock('../AccountDeletionSheet', () => ({ __esModule: true, default: 'Sheet' }));
    jest.doMock('../AccountDeletionHost', () => ({ __esModule: true, default: 'Host' }));
    const ui = require('../ui') as { AccountDeletionHost: unknown; AccountDeletionSheet: unknown };
    expect(ui.AccountDeletionHost).toBe('Host');
    expect(ui.AccountDeletionSheet).toBe('Sheet');
  });
});
