/** Sights for the attractions tests: markers in the shape the decoder gives, and wire JSON for the card. */
import type { AttractionMarker, AttractionTier } from '../../../api/attractions';
import { foldSightName } from '../../../api/attractions';

export function sight(
  slug: string,
  overrides: Partial<Omit<AttractionMarker, 'slug' | 'searchKeys'>> & { tier?: AttractionTier } = {},
): AttractionMarker {
  const name = overrides.name ?? slug;
  const nameEn = overrides.nameEn ?? null;
  const keys = [name, nameEn].filter((n): n is string => n !== null).map(foldSightName);
  return {
    slug,
    name,
    nameEn,
    kind: overrides.kind ?? 'waterfall',
    region: overrides.region ?? 'south',
    latitude: overrides.latitude ?? 64,
    longitude: overrides.longitude ?? -20,
    hasPage: overrides.hasPage ?? true,
    tier: overrides.tier ?? 'top',
    rankScore: overrides.rankScore === undefined ? 50 : overrides.rankScore,
    searchKeys: [...new Set(keys.filter(Boolean))],
  };
}

/** The marker on the wire. */
export function markerJson(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    name: slug,
    kind: 'waterfall',
    region: 'south',
    coordinates: { latitude: 63.6, longitude: -19.9 },
    hasPage: true,
    tier: 'top',
    rankScore: 50,
    ...overrides,
  };
}

/** Reykjavík, Akureyri and London, for origins. */
export const REYKJAVIK = { latitude: 64.1466, longitude: -21.9426 };
export const AKUREYRI = { latitude: 65.6835, longitude: -18.1105 };
export const LONDON = { latitude: 51.5072, longitude: -0.1276 };

/** A full card on the wire: Seljalandsfoss as production serves it, trimmed. */
export function detailJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'seljalandsfoss',
    name: 'Seljalandsfoss',
    localName: 'Seljalandsfoss',
    hasPage: true,
    tier: 'top',
    rankScore: 93.9,
    kind: 'waterfall',
    kindLabel: 'Waterfall',
    region: 'south',
    regionLabel: 'South Iceland',
    nearestTown: 'Hvolsvöllur',
    coordinates: { latitude: 63.615452, longitude: -19.988276 },
    driveFromReykjavik: { minutes: 118, km: 128 },
    roadAccess: 'road',
    nearestRoadM: null,
    ferryOnly: false,
    ferryPort: null,
    summary: 'A waterfall you can walk behind.',
    heightM: 65,
    outAndBack: false,
    requiresFourWheelDrive: false,
    bathing: null,
    images: [
      {
        src: 'https://upload.wikimedia.org/seljalandsfoss.jpg',
        altEn: 'Seljalandsfoss, Iceland',
        altIs: 'Seljalandsfoss, Ísland',
        credit: 'Zoran',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
      },
    ],
    nearby: [
      {
        slug: 'gljufrabui',
        name: 'Gljúfrabúi',
        nameEn: 'Gljufrafoss',
        kind: 'waterfall',
        distanceM: 656,
        thumb: 'https://www.lifepass.is/thumb/gljufrabui.jpg',
        thumbCredit: 'Pjt56',
        thumbLicense: 'CC BY-SA 4.0',
      },
      { slug: 'drifandi', name: 'Drífandi', kind: 'hike', distanceM: 1647, thumb: 'https://www.lifepass.is/thumb/d.jpg', thumbCredit: 'A' },
    ],
    forAttraction: null,
    relatedTrails: [],
    mapsLinks: {
      google: 'https://www.google.com/maps/dir/?api=1&destination=63.615452,-19.988276',
      apple: 'https://maps.apple.com/?daddr=63.615452%2C-19.988276',
    },
    sources: [
      {
        source: 'commons',
        sourceId: 'Seljalandsfoss.jpg',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Seljalandsfoss.jpg',
        license: 'CC BY-SA 3.0',
      },
      { source: 'osm', sourceId: 'node/1', sourceUrl: 'http://www.openstreetmap.org/node/1', license: 'ODbL' },
    ],
    pairings: [
      {
        venueSlug: 'laugaskard',
        venueName: 'Laugaskarð',
        city: 'Hveragerði',
        driveMinutes: 50,
        driveMetres: 60000,
        tier: 'after',
        inBundle: true,
      },
      {
        venueSlug: 'sky-lagoon',
        venueName: 'Sky Lagoon',
        city: 'Kópavogur',
        driveMinutes: 105,
        driveMetres: 120000,
        tier: 'on_the_way_back',
        corridor: 'reykjavik',
        inBundle: false,
        fromPriceIsk: 10100,
      },
    ],
    accessRule: 'Stay on marked paths. Driving off-road is illegal in Iceland.',
    attribution: 'Place data © OpenStreetMap contributors, ODbL 1.0.',
    ...overrides,
  };
}
