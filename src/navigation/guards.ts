/**
 * Android's system back, locked exactly where iOS locks dismissal.
 *
 * iOS has no system back. It still blocks leaving where leaving would lose
 * money or data: a class booking or payment in flight, the plans sheet while
 * its checkout is created, the walk-in guest and own-visit sheets, a consent
 * or deletion being posted, a workout being saved. On Android the back button
 * and the back gesture are the main way people move, so every one of those
 * places needs a guard, or back pops a screen mid-POST and a charge is left
 * with no screen to report it.
 *
 * - `useBusyGuard(busy)` on a stack screen: while busy, back (button,
 *   gesture, header) does nothing and the swipe is off. The work finishes on
 *   screen, where its outcome is shown.
 * - `useHardwareBack(handler)` where back must do something of its own: the
 *   workout runner opens its Leave dialog, the meal page asks keep or
 *   discard. Return true to consume the press.
 * - `sheetBackPolicy` for a sheet: back closes it like its own close or
 *   cancel control, never as a confirm, and does nothing while it is busy or
 *   cannot be dismissed. F5's `Sheet` applies it itself (`busy`,
 *   `dismissible`); `modalRequestClose` is the same rule for a plain RN Modal.
 *
 * Tabs: `backBehavior: 'history'` (src/navigation/TabNavigator.tsx): back on
 * a tab's first screen returns to the tab the member came from, and back on
 * the first tab of the session (Explore after a normal launch) leaves the
 * app. The predictive back animation stays off (app config default) until
 * every guard has been checked with it.
 */
import { NavigationContext, usePreventRemove } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

/** Options a stack screen can set; only `gestureEnabled` matters here. */
interface GuardableNavigation {
  setOptions(options: { gestureEnabled?: boolean }): void;
}

/**
 * Holds a stack screen while `busy` (iOS `interactiveDismissDisabled(busy)`):
 * hardware back, the back gesture and any `goBack` are refused until it is
 * not. Call it unconditionally at the top of the screen.
 */
export function useBusyGuard(busy: boolean): void {
  const navigation = useContext(NavigationContext) as (GuardableNavigation & object) | undefined;
  // The removal is refused, and nothing else happens: the screen stays, and
  // what is in flight reports on it.
  usePreventRemove(busy, () => undefined);
  useEffect(() => {
    navigation?.setOptions({ gestureEnabled: !busy });
  }, [navigation, busy]);
}

/**
 * Runs `handler` on the hardware back button (and the back gesture) while
 * `enabled` and, inside a screen, while that screen is focused. `handler`
 * returns true when it took the press; false lets back do what it would.
 * The newest subscription is asked first, so the deepest screen wins.
 */
export function useHardwareBack(handler: () => boolean, enabled = true): void {
  const navigation = useContext(NavigationContext);
  const latest = useRef(handler);
  latest.current = handler;
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  useEffect(() => {
    if (!enabled || !focused) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
    return () => subscription.remove();
  }, [enabled, focused]);
}

export interface SheetBackState {
  /** A request is in flight (a booking, a payment, a save). */
  readonly busy: boolean;
  /** False for a sheet only its own buttons may close (the walk-in guest and own-visit sheets). */
  readonly dismissible?: boolean;
}

/** What back does on a sheet: `close` (as its own close or cancel control), or `ignore`. Never a confirm. */
export type SheetBackOutcome = 'close' | 'ignore';

export function sheetBackPolicy({ busy, dismissible = true }: SheetBackState): SheetBackOutcome {
  return busy || !dismissible ? 'ignore' : 'close';
}

/**
 * `onRequestClose` for a sheet drawn as a React Native `Modal`: back closes it
 * through `close` (its cancel path) unless the policy says ignore. A Modal's
 * back always lands here first, so ignoring it keeps the screen underneath.
 */
export function modalRequestClose(state: SheetBackState, close: () => void): () => void {
  return () => {
    if (sheetBackPolicy(state) === 'close') close();
  };
}
