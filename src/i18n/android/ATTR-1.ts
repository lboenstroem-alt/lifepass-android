// Android-only copy for ATTR-1: Attractions data, rules, sight card, Home Outside card.
//
// Owned by ATTR-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - `attraction.android.maps_other`: the sight card's Directions dialog,
//   second answer. iOS offers Apple Maps beside Google Maps; Android has no
//   Apple Maps, so the answer hands the sight to whichever maps app the
//   member uses (a `geo:` link, plan 5.6). Worded as the venue page's answer
//   (VENUE-1's `venue.page.maps_other`), so the two dialogs read the same.
import { definePack } from './pack';

export default definePack({
  en: {
    'attraction.android.maps_other': 'Open in another app',
  },
  is: {
    'attraction.android.maps_other': 'Opna í öðru forriti',
  },
});
