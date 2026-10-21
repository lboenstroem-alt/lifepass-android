// Android-only copy for AUTH-1: Email auth, onboarding, password reset, auth links.
//
// Owned by AUTH-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - The eye button on a password field: iOS gives it no words (VoiceOver
//   reads the symbol's name); TalkBack needs a label that says what a tap
//   does.
// - "I've confirmed, sign me in" on the check-your-email alert: an Android
//   fallback for a browser that will not hand the confirmation link to the
//   app. It signs in with what the member just typed. iOS never needs it:
//   Safari always opens the app's link.
import { definePack } from './pack';

export default definePack({
  en: {
    'auth.android.show_password': 'Show password',
    'auth.android.hide_password': 'Hide password',
    'auth.android.confirmed_sign_in': "I've confirmed, sign me in",
  },
  is: {
    'auth.android.show_password': 'Sýna lykilorð',
    'auth.android.hide_password': 'Fela lykilorð',
    'auth.android.confirmed_sign_in': 'Ég hef staðfest, skráðu mig inn',
  },
});
