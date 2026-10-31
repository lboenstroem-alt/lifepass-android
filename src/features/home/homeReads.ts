// When Home reads its data again: a signal for the cards other packages draw
// inside Home (plan 3.0.3 slots), so they re-read with it.
//
// iOS Home loads Iceland's sights for the Outside card itself, at every Home
// appear and again in its pull to refresh (`loadOutsideMarkers` in `.task`
// and `.refreshable`). On Android the Outside card (ATTR-1) reads its own
// picks, and its props are fixed by the slot, so Home cannot hand it the
// sights or call it. Home signals here instead, at every focus and at the
// start of every pull to refresh.
//
// HOW A CARD FOLLOWS IT (published through ./index.ts, the only door other
// features may use):
//
//   useOnHomeRead(() => { void reload(); });
//
// The callback runs once per Home read, starting with the first focus, and
// never on mount by itself. That is the one-load-per-read rhythm iOS has: a
// card mounted inside Home subscribes in its own effect, which React runs
// before Home's focus effect in the same commit, so the first signal already
// finds it listening. (Re-reading on a change of `useHomeReads()` instead
// would load twice on first mount: once for the count the card mounted with,
// once more when Home's first focus bumps it.)
//
// It says nothing about the member, so there is nothing to clear at sign-out.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface HomeReadsState {
  /** How many times Home has read its data in this app session. */
  readonly count: number;
}

const useHomeReadsStore = create<HomeReadsState>()(() => ({ count: 0 }));

/** Home is reading again (a focus or a pull to refresh). Called by Home only. */
export function signalHomeReads(): void {
  useHomeReadsStore.setState((state) => ({ count: state.count + 1 }));
}

/** The number of Home reads so far; changes each time Home reads again. */
export function useHomeReads(): number {
  return useHomeReadsStore((state) => state.count);
}

/**
 * Runs `onRead` at every Home read from now on (each focus of Home and each
 * pull to refresh), never at mount by itself. The latest `onRead` is the one
 * called, so it may close over fresh props and state.
 */
export function useOnHomeRead(onRead: () => void): void {
  const latest = useRef(onRead);
  latest.current = onRead;
  useEffect(
    () =>
      useHomeReadsStore.subscribe((state, previous) => {
        if (state.count !== previous.count) latest.current();
      }),
    [],
  );
}

/** The count now, outside React. */
export function homeReadsCount(): number {
  return useHomeReadsStore.getState().count;
}
