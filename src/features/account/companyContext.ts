/**
 * The member's company-plan context on the Account screen,
 * `GET /company-plans/context`: iOS `AccountView.companyContext` and
 * `companyContextFailed`, and `loadCompanyContext()`.
 *
 * On iOS one `loadCompanyContext()` writes one `companyContext` /
 * `companyContextFailed` pair, and it serves two parts of the screen:
 * - the company banner (a pending co-pay activation or invitation), ACCT-3's
 *   `slots/CompanyPlanBanner`;
 * - the Membership card's fallback row "Have a company plan?", ACCT-1's,
 *   shown only while the read FAILED (any error, a 404 from a server without
 *   the route included), so a member is never left without a way to their
 *   company benefit.
 * Two stores would let the two disagree (the banner and the fallback row on
 * screen together, or neither) and send the read twice per appearance.
 *
 * THE CONTRACT (for ACCT-3 and the merge). This is the one store. ACCT-3's
 * `copay/contextSource.ts` re-exports it (`reloadCopayContext` =
 * `loadCompanyContext`, `resetCopayContext` = `resetCompanyContext`, the
 * context read from `useCompanyContext`), re-reads through
 * `loadCompanyContext()` after a Kenni sheet, an activation or a checkout
 * return, and does not read on appearance itself: the Account screen's
 * focus effect is the one read per appearance (iOS `.task`). The sign-out
 * cleaner in ./register.ts is the one that forgets it.
 *
 * A store rather than screen state so the slot and the screen share one read
 * (a slot takes no required props). The newest read wins; an answer for a
 * read that a sign-out overtook is dropped.
 */
import { create } from 'zustand';

import { fetchCompanyPlanContext } from '../../supabase/services/companyPlans';

/** What `GET /company-plans/context` answers (the type is ACCT-3's service's). */
export type CompanyContext = Awaited<ReturnType<typeof fetchCompanyPlanContext>>;

export interface CompanyContextState {
  /** The last context read; null before the first answer and after a failed read. */
  readonly context: CompanyContext | null;
  /** The last read failed: the Membership card offers the web dashboard instead. */
  readonly failed: boolean;
}

const initialState: CompanyContextState = { context: null, failed: false };

export const useCompanyContext = create<CompanyContextState>()(() => initialState);

/** Bumped by every read and by `resetCompanyContext`; an older read's answer is dropped. */
let latestRead = 0;

/** Reads the context (iOS `loadCompanyContext`). Never throws. */
export async function loadCompanyContext(): Promise<void> {
  latestRead += 1;
  const read = latestRead;
  try {
    const context = await fetchCompanyPlanContext();
    if (read !== latestRead) return;
    useCompanyContext.setState({ context, failed: false });
  } catch {
    // Any failure, the endpoint missing (404) included: fall back to the
    // web-dashboard row rather than a dead end.
    if (read !== latestRead) return;
    useCompanyContext.setState({ context: null, failed: true });
  }
}

/** Forgets the context (sign-out) and drops any read still on its way. */
export function resetCompanyContext(): void {
  latestRead += 1;
  useCompanyContext.setState(initialState, true);
}
