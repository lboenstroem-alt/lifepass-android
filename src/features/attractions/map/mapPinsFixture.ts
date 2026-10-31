/**
 * The sights half of the map fixture (`mapPins`, iOS `-LPScreenshotMapPins`,
 * src/dev/fixtures.ts): the port of iOS `MapPinsScreenshotFixtures
 * .attractions` and `.trails` (App/ScreenshotFixtures.swift).
 *
 * With the fixture on, the Explore map's sights and its search group read
 * these instead of the public feed, and ask nothing: Tjörnin as a top pick
 * and a sample walk's trailhead south of Vatnsmýri (clear of every venue pin
 * and of the open map a check taps), with the walk's line. Device checks over
 * adb then tap a known ring and see a known trail, whatever the feed holds
 * that day. Decoded through the feeds' own decoders, so the fixture can never
 * hold a sight the real feed could not.
 *
 * A development build only: `hasFixture` is always false in a release bundle.
 */
import { decodeMarkerPage, decodeTrailPage, type AttractionMarkerPage, type AttractionTrail } from '../../../api/attractions';
import { hasFixture } from '../../../dev/fixtures';

export interface MapPinsSights {
  readonly page: AttractionMarkerPage;
  readonly trails: readonly AttractionTrail[];
}

const ATTRACTIONS = {
  attractions: [
    {
      slug: 'tjornin',
      name: 'Tjörnin',
      kind: 'lake',
      region: 'capital',
      hasPage: true,
      tier: 'top',
      coordinates: { latitude: 64.144825, longitude: -21.94222 },
    },
    {
      slug: 'sample-trail',
      name: 'Sample Trail',
      kind: 'hike',
      region: 'capital',
      hasPage: true,
      tier: 'top',
      coordinates: { latitude: 64.1215, longitude: -21.936 },
    },
  ],
  attribution: null,
};

const TRAILS = {
  trails: [
    {
      slug: 'sample-trail',
      name: 'Sample Trail',
      lengthM: 1500,
      durationMinutes: 30,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-21.936, 64.1215],
          [-21.944, 64.123],
          [-21.952, 64.1255],
          [-21.958, 64.129],
        ],
      },
    },
  ],
  attribution: null,
};

/** The fixture's sights and trail, decoded (always, for tests of the data itself). */
export function mapPinsSights(): MapPinsSights {
  return { page: decodeMarkerPage(ATTRACTIONS), trails: decodeTrailPage(TRAILS).trails };
}

let cached: MapPinsSights | null = null;

/** The fixture's sights when this development build was started with `mapPins`, else null. */
export function mapPinsFixture(): MapPinsSights | null {
  if (!hasFixture('mapPins')) return null;
  cached ??= mapPinsSights();
  return cached;
}
