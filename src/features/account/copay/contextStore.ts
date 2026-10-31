/**
 * THE company-plan context store, `GET /company-plans/context` (iOS
 * `AccountView.companyContext` / `companyContextFailed` and
 * `loadCompanyContext()`), as everything in ACCT-3 sees it.
 *
 * ONE STORE ON THE SCREEN. On iOS one read writes one pair that drives both
 * the co-pay banner (ACCT-3) and the Membership card's "Have a company
 * plan?" fallback row (ACCT-1, shown only while the read failed), so the two
 * can never disagree. ACCT-1 owns that store on Android
 * (src/features/account/companyContext.ts: `useCompanyContext`,
 * `loadCompanyContext`, `resetCompanyContext`, the same `{ context, failed }`
 * shape) and reads it on every focus of the Account screen.
 *
 * THE MERGE SWITCH (made at the ACCT-3 merge, ACCT-1 merged first): this file
 * is now only a re-export of ACCT-1's store, and nothing else in ACCT-3
 * changed (every reader goes through ./contextSource, which goes through
 * here). ./__tests__/mergeContract.test.ts holds it to that, so the app never
 * ships two stores (two GETs per appearance, and a banner and a fallback row
 * that disagree).
 */
export {
  useCompanyContext as useCopayContextStore,
  loadCompanyContext as reloadCopayContext,
  resetCompanyContext as resetCopayContext,
} from '../companyContext';
export type { CompanyContextState as CopayContextState } from '../companyContext';
// ACCT-1's Account screen reads the context on every focus: the banner does not read again.
export const SCREEN_READS_ON_APPEAR = true;
