/**
 * Hardware back on a walk-in sheet the member cannot tap or swipe away (iOS
 * `.interactiveDismissDisabled()` on the guest and own-visit sheets): back
 * still ends the step, nothing having been sent, as Android expects of back.
 *
 * WHY A TURN LATER. The kit Sheet, when not `dismissible`, consumes back and
 * does nothing, and React Native asks the NEWEST listener first. The Sheet
 * registers its own once its modal has mounted, a commit after `visible`
 * turned true, so a listener added in the same effects flush would sit under
 * it and never be asked. Registering a turn after the step is shown puts
 * this one on top. (Contract request to F5: an `onBack` option on Sheet would
 * make this unnecessary.)
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { BackHandler, type NativeEventSubscription } from 'react-native';

export function useBackEndsStep(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  useLayoutEffect(() => {
    onBackRef.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    let subscription: NativeEventSubscription | null = null;
    const timer = setTimeout(() => {
      subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBackRef.current();
        return true;
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      subscription?.remove();
    };
  }, [active]);
}
