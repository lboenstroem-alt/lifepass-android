// The venues' names under their pins (MapKit sets an annotation's title under
// it, and iOS keeps the venue titles on).
//
// Drawn by the map itself, as a symbol layer, rather than inside each pin's
// view: Mapbox then does what MapKit does with titles, dropping a name that
// would run into another (or into the basemap's own labels, which give way
// to ours) and bringing it back with room. The pinned venue's name is placed
// first, so it is the one that stays. About 11.5 pt semibold, dark ink with a
// white halo, wrapping past 128 dp, set just under the 44 pt photo.
//
// Decorative for TalkBack: the pin's own label already says the name.
import { ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { memo, useMemo } from 'react';

import { coordinateOf } from '../../../lib/geo';
import { mapRing } from '../../../theme';
import type { Venue } from '../../../types/venue';
import { NAME_MAX_WIDTH, NAME_OFFSET } from './pinReveal';

/** The name's text size, in dp (iOS measures 11.5 pt semibold). */
export const NAME_TEXT_SIZE = 11.5;

/** One name to draw: where, what, and its place in the queue (lower is placed first). */
export interface NameFeatureInput {
  readonly id: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
}

/** The names as GeoJSON; the pinned venue sorts first so its name wins a collision. */
export function venueNameFeatures(
  venues: readonly Pick<Venue, 'id' | 'name' | 'latitude' | 'longitude'>[],
  pinnedId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; sort: number }> {
  const features: GeoJSON.Feature<GeoJSON.Point, { name: string; sort: number }>[] = [];
  venues.forEach((venue, index) => {
    const position = coordinateOf(venue);
    if (!position || !venue.name) return;
    features.push({
      type: 'Feature',
      id: venue.id,
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
      properties: { name: venue.name, sort: venue.id === pinnedId ? 0 : index + 1 },
    });
  });
  return { type: 'FeatureCollection', features };
}

export interface VenueNamesLayerProps {
  readonly venues: readonly Venue[];
  readonly pinnedId: string | null;
}

function VenueNamesLayer({ venues, pinnedId }: VenueNamesLayerProps) {
  const shape = useMemo(() => venueNameFeatures(venues, pinnedId), [venues, pinnedId]);
  return (
    <ShapeSource id="lifepass-venue-names" shape={shape}>
      <SymbolLayer
        id="lifepass-venue-name"
        style={{
          textField: ['get', 'name'],
          textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          textSize: NAME_TEXT_SIZE,
          textColor: mapRing.ink,
          textHaloColor: '#FFFFFF',
          textHaloWidth: 1.5,
          textAnchor: 'top',
          // Text offsets and widths are in ems of the text size.
          textOffset: [0, NAME_OFFSET / NAME_TEXT_SIZE],
          textMaxWidth: NAME_MAX_WIDTH / NAME_TEXT_SIZE,
          textAllowOverlap: false,
          symbolSortKey: ['get', 'sort'],
        }}
      />
    </ShapeSource>
  );
}

export default memo(VenueNamesLayer);
