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
 * (`dismissBodySheet(after)`): a save's `onSaved`, an intake's result, a
 * close's cancel. That runs once the slide-out has finished
 * (`bodySheetClosed`), never while the sheet is still on screen, so a caller
 * may open the next sheet straight from it (the Coach's days question after
 * the body question). A new request that comes in while the last sheet is
 * still sliding away runs what the last one owed first, so nothing owed is
 * ever lost or run twice.
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
/** What the sheet on screen (or sliding away) owes its caller, run once it has gone. */
let owed: (() => void) | null = null;

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

/** Runs what the last sheet owed, now. */
function settleOwed(): void {
  const work = owed;
  owed = null;
  runSafely(work);
}

function present(request: Omit<BodySheetRequest, 'id'>): void {
  const state = useBodySheetPresenter.getState();
  if (hostsMounted === 0 || state.visible) {
    runSafely(cancelAnswer(request));
    return;
  }
  settleOwed();
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
 * The sheet on screen closes; `after` (its save's callback, its result, its
 * cancel) runs once it has gone. Only the first close of a presentation
 * counts: a second (a back press during the slide) changes nothing.
 */
export function dismissBodySheet(after: (() => void) | null): void {
  const state = useBodySheetPresenter.getState();
  if (!state.visible) return;
  owed = after;
  useBodySheetPresenter.setState({ visible: false });
}

/** The host's sheet has left the screen. */
export function bodySheetClosed(requestId: number): void {
  const state = useBodySheetPresenter.getState();
  if (state.request?.id !== requestId || state.visible) return;
  settleOwed();
  useBodySheetPresenter.setState({ request: null });
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
    if (visible && request) owed = cancelAnswer(request);
    useBodySheetPresenter.setState({ request: null, visible: false });
    settleOwed();
  };
}

/** Whether a host is mounted to draw what the open functions ask for. */
export function isBodySheetsHostMounted(): boolean {
  return hostsMounted > 0;
}

/** Tests: nothing showing, nothing owed. */
export function resetBodySheetPresenterForTests(): void {
  owed = null;
  useBodySheetPresenter.setState({ request: null, visible: false });
}
