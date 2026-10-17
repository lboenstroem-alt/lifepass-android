/**
 * The app's one navigation handle, for code that runs outside any screen: the
 * deep-link and notification routers, the legacy route translator, a slot's
 * imperative opener (`openRunner`). Screens navigate with their own
 * `navigation` prop (`useAppNavigation()`), which keeps the tab's stack.
 *
 * Every helper here answers false when the navigator is not mounted yet (a
 * cold start before the container is ready, or the member is signed out and
 * the tabs do not exist): the caller parks its intent instead (the intent
 * store), and the tabs shell performs it once it is on screen.
 */
import { CommonActions, createNavigationContainerRef, StackActions } from '@react-navigation/native';

import {
  MAIN_TABS,
  TAB_ROOT_SCREEN,
  type MainTab,
  type RootModalName,
  type RootModalRoutes,
  type RootStackParamList,
  type SharedRouteName,
  type SharedRoutes,
} from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type AnyNavigate = (name: string, params?: object) => void;

/** `navigate` without the nested param-tree typing (checked at each helper's signature instead). */
function navigateLoosely(name: string, params?: object): void {
  (navigationRef.navigate as unknown as AnyNavigate)(name, params);
}

interface LooseState {
  readonly index?: number;
  readonly key?: string;
  readonly routes: readonly { readonly name: string; readonly key?: string; readonly state?: LooseState }[];
}

/** The tabs navigator's state, when the signed-in app is mounted. */
function tabsState(): LooseState | null {
  if (!navigationRef.isReady()) return null;
  const root = navigationRef.getRootState() as unknown as LooseState | undefined;
  const main = root?.routes.find((route) => route.name === 'Main');
  return main?.state ?? null;
}

/** The tab on screen, or null while signed out or before the navigator is ready. */
export function currentTab(): MainTab | null {
  const tabs = tabsState();
  if (!tabs || typeof tabs.index !== 'number') return null;
  const name = tabs.routes[tabs.index]?.name;
  return (MAIN_TABS as readonly string[]).includes(name ?? '') ? (name as MainTab) : null;
}

/** True once the signed-in tabs are mounted (a route can be performed now). */
export function tabsReady(): boolean {
  return tabsState() !== null;
}

/** Opens a root modal (Plans, the runner, the meal page...). False when the app is not ready. */
export function openRootModal<Name extends RootModalName>(
  name: Name,
  ...params: undefined extends RootModalRoutes[Name]
    ? [params?: RootModalRoutes[Name]]
    : [params: RootModalRoutes[Name]]
): boolean {
  if (!tabsReady()) return false;
  navigateLoosely(name, params[0] as object | undefined);
  return true;
}

/**
 * Pushes a shared route onto the CURRENT tab's stack, so the tab bar stays
 * (what a screen's own `navigation.navigate` does, for code with no screen).
 */
export function navigateInCurrentTab<Name extends SharedRouteName>(
  name: Name,
  ...params: undefined extends SharedRoutes[Name] ? [params?: SharedRoutes[Name]] : [params: SharedRoutes[Name]]
): boolean {
  const tab = currentTab();
  if (!tab) return false;
  navigateLoosely('Main', { screen: tab, params: { screen: name, params: params[0], initial: false } });
  return true;
}

/**
 * Switches to `tab` straight away. Code outside the shell asks with the intent
 * store's `requestTab` instead, which also keeps the launch and Plan rules;
 * this is what the shell itself performs.
 */
export function jumpToTab(tab: MainTab): boolean {
  const tabs = tabsState();
  if (!tabs) return false;
  navigationRef.dispatch({ ...CommonActions.navigate({ name: tab }), target: tabs.key });
  return true;
}

/** Pops `tab`'s stack back to its first screen (iOS `planPath = NavigationPath()`). */
export function popTabToRoot(tab: MainTab): boolean {
  const tabs = tabsState();
  const stack = tabs?.routes.find((route) => route.name === tab)?.state;
  if (!stack) return false;
  if (typeof stack.index === 'number' && stack.index > 0 && stack.key) {
    navigationRef.dispatch({ ...StackActions.popToTop(), target: stack.key });
  }
  return true;
}

/** The name of `tab`'s first screen (`HomeMain`, ...). */
export function tabRootScreen(tab: MainTab): string {
  return TAB_ROOT_SCREEN[tab];
}
