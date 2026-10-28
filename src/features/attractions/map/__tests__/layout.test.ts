/**
 * The on-screen rules of the sights layer (./layout.ts): the port of iOS
 * AttractionRanking.swift's `AttractionHitTarget`, `MapScreen` and
 * `AttractionMapLayout`.
 */
import type { Coordinate } from '../../../../lib/geo';
import { sight } from '../../__tests__/fixtures';
import {
  conflictRadiusMetres,
  distanceMetres,
  hitSize,
  isFlatNorthUp,
  labelled,
  labelRect,
  labelText,
  labelWidth,
  MAP_LAYOUT,
  mapScreenOf,
  mercator,
  regionOfCamera,
  regionOfSpan,
  screenDistance,
  screenPoint,
  textWidthEms,
  tightTargets,
  venueCover,
  venueTitleSize,
  type MapCameraReport,
  type MapScreen,
} from '../layout';

const SIZE = { width: 400, height: 600 };

/** Mercator back to a coordinate. */
function unproject(x: number, y: number): Coordinate {
  return { longitude: x * 360 - 180, latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI };
}

/** A camera over central Reykjavík as a 400 x 600 map reports it, about 4 m a point. */
function reykjavikCamera(): MapCameraReport {
  const centre = mercator({ latitude: 64.1466, longitude: -21.9426 });
  const perPoint = 1e-7;
  const nw = unproject(centre.x - 200 * perPoint, centre.y - 300 * perPoint);
  const se = unproject(centre.x + 200 * perPoint, centre.y + 300 * perPoint);
  return { bounds: { ne: [se.longitude, nw.latitude], sw: [nw.longitude, se.latitude] }, heading: 0, pitch: 0 };
}

/** Central Reykjavík, flat and facing north. */
const CAMERA = reykjavikCamera();

function screen(camera: MapCameraReport = CAMERA): MapScreen {
  const made = mapScreenOf(camera, SIZE);
  if (!made) throw new Error('no screen');
  return made;
}

/** The coordinate that lands on a screen point (the inverse of `screenPoint`). */
function at(on: MapScreen, x: number, y: number): Coordinate {
  return unproject(on.minX + (x / on.size.width) * on.rectWidth, on.minY + (y / on.size.height) * on.rectHeight);
}

function top(slug: string, position: Coordinate) {
  return sight(slug, { tier: 'top', ...position });
}

describe('the map on screen (iOS MapScreen)', () => {
  it('is flat and north-up within a degree of each', () => {
    expect(isFlatNorthUp(0, 0)).toBe(true);
    expect(isFlatNorthUp(359.5, 0.5)).toBe(true);
    expect(isFlatNorthUp(-0.5, 0)).toBe(true);
    expect(isFlatNorthUp(720.2, 0)).toBe(true);
    expect(isFlatNorthUp(1.5, 0)).toBe(false);
    expect(isFlatNorthUp(0, 1)).toBe(false);
    expect(isFlatNorthUp(180, 0)).toBe(false);
  });

  it('needs a camera, a box and a size', () => {
    expect(mapScreenOf(null, SIZE)).toBeNull();
    expect(mapScreenOf(CAMERA, { width: 0, height: 600 })).toBeNull();
    expect(mapScreenOf({ ...CAMERA, bounds: { ne: CAMERA.bounds.sw, sw: CAMERA.bounds.ne } }, SIZE)).toBeNull();
    expect(mapScreenOf({ ...CAMERA, heading: 30 }, SIZE)?.isFlatNorthUp).toBe(false);
  });

  it('puts the corners on the corners and keeps distances for any camera', () => {
    const on = screen();
    const [east, north] = CAMERA.bounds.ne;
    const [west, south] = CAMERA.bounds.sw;
    const nw = screenPoint(on, { latitude: north, longitude: west });
    const se = screenPoint(on, { latitude: south, longitude: east });
    expect(nw.x).toBeCloseTo(0, 6);
    expect(nw.y).toBeCloseTo(0, 6);
    expect(se.x).toBeCloseTo(400, 6);
    expect(se.y).toBeCloseTo(600, 6);
    const a = at(on, 100, 100);
    const b = at(on, 130, 140);
    expect(screenDistance(on, a, b)).toBeCloseTo(50, 0);
    expect(mercator({ latitude: 0, longitude: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('reads the reported box and the opening span as the same kind of region', () => {
    const plain: MapCameraReport = { bounds: { ne: [-21.8, 64.2], sw: [-22.1, 64.1] }, heading: 0, pitch: 0 };
    expect(regionOfCamera(plain)).toEqual({ south: 64.1, west: -22.1, north: 64.2, east: -21.8 });
    expect(regionOfCamera({ ...plain, bounds: { ne: [Number.NaN, 64.2], sw: [-22.1, 64.1] } })).toBeNull();
    expect(regionOfSpan({ center: { latitude: 64.96, longitude: -18.6 }, latitudeDelta: 4.2, longitudeDelta: 11.5 })).toEqual({
      south: 64.96 - 2.1,
      north: 64.96 + 2.1,
      west: -18.6 - 5.75,
      east: -18.6 + 5.75,
    });
  });
});

describe('taps near venues (iOS AttractionHitTarget)', () => {
  it('protects max(300 m, 44 points in metres) around a venue', () => {
    // Central Reykjavík on a 600-point map: 0.08° is 8,905.6 m, 14.84 m a point.
    expect(conflictRadiusMetres(0.08, 600)).toBeCloseTo((44 * 0.08 * 111_320) / 600, 6);
    // Zoomed right in, 44 points is a few metres: 300 m still holds.
    expect(conflictRadiusMetres(0.001, 600)).toBe(300);
    // A map that has not measured itself yet.
    expect(conflictRadiusMetres(0.08, 0)).toBe(300);
    expect(conflictRadiusMetres(0, 600)).toBe(300);
  });

  it('measures equirectangular metres', () => {
    const a = { latitude: 64, longitude: -21 };
    expect(distanceMetres(a, { latitude: 64.001, longitude: -21 })).toBeCloseTo(111.32, 2);
    expect(distanceMetres(a, { latitude: 64, longitude: -20.999 })).toBeCloseTo(111.32 * Math.cos((64 * Math.PI) / 180), 2);
  });

  it('keeps a ring near a venue to its own size, and widens the rest', () => {
    const venue = { latitude: 64.14, longitude: -21.94 };
    const near = sight('near', { latitude: 64.141, longitude: -21.94 }); // about 111 m
    const far = sight('far', { latitude: 64.15, longitude: -21.94 }); // about 1.1 km
    expect([...tightTargets([near, far], [venue], 300)]).toEqual(['near']);
    expect(tightTargets([near, far], [], 300).size).toBe(0);
    expect(hitSize('top', false, false)).toBe(40);
    expect(hitSize('notable', false, false)).toBe(34);
    expect(hitSize('standard', false, false)).toBe(34);
    expect(hitSize('top', false, true)).toBe(22);
    expect(hitSize('standard', true, true)).toBe(19);
  });
});

describe('rings under venue photos (iOS AttractionMapLayout.VenueCover)', () => {
  it('leaves out a ring a photo would sit on, and only that one', () => {
    const on = screen();
    const venue = at(on, 200, 300);
    const covers = venueCover([venue], on);
    // A notable ring reaches 8 + 22 + 2 = 32 points.
    expect(covers({ tier: 'notable', ...at(on, 200, 331) })).toBe(true);
    expect(covers({ tier: 'notable', ...at(on, 200, 333) })).toBe(false);
    // A top pick's reach is larger: 11 + 22 + 2 = 35.
    expect(covers({ tier: 'top', ...at(on, 234, 300) })).toBe(true);
    expect(covers({ tier: 'top', ...at(on, 236, 300) })).toBe(false);
  });

  it('measures by distance alone on a turned camera', () => {
    const turned = screen({ ...CAMERA, heading: 90 });
    const venue = at(turned, 200, 300);
    expect(venueCover([venue], turned)({ tier: 'standard', ...at(turned, 220, 300) })).toBe(true);
    expect(venueCover([venue], turned)({ tier: 'standard', ...at(turned, 240, 300) })).toBe(false);
  });
});

describe('top picks’ names (iOS AttractionMapLayout.labelled)', () => {
  const width = () => 60;

  it('hangs a name a point below its ring in open ground', () => {
    const on = screen();
    const pick = top('gullfoss', at(on, 200, 200));
    expect(labelled([pick], [], on, null, width).get('gullfoss')).toBe('below');
    expect(labelRect('below', { x: 189, y: 189, width: 22, height: 22 }, 60)).toEqual({ x: 170, y: 212, width: 60, height: 15 });
  });

  it('tries trailing, then leading, then above, where something is in the way', () => {
    const on = screen();
    const pick = top('pick', at(on, 200, 200));
    // A venue photo right under the ring.
    const venue = { coordinate: at(on, 200, 240), titleSize: { width: 60, height: 14 } };
    expect(labelled([pick], [venue], on, null, width).get('pick')).toBe('trailing');
    // ... and a ring on the right.
    const right = sight('right', { tier: 'standard', ...at(on, 250, 200) });
    expect(labelled([pick, right], [venue], on, null, width).get('pick')).toBe('leading');
    // ... and a ring on the left.
    const left = sight('left', { tier: 'standard', ...at(on, 150, 200) });
    expect(labelled([pick, right, left], [venue], on, null, width).get('pick')).toBe('above');
    // ... and one above: no room anywhere, no name.
    const above = sight('above', { tier: 'standard', ...at(on, 200, 175) });
    expect(labelled([pick, right, left, above], [venue], on, null, width).has('pick')).toBe(false);
  });

  it('keeps names inside the map’s edge', () => {
    const on = screen();
    // Too low for a name below: beside it instead.
    expect(labelled([top('low', at(on, 200, 588))], [], on, null, width).get('low')).toBe('trailing');
    // At the right edge: below still fits, centred.
    expect(labelled([top('edge', at(on, 360, 300))], [], on, null, width).get('edge')).toBe('below');
    expect(labelled([top('corner', at(on, 380, 588))], [], on, null, width).get('corner')).toBe('leading');
  });

  it('lets a neighbour level with a pick keep both names, the better one where it would be', () => {
    const on = screen();
    const best = top('best', at(on, 100, 100));
    const next = top('next', at(on, 125, 100));
    const names = labelled([best, next], [], on, null, width);
    expect(names.get('best')).toBe('below');
    expect(names.get('next')).toBe('trailing');
  });

  it('gives a crowd’s name to the pick that comes first (the map’s order)', () => {
    const on = screen();
    const first = top('first', at(on, 200, 200));
    const second = top('second', at(on, 200, 228));
    const names = labelled([first, second], [], on, null, width);
    // The first's name below would run into the second's ring: it goes beside.
    expect(names.get('first')).toBe('trailing');
    expect(names.get('second')).toBe('below');
  });

  it('only names top picks, measures the open sight at its open size, and waits on a turned camera', () => {
    const on = screen();
    const notable = sight('quiet', { tier: 'notable', ...at(on, 200, 200) });
    expect(labelled([notable], [], on, null, width).size).toBe(0);
    // Selected, the ring is 28 across and its name moves down onto the ring below.
    const pick = top('pick', at(on, 200, 200));
    const below = sight('below', { tier: 'standard', ...at(on, 200, 235) });
    expect(labelled([pick, below], [], on, null, width).get('pick')).toBe('below');
    expect(labelled([pick, below], [], on, 'pick', width).get('pick')).toBe('trailing');
    expect(labelled([pick], [], screen({ ...CAMERA, pitch: 30 }), null, width).size).toBe(0);
  });

  it('keeps clear of a venue’s name under its photo', () => {
    const on = screen();
    const pick = top('pick', at(on, 200, 200));
    // The venue sits down and to the left; its two-line name runs under the pick's ring.
    const venue = { coordinate: at(on, 140, 175), titleSize: { width: 128, height: 28 } };
    expect(labelled([pick], [venue], on, null, width).get('pick')).toBe('trailing');
  });
});

describe('measuring names', () => {
  it('caps a name at 132 points and cuts what would not fit', () => {
    expect(labelWidth('Gullfoss')).toBe(Math.ceil(textWidthEms('Gullfoss') * 11) + 4);
    const long = 'Jökulsárgljúfur í Vatnajökulsþjóðgarði norðan Dettifoss';
    expect(labelWidth(long)).toBe(MAP_LAYOUT.labelMaxWidth);
    expect(labelText('Gullfoss')).toBe('Gullfoss');
    const cut = labelText(long);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidthEms(cut) * 11).toBeLessThanOrEqual(MAP_LAYOUT.labelMaxWidth - 4);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it('sets a venue’s name on one line, or two past 128 points', () => {
    expect(venueTitleSize('Laugar')).toEqual({ width: Math.ceil(textWidthEms('Laugar') * 11.5) + 4, height: 14 });
    expect(venueTitleSize('Sundlaug Kópavogs og Salalaug í Kópavogi')).toEqual({ width: 128, height: 28 });
  });

  it('reads wide letters wider than narrow ones', () => {
    expect(textWidthEms('mmm')).toBeGreaterThan(textWidthEms('iii'));
    expect(textWidthEms('MÆ')).toBeGreaterThan(textWidthEms('ab'));
  });
});
