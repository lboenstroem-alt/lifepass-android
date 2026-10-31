/**
 * Payments that settled a moment ago away from the screen that is now
 * starting one: the recovery after process death, a presenter's Check again,
 * or a flow whose screen had gone. Memory only (a process death forgets them,
 * and so does sign-out).
 *
 * WHY. A member who paid behind the page and came back to a cold start does
 * not know the app is still confirming (it can take a minute for a pass), so
 * they tap Buy or Book again. The new attempt waits for the recovery
 * (./attempts), and when the recovery has just found the earlier payment
 * went through, the new page must not open: that would take the money a
 * second time (a second pass), or open a session that is already paid. iOS
 * never meets this, because its attempt lives in the screen's view model and
 * one outcome is shown per attempt.
 */
import {
  attemptAction,
  attemptIdentity,
  type InflightRecord,
  type NewInflightRecord,
} from './inflight';
import type { PaymentResolution } from './presenters';

/** How long a settled payment still stops a retry of the SAME payment (same key or Kling session). */
export const RECENT_RESOLUTION_MS = 2 * 60 * 1000;

const MAX_KEPT = 16;

export interface RecentResolution {
  /** Order of noting, so "after this attempt began waiting" needs no clock. */
  readonly seq: number;
  readonly at: number;
  readonly memberId: string;
  readonly identity: string | null;
  readonly action: string | null;
  readonly resolution: PaymentResolution;
  /** The member was shown it (by the rail's presenter). */
  readonly presented: boolean;
}

let seq = 0;
let recent: RecentResolution[] = [];

/**
 * True when `resolution` means the money for its action was taken: booked or
 * checked in, a plan or pass confirmed, or captured and parked for
 * operations (`needsAttention`: a second attempt would be a second charge
 * for something the first may still get). Any other ending (nothing paid,
 * refunded, expired) leaves the member free to try again.
 */
export function paidOrParked(resolution: PaymentResolution): boolean {
  switch (resolution.rail) {
    case 'booking':
    case 'walk_in': {
      const { settlement } = resolution;
      return settlement.kind === 'fulfilled' || (settlement.kind === 'outcome' && settlement.outcome.kind === 'needsAttention');
    }
    case 'plan':
      return resolution.verification.kind === 'confirmed';
    case 'card_setup':
    case 'copay':
      return false;
  }
}

function fresh(entry: RecentResolution, now: number): boolean {
  return now - entry.at < RECENT_RESOLUTION_MS;
}

/** Notes a final answer for `record` (only a paid or parked one is ever needed). */
export function noteResolved(record: InflightRecord, resolution: PaymentResolution, presented: boolean): void {
  if (!paidOrParked(resolution)) return;
  const now = Date.now();
  seq += 1;
  recent = [
    ...recent.filter((entry) => fresh(entry, now)),
    {
      seq,
      at: now,
      memberId: record.memberId.toLowerCase(),
      identity: attemptIdentity(record),
      action: attemptAction(record),
      resolution,
      presented,
    },
  ].slice(-MAX_KEPT);
}

/** A mark: what is noted after it settled while the caller waited. */
export function resolutionMark(): number {
  return seq;
}

/**
 * Takes (once) the paid or parked answer that stops `next` from starting:
 *
 * - the SAME payment (its key or Kling session) settled in the last
 *   `RECENT_RESOLUTION_MS`: reopening it would open a paid session;
 * - the same ACTION under another key settled after `since`, while the new
 *   attempt waited: the member tapped again before they could see the first
 *   one land. One settled before the tap was seen, and a second purchase
 *   then is the member's choice.
 *
 * Taken once, so the next tap is never stopped by the same answer.
 */
export function takeRecentResolution(next: NewInflightRecord, since: number): RecentResolution | null {
  const now = Date.now();
  const memberId = next.memberId.toLowerCase();
  const identity = attemptIdentity(next);
  const action = attemptAction(next);
  const match = recent.find(
    (entry) =>
      entry.memberId === memberId &&
      fresh(entry, now) &&
      ((identity !== null && entry.identity === identity) || (action !== null && entry.action === action && entry.seq > since)),
  );
  if (!match) return null;
  recent = recent.filter((entry) => entry !== match);
  return match;
}

/** The member's paid or parked answers of the last `RECENT_RESOLUTION_MS`, oldest first. */
export function recentResolutions(memberId: string): RecentResolution[] {
  const now = Date.now();
  const id = memberId.toLowerCase();
  return recent.filter((entry) => entry.memberId === id && fresh(entry, now));
}

/** Sign-out, and tests: forget them. */
export function forgetRecentResolutions(): void {
  recent = [];
}
