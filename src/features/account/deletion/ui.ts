// In-app account deletion (ACCT-4), the UI half; the opener is in ./index.ts.
//
// - `AccountDeletionHost`: mounted once by the tabs shell, beside the other
//   sheet hosts (src/navigation/TabNavigator.tsx, next to `KenniNudgeHost`):
//
//     import { AccountDeletionHost } from '../features/account/deletion/ui';
//     <AccountDeletionHost />
//
//   It is (TabsLayout). Without it `openAccountDeletion` answers false
//   (src/navigation/__tests__/deletionRefusal.test.tsx guards the wiring).
// - `AccountDeletionSheet`: the sheet itself, for a screen that hosts it
//   (the Account row does, as iOS `AccountView` does).
//
// Kept out of the index so that importing the opener (navigation code)
// never loads the sheet and everything it imports.
export { default as AccountDeletionHost } from './AccountDeletionHost';
export { default as AccountDeletionSheet, type AccountDeletionSheetProps } from './AccountDeletionSheet';
