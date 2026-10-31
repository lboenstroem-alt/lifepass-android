/**
 * The featured venue is picked in the same render that first has the venues
 * (iOS picks in the task that loads them), so no frame is ever drawn with a
 * stand-in hero: never the first venue in the list just because nothing is
 * picked yet, which can be one without a photo or a coming-soon one (the
 * 2.5.2 rule). Every render of the hero is recorded here.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { venuesStore } from '../../../stores/venuesStore';
import { freshHome, leaveHome, profileJSON, renderHome } from './homeHarness';
import { north, testVenue, venuePage } from './homeVenues';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/** The venue name of every hero Home has drawn. */
const mockHeroes: string[] = [];
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../HomeHeader', () => {
  const actual = jest.requireActual('../HomeHeader');
  const { createElement } = require('react');
  return {
    ...actual,
    HomeHero: (props: { venue: { name: string } }) => {
      mockHeroes.push(props.venue.name);
      return createElement(actual.HomeHero, props);
    },
  };
});
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();
jest.setTimeout(30_000);

beforeEach(() => {
  setTestFontScale(1);
  mockHeroes.length = 0;
});
afterEach(() => {
  restoreTestFontScale();
  leaveHome();
});

it('the first frame with venues already shows the picked hero, never a stand-in', async () => {
  // One venue the rule can feature (bookable, with a photo); the rest have no
  // photo or are coming soon.
  const catalog = [
    testVenue(1, 'Sundhöllin', { image: null }),
    testVenue(2, 'Vesturbæjarlaug', { image: null }),
    testVenue(3, 'Box800', { comingSoon: true }),
    testVenue(4, 'Laugardalslaug', { at: north(2_000) }),
    testVenue(5, 'Breiðholtslaug', { image: null }),
    testVenue(6, 'Klifurhúsið', { comingSoon: true }),
    testVenue(7, 'Árbæjarlaug', { image: null }),
  ];
  freshHome();
  api.on('GET', '/venues', Reply.ok(venuePage(catalog)));
  api.on('GET', '/bookings', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
  api.on('GET', '/profile', Reply.ok(profileJSON()));
  await renderHome();

  // What a hero left unpicked for a frame would have shown: the list's first.
  const first = venuesStore.getState().ordered()[0]?.name;
  expect(first).toBeDefined();
  expect(first).not.toBe('Laugardalslaug');

  expect(mockHeroes.length).toBeGreaterThan(0);
  expect(new Set(mockHeroes)).toEqual(new Set(['Laugardalslaug']));
});
