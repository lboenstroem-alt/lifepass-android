// @f4-stub (F4, for refusal steps): the account-deletion sheet's opener, filled by ACCT-4.
//
// A refusal's "Cancel deletion" opens the deletion sheet (iOS
// `RefusalStepPresenter` `.deletion` → `AccountDeletionSheet`). Not in plan
// 3.0.3: F4 added it so src/navigation/refusalSteps.ts has something to call.
// Keep the exported names and signature; replace the body (and this marker).
//
// Answers whether it opened the sheet. When it did, it calls `onClose` once
// when the sheet closes (cancelled, deletion cancelled, or anything else):
// iOS runs the refusing screen's `onSheetDismiss` for the deletion sheet as
// for every other step, so a booking screen or the scanner re-checks the
// refused selection after "Cancel deletion". The sheet opens over the
// refusing screen, so no focus change tells that screen it is back.
//
// Until ACCT-4 lands it opens nothing (and never calls `onClose`), and the
// refusal step takes the member to Account instead.

export interface AccountDeletionOptions {
  /** The sheet closed. Called once, and only when this call opened the sheet. */
  readonly onClose: () => void;
}

export function openAccountDeletion(options: AccountDeletionOptions): boolean {
  void options;
  return false;
}
