// @f4-stub (plan 3.0.3): the Kenni eID sheet, filled by AUTH-3.
//
// `openKenniSheet` opens the identity-verification sheet from anywhere
// (PLANS-1, ACCT-1, ACCT-3, BOOK-1, a refusal's "Verify identity"), and
// `KenniNudgeHost`, mounted once by F4's tabs shell, shows it: for those
// requests, and for the post-sign-up nudge the app store arms
// (`pendingKennitalaPrompt`, iOS MainTabView's `.sheet`).
//
// Keep these exports and signatures; replace the bodies (and this marker).
// Until AUTH-3 lands they show the first build's verification modal.
export { default as KenniNudgeHost } from './KenniNudgeHost';
export { openKenniSheet, useKenniSheetRequest, closeKenniSheetRequest } from './sheetRequests';
export type { KenniSheetOptions } from './sheetRequests';
