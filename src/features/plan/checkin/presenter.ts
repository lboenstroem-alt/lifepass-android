/**
 * Which weekly check-in Plan is showing (iOS PlanView's
 * `sheet = .weeklyCheckIn(entry:)`), so the three doors to the same sheet
 * open ONE sheet: the Today card's check-in row (`plan`), the review prompt
 * card (`review_card`) and the `health.weeklycheckin` notification
 * (`notification`, through Plan's parked action). No UI here; the host
 * (./WeeklyCheckInHost.tsx) draws the request.
 *
 * THE HOST LIVES WITH PLAN'S REVIEW SLOT, which every Plan body that can
 * offer the check-in mounts (the plan, and the intro or gate column under a
 * read day). A request with no host mounted is not kept for later: the
 * sheet would pop up minutes later over whatever the member is doing. The
 * notification's door then falls back to the review card, as Plan's parked
 * action does when the check-in is no longer due.
 *
 * ONE AT A TIME, as iOS presents one sheet: a request while one is up is
 * ignored. Every presentation has its own id, so its fields and its
 * Idempotency-Key start fresh, and a close from a sheet that is no longer
 * the one on record changes nothing.
 */
import { create } from 'zustand';

import type { WeeklyCheckInEntry } from '../shell';

export interface WeeklyCheckInRequest {
  readonly id: number;
  /** `weekly_checkin_opened.entry`. */
  readonly entry: WeeklyCheckInEntry;
}

interface PresenterState {
  /** The request on screen, kept while its sheet slides away so the content does not vanish. */
  readonly request: WeeklyCheckInRequest | null;
  readonly visible: boolean;
}

export const useWeeklyCheckInPresenter = create<PresenterState>()(() => ({ request: null, visible: false }));

let nextId = 1;
let hostsMounted = 0;

/** Opens the weekly check-in from `entry`. False when nothing can draw it (no host) or one is already up. */
export function openWeeklyCheckIn(entry: WeeklyCheckInEntry): boolean {
  if (hostsMounted === 0) return false;
  if (useWeeklyCheckInPresenter.getState().visible) return false;
  useWeeklyCheckInPresenter.setState({ request: { id: nextId++, entry }, visible: true });
  return true;
}

/** The sheet for `requestId` closes (a save's Done, Log weight's save, a gate, the member's swipe). */
export function dismissWeeklyCheckIn(requestId: number): void {
  const { request, visible } = useWeeklyCheckInPresenter.getState();
  if (request?.id !== requestId || !visible) return;
  useWeeklyCheckInPresenter.setState({ visible: false });
}

/** The sheet for `requestId` has left the screen. */
export function weeklyCheckInClosed(requestId: number): void {
  const { request } = useWeeklyCheckInPresenter.getState();
  if (request?.id !== requestId) return;
  useWeeklyCheckInPresenter.setState({ request: null, visible: false });
}

/** The host calls this when it mounts, and the answer when it unmounts. */
export function attachWeeklyCheckInHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    // The sheet went with Plan's body (a sign-out, a withdrawal): nothing
    // waits to come back later.
    if (hostsMounted === 0) useWeeklyCheckInPresenter.setState({ request: null, visible: false });
  };
}

/** Tests: nothing showing. */
export function resetWeeklyCheckInPresenterForTests(): void {
  useWeeklyCheckInPresenter.setState({ request: null, visible: false });
}
