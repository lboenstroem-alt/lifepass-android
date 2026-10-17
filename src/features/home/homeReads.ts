// When Home reads its data again: a signal for the cards other packages draw
// inside Home (plan 3.0.3 slots), so they re-read with it.
//
// iOS Home loads Iceland's sights for the Outside card itself, at every Home
// appear and again in its pull to refresh (`loadOutsideMarkers` in `.task`
// and `.refreshable`). On Android the Outside card (ATTR-1) reads its own
// picks, and its props are fixed by the slot, so Home cannot hand it the
// sights or call it. Home bumps this count instead, at every focus and at the
// start of every pull to refresh, and a card that wants Home's rhythm re-reads
// when it changes:
//
//   const reads = useHomeReads();
//   useEffect(() => { void reload(); }, [reads]);
//
// It says nothing about the member, so there is nothing to clear at sign-out.
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

/** The count now, outside React. */
export function homeReadsCount(): number {
  return useHomeReadsStore.getState().count;
}
