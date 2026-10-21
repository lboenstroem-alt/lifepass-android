/**
 * How the class sheet opens a page. Its host sits in the tabs shell, outside
 * any screen, so it cannot push with a screen's `navigation`: a shared route
 * goes onto the tab on screen (the tab bar stays), or into the shared sheet
 * when a root modal is on top (the Plan tab's classes sheet), and Plans is
 * its root modal (src/navigation/navigationRef.ts).
 *
 * A dependency of the sheet (`ClassBookingSheetProps.pages`), so the tests
 * can watch what it opens without a whole tab shell.
 */
import { navigateInCurrentTab, openRootModal } from '../../../navigation/navigationRef';
import type { SharedRouteName } from '../../../navigation/types';
import { venuesStore } from '../../../stores/venuesStore';
import { watchForReturn, type ReturnHow } from './returnWatch';

export interface ClassSheetPages {
  /** Opens a shared route where the member is. False when nothing opened. */
  openSharedRoute(name: SharedRouteName, params?: object): boolean;
  /** Opens the Plans modal. False when nothing opened. */
  openPlans(): boolean;
  /** Calls back once the member is back where the sheet was, or that place is gone (./returnWatch.ts). */
  watchForReturn(onReturn: (how: ReturnHow) => void): (() => void) | null;
  /** The venue's id, when the phone already knows the venue (Home and Explore loaded it). */
  venueIdForSlug(slug: string): string | null;
}

/** The venue's id from the venues already loaded, or null. */
export function knownVenueIdForSlug(slug: string): string | null {
  const wanted = slug.toLowerCase();
  const { catalog, fetched } = venuesStore.getState();
  return [...fetched, ...catalog].find((venue) => venue.slug.toLowerCase() === wanted)?.id ?? null;
}

export const appPages: ClassSheetPages = {
  openSharedRoute(name, params) {
    return (navigateInCurrentTab as (route: SharedRouteName, routeParams?: object) => boolean)(name, params);
  },
  openPlans() {
    return openRootModal('Plans');
  },
  watchForReturn(onReturn) {
    return watchForReturn(onReturn);
  },
  venueIdForSlug: knownVenueIdForSlug,
};
