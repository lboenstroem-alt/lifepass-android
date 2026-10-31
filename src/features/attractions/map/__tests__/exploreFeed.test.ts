/**
 * Explore's reads of the sights (../exploreFeed.ts, the part of iOS
 * MapViewModel the map and the search group share): whether a read is out,
 * however many joined it, and which successful reads a map counts as its own.
 */
import type { AttractionMarkerPage } from '../../../../api/attractions';
import { loadAttractionMarkers, resetAttractionMarkers, type MarkersLoadResult } from '../../markersStore';
import { exploreSightsFeed, loadExploreMarkers, readMark, readSince, resetExploreSightsFeed } from '../exploreFeed';

jest.mock('../../markersStore', () => {
  const actual = jest.requireActual<typeof import('../../markersStore')>('../../markersStore');
  return { ...actual, loadAttractionMarkers: jest.fn() };
});

const loadMarkers = jest.mocked(loadAttractionMarkers);
const PAGE: AttractionMarkerPage = { attractions: [], attribution: null };
const OK: MarkersLoadResult = { ok: true, page: PAGE };
const FAILED: MarkersLoadResult = { ok: false, error: new Error('503') };

/** A read the test answers by hand. */
function pending() {
  let answer: (result: MarkersLoadResult) => void = () => undefined;
  loadMarkers.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  return (result: MarkersLoadResult) => answer(result);
}

beforeEach(() => {
  resetAttractionMarkers();
  resetExploreSightsFeed();
  loadMarkers.mockReset();
});

it('is loading while any Explore read is out, until the last one answers', async () => {
  const first = pending();
  const second = pending();
  const a = loadExploreMarkers('en');
  const b = loadExploreMarkers('en');
  expect(exploreSightsFeed.getState().loading).toBe(true);
  first(FAILED);
  await a;
  expect(exploreSightsFeed.getState().loading).toBe(true);
  second(OK);
  await b;
  expect(exploreSightsFeed.getState().loading).toBe(false);
});

it('counts a successful read after a mark, in its language only; a failure counts for nothing', async () => {
  const mark = readMark();
  loadMarkers.mockResolvedValueOnce(FAILED);
  await loadExploreMarkers('en');
  expect(readSince(mark, 'en')).toBe(false);
  loadMarkers.mockResolvedValueOnce(OK);
  await loadExploreMarkers('en');
  expect(readSince(mark, 'en')).toBe(true);
  expect(readSince(mark, 'is')).toBe(false);
  // A mark taken after it: that read is history.
  expect(readSince(readMark(), 'en')).toBe(false);
});

it('a reset forgets the counts, and a read from before it changes nothing after', async () => {
  const answer = pending();
  const read = loadExploreMarkers('en');
  resetExploreSightsFeed();
  expect(exploreSightsFeed.getState().loading).toBe(false);
  const mark = readMark();
  answer(OK);
  await read;
  expect(readSince(mark, 'en')).toBe(false);
  expect(exploreSightsFeed.getState().loading).toBe(false);
});
