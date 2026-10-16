// Android-only copy shared by more than one package, owned by F1.
//
// Only words iOS never says go here, and only when two packages need the same
// words (one key, not two that drift apart). The rules for a pack are in
// ./pack.ts.
import { definePack } from './pack';

export default definePack({
  en: {
    // Directions on a venue page and a sight card (VENUE-1, ATTR-1). iOS
    // offers "Open in Apple Maps" (venue.maps_apple) beside Google Maps;
    // Android has no Apple Maps, so the second choice hands the place to
    // whichever maps app the member uses (a geo: link).
    'venue.maps_other': 'Open in another maps app',
  },
  is: {
    'venue.maps_other': 'Opna í öðru kortaforriti',
  },
});
