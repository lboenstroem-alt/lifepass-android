/**
 * The No energy sheet's rules, as pure functions (iOS `NoEnergySheet`,
 * Views/Health/NoEnergySheet.swift, `ios-ux.md` 8).
 *
 * WHICH CHOICES APPEAR IS THE SERVER'S ANSWER (`canMove`, `canSkip`,
 * `moveBlockedReason`), never a guess here: the move rules (never past
 * Sunday, at most twice) live in one place. The one thing the sheet adds is
 * a refusal it has just been given: a move the server turned down
 * (`session_move_limit`, `session_move_past_week`) takes the move away and
 * says why, and the sheet stays open on the skip it can still offer.
 */
import { ApiError } from '../../../api';
import type { SkipReason } from '../../../health';
import type { PlanSessionRef } from '../sheets/types';

export type NoEnergyMode = 'choose' | 'skipReason';

/** Why a move was just refused, in the server's own words for `moveBlockedReason`. */
export type MoveRefusal = 'limit' | 'past_week';

/** The four reasons, in their 2 × 2 grid order. `paused` is the server's, never offered. */
export const SKIP_REASON_CHOICES: readonly SkipReason[] = ['time', 'tired', 'sore', 'other'];

export interface NoEnergyContext {
  /** A move the server refused while the sheet was open. */
  readonly moveRefused: MoveRefusal | null;
  /** Opened from a missed row: straight to the reasons, and a missed row never moves. */
  readonly startsInSkipMode: boolean;
}

/** "Move it to tomorrow" (or the swap) is offered. */
export function offersMove(session: Pick<PlanSessionRef, 'canMove'>, context: NoEnergyContext): boolean {
  return session.canMove === true && context.moveRefused === null && !context.startsInSkipMode;
}

/** "Skip it" is offered unless the server said no. */
export function offersSkip(session: Pick<PlanSessionRef, 'canSkip'>): boolean {
  return session.canSkip !== false;
}

/**
 * Why moving is not on the table, when the server said so (C25): a refusal
 * just given, else the read's own `moveBlockedReason` when `canMove` is
 * false. A reason the app does not know reads "can't be moved right now".
 */
export function blockedLineKey(
  session: Pick<PlanSessionRef, 'canMove' | 'moveBlockedReason'>,
  context: NoEnergyContext,
): string | null {
  if (context.startsInSkipMode) return null;
  const reason = context.moveRefused ?? (session.canMove === false ? session.moveBlockedReason ?? null : null);
  switch (reason) {
    case null:
      return null;
    case 'limit':
      return 'noenergy.move_limit';
    case 'past_week':
      return 'noenergy.move_past_week';
    default:
      return 'noenergy.move_unavailable';
  }
}

/** The move option's title and subtitle keys: a swap when tomorrow already holds a session. */
export function moveCopy(tomorrowTitle: string | null | undefined): {
  readonly titleKey: string;
  readonly subtitleKey: string;
  readonly params: Readonly<Record<string, string>>;
} {
  if (tomorrowTitle === null || tomorrowTitle === undefined) {
    return { titleKey: 'noenergy.move', subtitleKey: 'noenergy.move_sub', params: {} };
  }
  return { titleKey: 'noenergy.swap', subtitleKey: 'noenergy.swap_sub', params: { title: tomorrowTitle } };
}

export type NoEnergyFailure =
  | { readonly kind: 'cancelled' }
  /** The sheet stays open and turns into the skip it can still offer. */
  | { readonly kind: 'moveRefused'; readonly reason: MoveRefusal }
  /** `session_action_not_allowed`: the card is stale; the sheet closes and Plan reads again. */
  | { readonly kind: 'changed' }
  | { readonly kind: 'offline' }
  /** Anything else; `api` says whether it goes through the health store's problem table. */
  | { readonly kind: 'other'; readonly api: boolean };

/** Sorts a failed move or skip (iOS `NoEnergySheet.post`'s catch). */
export function noEnergyFailure(error: unknown): NoEnergyFailure {
  if (!(error instanceof ApiError)) return { kind: 'other', api: false };
  if (error.isCancellation) return { kind: 'cancelled' };
  if (error.isProblem('session_move_limit')) return { kind: 'moveRefused', reason: 'limit' };
  if (error.isProblem('session_move_past_week')) return { kind: 'moveRefused', reason: 'past_week' };
  if (error.isProblem('session_action_not_allowed')) return { kind: 'changed' };
  if (error.isOffline) return { kind: 'offline' };
  return { kind: 'other', api: true };
}
