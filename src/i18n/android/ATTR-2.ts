// Android-only copy for ATTR-2: Map sights layer, trails, toggle and legend, search group.
//
// Owned by ATTR-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// Empty on purpose: everything the sights say on the map and in search is an
// iOS key in both languages (the toggle `attraction.sights` and its spoken
// `attraction.legend_sights`, the legend's `attraction.legend_trails`, the
// notice `attraction.sights_failed` and `attraction.retry`, the group's
// `attraction.search_group` and `attraction.data_credit`, a ring's spoken
// `attraction.top_pick` and `attraction.trailhead`, and the kind and region
// names). The ODbL plate shows the feed's own `attribution`, as sent.
import { definePack } from './pack';

export default definePack({
  en: {},
  is: {},
});
