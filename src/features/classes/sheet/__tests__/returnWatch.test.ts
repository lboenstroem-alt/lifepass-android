/**
 * Telling when the member is back where the class sheet was: the deepest
 * focused route is the one focused when the sheet stepped aside ("back"),
 * that route is gone or the member moved to another tab ("gone"), or the
 * member is still on the page ("away"). States are shaped like the app's:
 * the root stack (Main, root modals, the shared sheet), the tabs, each tab's
 * stack.
 */
import { containsRouteKey, focusedRouteKeys, returnVerdict, watchForReturn, type WatchedNavigator } from '../returnWatch';

type Route = { key: string; name: string; state?: State };
type State = { index: number; routes: Route[] };

const stack = (routes: Route[], index = routes.length - 1): State => ({ index, routes });
const route = (key: string, state?: State): Route => ({ key, name: key.split('-')[0]!, state });

/** The app with Explore's stack holding `explore`, and Home's its root. */
function app(explore: Route[], options: { tab?: 'Explore' | 'Home'; modals?: Route[] } = {}): State {
  const tabs = stack(
    [route('Home-1', stack([route('HomeMain-1')])), route('Explore-1', stack(explore))],
    options.tab === 'Home' ? 0 : 1,
  );
  return stack([route('Main-1', tabs), ...(options.modals ?? [])]);
}

const FEED = route('ExploreMain-1');

it('reads the focused path root to leaf, and finds a route anywhere', () => {
  const state = app([FEED, route('Account-1')]);
  expect(focusedRouteKeys(state)).toEqual(['Main-1', 'Explore-1', 'Account-1']);
  expect(containsRouteKey(state, 'ExploreMain-1')).toBe(true);
  expect(containsRouteKey(state, 'HomeMain-1')).toBe(true);
  expect(containsRouteKey(state, 'Plans-1')).toBe(false);
  expect(focusedRouteKeys(undefined)).toEqual([]);
});

it('Plans over the feed: away while it is up, back once it closes', () => {
  const origin = focusedRouteKeys(app([FEED]));
  expect(returnVerdict(origin, app([FEED], { modals: [route('Plans-1')] }))).toBeNull();
  expect(returnVerdict(origin, app([FEED]))).toBe('back');
});

it('a page pushed on the same tab: away until it pops', () => {
  const origin = focusedRouteKeys(app([FEED]));
  expect(returnVerdict(origin, app([FEED, route('Account-1')]))).toBeNull();
  expect(returnVerdict(origin, app([FEED, route('Account-1'), route('Receipts-1')]))).toBeNull();
  expect(returnVerdict(origin, app([FEED]))).toBe('back');
});

it('another tab, or the screen itself gone, is gone', () => {
  const origin = focusedRouteKeys(app([FEED]));
  expect(returnVerdict(origin, app([FEED], { tab: 'Home' }))).toBe('gone');
  expect(returnVerdict(origin, app([route('ExploreMain-2')]))).toBe('gone');
  expect(returnVerdict([], app([FEED]))).toBe('gone');
});

it('the Plan tab classes sheet (a root modal): the shared sheet over it is away, its close is back', () => {
  const modal = route('ClassesDiscoveryModal-1');
  const origin = focusedRouteKeys(app([FEED], { modals: [modal] }));
  expect(origin).toEqual(['ClassesDiscoveryModal-1']);
  expect(returnVerdict(origin, app([FEED], { modals: [modal, route('SharedSheet-1', stack([route('Profile-1')]))] }))).toBeNull();
  expect(returnVerdict(origin, app([FEED], { modals: [modal] }))).toBe('back');
  // The modal itself closed meanwhile.
  expect(returnVerdict(origin, app([FEED]))).toBe('gone');
});

function fakeNavigator(initial: State): WatchedNavigator & { go(next: State): void; listeners: number; ready: boolean } {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    ready: true,
    get listeners() {
      return listeners.size;
    },
    isReady() {
      return this.ready;
    },
    getRootState: () => state,
    addListener: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

it('watches until the member is back, calls once, and stops listening', () => {
  const navigator = fakeNavigator(app([FEED]));
  const onReturn = jest.fn();
  const stop = watchForReturn(onReturn, navigator);
  expect(stop).not.toBeNull();
  navigator.go(app([FEED], { modals: [route('Plans-1')] }));
  expect(onReturn).not.toHaveBeenCalled();
  navigator.go(app([FEED]));
  expect(onReturn).toHaveBeenCalledWith('back');
  expect(navigator.listeners).toBe(0);
  navigator.go(app([FEED]));
  expect(onReturn).toHaveBeenCalledTimes(1);
});

it('a stopped watch says nothing; an unready navigator cannot be watched', () => {
  const navigator = fakeNavigator(app([FEED]));
  const onReturn = jest.fn();
  watchForReturn(onReturn, navigator)!();
  navigator.go(app([FEED], { tab: 'Home' }));
  expect(onReturn).not.toHaveBeenCalled();

  navigator.ready = false;
  expect(watchForReturn(onReturn, navigator)).toBeNull();
});
