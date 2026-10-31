/**
 * The map fixture's sights (../mapPinsFixture.ts, iOS
 * `MapPinsScreenshotFixtures.attractions` and `.trails`): the port of
 * VenueMarkerTypeTests.testTheMapFixtureSeedsItsSights, and the Explore map
 * and its reads standing them in for the feed without a request.
 */
import { act, renderHook } from '@testing-library/react-native';
import { api } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { isHike, sightDisplayName } from '../../model';
import { resetSightsFeeds } from '../index';
import { loadExploreMarkers } from '../exploreFeed';
import { mapPinsFixture, mapPinsSights } from '../mapPinsFixture';
import { useSightsMap } from '../useSightsMap';

// The barrel's controls bring the UI kit's fonts.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest({ token: null });

/** Central Reykjavík, where the fixture's two sights are. */
const REYKJAVIK = { center: { latitude: 64.135, longitude: -21.94 }, latitudeDelta: 0.08, longitudeDelta: 0.2 };

const original = process.env.EXPO_PUBLIC_FIXTURE;

beforeEach(() => {
  resetSightsFeeds();
  setCurrentLanguage('en');
});

afterEach(() => {
  if (original === undefined) delete process.env.EXPO_PUBLIC_FIXTURE;
  else process.env.EXPO_PUBLIC_FIXTURE = original;
});

it('seeds its sights: Tjörnin as a top pick and a sample trailhead, with the walk’s line (iOS testTheMapFixtureSeedsItsSights)', () => {
  const { page, trails } = mapPinsSights();
  const sights = page.attractions;
  expect(sights.map((item) => item.slug)).toEqual(['tjornin', 'sample-trail']);
  expect(sights[0].tier).toBe('top');
  expect(sightDisplayName(sights[0], 'en')).toBe('Tjörnin');
  expect(isHike(sights[sights.length - 1])).toBe(true);
  expect(trails.map((trail) => trail.slug)).toEqual(['sample-trail']);
  expect(trails[0].lines[0].length).toBeGreaterThanOrEqual(2);
});

it('is nothing outside a fixture run', () => {
  delete process.env.EXPO_PUBLIC_FIXTURE;
  expect(mapPinsFixture()).toBeNull();
  process.env.EXPO_PUBLIC_FIXTURE = 'mapPinned=sky-lagoon';
  expect(mapPinsFixture()).toBeNull();
});

describe('with mapPins', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_FIXTURE = 'mapPins';
  });

  it('the map draws the fixture’s rings and trail and asks the feed nothing', async () => {
    const view = await renderHook(() =>
      useSightsMap({ showSights: true, setShowSights: () => undefined, openingRegion: REYKJAVIK, mapSize: { width: 390, height: 700 } }),
    );
    await act(async () => undefined);
    const rings = view.result.current.layer.sights.features.filter((f) => f.properties.kind === 'ring').map((f) => f.id);
    expect(rings).toEqual(expect.arrayContaining(['tjornin', 'sample-trail']));
    expect(view.result.current.layer.trails.features.map((f) => f.id)).toEqual(['sample-trail']);
    expect(view.result.current.showsRetryNotice).toBe(false);
    expect(view.result.current.loading).toBe(false);
    expect(api.sentAll('/attractions')).toHaveLength(0);
    expect(api.sentAll('/attractions/trails')).toHaveLength(0);
  });

  it('Explore’s read (the search group’s) answers with the fixture, without a request', async () => {
    const result = await loadExploreMarkers('en');
    expect(result.ok && result.page.attractions.map((item) => item.slug)).toEqual(['tjornin', 'sample-trail']);
    expect(api.sentAll('/attractions')).toHaveLength(0);
  });
});
