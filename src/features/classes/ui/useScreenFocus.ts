// Whether the screen around the feed is in front: Explore's tab or the Plan
// sheet. The 30 s tick runs only then (iOS ties it to the view's lifetime with
// `.task`, which SwiftUI cancels when the view goes away), and a return to
// the screen retries a first load that failed.
//
// Outside a navigator (a component test) the feed counts as in front.
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';

export function useScreenFocus(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}
