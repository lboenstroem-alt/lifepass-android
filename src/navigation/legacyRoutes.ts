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
 */
import type { NavigationAction } from '@react-navigation/native';

import { useIntentStore } from '../stores/intentStore';
import { navigateInCurrentTab, openRootModal } from './navigationRef';
import type { ProfileTab } from './types';

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
