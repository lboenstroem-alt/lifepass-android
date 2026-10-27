/**
 * The visit rating, read from React: one field at a time, so the card and
 * the sheet re-render only when what they draw changes.
 *
 *   const card = useVisitRating((s) => s.card);
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { visitRatingStore, type VisitRatingStore } from './store';

export function useVisitRating<T>(selector: (state: VisitRatingStore) => T): T {
  return useStore(visitRatingStore, selector);
}

/** The store's actions (stable: they never change identity). */
export function visitRatingActions(): VisitRatingStore {
  return visitRatingStore.getState();
}

/**
 * Whether the screen around the caller is the one in focus; true outside a
 * navigator (a hook that throws there would take the card down with it).
 */
export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) {
      setFocused(true);
      return;
    }
    setFocused(navigation.isFocused());
    const stopFocus = navigation.addListener('focus', () => setFocused(true));
    const stopBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      stopFocus();
      stopBlur();
    };
  }, [navigation]);
  return focused;
}
