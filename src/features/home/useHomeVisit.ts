// A Home VISIT: from the moment the Home tab is selected until another tab is.
//
// iOS builds Home afresh at every tab switch (MainTabView's `switch
// selectedTab`), so a new visit starts with no hero and rolls one, while
// coming back from a page pushed on Home's own stack (a venue, Profile) is
// the same view and keeps it. Android keeps the Home screen mounted, so the
// screen asks this hook when a new visit begins: the Home tab regaining focus
// after another tab had it. Focus coming back from a pushed page is not a
// new visit (the tab never lost focus).
import { useEffect, useRef, useState } from 'react';

/** What the hook needs of a screen's navigation: its parent (the tab's own route in the tab bar). */
export interface VisitNavigation {
  getParent(): { addListener(event: 'focus' | 'blur', callback: () => void): () => void } | undefined;
}

/** 0 for the visit Home was first shown in; one more for every later visit. */
export function useHomeVisit(navigation: VisitNavigation): number {
  const [visit, setVisit] = useState(0);
  const away = useRef(false);

  useEffect(() => {
    const tab = navigation.getParent();
    if (!tab) return undefined;
    const offBlur = tab.addListener('blur', () => {
      away.current = true;
    });
    const offFocus = tab.addListener('focus', () => {
      if (!away.current) return;
      away.current = false;
      setVisit((current) => current + 1);
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);

  return visit;
}
