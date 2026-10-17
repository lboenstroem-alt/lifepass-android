// Kenni eID (AUTH-3): verify the member's kennitala once with Icelandic
// electronic ID. The public surface (plan 3.0.3); other features import from
// here only.
//
// OPENING THE SHEET. From anywhere (PLANS-1, ACCT-1, ACCT-3, BOOK-1, a
// refusal's "Verify identity"):
//
//   openKenniSheet({
//     bodyKey: 'kenni.body',                  // or 'kenni.onboarding_body'
//     onSeePasses: () => showPasses(),        // Plans only
//     onClose: () => {
//       // Gone, verified or not. The profile was re-read after a
//       // verification: decide from it, never resume a purchase unverified.
//       if (selectIsKennitalaVerified(useAppStore.getState())) resume();
//     },
//   });
//
// Only open it for a member whose profile says unverified (iOS checks
// `isKennitalaVerified` first; a start for a verified member answers
// `alreadyVerified` and the sheet just says so).
//
// `KenniNudgeHost` is mounted once by F4's tabs shell; it also shows the
// post-sign-up nudge. `onKenniSheetClosed` / `useOnKenniSheetClosed` tell a
// screen that any Kenni sheet has closed (ACCT-3's co-pay banner re-reads the
// company-plan context then: the completion claims invitations).
export { default as KenniNudgeHost } from './KenniNudgeHost';
export { default as KenniSheet, KENNI_SUPPORT_URL } from './KenniSheet';
export type { KenniSheetOutcome, KenniSheetProps } from './KenniSheet';
export {
  openKenniSheet,
  useKenniSheetRequest,
  closeKenniSheetRequest,
  isKenniSheetRequested,
} from './sheetRequests';
export type { KenniSheetOptions } from './sheetRequests';
export { onKenniSheetClosed, useOnKenniSheetClosed } from './events';
export { handleKenniCallbackLink, isKenniCallbackUrl } from './callbackLink';
export type { KenniFailure } from './model';
