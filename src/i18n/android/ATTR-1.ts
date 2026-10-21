// Android-only copy for ATTR-1: Attractions data, rules, sight card, Home Outside card.
//
// Owned by ATTR-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// Empty: the sight card's second Directions answer ("another maps app", a
// `geo:` pin where iOS offers Apple Maps) is F1's shared `venue.maps_other`
// (./F1.ts), the venue page's words, so the two dialogs read the same.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
