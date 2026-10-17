// Android-only copy for EXPL-1: Explore shell, list, search, filters, location banner.
//
// Owned by EXPL-1 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
import { definePack } from './pack';

export default definePack({
  en: {
    // A list row's place when the venue has no city. iOS writes the English
    // word into the row in both languages; Android says it in the member's.
    'explore.android.city_fallback': 'Iceland',
  },
  is: {
    'explore.android.city_fallback': 'Ísland',
  },
});
