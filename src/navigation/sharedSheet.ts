/**
 * Opening a shared route (Account, Profile, a venue's page...) from wherever
 * the member is.
 *
 * A screen in a tab pushes it onto that tab's own stack, so the tab bar
 * stays: that is `navigation.navigate(name)`, and what this does there.
 *
 * A root modal (Plans, the classes sheet, the meal page, the runner) has no
 * shared routes in its stack: `navigation.navigate('Account')` from Plans
 * reaches no navigator and does nothing, and pushing onto the tab under the
 * modal would open the page out of sight. There the page slides up in the
 * shared sheet over the modal (./SharedSheetNavigator.tsx), as iOS presents
 * a refusal's Account over Plans as a sheet, and closing it lands back on
 * Plans. The same holds for code drawn outside any screen (a sheet's host in
 * the tabs shell): it goes to the current tab, or the shared sheet when a
 * modal is on top (`navigateInCurrentTab`).
 *
 * A UI-kit sheet is drawn above every navigator: a page opened while one is
 * up opens UNDER it. A sheet closes itself before it opens a page.
 */
import { navigateInCurrentTab } from './navigationRef';
import type { AppNavigation, SharedRouteName, SharedRoutes } from './types';

/**
 * What a screen navigates with. `getState` and `getParent` say which
 * navigators it is inside (every screen's `navigation` has them); without
 * them it is taken to be a tab screen's.
 */
export type SharedRouteNavigation = Pick<AppNavigation, 'navigate'> &
  Partial<Pick<AppNavigation, 'getState' | 'getParent'>>;

interface LooseNavigation {
  navigate(name: string, params?: object): void;
  getState?: () => unknown;
  getParent?: () => unknown;
}

/** True when `navigation`, or a navigator above it, has the route `name` (a tab stack or the shared sheet). */
export function canPushSharedRoute(navigation: SharedRouteNavigation, name: SharedRouteName): boolean {
  const start = navigation as unknown as LooseNavigation;
  if (typeof start.getState !== 'function') return true;
  for (let current: LooseNavigation | undefined = start; current; ) {
    const state = current.getState?.() as { readonly routeNames?: readonly string[] } | undefined;
    if (state?.routeNames?.includes(name)) return true;
    current = current.getParent?.() as LooseNavigation | undefined;
  }
  return false;
}

/**
 * Opens the shared route `name`: pushed where `navigation` can push it, else
 * on the current tab or in the shared sheet over a modal. False only when
 * the signed-in app is not on screen.
 */
export function openSharedRoute<Name extends SharedRouteName>(
  navigation: SharedRouteNavigation,
  name: Name,
  ...params: undefined extends SharedRoutes[Name] ? [params?: SharedRoutes[Name]] : [params: SharedRoutes[Name]]
): boolean {
  if (canPushSharedRoute(navigation, name)) {
    const loose = navigation as unknown as LooseNavigation;
    if (params[0] === undefined) loose.navigate(name);
    else loose.navigate(name, params[0] as object);
    return true;
  }
  return (navigateInCurrentTab as (route: SharedRouteName, routeParams?: object) => boolean)(
    name,
    params[0] as object | undefined,
  );
}
