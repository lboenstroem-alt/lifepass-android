/**
 * "Confirming your payment…" while the recovery confirms a payment the app
 * lost behind the page: the Android stand-in for what iOS shows on the
 * screen that is waiting (PlansView's `verificationOverlay`, the booking
 * sheet's and the door's spinner).
 *
 * WHY. After a cold start from `lifepass://payment-success` the member lands
 * on Home while the recovery confirms: up to five asks 2.5 s apart for a
 * booking or walk-in, about a minute for a pass. Said nothing, the member who
 * just paid sees an app that ignores them, and taps Buy or Book again.
 *
 * WHO DRAWS IT. `RecoveryProgressHost` (./RecoveryProgressHost), which the
 * app shell (App.tsx) mounts once inside the UI kit's provider. Should no
 * host be mounted, a toast says it (the UI kit's), so the member is never
 * left with nothing. Cancel hides it and the check keeps running, as
 * iOS's Cancel does; the outcome still comes when it settles.
 *
 * When it shows: while the recovery settles a booking, walk-in or plan record
 * after a return link or at launch, unless that record's "still confirming"
 * was already said (later checks are quiet). Never on a quiet return to the
 * foreground, and never for card setup or co-pay (quiet rails).
 */
import { useSyncExternalStore } from 'react';

import { showToast } from '../components/ui/Toast';
import { t } from '../i18n';

import type { InflightRail } from './inflight';

export interface RecoveryProgress {
  readonly attemptId: string;
  readonly rail: InflightRail;
}

let current: RecoveryProgress | null = null;
/** The attempt whose overlay the member dismissed (Cancel): hidden, still checking. */
let dismissed: string | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** What a host should draw now: the progress, unless the member dismissed it. */
export function visibleRecoveryProgress(): RecoveryProgress | null {
  return current && current.attemptId !== dismissed ? current : null;
}

/** The recovery starts confirming `attemptId` where the member can see it. */
export function startRecoveryProgress(progress: RecoveryProgress): void {
  current = progress;
  dismissed = null;
  emit();
  if (hosts === 0) {
    // No host mounted (a test, or a shell without one): a toast, long enough for a booking's asks.
    showToast(t('plans.confirming'), { durationMs: 8_000 });
  }
}

/** The recovery is done with `attemptId` (its outcome is about to be shown, or it settled quietly). */
export function endRecoveryProgress(attemptId: string): void {
  if (current?.attemptId !== attemptId) return;
  current = null;
  dismissed = null;
  emit();
}

/** Cancel: hide it; the check keeps running and its outcome still comes. */
export function dismissRecoveryProgress(): void {
  if (!current) return;
  dismissed = current.attemptId;
  emit();
}

export function subscribeRecoveryProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The progress a host draws (re-renders when it changes). */
export function useRecoveryProgress(): RecoveryProgress | null {
  return useSyncExternalStore(subscribeRecoveryProgress, visibleRecoveryProgress, visibleRecoveryProgress);
}

/** A host mounted (it returns its unmount). While one is, no toast is shown. */
export function attachRecoveryProgressHost(): () => void {
  hosts += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hosts -= 1;
  };
}

/** Sign-out and tests: nothing showing. */
export function resetRecoveryProgress(): void {
  current = null;
  dismissed = null;
  emit();
}
