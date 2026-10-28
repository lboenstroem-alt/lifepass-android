/**
 * The empty day's look-ahead (2.5.1): a selected day with nothing for these
 * filters names the next day that has something and offers to jump there
 * (iOS `ClassesViewModel.NextMatchRequest` / `NextMatchState`).
 */
import type { ClassFeedItem } from '../../../api/classFeed';
import type { Coordinate } from '../../../lib/geo';

/**
 * Everything that decides what "the next match" is for an empty selected day:
 * the day, the server-side filters, the "Near me" origin and radius, and a
 * retry counter. The screen keys its look-ahead on it, so any change (a
 * filter, the radius, a location fix, a retry) cancels the one in flight and
 * starts the right one.
 */
export interface NextMatchRequest {
  readonly dayIso: string;
  /** The search the feed on screen was LOADED with, not the live search text. */
  readonly query: string | null;
  readonly category: string | null;
  /** The "Near me" origin; null when the toggle is off. */
  readonly originLatitude: number | null;
  readonly originLongitude: number | null;
  /** The radius in force; 0 when "Near me" is off. */
  readonly radiusKm: number;
  readonly attempt: number;
}

export type NextMatchState =
  /**
   * The day's first page held nothing that passes the phone's own filters but
   * more pages exist: reading those before calling the day empty.
   */
  | { readonly kind: 'checkingDay' }
  /** The day is empty; reading the fortnight after it. */
  | { readonly kind: 'searching' }
  /** The earliest matching class after the day. */
  | { readonly kind: 'found'; readonly item: ClassFeedItem }
  /** Nothing matches in the fortnight after the day (worded by `noneInWindowLines`). */
  | { readonly kind: 'noneInWindow' }
  /** Too many pages without an answer: say no more than the plain empty state does. */
  | { readonly kind: 'gaveUp' }
  /** A request failed: the feed's usual error UI, with a retry. */
  | { readonly kind: 'failed' };

/** Swift's `Equatable` for a request: the same key is the same request. */
export function nextMatchKey(request: NextMatchRequest): string {
  return JSON.stringify([
    request.dayIso,
    request.query,
    request.category,
    request.originLatitude,
    request.originLongitude,
    request.radiusKm,
    request.attempt,
  ]);
}

export function sameRequest(a: NextMatchRequest | null, b: NextMatchRequest | null): boolean {
  if (!a || !b) return a === b;
  return nextMatchKey(a) === nextMatchKey(b);
}

/** The request's "Near me" origin, or null when it was off. */
export function requestOrigin(request: NextMatchRequest): Coordinate | null {
  if (request.originLatitude === null || request.originLongitude === null) return null;
  return { latitude: request.originLatitude, longitude: request.originLongitude };
}

/** A state's identity, for "announce it when it changes" (Swift `onChange` compares states). */
export function nextMatchStateKey(state: NextMatchState | null): string {
  if (!state) return 'none';
  return state.kind === 'found' ? `found:${state.item.venue.id}:${state.item.startsAt.getTime()}:${state.item.booking.activityId}` : state.kind;
}
