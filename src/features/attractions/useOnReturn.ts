/**
 * Runs a callback each time the screen around the caller comes back to the
 * front after something covered it (a pushed page, another tab), never on
 * the first arrival.
 *
 * iOS re-runs a view's `.task` whenever the view appears again, which is
 * how Home re-reads the sights and a sight's card re-reads itself on return.
 * Android keeps the screen mounted, so the return is the navigation's focus
 * after a blur. Outside a navigator (a test rendering a card alone) there is
 * nothing to follow and the callback never runs.
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef } from 'react';

export function useOnReturn(onReturn: () => void): void {
  const navigation = useContext(NavigationContext);
  const latest = useRef(onReturn);
  latest.current = onReturn;
  useEffect(() => {
    if (!navigation) return undefined;
    // A screen restored under another one has not been seen yet: its first
    // focus is a return.
    let left = !navigation.isFocused();
    const offBlur = navigation.addListener('blur', () => {
      left = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!left) return;
      left = false;
      latest.current();
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);
}
