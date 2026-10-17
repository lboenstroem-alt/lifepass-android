// "A Kenni sheet just closed": for screens that hold something a verification
// can change besides the profile.
//
// WHY. The Kenni completion is where a pending company invitation is claimed
// (`POST /auth/kenni/complete` answers `claims`), so after the sheet closes
// iOS Account re-reads both the profile AND the company-plan context
// (AccountView's `.sheet(onDismiss:)`). The profile is the app store's, and
// the sheet re-reads it itself; the company context belongs to the Account
// screen's co-pay banner (ACCT-3), which subscribes here and re-reads
// `GET /company-plans/context` whenever any Kenni sheet closes, wherever it
// was opened from (a verification from the plans screen claims an invite
// just the same).
import { useEffect, useRef } from 'react';

import type { KenniSheetOutcome } from './KenniSheet';

type Listener = (outcome: KenniSheetOutcome) => void;

const listeners = new Set<Listener>();

/** Calls `listener` each time a Kenni sheet has closed. Returns an unsubscribe. */
export function onKenniSheetClosed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The hook form of `onKenniSheetClosed`, for a mounted screen (the latest `listener` is called). */
export function useOnKenniSheetClosed(listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => onKenniSheetClosed((outcome) => latest.current(outcome)), []);
}

/** The host: a sheet has left the screen. */
export function notifyKenniSheetClosed(outcome: KenniSheetOutcome): void {
  for (const listener of [...listeners]) {
    try {
      listener(outcome);
    } catch {
      // One screen's reload must not stop the others'.
    }
  }
}
