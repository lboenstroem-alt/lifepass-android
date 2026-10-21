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
// `onKenniSheetClosed` (./events.ts) for the company-plan context (by the
// sheet itself).
//
// A REDIRECT WITHOUT ITS TAB (Android only, ./callbackLink.ts). The host is
// where such a link is heard and finished, because it mounts only with the
// tabs: once the session is restored and the member signed in. On every
// mount it reads the launch link (a cold start after Android stopped the
// app, or a recreated Activity), and while up it listens for link events (a
// redirect later than the tab's grace). A link the claim allows goes to the
// sheet on screen, which keeps its opener's body, "See visitor passes" and
// `onClose` (iOS: the sheet the member is looking at finishes its own round
// trip); with no sheet up, one opens with the membership body.
//
// THE MODULE PATH. The sheet is rendered through
// src/components/KenniVerificationModal (now a thin shim over ./KenniSheet)
// because F4's shell tests stand in for the sheet at that path
// (`jest.mock('../../components/KenniVerificationModal')`). Point this at
// ./KenniSheet, and delete the shim, once they mock ./KenniSheet instead and
// PLANS-1 has replaced the legacy plans screen that still imports it.
import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import KenniVerificationModal from '../../components/KenniVerificationModal';
import { useAppStore } from '../../stores/appStore';

import {
  claimParkedKenniResume,
  handleKenniCallbackLink,
  reparkKenniResume,
  useParkedKenniResume,
} from './callbackLink';
import { closeKenniSheetRequest, presentRequest, useKenniSheetRequest, type KenniSheetRequest } from './sheetRequests';

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
  const key = keyOf(presented);

  // A redirect without its tab, given to the sheet on screen: `key` is the
  // presentation it was given to (another sheet never completes it).
  const [handed, setHanded] = useState<{ readonly key: string; readonly url: string } | null>(null);
  const resumeUrl = presented?.resumeUrl ?? (handed !== null && handed.key === key ? handed.url : undefined);

  // Read where the claim lands (it is asynchronous).
  const screenRef = useRef({ visible, key });
  screenRef.current = { visible, key };
  const mounted = useRef(true);

  // The launch link on every mount, then every link event while up.
  useEffect(() => {
    mounted.current = true;
    const subscription = Linking.addEventListener('url', ({ url }: { url: string }) => {
      handleKenniCallbackLink(url);
    });
    Linking.getInitialURL()
      .then((url) => {
        if (url && mounted.current) handleKenniCallbackLink(url);
      })
      .catch(() => undefined);
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  const parked = useParkedKenniResume();
  useEffect(() => {
    if (parked === null) return;
    void claimParkedKenniResume(parked).then((allowed) => {
      if (!allowed) return;
      if (!mounted.current) {
        reparkKenniResume(parked);
        return;
      }
      const now = screenRef.current;
      if (now.visible) setHanded({ key: now.key, url: parked });
      else presentRequest({ bodyKey: 'kenni.body', onClose: () => undefined, resumeUrl: parked });
    });
  }, [parked]);

  /** The member closed it (Cancel, Continue, See visitor passes, back, a pan down). */
  function memberClosed() {
    const app = useAppStore.getState();
    // Still armed: the member closed it, so it is handled for good. (A
    // request shown over an armed nudge is the same sheet: it counts too.)
    if (app.pendingKennitalaPrompt) void app.dismissKennitalaPrompt();
    if (showingRequest) setClosedRequest(showingRequest);
  }

  /** The sheet has left the screen (it announces its own close, ./events.ts). */
  function gone() {
    const closed = shown.current;
    shown.current = null;
    setClosedRequest(null);
    setHanded(null);
    if (closed) closeKenniSheetRequest(closed);
  }

  return (
    <KenniVerificationModal
      key={key}
      visible={visible}
      bodyKey={presented ? presented.bodyKey : 'kenni.onboarding_body'}
      onSeePasses={presented?.onSeePasses}
      resumeUrl={resumeUrl}
      onClose={memberClosed}
      onClosed={gone}
    />
  );
}
