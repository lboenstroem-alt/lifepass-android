// Android-only copy for ACCT-1: Account screen (member card, rows, language, referral, legal, sign-out).
//
// Owned by ACCT-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - account.android.notifications*: the Notifications row. iOS has no such
//   row (an iPhone reaches an app's notifications from Settings); the owner
//   kept it on Android (decision D4) because Android tucks the per-app
//   switches deeper. It opens the phone's notification settings for
//   LifePass, which leaves the app, and the hint says so for TalkBack.
import { definePack } from './pack';

export default definePack({
  en: {
    'account.android.notifications': 'Notifications',
    'account.android.notifications_hint': 'Opens the notification settings on your phone',
  },
  is: {
    'account.android.notifications': 'Tilkynningar',
    'account.android.notifications_hint': 'Opnar stillingar tilkynninga í símanum',
  },
});
