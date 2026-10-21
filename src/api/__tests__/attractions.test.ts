/**
 * The sights on the wire (iOS Models/Attraction.swift, AttractionTrail.swift
 * and AttractionService.swift): the tolerant decoders, the asset and link
 * rules, and the three reads against the contract.
 */
import { api, Reply } from '@test/server';

import {
  apiOrigin,
  decodeAttractionDetail,
  decodeAttractionMarker,
  decodeAttractionNearby,
  decodeMarkerPage,
  decodeTrailGeometry,
  decodeTrailPage,
  fetchAttractionDetail,
  fetchAttractionMarkers,
  fetchAttractionTrails,
  foldSightName,
  httpsLink,
  parseAttractionDrive,
  parseRoadAccess,
  resolveAttractionAsset,
  simplifyLine,
  trailBoundsOf,
  type AttractionDetail,
} from '../attractions';
import { DecodingError } from '../errors';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';

const marker = {
  slug: 'seljalandsfoss',
  name: 'Seljalandsfoss',
  kind: 'waterfall',
  region: 'south',
  coordinates: { latitude: 63.615452, longitude: -19.988276 },
  hasPage: true,
  tier: 'top',
  rankScore: 93.9,
};

const detail = {
  slug: 'seljalandsfoss',
  name: 'Seljalandsfoss',
  kind: 'waterfall',
  region: 'south',
  coordinates: { latitude: 63.615452, longitude: -19.988276 },
};

function card(extra: Record<string, unknown> = {}): AttractionDetail {
  return decodeAttractionDetail({ ...detail, ...extra });
}

// MARK: - Markers

describe('markers', () => {
  it('reads a full row and folds both names once', () => {
    const m = decodeAttractionMarker({ ...marker, slug: 'thingvellir', name: 'Þingvellir', nameEn: ' Thingvellir National Park ' });
    expect(m).toEqual({
      slug: 'thingvellir',
      name: 'Þingvellir',
      nameEn: 'Thingvellir National Park',
      kind: 'waterfall',
      region: 'south',
      latitude: 63.615452,
      longitude: -19.988276,
      hasPage: true,
      tier: 'top',
      rankScore: 93.9,
      searchKeys: ['thingvellir', 'thingvellirnationalpark'],
    });
  });

  it('a blank English name is none, and one name equal to the other is folded once', () => {
    expect(decodeAttractionMarker({ ...marker, nameEn: '   ' }).nameEn).toBeNull();
    expect(decodeAttractionMarker({ ...marker, nameEn: 7 }).nameEn).toBeNull();
    expect(decodeAttractionMarker({ ...marker, nameEn: 'SELJALANDSFOSS' }).searchKeys).toEqual(['seljalandsfoss']);
  });

  it('a missing or unknown tier reads as notable, never top or standard', () => {
    const { tier: _tier, ...noTier } = marker;
    expect(decodeAttractionMarker(noTier).tier).toBe('notable');
    expect(decodeAttractionMarker({ ...marker, tier: 'gold' }).tier).toBe('notable');
    expect(decodeAttractionMarker({ ...marker, tier: 3 }).tier).toBe('notable');
    expect(decodeAttractionMarker({ ...marker, tier: 'standard' }).tier).toBe('standard');
  });

  it('a non-finite or malformed score is none, and costs the sight nothing else', () => {
    expect(decodeAttractionMarker({ ...marker, rankScore: Infinity }).rankScore).toBeNull();
    expect(decodeAttractionMarker({ ...marker, rankScore: '93' }).rankScore).toBeNull();
    expect(decodeAttractionMarker({ ...marker, rankScore: null }).slug).toBe('seljalandsfoss');
  });

  it('hasPage defaults to false; the required fields are required', () => {
    const { hasPage: _hasPage, ...noPage } = marker;
    expect(decodeAttractionMarker(noPage).hasPage).toBe(false);
    expect(() => decodeAttractionMarker({ ...marker, slug: 1 })).toThrow();
    expect(() => decodeAttractionMarker({ ...marker, coordinates: null })).toThrow();
    expect(() => decodeAttractionMarker({ ...marker, coordinates: { latitude: '1', longitude: 2 } })).toThrow();
  });

  it('the feed decodes all or nothing, as iOS reads [AttractionMarker]', () => {
    const page = decodeMarkerPage({ attractions: [marker], attribution: 'ODbL', locale: 'en' });
    expect(page.attractions).toHaveLength(1);
    expect(page.attribution).toBe('ODbL');
    expect(() => decodeMarkerPage({ attractions: [marker, { slug: 'x' }] })).toThrow();
  });
});

// MARK: - Folding

describe('folding (AttractionSearch.fold)', () => {
  it('spells out þ, ð and æ, drops accents and everything but letters and digits', () => {
    expect(foldSightName('Þingvellir')).toBe('thingvellir');
    expect(foldSightName('Öxarárfoss')).toBe('oxararfoss');
    expect(foldSightName('Æðahellir')).toBe('aedahellir');
    expect(foldSightName('seljalands foss')).toBe(foldSightName('Seljalandsfoss'));
    expect(foldSightName('Dyrhólaey (arch)')).toBe('dyrholaeyarch');
    expect(foldSightName('Route 1')).toBe('route1');
  });
});

// MARK: - Trails

describe('trails', () => {
  const line = { type: 'LineString', coordinates: [[-21.1, 64.1], [-21.0, 64.2], [-20.9, 64.25]] };

  it('swaps [lon, lat] into coordinates and boxes the trail once', () => {
    const page = decodeTrailPage({
      trails: [{ slug: 'glymur', name: 'Glymur', geometry: line, lengthM: 7100.4, durationMinutes: 180.6, difficulty: 'moderate' }],
      attribution: 'ODbL',
    });
    expect(page.attribution).toBe('ODbL');
    const [trail] = page.trails;
    expect(trail.lines[0][0]).toEqual({ latitude: 64.1, longitude: -21.1 });
    expect(trail.bounds).toEqual({ south: 64.1, west: -21.1, north: 64.25, east: -20.9 });
    expect(trail.lengthM).toBe(7100);
    expect(trail.durationMinutes).toBe(181);
    expect(trail.difficulty).toBe('moderate');
  });

  it('one broken trail is dropped and the rest are kept', () => {
    const page = decodeTrailPage({
      trails: [
        { slug: 'a', geometry: line },
        { slug: 'b', geometry: { type: 'LineString', coordinates: [[-21, 'x']] } },
        { slug: 'c' },
        { slug: 'd', geometry: { type: 'Point', coordinates: [-21, 64] } },
        { slug: 'e', geometry: { type: 'LineString', coordinates: [[-21, 64]] } },
        { slug: 'f', name: 5, geometry: line },
        { slug: 'g', geometry: line, lengthM: 'long', difficulty: 3 },
      ],
    });
    expect(page.trails.map((trail) => trail.slug)).toEqual(['a', 'g']);
    expect(page.trails[0].name).toBe('a');
    expect(page.trails[1].lengthM).toBeNull();
    expect(page.trails[1].difficulty).toBeNull();
    expect(page.attribution).toBeNull();
  });

  it('drops positions out of range and runs with fewer than two points', () => {
    const lines = decodeTrailGeometry({
      type: 'MultiLineString',
      coordinates: [
        [[-21, 64], [200, 64], [-21, 95], [-20.5, 64.5, 120]],
        [[-21, 64]],
        [],
      ],
    });
    expect(lines).toEqual([[{ latitude: 64, longitude: -21 }, { latitude: 64.5, longitude: -20.5 }]]);
  });

  it('a page without a trails list is an empty page', () => {
    expect(decodeTrailPage({}).trails).toEqual([]);
  });

  it('simplifies with the longitude scaled to the latitude (TrailGeometry.simplify)', () => {
    // A wiggle of 0.00006° of longitude at 65°N is about 0.000025° on the
    // equirectangular projection: under the 0.00004 tolerance, so dropped.
    const east = simplifyLine([
      { latitude: 65, longitude: -20 },
      { latitude: 65.001, longitude: -19.99994 },
      { latitude: 65.002, longitude: -20 },
    ]);
    expect(east).toHaveLength(2);
    // The same wiggle in latitude is kept.
    const north = simplifyLine([
      { latitude: 65, longitude: -20 },
      { latitude: 65.00006, longitude: -19.999 },
      { latitude: 65, longitude: -19.998 },
    ]);
    expect(north).toHaveLength(3);
    // A closed loop measures to its point, and keeps its far side.
    const loop = simplifyLine([
      { latitude: 65, longitude: -20 },
      { latitude: 65.01, longitude: -20 },
      { latitude: 65, longitude: -20 },
    ]);
    expect(loop).toHaveLength(3);
  });

  it('boxes nothing as null', () => {
    expect(trailBoundsOf([])).toBeNull();
    expect(trailBoundsOf([[]])).toBeNull();
  });
});

// MARK: - The card

describe('the card', () => {
  it('reads the first release with its defaults', () => {
    const a = card();
    expect(a.localName).toBe('Seljalandsfoss');
    expect(a.kindLabel).toBe('waterfall');
    expect(a.regionLabel).toBe('south');
    expect(a.requiresFourWheelDrive).toBe(false);
    expect(a.images).toEqual([]);
    expect(a.sources).toEqual([]);
    expect(a.pairings).toEqual([]);
    expect(a.nearby).toEqual([]);
    expect(a.relatedTrails).toEqual([]);
    expect(a.routeLines).toEqual([]);
    expect(a.accessRule).toBe('');
    expect(a.tier).toBe('notable');
    expect(a.hasPage).toBe(false);
    expect(a.outAndBack).toBe(false);
    expect(a.forAttraction).toBeNull();
    expect(a.mapsLinks).toBeNull();
  });

  it('the first release is strict: a wrong type is a decoding error', () => {
    expect(() => card({ heightM: '65' })).toThrow();
    expect(() => card({ heightM: 65.5 })).toThrow();
    expect(() => card({ images: [{ src: 'x' }] })).toThrow();
    expect(() => card({ pairings: [{ venueSlug: 'x' }] })).toThrow();
    expect(() => card({ bathing: { level: 'safe' } })).toThrow();
  });

  describe('road access (the web’s ROAD_ACCESS contract)', () => {
    it('absent, with ferryOnly true, is the Landeyjahöfn ferry', () => {
      const a = card({ ferryOnly: true });
      expect(a.roadAccess).toBe('ferry');
      expect(a.ferryPort).toBe('Landeyjahöfn');
    });

    it('absent or null, with ferryOnly false or missing, is the road', () => {
      expect(card({ ferryOnly: false }).roadAccess).toBe('road');
      expect(card({ roadAccess: null }).roadAccess).toBe('road');
      expect(card().ferryPort).toBeNull();
    });

    it('an unknown value is unknown, never road', () => {
      expect(card({ roadAccess: 'hovercraft' }).roadAccess).toBeNull();
      expect(card({ roadAccess: 5, ferryPort: 'Dalvík' })).toMatchObject({ roadAccess: null, ferryPort: 'Dalvík' });
    });

    it('reads the measured values, the port trimmed', () => {
      expect(card({ roadAccess: 'offshore' }).roadAccess).toBe('offshore');
      expect(card({ roadAccess: 'ferry', ferryPort: ' Landeyjahöfn ' }).ferryPort).toBe('Landeyjahöfn');
      expect(card({ roadAccess: 'ferry', ferryPort: '  ' }).ferryPort).toBeNull();
      expect(card({ roadAccess: 'ferry' }).ferryPort).toBeNull();
    });
  });

  describe('the drive from Reykjavík', () => {
    it('reads a measured drive', () => {
      expect(card({ driveFromReykjavik: { minutes: 118, km: 128 } }).driveFromReykjavik).toEqual({ minutes: 118, km: 128 });
      expect(parseAttractionDrive({ minutes: 0.5, km: 0 })).toEqual({ minutes: 1, km: 0 });
    });

    it('is no drive when it rounds to no minutes or is not a number, and costs the card nothing', () => {
      expect(card({ driveFromReykjavik: { minutes: 0.4, km: 1 } }).driveFromReykjavik).toBeNull();
      expect(card({ driveFromReykjavik: { minutes: 'x', km: 1 } }).driveFromReykjavik).toBeNull();
      expect(card({ driveFromReykjavik: { minutes: 30, km: -1 } }).driveFromReykjavik).toBeNull();
      expect(card({ driveFromReykjavik: { minutes: Infinity, km: 1 } }).driveFromReykjavik).toBeNull();
      expect(card({ driveFromReykjavik: { minutes: 1e30, km: 1 } }).driveFromReykjavik).toBeNull();
      expect(card({ driveFromReykjavik: 'far' }).slug).toBe('seljalandsfoss');
    });
  });

  it('the nearest road accepts whole or fractional metres, at least 0', () => {
    expect(card({ nearestRoadM: 1500 }).nearestRoadM).toBe(1500);
    expect(card({ nearestRoadM: 1500.5 }).nearestRoadM).toBe(1501);
    expect(card({ nearestRoadM: -3 }).nearestRoadM).toBeNull();
    expect(card({ nearestRoadM: -3.5 }).nearestRoadM).toBeNull();
    expect(card({ nearestRoadM: '1500' }).nearestRoadM).toBeNull();
    expect(card({ nearestRoadM: 1e30 }).nearestRoadM).toBeNull();
  });

  it('a malformed walk link is dropped on its own (LossyList)', () => {
    const a = card({
      relatedTrails: [
        { slug: 'a', name: 'A', lengthM: 7100, durationMinutes: 180, outAndBack: true },
        { slug: 'b' },
        'c',
        { slug: 'd', name: 'D', nameEn: ' ', lengthM: 1200.6, durationMinutes: 'soon', outAndBack: 'yes' },
      ],
    });
    expect(a.relatedTrails).toEqual([
      { slug: 'a', name: 'A', nameEn: null, lengthM: 7100, durationMinutes: 180, outAndBack: true },
      { slug: 'd', name: 'D', nameEn: null, lengthM: 1201, durationMinutes: null, outAndBack: false },
    ]);
    expect(card({ relatedTrails: 'none' }).relatedTrails).toEqual([]);
  });

  it('a link with outAndBack absent reads as false', () => {
    expect(card({ forAttraction: { slug: 'glymur', name: 'Glymur' } }).forAttraction?.outAndBack).toBe(false);
    expect(card({ forAttraction: { slug: 1 } }).forAttraction).toBeNull();
  });

  it('a malformed neighbour costs the nearby list, never the card', () => {
    const near = { slug: 'gljufrabui', name: 'Gljúfrabúi', kind: 'waterfall', distanceM: 656 };
    expect(card({ nearby: [near] }).nearby).toHaveLength(1);
    expect(card({ nearby: [near, { slug: 'x' }] }).nearby).toEqual([]);
    expect(card({ nearby: 'close' }).nearby).toEqual([]);
  });

  it('a blank thumb credit or licence is missing', () => {
    const n = decodeAttractionNearby({
      slug: 'a',
      name: 'A',
      kind: 'waterfall',
      distanceM: 10,
      thumbCredit: '  ',
      thumbLicense: 5,
    });
    expect(n.thumbCredit).toBeNull();
    expect(n.thumbLicense).toBeNull();
    expect(decodeAttractionNearby({ slug: 'a', name: 'A', kind: 'k', distanceM: 1, thumbCredit: ' Pjt56 ' }).thumbCredit).toBe('Pjt56');
  });

  it('reads the route, the maps links and the rest of the newer fields lossily', () => {
    const a = card({
      routeGeojson: { type: 'LineString', coordinates: [[-21.1, 64.1], [-21.0, 64.2]] },
      mapsLinks: { google: 'https://www.google.com/maps/dir/?api=1&destination=63.6,-19.9', apple: null },
      hasPage: true,
      tier: 'top',
      rankScore: 93.9,
      outAndBack: true,
    });
    expect(a.routeLines).toHaveLength(1);
    expect(a.mapsLinks?.google).toContain('google.com');
    expect(a).toMatchObject({ hasPage: true, tier: 'top', rankScore: 93.9, outAndBack: true });
    expect(card({ routeGeojson: { type: 'LineString', coordinates: 'x' } }).routeLines).toEqual([]);
    expect(card({ mapsLinks: { google: 5 } }).mapsLinks).toBeNull();
    expect(card({ hasPage: 'yes', outAndBack: 1, ferryOnly: 'true' })).toMatchObject({
      hasPage: false,
      outAndBack: false,
      ferryOnly: false,
      roadAccess: 'road',
    });
  });
});

// MARK: - Links and assets

describe('links (AttractionLink.https)', () => {
  it('opens https with a host only', () => {
    expect(httpsLink('https://creativecommons.org/licenses/by-sa/3.0')).toBe('https://creativecommons.org/licenses/by-sa/3.0');
    expect(httpsLink(' https://example.org ')).toBe('https://example.org');
    for (const raw of ['http://example.org', 'tel:5551234', 'sms:5551234', 'javascript:alert(1)', 'https://', 'https:///path', 'https://user@:80/x', '', null, undefined]) {
      expect(httpsLink(raw)).toBeNull();
    }
  });

  it('encodes characters a URL cannot carry raw', () => {
    expect(httpsLink('https://is.wikipedia.org/wiki/Þingvellir')).toBe('https://is.wikipedia.org/wiki/%C3%9Eingvellir');
  });
});

describe('assets (AttractionAssetURL.resolve)', () => {
  it('reads a protocol-relative URL as https', () => {
    expect(resolveAttractionAsset('//upload.wikimedia.org/x.jpg')).toBe('https://upload.wikimedia.org/x.jpg');
  });

  it('resolves a root-relative plate against the API’s origin', () => {
    expect(resolveAttractionAsset('/api/v1/attractions/plate/x', 'https://www.lifepass.is/api/v1')).toBe(
      'https://www.lifepass.is/api/v1/attractions/plate/x',
    );
    expect(resolveAttractionAsset('/api/v1/attractions/plate/x', 'http://192.168.1.4:3000/api/v1')).toBe(
      'http://192.168.1.4:3000/api/v1/attractions/plate/x',
    );
    expect(apiOrigin('not a url')).toBe('https://www.lifepass.is');
  });

  it('loads web images only', () => {
    expect(resolveAttractionAsset('ftp://x/y.jpg')).toBeNull();
    expect(resolveAttractionAsset('data:image/png;base64,AAA')).toBeNull();
    expect(resolveAttractionAsset('  ')).toBeNull();
    expect(resolveAttractionAsset(null)).toBeNull();
  });

  it('percent-encodes a Commons file name with Icelandic letters', () => {
    expect(resolveAttractionAsset('https://upload.wikimedia.org/Æðahellir 1.jpg')).toBe(
      'https://upload.wikimedia.org/%C3%86%C3%B0ahellir%201.jpg',
    );
  });
});

describe('road access values', () => {
  it('knows road, ferry and offshore only', () => {
    expect(parseRoadAccess('road')).toBe('road');
    expect(parseRoadAccess('ferry')).toBe('ferry');
    expect(parseRoadAccess('offshore')).toBe('offshore');
    expect(parseRoadAccess('hovercraft')).toBeNull();
    expect(parseRoadAccess(null)).toBeNull();
  });
});

// MARK: - The reads

describe('the reads (auth optional)', () => {
  describe('signed in', () => {
    stubApiClientPerTest();

    it('GET /attractions sends the locale and the bearer', async () => {
      api.on('GET', '/attractions', Reply.ok({ attractions: [marker], locale: 'is', attribution: 'ODbL' }));
      const page = await fetchAttractionMarkers('is');
      expect(page.attractions[0].slug).toBe('seljalandsfoss');
      const sent = expectSentToMatchContract('GET', '/attractions');
      expect(sent.query).toEqual({ locale: 'is' });
      expect(sent.headers.authorization).toBe('Bearer test-token');
    });

    it('GET /attractions/by-slug/{slug} reads one card in the locale', async () => {
      api.on('GET', '/attractions/by-slug/:slug', (request) => Reply.ok({ ...detail, slug: request.params.slug }));
      const a = await fetchAttractionDetail('gljufrabui', 'en');
      expect(a.slug).toBe('gljufrabui');
      const sent = expectSentToMatchContract('GET', '/attractions/by-slug/gljufrabui');
      expect(sent.query).toEqual({ locale: 'en' });
    });

    it('GET /attractions/trails sends no locale', async () => {
      api.on('GET', '/attractions/trails', Reply.ok({ trails: [], attribution: 'ODbL' }));
      await fetchAttractionTrails();
      const sent = expectSentToMatchContract('GET', '/attractions/trails');
      expect(sent.query).toEqual({});
    });

    it('a feed the app cannot read is a decoding error', async () => {
      api.on('GET', '/attractions', Reply.ok({ attractions: 'none' }));
      await expect(fetchAttractionMarkers('en')).rejects.toBeInstanceOf(DecodingError);
    });
  });

  describe('signed out', () => {
    stubApiClientPerTest({ token: null });

    it('still reads, without a bearer', async () => {
      api.on('GET', '/attractions', Reply.ok({ attractions: [marker], attribution: 'ODbL' }));
      const page = await fetchAttractionMarkers('en');
      expect(page.attractions).toHaveLength(1);
      expect(api.sent('/attractions').headers.authorization).toBeUndefined();
    });
  });
});
