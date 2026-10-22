/**
 * The change-days sheet, presented from anywhere: the plan overview card,
 * the programme overview, the proposal card and the Coach's wizards call
 * `openChangeDays` (./index.ts), and the host the tabs shell keeps mounted
 * (./ChangeDaysHost.tsx) draws the request. No UI here. The same rules as
 * the body sheet's presenter (src/features/body/sheet/presenter.ts), so the
 * Coach can chain the two:
 *
 * ONE SHEET AT A TIME, as iOS cannot present two either. A request that
 * arrives while one is on screen (or with no host mounted, signed out) is
 * not shown and is answered at once as a close (`onCancel`), so a wizard
 * never waits on a sheet that never came.
 *
 * CALLBACKS RUN AFTER THE SHEET HAS GONE. A sheet closes with what it owes
 * (`dismissChangeDays(id, after)`): the picked days, the saved programme, a
 * "changed elsewhere", or a cancel. That runs once the slide-out has
 * finished (`changeDaysClosed`), never while the sheet is still on screen,
 * so a caller may open the next sheet or a page straight from it. The
 * presenter is cleared BEFORE a callback runs.
 *
 * CLOSED BY THE MEMBER (pan down, the backdrop, back). The kit's Sheet
 * reports that the sheet has left the screen before it tells the sheet the
 * member closed it; the close the sheet then makes finishes the presentation
 * at once. iOS answers `onCancel` on any disappearance that delivered
 * nothing (ChangeDaysSheet `.onDisappear`).
 */
import { create } from 'zustand';

import type { ChangeDaysMode } from './types';

export interface ChangeDaysRequest {
  readonly id: number;
  readonly mode: ChangeDaysMode;
}

interface PresenterState {
  /** The request on screen, kept while its sheet slides away so the content does not vanish. */
  readonly request: ChangeDaysRequest | null;
  readonly visible: boolean;
}

export const useChangeDaysPresenter = create<PresenterState>()(() => ({ request: null, visible: false }));

let nextId = 1;
let hostsMounted = 0;
/** What the sheet sliding away owes its caller, run once it has gone. */
let owed: (() => void) | null = null;
/** The request whose sheet left the screen while it still counted as visible (closed by hand). */
let goneWhileVisible: number | null = null;

function cancelOf(mode: ChangeDaysMode): (() => void) | null {
  return mode.onCancel ?? null;
}

function runSafely(work: (() => void) | null): void {
  if (!work) return;
  try {
    work();
  } catch {
    // A caller's callback failing must not leave the presenter stuck.
  }
}

/** Shows the sheet for `mode`, or answers it as a close when it cannot be shown (see the header). */
export function presentChangeDays(mode: ChangeDaysMode): void {
  if (hostsMounted === 0) {
    runSafely(cancelOf(mode));
    return;
  }
  const state = useChangeDaysPresenter.getState();
  if (state.visible) {
    if (goneWhileVisible === null || goneWhileVisible !== state.request?.id) {
      runSafely(cancelOf(mode));
      return;
    }
    // The sheet on record left the screen by the member's hand while its
    // save was in flight, and the save never closed it: its caller is
    // answered as a close now.
    owed = state.request ? cancelOf(state.request.mode) : null;
    goneWhileVisible = null;
  }
  const work = owed;
  owed = null;
  if (work) {
    // Cleared first, so a sheet the callback opens is shown.
    useChangeDaysPresenter.setState({ request: null, visible: false });
    runSafely(work);
    if (hostsMounted === 0 || useChangeDaysPresenter.getState().visible) {
      runSafely(cancelOf(mode));
      return;
    }
  }
  useChangeDaysPresenter.setState({ request: { id: nextId++, mode }, visible: true });
}

/**
 * The sheet for `requestId` closes; `after` runs once it has gone. Only the
 * first close of a presentation counts.
 */
export function dismissChangeDays(requestId: number, after: (() => void) | null): void {
  const state = useChangeDaysPresenter.getState();
  if (state.request?.id !== requestId || !state.visible) return;
  if (goneWhileVisible === requestId) {
    // Already off the screen (closed by hand): the presentation ends now.
    goneWhileVisible = null;
    useChangeDaysPresenter.setState({ request: null, visible: false });
    runSafely(after);
    return;
  }
  owed = after;
  useChangeDaysPresenter.setState({ visible: false });
}

/** The host's sheet has left the screen. */
export function changeDaysClosed(requestId: number): void {
  const state = useChangeDaysPresenter.getState();
  if (state.request?.id !== requestId) return;
  if (state.visible) {
    // Closed by the member: the sheet's own close follows.
    goneWhileVisible = requestId;
    return;
  }
  const work = owed;
  owed = null;
  useChangeDaysPresenter.setState({ request: null });
  runSafely(work);
}

/** The host calls this when it mounts, and the answer when it unmounts (a sign-out takes the shell down). */
export function attachChangeDaysHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted > 0) return;
    const { request, visible } = useChangeDaysPresenter.getState();
    // The sheet went with the host: what it owed (or, while it was up, a cancel) is answered now.
    const work = visible && request ? cancelOf(request.mode) : owed;
    owed = null;
    goneWhileVisible = null;
    useChangeDaysPresenter.setState({ request: null, visible: false });
    runSafely(work);
  };
}

/** Whether a host is mounted to draw what `openChangeDays` asks for. */
export function isChangeDaysHostMounted(): boolean {
  return hostsMounted > 0;
}

/** Tests: nothing showing, nothing owed. */
export function resetChangeDaysPresenterForTests(): void {
  owed = null;
  goneWhileVisible = null;
  useChangeDaysPresenter.setState({ request: null, visible: false });
}
