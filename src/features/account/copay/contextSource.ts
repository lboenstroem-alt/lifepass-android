/**
 * The company-plan context the co-pay banner shows, `GET /company-plans/context`
 * (iOS `AccountView.companyContext` and `loadCompanyContext()`).
 *
 * A store rather than component state: the banner is a slot with no props,
 * and the flows (activation, the Kenni sheet's close, the recovery of a page
 * Android closed the app behind) re-read it from outside any component. The
 * newest read wins; a read that a sign-out overtook is dropped, and the
 * sign-out cleaner in ./register.ts forgets the context (it names the
 * member's employer and what it pays for them).
 *
 * ONE READ, TWO READERS. ACCT-1's Account screen reads the same route for its
 * "Have a company plan?" fallback row (src/features/account/companyContext.ts
 * on its branch, with the same state shape: `context`, `failed`). Once both
 * have merged, this module should re-export that store instead of keeping its
 * own, so the screen and the banner share one read: everything in ACCT-3
 * reads the context through the four exports below and nothing else.
 */
import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';
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

/** The context as last read, for code outside React. */
export function copayContext(): CompanyPlanContext | null {
  return useCopayContextStore.getState().context;
}

/** The context as last read; re-renders when a read lands. */
export function useCopayContext(): CompanyPlanContext | null {
  return useCopayContextStore((state) => state.context);
}

/**
 * Reads the context every time the screen the caller sits on appears (iOS
 * `.task` on AccountView): when it mounts on a focused screen, and again each
 * time the member comes back to it. Outside a navigator (a test, a preview)
 * it reads once, on mount.
 */
export function useReloadCopayContextOnAppear(): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation) {
      void reloadCopayContext();
      return undefined;
    }
    // useFocusEffect's rule: read now when the screen is already focused, and
    // on each later focus. A focus event that arrives for the appearance
    // already read (the mount and the event in one go) is skipped.
    let readForThisAppearance = navigation.isFocused();
    if (readForThisAppearance) void reloadCopayContext();
    const offFocus = navigation.addListener('focus', () => {
      if (readForThisAppearance) {
        readForThisAppearance = false;
        return;
      }
      void reloadCopayContext();
    });
    const offBlur = navigation.addListener('blur', () => {
      readForThisAppearance = false;
    });
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
}
