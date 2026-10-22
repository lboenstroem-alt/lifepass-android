/**
 * When a feedback screen is really on screen, read the way iOS sees it.
 *
 * iOS keeps only what is shown in the view tree: MainTabView draws the
 * selected tab alone (`switch selectedTab`), and a NavigationStack takes a
 * view off screen while another is pushed over it, so its `.task` ends and
 * runs again when it shows again, and an `onAppear` fires only on screen.
 * React Navigation keeps a visited tab, and every screen under the top one,
 * mounted. These two hooks give the feedback's screens the iOS reading:
 *
 *   useScreenFocused()   true while this screen is the one on screen: its tab
 *                        selected, nothing pushed over it, no root modal
 *   useReappearCount()   goes up each time this screen shows again after
 *                        something covered it (iOS `.task` running again)
 *
 * Outside a navigator (a test, or a view drawn in its own sheet) the screen
 * counts as on screen and never reappears.
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';

export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
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

  return focused;
}

export function useReappearCount(): number {
  const navigation = useContext(NavigationContext);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!navigation) return undefined;
    // Only a focus after a blur is a return: the first focus is the screen's
    // own first appearance, which the view's load already covers.
    let covered = false;
    const offBlur = navigation.addListener('blur', () => {
      covered = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!covered) return;
      covered = false;
      setCount((n) => n + 1);
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);

  return count;
}
