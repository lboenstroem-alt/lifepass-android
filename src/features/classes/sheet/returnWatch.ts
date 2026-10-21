/**
 * "Has the member come back to where the class sheet was?"
 *
 * WHY. On iOS everything the class sheet opens (Plans, Account, My bookings,
 * the full schedule) is presented OVER it, inside or on top of the sheet, so
 * closing that page lands back on the sheet. On Android a UI-kit sheet is
 * drawn over every page, so it has to step aside while a page is up: it hides,
 * the page opens in the app's navigator, and once the member is back on the
 * screen the sheet was opened over, the sheet comes back (or, after the full
 * schedule, ends). The sheet's host sits outside any screen, so no focus
 * event tells it that; this watches the navigator's state instead.
 *
 * "Back" is the deepest focused route being the one that was focused when the
 * watch began. "Gone" is that route no longer existing, or the member having
 * moved to another tab: the place the sheet belonged to is not coming back.
 */
import { navigationRef } from '../../../navigation/navigationRef';

interface LooseRoute {
  readonly key?: string;
  readonly name: string;
  readonly state?: LooseState;
}

interface LooseState {
  readonly index?: number;
  readonly routes: readonly LooseRoute[];
}

/** The focused routes' keys, root to leaf (a route without a key counts by name). */
export function focusedRouteKeys(state: LooseState | undefined | null): string[] {
  const keys: string[] = [];
  for (let current = state ?? undefined; current; ) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    keys.push(route.key ?? route.name);
    current = route.state;
  }
  return keys;
}

/** Whether a route with `key` is anywhere in the tree. */
export function containsRouteKey(state: LooseState | undefined | null, key: string): boolean {
  if (!state) return false;
  return state.routes.some((route) => (route.key ?? route.name) === key || containsRouteKey(route.state, key));
}

export type ReturnHow = 'back' | 'gone';

/**
 * Where the watch began: the focused path. `next` says what a later state
 * means for it: `back`, `gone`, or null (the member is still away).
 */
export function returnVerdict(origin: readonly string[], state: LooseState | undefined | null): ReturnHow | null {
  const leaf = origin[origin.length - 1];
  if (!leaf) return 'gone';
  const now = focusedRouteKeys(state);
  if (now[now.length - 1] === leaf) return 'back';
  if (!containsRouteKey(state, leaf)) return 'gone';
  // Another tab now in front of the one the sheet was on (a modal over the
  // same tab, Plans or the shared sheet, keeps the tab and is not this).
  const originTab = origin[1];
  if (now[0] === origin[0] && originTab !== undefined && now[1] !== undefined && now[1] !== originTab) return 'gone';
  return null;
}

/** The navigator a watch reads (the app's, or a test's). */
export interface WatchedNavigator {
  isReady(): boolean;
  getRootState(): unknown;
  addListener(event: 'state', listener: () => void): () => void;
}

/**
 * Calls `onReturn` once, when the member is back on the screen focused now
 * (`back`) or that screen is gone (`gone`). Null when the navigator is not
 * ready (nothing can have been opened): the caller comes back at once. The
 * returned function stops the watch.
 */
export function watchForReturn(
  onReturn: (how: ReturnHow) => void,
  navigator: WatchedNavigator = navigationRef as unknown as WatchedNavigator,
): (() => void) | null {
  if (!navigator.isReady()) return null;
  const origin = focusedRouteKeys(navigator.getRootState() as LooseState | undefined);
  if (origin.length === 0) return null;
  let done = false;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    done = true;
    unsubscribe?.();
    unsubscribe = null;
  };
  unsubscribe = navigator.addListener('state', () => {
    if (done) return;
    const verdict = returnVerdict(origin, navigator.getRootState() as LooseState | undefined);
    if (!verdict) return;
    stop();
    onReturn(verdict);
  });
  return stop;
}
