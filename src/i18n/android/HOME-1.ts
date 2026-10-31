// Android-only copy for HOME-1: Home tab.
//
// Owned by HOME-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// The two place names below are the city line's last resort on Home's venue
// cards, when a venue has neither a city nor an address. iOS writes them as
// English literals ("Reykjavík" on the Nearby cards, "Iceland" on the
// Popular rows); here they follow the account language, so an Icelandic
// account reads "Ísland".
import { definePack } from './pack';

export default definePack({
  en: {
    'home.android.city_fallback_nearby': 'Reykjavík',
    'home.android.city_fallback_popular': 'Iceland',
  },
  is: {
    'home.android.city_fallback_nearby': 'Reykjavík',
    'home.android.city_fallback_popular': 'Ísland',
  },
});
