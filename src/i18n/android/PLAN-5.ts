// Android-only copy for PLAN-5: Food card, drafts, weekly review and check-in.
//
// Owned by PLAN-5 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - checkin.from_health_app: the weekly check-in's "last weight" line when
//   that weight was synced from a wearable. iOS says "From Apple Health on
//   {date}" (`checkin.from_apple_health`); Android reads no Health Connect
//   (owner decision), and a weight synced from the member's other phone is
//   named neutrally here rather than after a brand this phone never shows.
import { definePack } from './pack';

export default definePack({
  en: {
    'checkin.from_health_app': 'From a connected health app on {date}',
  },
  is: {
    'checkin.from_health_app': 'Úr tengdu heilsuforriti þann {date}',
  },
});
