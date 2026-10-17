/**
 * The first Android build's route names, translated at run time.
 *
 * Its screens (src/screens/**) still navigate to routes this build renamed or
 * moved: the Profile TAB ('Bookings'), the top-up page ('TopUp', now the
 * `Plans` modal) and the Check-in tab ('CheckIn', now `Scan`). No navigator
 * has those names, so React Navigation reports the action as unhandled; the
 * container hands it here (`onUnhandledAction`) and it is performed under
 * the new name, until each owner rebuilds its screen. QA-1 deletes this file
 * with the last legacy screen.
 *
 * 'CheckIn' from a page (the venue page's walk-in "Scan the QR code") is the
 * scanner pushed on that page's own stack, with a back button (`ScanPushed`),
 * as iOS pushes `CheckInView(showsBackButton: true)` from the venue page: the
 * member stays in the venue's context and back returns to it. Only a caller
 * with no stack gets the Scan tab.
 */
import type { NavigationAction } from '@react-navigation/native';

import { useIntentStore } from '../stores/intentStore';
import { navigateInCurrentTab, navigationRef, openRootModal } from './navigationRef';
import type { ProfileTab } from './types';

interface LooseState {
  readonly routeNames?: readonly string[];
  readonly routes: readonly { readonly key?: string; readonly state?: LooseState }[];
}

const has = (state: LooseState | undefined, name: string): boolean => state?.routeNames?.includes(name) ?? false;

/**
 * True when the screen that sent an action (`source`, its route key) sits in
 * a stack that can push `name`: its own navigator or one above it has the
 * route, or (a call through `getParent()`, which sends from the tab's route)
 * the stack inside that route has it.
 */
export function sourceCanPush(source: string | undefined, name: string): boolean {
  if (!source || !navigationRef.isReady()) return false;
  const search = (state: LooseState, ancestorHas: boolean): boolean | null => {
    const here = ancestorHas || has(state, name);
    for (const route of state.routes) {
      if (route.key === source) return here || has(route.state, name);
      if (route.state) {
        const found = search(route.state, here);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return search(navigationRef.getRootState() as unknown as LooseState, false) ?? false;
}

interface NavigatePayload {
  readonly name?: unknown;
  readonly params?: unknown;
}

function profileTabFrom(params: unknown): ProfileTab {
  if (typeof params !== 'object' || params === null) return 'bookings';
  const record = params as { initialTab?: unknown; params?: unknown };
  if (record.initialTab === 'saved') return 'saved';
  // `navigate('Bookings', { screen: 'BookingsMain', params: { initialTab } })`.
  return profileTabFrom(record.params) === 'saved' ? 'saved' : 'bookings';
}

/** Performs a legacy route under its new name. True when it was one. */
export function translateLegacyAction(action: NavigationAction): boolean {
  if (action.type !== 'NAVIGATE' && action.type !== 'PUSH' && action.type !== 'JUMP_TO') return false;
  const payload = (action.payload ?? {}) as NavigatePayload;
  switch (payload.name) {
    case 'Bookings':
    case 'BookingsMain':
      // The Profile tab is gone: Profile is a page on the tab you are on.
      return navigateInCurrentTab('Profile', { initialTab: profileTabFrom(payload.params) });
    case 'TopUp':
      return openRootModal('Plans');
    case 'CheckIn':
    case 'CheckInMain':
      // From a page: the scanner on its stack, back to the page. Else the tab.
      if (sourceCanPush((action as { source?: string }).source, 'ScanPushed') && navigateInCurrentTab('ScanPushed')) {
        return true;
      }
      useIntentStore.getState().requestTab('Scan');
      return true;
    default:
      return false;
  }
}

/** The container's `onUnhandledAction`: legacy names, else React Navigation's own development warning. */
export function onUnhandledNavigationAction(action: NavigationAction): void {
  if (translateLegacyAction(action)) return;
  if (__DEV__ && process.env.NODE_ENV !== 'test') {
    console.error(`[navigation] "${action.type}" was not handled by any navigator`, action.payload);
  }
}
