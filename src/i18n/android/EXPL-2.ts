// Android-only copy for EXPL-2: Explore map (rings, legend, two-tap card, pin reveal, location dot).
//
// Owned by EXPL-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
import { definePack } from './pack';

export default definePack({
  en: {
    // The map's locate button. iOS uses MapKit's own button, whose name the
    // system supplies; Android draws its own and names it here.
    'explore.android.map.locate': 'Show where I am',
  },
  is: {
    'explore.android.map.locate': 'Sýna hvar ég er',
  },
});
