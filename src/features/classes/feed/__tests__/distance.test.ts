/**
 * Every class card shows how far away its venue is ("2.4 km") whenever the
 * phone knows where the member REALLY is: a fix, with location permission
 * granted. "Near me" stays a radius filter, centred on the fix or, without
 * one, on central Reykjavík; that fallback narrows the list but never prints
 * a number. The port of iOS ClassDistanceTests.
 */
import { api } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { formatDistance, translate } from '../../../../i18n';
import { REYKJAVIK_CENTRE, type Coordinate } from '../../../../lib/geo';
import { AKUREYRI, classItem, classJSON, FOREST, HRESS, NEARBY, NOWHERE, page, REYKJAVIK, type FixtureVenue } from '../../__tests__/feedFixtures';
import {
  createClassesFeed,
  selectDayGroups,
  selectNearMeOrigin,
  selectUsingLocationFallback,
} from '../classesFeedStore';
import { feedEntries, passesClientFilters, type FeedEntry } from '../clientFilters';

stubApiClientPerTest();

const tomorrow = (offsetMs = 0) => new Date(Date.now() + 86_400_000 + offsetMs);
const item = (venue: FixtureVenue, startsAt: Date = tomorrow()) => classItem({ name: 'Yoga', venue, startsAt, category: 'yoga' });
const feed = () => [item(HRESS), item(NEARBY), item(FOREST), item(NOWHERE)];

function entries(fix: Coordinate | null, nearMeOrigin: Coordinate | null, items = feed(), radiusKm = 5): FeedEntry[] {
  return feedEntries(items, new Date(), fix, nearMeOrigin, radiusKm);
}

function distances(list: FeedEntry[]): Record<string, number | null> {
  return Object.fromEntries(list.map((entry) => [entry.item.venue.name, entry.distanceKm]));
}

describe('the four combinations', () => {
  /** The owner's ask: a known location puts the km on EVERY class, with "Near me" off. */
  it('a fix shows the distance on every class, with Near me off', () => {
    const shown = distances(entries(REYKJAVIK, null));
    expect(Object.keys(shown)).toHaveLength(4);
    expect(Math.abs(shown.Hress! - 8.9)).toBeLessThan(0.3);
    expect(Math.abs(shown['Nearby Studio']! - 0.4)).toBeLessThan(0.1);
    expect(shown['Forest Lagoon']).toBeGreaterThan(200);
    expect(shown['Nowhere Gym']).toBeNull();
  });

  it('no fix shows no distance', () => {
    const list = entries(null, null);
    expect(list).toHaveLength(4);
    expect(list.every((entry) => entry.distanceKm === null)).toBe(true);
  });

  /** Location refused, "Near me" on: the radius still works around central Reykjavík, but no card claims a distance from it. */
  it('the Reykjavík fallback filters but never prints a distance', () => {
    const list = entries(null, REYKJAVIK, feed(), 1);
    expect(list.map((entry) => entry.item.venue.name)).toEqual(['Nearby Studio']);
    expect(list.every((entry) => entry.distanceKm === null)).toBe(true);
  });

  it('a fix with Near me filters around the member and shows the distance', () => {
    const list = entries(AKUREYRI, AKUREYRI, feed(), 10);
    expect(list.map((entry) => entry.item.venue.name)).toEqual(['Forest Lagoon']);
    expect(Math.abs(list[0]!.distanceKm! - 1.5)).toBeLessThan(0.2);
  });

  it('Near me still drops venues without coordinates and started classes', () => {
    const started = item(NEARBY, new Date(Date.now() - 60_000));
    const all = [...feed(), started];
    const list = entries(REYKJAVIK, REYKJAVIK, all, 10);
    expect(new Set(list.map((entry) => entry.item.venue.name))).toEqual(new Set(['Hress', 'Nearby Studio']));
    expect(list).toHaveLength(2);
    for (const each of all) {
      // One definition for the list and the look-ahead.
      expect(passesClientFilters(each, new Date(), REYKJAVIK, 10)).toBe(list.some((entry) => entry.item === each));
    }
  });
});

describe('through the feed', () => {
  const reply = (venues: FixtureVenue[]) =>
    api.on('GET', '/classes', page(venues.map((venue, index) => classJSON({ venue, startsAt: tomorrow(index * 3_600_000) }))));

  /** The feed reads the granted fix (never asks for one) and puts the km on every card with "Near me" off. */
  it('shows distances from a granted fix', async () => {
    reply([HRESS, NEARBY]);
    const store = createClassesFeed({ initialFix: REYKJAVIK });
    await store.getState().loadInitial();
    expect(store.getState().nearMeEnabled).toBe(false);
    const shown = selectDayGroups(store.getState()).flatMap((group) => group.entries);
    expect(shown).toHaveLength(2);
    expect(shown.every((entry) => entry.distanceKm !== null)).toBe(true);
    expect(selectUsingLocationFallback(store.getState())).toBe(false);
  });

  it('shows no distance without a fix', async () => {
    reply([HRESS]);
    const store = createClassesFeed({ initialFix: null });
    await store.getState().loadInitial();
    const shown = selectDayGroups(store.getState()).flatMap((group) => group.entries);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.distanceKm).toBeNull();
  });

  /**
   * One definition of "where the member is" for the whole screen: the cards'
   * distances, the "Near me" centre and the fallback note. With location
   * turned off while the app is open, the old fix stops counting for all
   * three at once.
   */
  it('Near me, the note and the cards follow one fix', async () => {
    reply([HRESS, NEARBY, FOREST]);
    const requestLocation = jest.fn();
    const store = createClassesFeed({ initialFix: AKUREYRI, requestLocation });
    await store.getState().loadInitial();
    expect(selectNearMeOrigin(store.getState())).toBeNull();

    store.getState().toggleNearMe();
    store.getState().setRadius(10);
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(selectNearMeOrigin(store.getState())).toEqual(AKUREYRI);
    expect(selectUsingLocationFallback(store.getState())).toBe(false);
    const around = selectDayGroups(store.getState()).flatMap((group) => group.entries);
    expect(around.map((entry) => entry.item.venue.name)).toEqual(['Forest Lagoon']);
    expect(around[0]!.distanceKm).not.toBeNull();

    // Location turned off in Settings while the app stays open.
    store.getState().setFix(null);
    expect(selectNearMeOrigin(store.getState())).toEqual(REYKJAVIK_CENTRE);
    expect(selectUsingLocationFallback(store.getState())).toBe(true);
    const fallback = selectDayGroups(store.getState()).flatMap((group) => group.entries);
    expect(new Set(fallback.map((entry) => entry.item.venue.name))).toEqual(new Set(['Hress', 'Nearby Studio']));
    expect(fallback.every((entry) => entry.distanceKm === null)).toBe(true);

    // Turning it off asks for nothing.
    store.getState().toggleNearMe();
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(selectUsingLocationFallback(store.getState())).toBe(false);
  });
});

describe('words', () => {
  it('the distance reads as on the web', () => {
    expect(formatDistance(0.35, 'en')).toBe('350 m');
    expect(formatDistance(2.44, 'en')).toBe('2.4 km');
    expect(formatDistance(9.96, 'en')).toBe('10.0 km');
    expect(formatDistance(12.4, 'en')).toBe('12 km');
  });

  it('Icelandic writes a decimal comma', () => {
    expect(formatDistance(2.44, 'is')).toBe('2,4 km');
    expect(formatDistance(0.35, 'is')).toBe('350 m');
    expect(formatDistance(12.4, 'is')).toBe('12 km');
  });

  it('a screen reader hears what the number on a card is, in both languages', () => {
    expect(translate('classes.distance_a11y', 'en')).toBe('{distance} away');
    expect(translate('classes.distance_a11y', 'is')).toBe('í {distance} fjarlægð');
  });

  /** The fallback note says what the radius measures from; it never promises distances from Reykjavík. */
  it('the fallback note no longer promises distances', () => {
    const en = translate('classes.location_fallback', 'en');
    const is = translate('classes.location_fallback', 'is');
    expect(en).toContain('Near me');
    expect(is).toContain('Nálægt mér');
    expect(en.toLowerCase()).not.toContain('distances');
    expect(is).not.toContain('fjarlægðir');
    for (const value of [en, is]) expect(value).not.toMatch(/[–—]/);
  });
});
