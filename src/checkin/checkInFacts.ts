/**
 * What a check-in tells the rest of the app, and when the member leaves its
 * proof: a tiny listener registry with no imports of its own, so the money
 * paths that check members in (the walk-in flow, the hosted-page confirm)
 * can report without loading the features that listen (the visit rating's
 * notification, the Google Play rating ask), and those features can read
 * the check-in flow without the two importing each other.
 *
 *   reportCheckInFacts({ ratingPrompt, lifetimeCheckIns })   a check-in just stood
 *   reportCheckInProofClosed({ lifetimeCheckIns })           the member left its proof
 *
 * A listener that throws costs only itself: a check-in never fails over
 * what it tells others.
 */
import type { VisitRatingReservation } from '../api/visitRating';

/** What a check-in's answer adds (API 0.46.0), both fail-soft. */
export interface CheckInFacts {
  /** The "How was your visit?" ask the check-in reserved, or null (most of the time). */
  readonly ratingPrompt: VisitRatingReservation | null;
  /** The member's check-ins that stand, this one included; null when unknown. */
  readonly lifetimeCheckIns: number | null;
}

/** The member left the check-in's success screen (the proof reception reads). */
export interface ProofClosedFacts {
  /** What the check-in on that screen said; null when it said nothing. */
  readonly lifetimeCheckIns: number | null;
}

type Listener<T> = (facts: T) => void;

const checkInListeners = new Map<string, Listener<CheckInFacts>>();
const proofClosedListeners = new Map<string, Listener<ProofClosedFacts>>();

function register<T>(table: Map<string, Listener<T>>, id: string, listener: Listener<T>): () => void {
  table.set(id, listener);
  return () => {
    if (table.get(id) === listener) table.delete(id);
  };
}

function tell<T>(table: Map<string, Listener<T>>, facts: T): void {
  for (const listener of [...table.values()]) {
    try {
      listener(facts);
    } catch {
      // A listener's own failure; the check-in stands either way.
    }
  }
}

/** Hears every check-in this app makes (registering the same id again replaces it). */
export function onCheckInFacts(id: string, listener: Listener<CheckInFacts>): () => void {
  return register(checkInListeners, id, listener);
}

/** Hears the member leave a check-in's success screen. */
export function onCheckInProofClosed(id: string, listener: Listener<ProofClosedFacts>): () => void {
  return register(proofClosedListeners, id, listener);
}

/** A check-in stood: what its answer said. Never throws. */
export function reportCheckInFacts(facts: CheckInFacts): void {
  tell(checkInListeners, facts);
}

/** The member left a check-in's success screen. Never throws. */
export function reportCheckInProofClosed(facts: ProofClosedFacts): void {
  tell(proofClosedListeners, facts);
}
