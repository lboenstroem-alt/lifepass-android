/**
 * The open-sheet request behind `openClassSheet` (plan 3.0.3): one session's
 * sheet at a time, drawn by the host the tabs shell mounts
 * (./ClassSheetHost.tsx), the way iOS presents one `.sheet(item:)`.
 *
 * ONE AT A TIME. A second request while a sheet is up replaces it, and the
 * first opener hears its sheet has gone (`onDismiss`), so no screen waits for
 * a close that never comes. Never while that sheet has a booking in flight:
 * it would still land, with no alert, no reminder and no refresh behind it
 * (iOS disables the sheet's dismissal then), so the second request is
 * dropped.
 *
 * FORGOTTEN AT SIGN-OUT, without calling anything: the host unmounts with
 * the tabs, and a request left here would show the previous member's class
 * to the next one.
 */
import { createHostStore } from '../../../components/ui/hostStore';
import { registerSignOutCleaner } from '../../../app/signOut';
import type { ClassOccurrence } from '../model/occurrence';

/** What the opener hears (see `OpenClassSheetOptions` in ./index.ts). */
export interface ClassSheetCallbacks {
  readonly onBooked?: () => void;
  readonly onDismiss?: () => void;
}

export interface ClassSheetRequest {
  /** Each opening is its own sheet (the host keys it). */
  readonly id: number;
  readonly occurrence: ClassOccurrence;
  readonly callbacks: ClassSheetCallbacks;
}

/** How a sheet ended: closed (button, back, swipe, Done), or left for the full schedule and back. */
export type ClassSheetEnding = 'closed' | 'otherTimes';

interface RequestState {
  readonly request: ClassSheetRequest | null;
  /** The open sheet has a booking in flight. */
  readonly busy: boolean;
}

const requests = createHostStore<RequestState>({ request: null, busy: false });
let nextId = 1;

/** Tells an opener its sheet has gone; a throwing callback never breaks the host. */
function tellDismissed(request: ClassSheetRequest): void {
  try {
    request.callbacks.onDismiss?.();
  } catch {
    // The opener's own failure; the sheet has gone either way.
  }
}

/** Asks for the sheet over whatever is showing. False when a booking in flight holds the open one. */
export function presentClassSheet(occurrence: ClassOccurrence, callbacks: ClassSheetCallbacks): boolean {
  const { request: earlier, busy } = requests.get();
  if (earlier && busy) return false;
  const request: ClassSheetRequest = { id: nextId++, occurrence, callbacks };
  requests.set({ request, busy: false });
  if (earlier) tellDismissed(earlier);
  return true;
}

/** The open request, for the host. */
export function useClassSheetRequest(): ClassSheetRequest | null {
  return requests.use().request;
}

/** The open request, outside React. */
export function currentClassSheetRequest(): ClassSheetRequest | null {
  return requests.get().request;
}

/** The open sheet's booking started or ended (only the open request's report counts). */
export function setClassSheetBusy(id: number, busy: boolean): void {
  const state = requests.get();
  if (state.request?.id !== id || state.busy === busy) return;
  requests.set({ ...state, busy });
}

/**
 * The sheet `id` has ended: forgotten, then its opener told. Back from the
 * full schedule, a booking may have landed out of the sheet's sight, so the
 * opener hears `onBooked` first and re-reads (see `OpenClassSheetOptions`).
 */
export function finishClassSheet(id: number, ending: ClassSheetEnding): void {
  const request = requests.get().request;
  if (!request || request.id !== id) return;
  requests.set({ request: null, busy: false });
  if (ending === 'otherTimes') {
    try {
      request.callbacks.onBooked?.();
    } catch {
      // As above.
    }
  }
  tellDismissed(request);
}

/** For tests: no sheet open. */
export function resetClassSheetRequestsForTests(): void {
  requests.set({ request: null, busy: false });
}

registerSignOutCleaner('classes.sheetRequest', () => requests.set({ request: null, busy: false }));
