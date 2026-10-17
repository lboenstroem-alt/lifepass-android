/**
 * The app's walk-in, read from React: one field at a time, so a sheet
 * re-renders only when what it draws changes.
 *
 *   const show = useWalkIn((s) => s.showGuestPicker);
 */
import { useStore } from 'zustand';

import { walkInStore, type WalkInStore } from './store';

export function useWalkIn<T>(selector: (state: WalkInStore) => T): T {
  return useStore(walkInStore, selector);
}

/** The flow's actions (stable: they never change identity). */
export function walkInActions(): WalkInStore {
  return walkInStore.getState();
}
