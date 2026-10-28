/**
 * The session preview's one decision and its refusal table (iOS
 * `SessionPreviewSheet.actions` and `pull`, Views/Plan/SessionPreviewSheet.swift).
 *
 * The preview is a READ with at most one action on it: start today's
 * session, or pull a later one to today. Nothing else, because a sheet that
 * can also skip, move and mark done is the Today block in another frame.
 */
import { ApiError, isProblem } from '../../../api';
import type { SessionView } from '../../../health';

/**
 * The refusals that mean "this cannot be pulled after all": the button goes
 * away (with the "changed" toast) rather than sitting there offering
 * something that cannot happen.
 */
export const PULL_REFUSALS: readonly string[] = [
  'session_move_limit',
  'session_move_past_week',
  'session_action_not_allowed',
  'today_not_free',
];

/** The one action the preview offers. */
export type PreviewAction = 'start' | 'pull' | null;

/**
 * Start when the caller says this is today's planned runner session (and the
 * plan is not paused or read only); otherwise "Do it today" while the server
 * says the session can be pulled and no refusal has hidden it.
 */
export function previewAction(session: Pick<SessionView, 'canPull'>, context: { readonly canStart: boolean; readonly pullHidden: boolean }): PreviewAction {
  if (context.canStart) return 'start';
  if (session.canPull === true && !context.pullHidden) return 'pull';
  return null;
}

/** What a failed pull shows. */
export type PullFailure =
  /** Refused for good: hide the button, toast "changed". */
  | { readonly kind: 'hide' }
  /** A line under the blocks; the button stays for another try. */
  | { readonly kind: 'message'; readonly key: string }
  /** The member closed the sheet mid-request: nothing to say. */
  | { readonly kind: 'cancelled' };

export function pullFailure(error: unknown): PullFailure {
  if (error instanceof ApiError) {
    if (error.isCancellation) return { kind: 'cancelled' };
    if (isProblem(error, ...PULL_REFUSALS)) return { kind: 'hide' };
    if (error.isOffline) return { kind: 'message', key: 'health.offline.action_hint' };
  }
  return { kind: 'message', key: 'common.error_body' };
}
