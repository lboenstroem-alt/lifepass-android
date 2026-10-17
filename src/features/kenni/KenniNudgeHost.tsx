// @f4-stub (plan 3.0.3): the Kenni sheet host, filled by AUTH-3; mounted once by F4's tabs shell.
//
// Shows the verification sheet for an `openKenniSheet` request, and for the
// post-sign-up nudge (iOS MainTabView: `KenniVerificationView(bodyKey:
// "kenni.onboarding_body")` while `pendingKennitalaPrompt`). Closing the
// NUDGE, verified or not, counts as handled: `dismissKennitalaPrompt()`
// persists it so the nudge fires at most once per phone. A nudge retracted by
// the app itself (a check-in link arrived, sign-out) clears the flag first,
// so it is never counted as dismissed.
//
// Until AUTH-3 lands this shows the first build's verification modal.
import KenniVerificationModal from '../../components/KenniVerificationModal';
import { useAppStore } from '../../stores/appStore';
import { closeKenniSheetRequest, useKenniSheetRequest } from './sheetRequests';

export default function KenniNudgeHost() {
  const request = useKenniSheetRequest();
  const nudge = useAppStore((state) => state.pendingKennitalaPrompt);

  function close() {
    if (request) {
      closeKenniSheetRequest();
      return;
    }
    // Still armed: the member closed it. (A programmatic retract cleared it first.)
    if (useAppStore.getState().pendingKennitalaPrompt) void useAppStore.getState().dismissKennitalaPrompt();
  }

  return (
    <KenniVerificationModal
      visible={request !== null || nudge}
      onClose={close}
      onVerified={() => {
        void useAppStore.getState().refreshCredits();
        close();
      }}
    />
  );
}
