/**
 * The company-plan context the co-pay banner shows, `GET /company-plans/context`
 * (iOS `AccountView.companyContext` and `loadCompanyContext()`), for every
 * reader in ACCT-3.
 *
 * A store rather than component state: the banner is a slot with no props,
 * and the flows (activation, a Kenni sheet's close, the recovery of a page
 * Android closed the app behind) re-read it from outside any component. The
 * newest read wins; a read that a sign-out overtook is dropped, and the
 * sign-out cleaner in ./register.ts forgets the context (it names the
 * member's employer and what it pays for them).
 *
 * The store itself is ./contextStore: ONE store for the whole Account screen,
 * ACCT-1's once both packages have merged (that file says how), so the
 * banner and the screen's "Have a company plan?" fallback row share one read.
 */
import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';

import type { CompanyPlanContext } from '../../../supabase/services/companyPlans';

import { reloadCopayContext, SCREEN_READS_ON_APPEAR, useCopayContextStore } from './contextStore';

export { reloadCopayContext, resetCopayContext, useCopayContextStore } from './contextStore';
export type { CopayContextState } from './contextStore';

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
 *
 * Nothing at all once the Account screen reads the context on every focus
 * itself (ACCT-1's screen, `SCREEN_READS_ON_APPEAR`): one read per
 * appearance, as on iOS, never two.
 */
export function useReloadCopayContextOnAppear(): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (SCREEN_READS_ON_APPEAR) return undefined;
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
