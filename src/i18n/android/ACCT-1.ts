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
// - account.whatsapp, account.android.whatsapp_hint: the "Chat on WhatsApp"
//   row (WhatsApp support, owner decision 22 October 2026; API 0.39.0),
//   shown only while GET /profile carries the chat. iOS says the title too,
//   from its release after 2.9.1 (feat/whatsapp-support), but the generated
//   tables here come from iOS 2.5.6, which does not. Once they are
//   regenerated from an iOS build that has it, the pack test reports
//   `account.whatsapp` twice: delete it from this pack then, and keep the
//   hint (iOS has no hint; the row leaves the app for WhatsApp or the
//   browser, as the Notifications row leaves for the phone's settings).
// - account.android.rateApp.subtitle, account.android.rateApp.hint: the
//   "Rate LifePass" row (API 0.46.0, owner decision 27 October 2026). Its
//   title is iOS's (account.rateApp.title); iOS's subtitle names the App
//   Store (account.rateApp.subtitle), so Android says Google Play here, and
//   the hint says the row leaves the app for it.
import { definePack } from './pack';

export default definePack({
  en: {
    'account.android.notifications': 'Notifications',
    'account.android.notifications_hint': 'Opens the notification settings on your phone',
    'account.whatsapp': 'Chat on WhatsApp',
    'account.android.whatsapp_hint': 'Opens a chat with LifePass support in WhatsApp',
    'account.android.rateApp.subtitle': 'On Google Play',
    'account.android.rateApp.hint': 'Opens LifePass in Google Play',
  },
  is: {
    'account.android.notifications': 'Tilkynningar',
    'account.android.notifications_hint': 'Opnar stillingar tilkynninga í símanum',
    'account.whatsapp': 'Spjalla á WhatsApp',
    'account.android.whatsapp_hint': 'Opnar spjall við þjónustuver LifePass í WhatsApp',
    'account.android.rateApp.subtitle': 'Á Google Play',
    'account.android.rateApp.hint': 'Opnar LifePass á Google Play',
  },
});
