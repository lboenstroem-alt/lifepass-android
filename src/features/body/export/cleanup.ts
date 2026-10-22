/**
 * When the export file goes. It is the member's whole account in one file,
 * so it lives only as long as some app may still be reading it.
 *
 * iOS deletes it when the share sheet is dismissed, which is after the
 * chosen activity has finished. Android gives no such moment: expo-sharing's
 * promise resolves when the chooser hands a result back, and Android
 * forwards that result from the chosen app. An app whose share screen runs
 * in its own task (a `singleTask` share activity) answers at once, before it
 * has opened the file, and an app that uploads after its screen closes
 * reads the file later still. Deleting the moment the promise resolved could
 * leave the member with an empty or failed share.
 *
 * So once the share has answered, the file goes when BOTH hold:
 *
 * - at least `EXPORT_SHARE_GRACE_MS` have passed since that answer, and
 * - LifePass is in the foreground: the member is back here, so no other
 *   app's share screen is in front (or the next return to the foreground,
 *   when the grace runs out while they are elsewhere).
 *
 * Backstops for a file this never got to (Android killed the app, the
 * timer never ran): the page opening and the app starting
 * (`clearLeftoverExports`, which leaves alone a file a share in this run
 * still holds), the next export, a health wipe and a sign-out
 * (`clearAllExports`, and src/health's own `clearExports`).
 */
import { AppState, type AppStateStatus } from 'react-native';

import { healthLocalStore } from '../../../health';

/** How long a shared file stays after the share answered, at the least. */
export const EXPORT_SHARE_GRACE_MS = 3 * 60_000;

/** What the schedule needs from the platform (injected by tests). */
export interface ExportCleanupDeps {
  readonly appState: {
    readonly currentState: AppStateStatus | unknown;
    addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
  };
  readonly clear: () => Promise<void>;
}

const DEFAULT_DEPS: ExportCleanupDeps = {
  appState: AppState,
  clear: () => healthLocalStore.clearExports(),
};

let deps: ExportCleanupDeps = DEFAULT_DEPS;

/** Nothing holds a file; a share is up; or a share answered and its file waits for its moment. */
type Phase = { readonly kind: 'idle' } | { readonly kind: 'sharing' } | { readonly kind: 'waiting'; readonly cancel: () => void };

let phase: Phase = { kind: 'idle' };

function cancelWaiting(): void {
  if (phase.kind === 'waiting') phase.cancel();
  phase = { kind: 'idle' };
}

/** A share sheet is about to open on the file: nothing deletes it until the share answers. */
export function holdForShare(): void {
  cancelWaiting();
  phase = { kind: 'sharing' };
}

/**
 * The share answered (shared or not: closing the chooser is an answer too).
 * The file goes once the grace has passed and LifePass is in the foreground.
 */
export function releaseAfterShare(): void {
  cancelWaiting();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let subscription: { remove(): void } | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    subscription?.remove();
    subscription = null;
  };
  const waiting: Phase = { kind: 'waiting', cancel: stop };
  const run = () => {
    stop();
    if (phase === waiting) phase = { kind: 'idle' };
    void deps.clear().catch(() => undefined);
  };
  timer = setTimeout(() => {
    timer = null;
    if (deps.appState.currentState === 'active') {
      run();
      return;
    }
    subscription = deps.appState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
  }, EXPORT_SHARE_GRACE_MS);
  phase = waiting;
}

/**
 * The share sheet never opened (no share target, or it failed to start):
 * no other app has the file, so it goes now.
 */
export async function releaseUnshared(): Promise<void> {
  cancelWaiting();
  await deps.clear();
}

/**
 * A file no share in this run holds (the app was killed with one on disk):
 * gone. Run when Body and goals opens and when the app starts.
 */
export async function clearLeftoverExports(): Promise<void> {
  if (phase.kind !== 'idle') return;
  await deps.clear();
}

/** Every export, now, whatever share holds it: a new export, a sign-out. */
export async function clearAllExports(): Promise<void> {
  cancelWaiting();
  await deps.clear();
}

/** Tests: the platform the schedule uses (omit to restore the real one), and nothing pending. */
export function resetExportCleanupForTests(next?: ExportCleanupDeps): void {
  cancelWaiting();
  deps = next ?? DEFAULT_DEPS;
}
