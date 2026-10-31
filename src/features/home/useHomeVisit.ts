// A Home VISIT: from the moment the Home tab is selected until another tab is.
//
// iOS builds Home afresh at every tab switch (MainTabView's `switch
// selectedTab`), so a new visit starts with no hero and rolls one, while
// coming back from a page pushed on Home's own stack (a venue, Profile) or
// from a sheet or cover over it is the same view and keeps it. Android keeps
// the Home screen mounted, so this hook says when a visit ends: the tab bar
// selecting another tab. Nothing else counts:
//   - a page pushed on Home's stack leaves the Home tab selected;
//   - a root modal over the tabs (Plans, a shared sheet, the meal capture or
//     the runner opened from a notification) blurs and refocuses the Home tab
//     as React Navigation passes its parent's focus down, but the tab bar's
//     selection never moves, so it is not a new visit either.
//
// The count moves the moment the member LEAVES, not when they come back: Home
// rolls the next visit's hero while it is out of sight, so the tab opens on
// its new hero instead of showing the last one for a frame and then swapping.
import { useEffect, useState } from 'react';

/** The part of the tab navigator's state the hook reads. */
interface TabBarState {
  readonly index: number;
  readonly routes: readonly { readonly key: string }[];
}

/** What the hook needs of the Home tab's own route in the tab bar (the screen's parent navigation). */
export interface VisitTab {
  getState(): TabBarState;
  isFocused(): boolean;
  addListener(event: 'focus', callback: () => void): () => void;
  addListener(event: 'state', callback: (event: { data: { state: TabBarState } }) => void): () => void;
}

/** What the hook needs of a screen's navigation: its parent, the tab's own route in the tab bar. */
export interface VisitNavigation {
  getParent(): VisitTab | undefined;
}

function selectedKey(state: TabBarState): string | null {
  return state.routes[state.index]?.key ?? null;
}

/** 0 for the visit Home was first shown in; one more each time the tab bar leaves Home. */
export function useHomeVisit(navigation: VisitNavigation): number {
  const [visit, setVisit] = useState(0);

  useEffect(() => {
    const tab = navigation.getParent();
    if (!tab) return undefined;
    // The Home tab's key in the tab bar: the selected route whenever Home has focus.
    let homeKey = tab.isFocused() ? selectedKey(tab.getState()) : null;
    let away = false;
    const offFocus = tab.addListener('focus', () => {
      homeKey = selectedKey(tab.getState());
    });
    const offState = tab.addListener('state', (event) => {
      if (homeKey === null) return;
      if (selectedKey(event.data.state) === homeKey) {
        away = false;
        return;
      }
      if (away) return;
      away = true;
      setVisit((current) => current + 1);
    });
    return () => {
      offFocus();
      offState();
    };
  }, [navigation]);

  return visit;
}
