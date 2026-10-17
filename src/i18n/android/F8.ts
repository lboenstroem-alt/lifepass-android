// Android-only copy for F8: Money rails core: hosted pages, payment sessions, in-flight recovery.
//
// Owned by F8 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// iOS never needs these: its payment page is a cover inside the app, so the
// door's own success screen is always there to show the proof. On Android
// the app can be closed behind the page, and a walk-in paid on it is then
// confirmed after a cold start, with the door's screen gone. Until the
// check-in flow shows its proof there, the member is told where to find it
// (Home re-offers the proof, as on iOS).
import { definePack } from './pack';

export default definePack({
  en: {
    'payments.recovered.checked_in_venue':
      "Your payment went through and you're checked in at {venue}. Open Home and tap Show to staff to show it at reception.",
    'payments.recovered.checked_in':
      "Your payment went through and you're checked in. Open Home and tap Show to staff to show it at reception.",
  },
  is: {
    'payments.recovered.checked_in_venue':
      'Greiðslan gekk í gegn og þú ert innrituð/aður hjá {venue}. Opnaðu Heim og ýttu á Sýna starfsfólki til að sýna innritunina í móttöku.',
    'payments.recovered.checked_in':
      'Greiðslan gekk í gegn og þú ert innrituð/aður. Opnaðu Heim og ýttu á Sýna starfsfólki til að sýna innritunina í móttöku.',
  },
});
