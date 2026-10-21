// In-app account deletion (ACCT-4), the UI half; the opener is in ./index.ts.
//
// - `AccountDeletionHost`: mounted once by the tabs shell, beside the other
//   sheet hosts (src/navigation/TabNavigator.tsx, next to `KenniNudgeHost`):
//
//     import { AccountDeletionHost } from '../features/account/deletion/ui';
//     <AccountDeletionHost />
//
//   Until it is mounted `openAccountDeletion` answers false.
// - `AccountDeletionSheet`: the sheet itself, for a screen that hosts it
//   (the Account row does, as iOS `AccountView` does).
//
// Kept out of the index so that importing the opener (navigation code)
// never loads the sheet and everything it imports.
export { default as AccountDeletionHost } from './AccountDeletionHost';
export { default as AccountDeletionSheet, type AccountDeletionSheetProps } from './AccountDeletionSheet';
