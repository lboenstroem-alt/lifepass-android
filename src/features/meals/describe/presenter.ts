/**
 * Which "Describe what you ate" sheet is up, for the one host F4's tabs shell
 * mounts (./DescribeHost.tsx). The meal page (MEAL-2) asks through
 * `openDescribe`; the sheet draws over the page from the UI kit's portal,
 * above every screen, as the iOS sheet covers the capture page.
 *
 * One at a time, as iOS presents one sheet: a second request while one is up
 * is ignored. With no host mounted (signed out) nothing is held, so a request
 * can never surface later, for someone else.
 *
 * THE WORDS. A request carries the words already typed in the search field
 * (the prefill). They live here only while the sheet is up or sliding away,
 * and go when it has gone, when the host unmounts (sign-out) or on reset.
 */
import { create } from 'zustand';

import type { HealthAccess } from '../../../health/models';
import type { MealSlot } from '../../../navigation/types';
import type { MealRecord } from '../types/models';

export interface DescribePrefill {
  /** Words already typed (the search field's text). */
  readonly text?: string;
  /** The meal page's slot; omitted, the slot the clock gives now. */
  readonly slot?: MealSlot;
  /** `YYYY-MM-DD`; omitted, today. */
  readonly date?: string;
  /**
   * The estimate was saved as a draft: the meal page opens it. Called after
   * the sheet has started to close; the record is the draft as the server
   * saved it (the page may open it without reading it again).
   */
  readonly onDraft: (mealId: string, meal: MealRecord) => void;
  /** "Search instead" (and a route that is gone): back to the search with these words. */
  readonly onSearch?: (text: string) => void;
  /**
   * A refusal that needs the membership gate: the describe sheet closes and
   * the page shows its gate (iOS `capture.showGate`). Omitted, the app-wide
   * gate is presented.
   */
  readonly onGate?: (access: HealthAccess) => void;
  /** A refusal that closes the meal page too (a minor, consent gone elsewhere: iOS `capture.close()`). */
  readonly onClosePage?: () => void;
}

export interface DescribeRequest extends DescribePrefill {
  /** One per opening, so each opening is a fresh sheet with a fresh model and keys. */
  readonly id: number;
}

interface DescribePresenterState {
  /** The request on screen, kept while the sheet slides away. */
  readonly request: DescribeRequest | null;
  readonly visible: boolean;
}

export const useDescribePresenter = create<DescribePresenterState>()(() => ({ request: null, visible: false }));

let hostsMounted = 0;
let nextId = 1;

/** The host calls this when it mounts, and the answer when it unmounts; the last host takes the request with it. */
export function attachDescribeHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted === 0) useDescribePresenter.setState({ request: null, visible: false });
  };
}

/**
 * Opens the describe sheet over whatever is showing. False, and nothing
 * shown, when one is already up or no host is mounted.
 */
export function openDescribe(prefill: DescribePrefill): boolean {
  if (hostsMounted === 0) return false;
  if (useDescribePresenter.getState().visible) return false;
  useDescribePresenter.setState({ request: { ...prefill, id: nextId++ }, visible: true });
  return true;
}

/** Starts the close (the sheet slides away, then `describeClosed`). */
export function closeDescribe(): void {
  if (!useDescribePresenter.getState().visible) return;
  useDescribePresenter.setState({ visible: false });
}

/** The sheet has gone: its request (and the words in it) goes too. */
export function describeClosed(id: number): void {
  const { request, visible } = useDescribePresenter.getState();
  if (request?.id === id && !visible) useDescribePresenter.setState({ request: null });
}

/** Tests: nothing showing. */
export function resetDescribePresenter(): void {
  useDescribePresenter.setState({ request: null, visible: false });
}
