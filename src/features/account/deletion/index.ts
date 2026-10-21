// In-app account deletion (ACCT-4): the opener other packages call. No UI
// here, so navigation code can import it without loading the sheet, the
// bottom sheet library, the health store or the app store.
//
// - `openAccountDeletion({ onClose })` (F4's contract, for refusal steps):
//   a refusal's "Cancel deletion" opens the deletion sheet over the refusing
//   screen (iOS `RefusalStepPresenter` `.deletion` → `AccountDeletionSheet`).
//   Answers whether it opened the sheet; when it did, `onClose` runs once
//   when the sheet closes (cancelled, deletion cancelled, or anything else),
//   so a booking screen or the scanner re-checks the refused selection: the
//   sheet opens over the refusing screen, so no focus change tells that
//   screen it is back. It answers false until the tabs shell mounts
//   `AccountDeletionHost`, and the refusal step then takes the member to
//   Account instead, where the same sheet lives behind the Delete account row.
//
// The UI is in ./ui.ts: `AccountDeletionHost` (mounted once by the tabs
// shell, beside the other sheet hosts) and `AccountDeletionSheet`.
export { openAccountDeletion, isAccountDeletionHostMounted, type AccountDeletionOptions } from './presenter';
