// The Kenni sheet host, mounted once by F4's tabs shell (plan 3.0.3).
//
// It shows the verification sheet for an `openKenniSheet` request
// (./sheetRequests.ts), and for the post-sign-up nudge the app store arms
// (`pendingKennitalaPrompt`, iOS MainTabView's `.sheet` with
// `KenniVerificationView(bodyKey: "kenni.onboarding_body")`). The arming
// rules (fresh account under 48 hours, unverified, never dismissed on this
// phone, no check-in link this session, not a password-recovery sign-in) are
// F3's `evaluateKennitalaPrompt`, run at app entry only.
//
// CLOSING THE NUDGE, verified or not, counts as handled: the member's close
// persists `kennitalaPromptDismissed` at once (`dismissKennitalaPrompt`), so
// it fires at most once per phone, as iOS's binding does when the sheet is
// dismissed. A nudge RETRACTED by the app (a check-in link arrived: a member
// walking up to a door outranks it; sign-out) has its flag cleared first, so
// its close persists nothing and it can arm again at the next launch.
//
// A REQUEST'S OPENER hears `onClose` once the sheet has left the screen (iOS
// `onDismiss`), so whatever it opens next never collides with a sheet still
// sliding away. Every close, of either kind, is announced to
// `onKenniSheetClosed` (./events.ts) for the company-plan context.
//
// THE MODULE PATH. The sheet is rendered through
// src/components/KenniVerificationModal (now a thin shim over ./KenniSheet)
// because F4's shell tests stand in for the sheet at that path
// (`jest.mock('../../components/KenniVerificationModal')`). Point this at
// ./KenniSheet, and delete the shim, once they mock ./KenniSheet instead and
// PLANS-1 has replaced the legacy plans screen that still imports it.
import { useRef, useState } from 'react';

import KenniVerificationModal from '../../components/KenniVerificationModal';
import { useAppStore } from '../../stores/appStore';

import { notifyKenniSheetClosed } from './events';
import type { KenniSheetOutcome } from './KenniSheet';
import { closeKenniSheetRequest, useKenniSheetRequest, type KenniSheetRequest } from './sheetRequests';

/** A stable key per request object, so a request that replaces another is a fresh sheet. */
const requestKeys = new WeakMap<KenniSheetRequest, number>();
let lastKey = 0;
function keyOf(request: KenniSheetRequest | null): string {
  if (!request) return 'nudge';
  let key = requestKeys.get(request);
  if (key === undefined) {
    lastKey += 1;
    key = lastKey;
    requestKeys.set(request, key);
  }
  return `request-${key}`;
}

export default function KenniNudgeHost() {
  const request = useKenniSheetRequest();
  const nudge = useAppStore((state) => state.pendingKennitalaPrompt);
  // The request the member closed, while its sheet slides away.
  const [closedRequest, setClosedRequest] = useState<KenniSheetRequest | null>(null);

  const showingRequest = request !== null && request !== closedRequest ? request : null;
  const visible = showingRequest !== null || nudge;

  // What is on screen, kept while it slides away so it keeps its words. A
  // request outranks the nudge (it carries its opener's copy and actions).
  const shown = useRef<KenniSheetRequest | null>(null);
  if (visible) shown.current = showingRequest;
  const presented = shown.current;

  /** The member closed it (Cancel, Continue, See visitor passes, back, a pan down). */
  function memberClosed() {
    const app = useAppStore.getState();
    // Still armed: the member closed it, so it is handled for good. (A
    // request shown over an armed nudge is the same sheet: it counts too.)
    if (app.pendingKennitalaPrompt) void app.dismissKennitalaPrompt();
    if (showingRequest) setClosedRequest(showingRequest);
  }

  /** The sheet has left the screen. */
  function gone(outcome: KenniSheetOutcome) {
    const closed = shown.current;
    shown.current = null;
    setClosedRequest(null);
    if (closed) closeKenniSheetRequest(closed);
    notifyKenniSheetClosed(outcome);
  }

  return (
    <KenniVerificationModal
      key={keyOf(presented)}
      visible={visible}
      bodyKey={presented ? presented.bodyKey : 'kenni.onboarding_body'}
      onSeePasses={presented?.onSeePasses}
      resumeUrl={presented?.resumeUrl}
      onClose={memberClosed}
      onClosed={gone}
    />
  );
}
