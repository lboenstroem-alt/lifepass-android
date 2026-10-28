/**
 * A failed auth link leaves its banner on Log in (`deepLinkError`), but the
 * signed-out screens show Log in only on demand, so the screen on top goes
 * there or the message is never seen (iOS OnboardingFlow's
 * `.onChange(of: appState.deepLinkError)` and `.onAppear`).
 *
 * Only a NEW message moves anyone, and only the screen in front acts: a
 * member who reads the banner, goes back to the splash and leaves the banner
 * up is not sent back to Log in again. `onMount` adds iOS's `.onAppear`: the
 * signed-out screens appearing with a message already waiting (a link that
 * failed while signed in, or before the screens were up) open on Log in.
 */
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef } from 'react';

import { useAppStore } from '../../stores/appStore';

export function useLoginOnLinkError(goToLogin: () => void, options: { readonly onMount?: boolean } = {}): void {
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const go = useRef(goToLogin);
  go.current = goToLogin;
  const onMount = options.onMount === true;

  useEffect(() => {
    if (onMount && useAppStore.getState().deepLinkError !== null) go.current();
    return useAppStore.subscribe((state, previous) => {
      if (state.deepLinkError === null || state.deepLinkError === previous.deepLinkError) return;
      if (focusedRef.current) go.current();
    });
    // Once per screen: the store subscription follows every later change itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
