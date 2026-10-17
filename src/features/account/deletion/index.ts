// @f4-stub (F4, for refusal steps): the account-deletion sheet's opener, filled by ACCT-4.
//
// A refusal's "Cancel deletion" opens the deletion sheet (iOS
// `RefusalStepPresenter` `.deletion` → `AccountDeletionSheet`). Not in plan
// 3.0.3: F4 added it so src/navigation/refusalSteps.ts has something to call.
// Keep the exported name and signature; replace the body (and this marker).
//
// Answers whether it opened the sheet. Until ACCT-4 lands it opens nothing,
// and the refusal step takes the member to Account instead.
export function openAccountDeletion(): boolean {
  return false;
}
