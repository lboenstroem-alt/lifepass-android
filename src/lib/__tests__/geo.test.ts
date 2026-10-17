/**
 * Distances and proximity bands (iOS ProximityGrouping.swift): Icelandic
 * bands, a stable order inside each band, no position never measured.
 */
import {
  coordinateOf,
  distanceMeters,
  groupByProximity,
  haversineMeters,
  nearestWithin,
  ProximityBand,
  proximityBandAround,
  proximityBandOf,
  REYKJAVIK_CENTRE,
} from '../geo';

const at = (name: string, latitude: number | null, longitude: number | null) => ({ name, latitude, longitude });

it('measures great-circle distances', () => {
  expect(haversineMeters(64.1466, -21.9426, 64.1466, -21.9426)).toBe(0);
  // Reykjavík to Akureyri is about 249 km as the crow flies.
  const km = distanceMeters(REYKJAVIK_CENTRE, { latitude: 65.6839, longitude: -18.0906 }) / 1000;
  expect(km).toBeGreaterThan(245);
  expect(km).toBeLessThan(253);
});

it('the bands are 3, 15 and 60 km', () => {
  expect(proximityBandOf(0)).toBe(ProximityBand.walkable);
  expect(proximityBandOf(2_999.9)).toBe(ProximityBand.walkable);
  expect(proximityBandOf(3_000)).toBe(ProximityBand.sameArea);
  expect(proximityBandOf(14_999)).toBe(ProximityBand.sameArea);
  expect(proximityBandOf(15_000)).toBe(ProximityBand.dayTrip);
  expect(proximityBandOf(59_999)).toBe(ProximityBand.dayTrip);
  expect(proximityBandOf(60_000)).toBe(ProximityBand.fartherAway);
});

it('something with no position is never measured and is farthest', () => {
  expect(coordinateOf(at('x', null, null))).toBeNull();
  expect(coordinateOf(at('x', 64, null))).toBeNull();
  expect(coordinateOf({ latitude: Number.NaN, longitude: 1 })).toBeNull();
  expect(coordinateOf(at('x', 0, 0))).toEqual({ latitude: 0, longitude: 0 });
  expect(proximityBandAround(at('x', null, null), REYKJAVIK_CENTRE)).toBe(ProximityBand.fartherAway);
});

it('groups by band and keeps the order inside each band', () => {
  const venues = [
    at('far', 65.68, -18.09),
    at('near-1', 64.147, -21.94),
    at('none', null, null),
    at('town', 64.1, -21.85),
    at('near-2', 64.146, -21.95),
  ];
  expect(groupByProximity(venues, REYKJAVIK_CENTRE).map((v) => v.name)).toEqual([
    'near-1',
    'near-2',
    'town',
    'far',
    'none',
  ]);
});

/** Home's hero: somewhere the member could go today, or nothing. */
it('the nearest within a limit, or none', () => {
  const venues = [at('sky', 64.115, -21.98), at('hresso', 64.147, -21.94), at('none', null, null)];
  expect(nearestWithin(venues, REYKJAVIK_CENTRE, 20_000)?.name).toBe('hresso');
  expect(nearestWithin([at('akureyri', 65.68, -18.09)], REYKJAVIK_CENTRE, 20_000)).toBeNull();
  expect(nearestWithin([], REYKJAVIK_CENTRE, 20_000)).toBeNull();
});
