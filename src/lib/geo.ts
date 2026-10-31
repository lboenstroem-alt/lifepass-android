// Geo helpers for the venue lists, the map and the Coach.
//
// Distances are great-circle (haversine) on the phone. The location never
// leaves the phone for ordering: the browse bands (./browseOrder.ts) are
// worked out here, as iOS does with CLLocation.

/** A point on the map. */
export type Coordinate = { readonly latitude: number; readonly longitude: number };

/**
 * Reykjavík city centre (iOS `LocationService.reykjavikFallback`). A FILTER
 * may measure from it when there is no fix (classes "Near me"); nothing may
 * present it as where the member is, and no list is ordered by it.
 */
export const REYKJAVIK_CENTRE: Coordinate = { latitude: 64.1466, longitude: -21.9426 };

/** Mean Earth radius in metres. */
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two lat/long points, in metres. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Metres between two points (iOS `CLLocation.distance(from:)`). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  return haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
}

/** Anything that may carry a position (a venue, a sight). */
export type MaybeLocated = { readonly latitude: number | null | undefined; readonly longitude: number | null | undefined };

/**
 * The position of something that may have none. A venue without coordinates
 * has none: it is never placed at 0,0, never drawn on the map and never
 * measured from (iOS keeps `latitude`/`longitude` optional for this).
 */
export function coordinateOf(item: MaybeLocated): Coordinate | null {
  const { latitude, longitude } = item;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

// MARK: - Proximity bands

/**
 * Orders venues by how close they are, in BANDS, not by exact distance (iOS
 * ProximityGrouping.swift, the web's `proximityBand` in proximity.ts).
 *
 * Strict nearest-first ordering looks precise and behaves badly: two venues
 * 400 m apart swap places every time the GPS fix jitters, so the list
 * reshuffles while you are reading it. Banding keeps the useful part (things
 * near you come first) while the order inside each band stays stable.
 *
 * THE BANDS ARE ICELANDIC DISTANCES. Greater Reykjavík is about 15 km across,
 * so `sameArea` is "still in town". `dayTrip` covers Reykjanes, Akranes,
 * Selfoss and Hveragerði from the capital. Beyond that is another part of the
 * country.
 */
export enum ProximityBand {
  /** Under 3 km. */
  walkable = 0,
  /** 3 to 15 km. */
  sameArea = 1,
  /** 15 to 60 km. */
  dayTrip = 2,
  /** 60 km or more, and anything with no position. */
  fartherAway = 3,
}

/** The band of a distance in metres. */
export function proximityBandOf(metres: number): ProximityBand {
  if (metres < 3_000) return ProximityBand.walkable;
  if (metres < 15_000) return ProximityBand.sameArea;
  if (metres < 60_000) return ProximityBand.dayTrip;
  return ProximityBand.fartherAway;
}

/** The band of `item` around `origin`; no position is `fartherAway` (something has to be last). */
export function proximityBandAround(item: MaybeLocated, origin: Coordinate): ProximityBand {
  const point = coordinateOf(item);
  if (!point) return ProximityBand.fartherAway;
  return proximityBandOf(distanceMeters(point, origin));
}

/**
 * `items` regrouped into distance bands around `origin`, keeping the incoming
 * order inside each band (a stable sort). An item with no position sorts into
 * `fartherAway`, beside its peers, never dropped (iOS `ProximityGrouping.group`).
 */
export function groupByProximity<T extends MaybeLocated>(items: readonly T[], origin: Coordinate): T[] {
  return items
    .map((item, index) => ({ item, index, band: proximityBandAround(item, origin) }))
    .sort((a, b) => (a.band !== b.band ? a.band - b.band : a.index - b.index))
    .map(({ item }) => item);
}

/**
 * The nearest item within `limitMeters` of `origin`, or null (iOS
 * `ProximityGrouping.nearest`). Null rather than the nearest at any distance,
 * so a caller can fall back instead of featuring a lagoon 400 km away under a
 * heading that says it is near. Ties keep the first.
 */
export function nearestWithin<T extends MaybeLocated>(
  items: readonly T[],
  origin: Coordinate,
  limitMeters: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Number.MAX_VALUE;
  for (const item of items) {
    const point = coordinateOf(item);
    if (!point) continue;
    const distance = distanceMeters(point, origin);
    if (distance <= limitMeters && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
