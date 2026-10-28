/**
 * Merge guard: ONE company-plan context store on the Account screen.
 *
 * On iOS one `loadCompanyContext()` writes the one `companyContext` /
 * `companyContextFailed` pair that drives both the co-pay banner (ACCT-3) and
 * the "Have a company plan?" fallback row (ACCT-1), so they never disagree
 * and the route is read once per appearance. On Android ACCT-1 owns that
 * store (src/features/account/companyContext.ts). ACCT-3 and ACCT-1 are built
 * on separate branches, so until ACCT-1's file is on the branch ACCT-3 keeps
 * an equivalent store of its own (../contextStore.ts).
 *
 * Whichever of the two merges second, this test turns red until
 * ../contextStore.ts has been switched to ACCT-1's store, so the merge cannot
 * ship two stores. The switch is spelled out in that file's header and in the
 * failure below.
 */
import { existsSync } from 'fs';
import { join } from 'path';

import * as contextStore from '../contextStore';

const ACCT1_STORE = join(__dirname, '..', '..', 'companyContext.ts');

const SWITCH = `
ACCT-1's company-context store (src/features/account/companyContext.ts) is on this branch,
but ACCT-3 still keeps its own copy. Replace the whole body of
src/features/account/copay/contextStore.ts with:

  export {
    useCompanyContext as useCopayContextStore,
    loadCompanyContext as reloadCopayContext,
    resetCompanyContext as resetCopayContext,
  } from '../companyContext';
  export type { CompanyContextState as CopayContextState } from '../companyContext';
  // ACCT-1's Account screen reads the context on every focus: the banner does not read again.
  export const SCREEN_READS_ON_APPEAR = true;

(keep the file's header comment). Nothing else in ACCT-3 changes.`;

describe('the company-plan context store (ACCT-1 merge contract)', () => {
  if (!existsSync(ACCT1_STORE)) {
    it('until ACCT-1’s store is on the branch: its own store, and the banner reads on each appearance', () => {
      expect(typeof contextStore.useCopayContextStore.getState).toBe('function');
      expect(contextStore.SCREEN_READS_ON_APPEAR).toBe(false);
    });
    return;
  }

  it('once ACCT-1’s store is on the branch: it IS that store, and only the screen reads on appearance', () => {
    const acct1 = jest.requireActual<Record<string, unknown>>('../../companyContext');
    const shared =
      contextStore.useCopayContextStore === acct1.useCompanyContext &&
      contextStore.reloadCopayContext === acct1.loadCompanyContext &&
      contextStore.resetCopayContext === acct1.resetCompanyContext &&
      contextStore.SCREEN_READS_ON_APPEAR;
    if (!shared) throw new Error(SWITCH);
  });
});
