/**
 * The health consent sheet, presented from anywhere: a screen that has the
 * sheet in its own tree can render `HealthConsentSheet` itself; code that
 * has no screen to hand (a refusal handled in a store, the Scan tab's meal
 * entry, the Coach's wizard gate) calls `openHealthConsent` and the host the
 * app shell mounts above the navigator (./HealthConsentHost.tsx, inside
 * ../HealthHost.tsx) shows it. No UI here, so stores and register files can
 * use it without loading a screen.
 *
 *   openHealthConsent({ entry: 'scan', onGranted: () => openMealCapture() });
 *
 * One request at a time: a second while one is showing replaces nothing, as
 * iOS cannot present two sheets at once either.
 *
 * NO HOST, NO SHEET. The host registers itself when it mounts
 * (`attachHealthConsentHost`). With none mounted, `openHealthConsent`
 * answers false and leaves nothing pending: a request marked visible with
 * nothing to draw it would show the member nothing, and would refuse every
 * later request ("one is already showing") until a sign-out reset it. A
 * caller that gets false shows a sheet of its own (`HealthConsentSheet`).
 */
import { create } from 'zustand';

import type { HealthConsentEntry } from './consent';

export interface HealthConsentRequest {
  readonly entry: HealthConsentEntry;
  /** Runs once consent is granted and the sheet has gone. */
  readonly onGranted?: () => void | Promise<void>;
  /** Overrides the host's own Open Account (the pending-deletion line). */
  readonly onOpenAccount?: () => void;
}

interface PresenterState {
  /** The request on screen, kept while the sheet slides away so its content does not vanish. */
  readonly request: HealthConsentRequest | null;
  readonly visible: boolean;
}

export const useHealthConsentPresenter = create<PresenterState>()(() => ({ request: null, visible: false }));

/** How many hosts are mounted: the app shell's one (a test may render its own). */
let hostsMounted = 0;

/**
 * The host calls this when it mounts and the answer when it unmounts. When
 * the last host goes, whatever it was showing goes with it.
 */
export function attachHealthConsentHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted === 0) useHealthConsentPresenter.setState({ request: null, visible: false });
  };
}

/** Whether a host is mounted to draw what `openHealthConsent` asks for. */
export function isHealthConsentHostMounted(): boolean {
  return hostsMounted > 0;
}

/**
 * Shows the consent sheet. Answers false, and shows nothing, when one is
 * already showing or no host is mounted (see the file comment).
 */
export function openHealthConsent(request: HealthConsentRequest): boolean {
  if (hostsMounted === 0) return false;
  if (useHealthConsentPresenter.getState().visible) return false;
  useHealthConsentPresenter.setState({ request, visible: true });
  return true;
}

/** Closes it (the sheet's own close does this). */
export function closeHealthConsent(): void {
  useHealthConsentPresenter.setState({ visible: false });
}

/** Tests and the sign-out: nothing showing. */
export function resetHealthConsentPresenter(): void {
  useHealthConsentPresenter.setState({ request: null, visible: false });
}
