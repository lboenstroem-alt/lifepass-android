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
 * Until ACCT-1's file is on this branch, this module holds an equivalent
 * store of its own. THE MERGE SWITCH: once ACCT-1 has merged, this whole file
 * becomes the re-export below, and nothing else in ACCT-3 changes (every
 * reader goes through ./contextSource, which goes through here):
 *
 *   export {
 *     useCompanyContext as useCopayContextStore,
 *     loadCompanyContext as reloadCopayContext,
 *     resetCompanyContext as resetCopayContext,
 *   } from '../companyContext';
 *   export type { CompanyContextState as CopayContextState } from '../companyContext';
 *   // ACCT-1's Account screen reads the context on every focus: the banner does not read again.
 *   export const SCREEN_READS_ON_APPEAR = true;
 *
 * ./__tests__/mergeContract.test.ts fails until that switch is made, so the
 * merge cannot ship two stores (two GETs per appearance, and a banner and a
 * fallback row that disagree).
 */
import { create } from 'zustand';

import { fetchCompanyPlanContext, type CompanyPlanContext } from '../../../supabase/services/companyPlans';

export interface CopayContextState {
  /** The last context read; null before the first answer and after a failed read. */
  readonly context: CompanyPlanContext | null;
  /** The last read failed (any error, a 404 from a server without the route included). */
  readonly failed: boolean;
}

const initialState: CopayContextState = { context: null, failed: false };

export const useCopayContextStore = create<CopayContextState>()(() => initialState);

/** Bumped by every read and by `resetCopayContext`; an older read's answer is dropped. */
let latestRead = 0;

/** Reads the context (iOS `loadCompanyContext`). Never throws. */
export async function reloadCopayContext(): Promise<void> {
  latestRead += 1;
  const read = latestRead;
  try {
    const context = await fetchCompanyPlanContext();
    if (read !== latestRead) return;
    useCopayContextStore.setState({ context, failed: false });
  } catch {
    // iOS: any failure leaves no banner (and Account offers the web dashboard).
    if (read !== latestRead) return;
    useCopayContextStore.setState({ context: null, failed: true });
  }
}

/** Forgets the context (sign-out) and drops any read still on its way. */
export function resetCopayContext(): void {
  latestRead += 1;
  useCopayContextStore.setState(initialState, true);
}

/**
 * Whether the Account screen itself reads the context each time it appears.
 * Not yet (the first build's screen does not use this store), so the banner
 * reads on appearance; ACCT-1's screen does, and then the banner must not.
 */
export const SCREEN_READS_ON_APPEAR: boolean = false;
