// Where the Explore map looks when it opens (iOS SearchMapView's camera
// positions), as regions: a centre and a span in degrees, the way MapKit
// states them. Mapbox fits a region's corners into the map (`regionBounds`),
// as MapKit fits a region: all of it in view, the longer side deciding.
import { REYKJAVIK_CENTRE, type Coordinate } from '../../../lib/geo';

export interface MapRegion {
  readonly center: Coordinate;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

/** The map's first view: central Reykjavík (iOS span 0.08 by 0.08). */
export const REYKJAVIK_REGION: MapRegion = { center: REYKJAVIK_CENTRE, latitudeDelta: 0.08, longitudeDelta: 0.08 };

/**
 * Home's "See all on the map": the island with a margin, Reykjanes to
 * Langanes. At that zoom the top pick of every region draws.
 */
export const ICELAND_REGION: MapRegion = {
  center: { latitude: 64.96, longitude: -18.6 },
  latitudeDelta: 4.2,
  longitudeDelta: 11.5,
};

/** A Mapbox position: [longitude, latitude]. */
export type LngLat = [number, number];

/** A region's corners, north-east and south-west, as Mapbox takes them. */
export function regionBounds(region: MapRegion): { ne: LngLat; sw: LngLat } {
  const halfLat = region.latitudeDelta / 2;
  const halfLon = region.longitudeDelta / 2;
  return {
    ne: [region.center.longitude + halfLon, region.center.latitude + halfLat],
    sw: [region.center.longitude - halfLon, region.center.latitude - halfLat],
  };
}

/** Mapbox's tile size in dp: the whole world is 512 × 2^zoom dp wide. */
const TILE_SIZE = 512;

function mercatorY(latitude: number): number {
  const phi = (latitude * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

/**
 * The zoom at which a region just fits a map of `width` by `height` dp (the
 * camera Mapbox settles on for `regionBounds`). The map reports its real zoom
 * once it has drawn; this is what the layers read before that.
 */
export function regionZoom(region: MapRegion, width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const lonZoom = Math.log2((width * 360) / (region.longitudeDelta * TILE_SIZE));
  const north = region.center.latitude + region.latitudeDelta / 2;
  const south = region.center.latitude - region.latitudeDelta / 2;
  const span = mercatorY(north) - mercatorY(south);
  const latZoom = Math.log2((height * 2 * Math.PI) / (span * TILE_SIZE));
  return Math.min(lonZoom, latZoom);
}
