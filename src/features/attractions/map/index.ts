/**
 * The sights layer's door for the Explore map (EXPL-2's overlay seam,
 * ../../explore/map/sightsControls.tsx, fills its controls from here; the
 * layer itself is the published slot ./SightsLayer.tsx).
 */
import { resetAttractionMarkers } from '../markersStore';
import { resetTrailsFeed } from './trailsFeed';

export { useSightsMap, MARKER_RETRY_DELAYS_MS } from './useSightsMap';
export type { AccessibleSight, SightsLayerContent, SightsMap, SightsMapInput, SightsMapVenue, SpanRegion } from './useSightsMap';
export { SightsCreditPlate, SightsRetryNotice, SightsToggle } from './SightsControls';
export type { MapCameraReport, Size } from './layout';

/** Tests: forget the shared marker feed, the trails' wait and any request on its way. */
export function resetSightsFeeds(): void {
  resetAttractionMarkers();
  resetTrailsFeed();
}
