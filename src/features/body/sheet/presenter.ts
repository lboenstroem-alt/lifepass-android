/**
 * The body sheet and the target sheet, presented from anywhere: the Plan
 * tab, Body and goals and the Coach call `openBodySheet` / `openTargetSheet`
 * (../sheets/index.ts), and the host the tabs shell keeps mounted
 * (../sheets/BodySheetsHost.tsx) draws the request. No UI here.
 *
 * ONE SHEET AT A TIME, as iOS cannot present two either. A request that
 * arrives while one is on screen is not shown, and it is ANSWERED at once as
 * a close (an intake's `cancelled`, a pick's `onCancel`), so a wizard never
 * waits on a sheet that never came. The same holds with no host mounted.
 *
 * CALLBACKS RUN AFTER THE SHEET HAS GONE. A sheet closes with what it owes
 * (`dismissBodySheet(id, after)`): a save's `onSaved`, an intake's result, a
 * close's cancel. That runs once the slide-out has finished
 * (`bodySheetClosed`), never while the sheet is still on screen, so a caller
 * may open the next sheet straight from it (the Coach's days question after
 * the body question). The presenter is always cleared BEFORE a callback runs,
 * so a sheet opened from it is shown, never overwritten.
 *
 * A new request that comes in while the last sheet is still sliding away
 * runs what the last one owed first, as that caller asked first: nothing
 * owed is ever lost or run twice. If that callback opens a sheet itself (the
 * wizard's next question), that one is shown and the new request is answered
 * as a close, as any request is while a sheet is up.
 *
 * CLOSED BY THE MEMBER (pan down, the backdrop). The kit's Sheet reports that
 * the sheet has left the screen (`bodySheetClosed`) BEFORE it tells the sheet
 * the member closed it, so the report arrives while the presentation still
 * counts as visible, and no second report ever follows. The presenter notes
 * the sheet as gone, and the close the sheet then makes finishes the
 * presentation at once and answers its caller. iOS answers on any
 * disappearance, a swipe included (BodySheet / TargetWeightSheet
 * `.onDisappear`).
 */
import { create } from 'zustand';

import type { BodySheetMode, TargetSheetMode } from './types';

export type BodySheetRequest =
  | {
      readonly id: number;
      readonly sheet: 'body';
      readonly mode: BodySheetMode;
    }
  | {
      readonly id: number;
      readonly sheet: 'target';
      readonly mode: TargetSheetMode;
    };

interface PresenterState {
  /** The request on screen, kept while its sheet slides away so the content does not vanish. */
  readonly request: BodySheetRequest | null;
  readonly visible: boolean;
}

export const useBodySheetPresenter = create<PresenterState>()(() => ({
  request: null,
  visible: false,
}));

let nextId = 1;
let hostsMounted = 0;
/** What the sheet sliding away owes its caller, run once it has gone. */
let owed: (() => void) | null = null;
/**
 * The request whose sheet left the screen while it still counted as visible
 * (the member closed it by hand). Its own close, which follows at once,
 * finishes it.
 */
let goneWhileVisible: number | null = null;

/** The answer a request gets when it is never shown, or is closed with nothing chosen. */
export function cancelAnswer(request: Pick<BodySheetRequest, 'sheet' | 'mode'>): (() => void) | null {
  if (request.sheet === 'body') {
    const mode = request.mode as BodySheetMode;
    return mode.kind === 'intake' ? () => mode.onResult({ kind: 'cancelled' }) : null;
  }
  const mode = request.mode as TargetSheetMode;
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

function present(request: Omit<BodySheetRequest, 'id'>): void {
  if (hostsMounted === 0) {
    runSafely(cancelAnswer(request));
    return;
  }
  const state = useBodySheetPresenter.getState();
  if (state.visible) {
    if (goneWhileVisible === null || goneWhileVisible !== state.request?.id) {
      runSafely(cancelAnswer(request));
      return;
    }
    // The sheet on record left the screen by the member's hand while its
    // save was in flight, and the save never closed it (it failed). Nothing
    // can press it any more: its caller is answered as a close now, and a
    // late close of its own is ignored (it is bound to its request).
    owed = state.request ? cancelAnswer(state.request) : null;
    goneWhileVisible = null;
  }
  const work = owed;
  owed = null;
  if (work) {
    // Cleared first, so a sheet the callback opens is shown (see the header).
    useBodySheetPresenter.setState({ request: null, visible: false });
    runSafely(work);
    if (hostsMounted === 0 || useBodySheetPresenter.getState().visible) {
      runSafely(cancelAnswer(request));
      return;
    }
  }
  useBodySheetPresenter.setState({
    request: { ...request, id: nextId++ } as BodySheetRequest,
    visible: true,
  });
}

export function presentBodySheet(mode: BodySheetMode): void {
  present({ sheet: 'body', mode });
}

export function presentTargetSheet(mode: TargetSheetMode): void {
  present({ sheet: 'target', mode });
}

/**
 * The sheet for `requestId` closes; `after` (its save's callback, its
 * result, its cancel) runs once it has gone. Only the first close of a
 * presentation counts: a second (a back press during the slide), or one from
 * a sheet that is no longer the one on record, changes nothing.
 */
export function dismissBodySheet(requestId: number, after: (() => void) | null): void {
  const state = useBodySheetPresenter.getState();
  if (state.request?.id !== requestId || !state.visible) return;
  if (goneWhileVisible === requestId) {
    // Already off the screen (closed by hand): no further report comes, so
    // the presentation ends now, cleared before its caller hears.
    goneWhileVisible = null;
    useBodySheetPresenter.setState({ request: null, visible: false });
    runSafely(after);
    return;
  }
  owed = after;
  useBodySheetPresenter.setState({ visible: false });
}

/** The host's sheet has left the screen. */
export function bodySheetClosed(requestId: number): void {
  const state = useBodySheetPresenter.getState();
  if (state.request?.id !== requestId) return;
  if (state.visible) {
    // Closed by the member: the sheet's own close follows (see the header).
    goneWhileVisible = requestId;
    return;
  }
  const work = owed;
  owed = null;
  // Cleared before the callback runs, so a sheet it opens is shown.
  useBodySheetPresenter.setState({ request: null });
  runSafely(work);
}

/** The host calls this when it mounts, and the answer when it unmounts (a sign-out takes the shell down). */
export function attachBodySheetsHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted > 0) return;
    const { request, visible } = useBodySheetPresenter.getState();
    // The sheet went with the host: what it owed (or, while it was still up,
    // a close) is answered now, so no caller waits for ever.
    const work = visible && request ? cancelAnswer(request) : owed;
    owed = null;
    goneWhileVisible = null;
    useBodySheetPresenter.setState({ request: null, visible: false });
    runSafely(work);
  };
}

/** Whether a host is mounted to draw what the open functions ask for. */
export function isBodySheetsHostMounted(): boolean {
  return hostsMounted > 0;
}

/** Tests: nothing showing, nothing owed. */
export function resetBodySheetPresenterForTests(): void {
  owed = null;
  goneWhileVisible = null;
  useBodySheetPresenter.setState({ request: null, visible: false });
}
