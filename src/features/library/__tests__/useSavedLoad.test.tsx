/**
 * What a Saved surface loads (iOS FavouritesViewModel.load): favourites and
 * venues side by side, a favourites failure that changes nothing, a venues
 * failure that empties the suggestions.
 */
import { act, renderHook } from '@testing-library/react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { favouritesStore } from '../../favourites';
import { useSavedLoad } from '../saved/useSavedLoad';

import { favouriteJSON, venueJSON } from './fixtures';

stubApiClientPerTest();

const SAVED = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000001';

const venuesPage = (rows: unknown[]) => Reply.ok({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } });

beforeEach(() => favouritesStore.getState().reset());

it('reads both, the saved lists from the store and the venues in the server order', async () => {
  api.on('GET', '/favourites', Reply.ok({ venues: [favouriteJSON(SAVED)], activities: [] }));
  api.on('GET', '/venues', venuesPage([venueJSON(OTHER)]));
  const { result } = await renderHook(() => useSavedLoad());
  await act(async () => result.current.load());
  expect(result.current.isLoading).toBe(false);
  expect(result.current.venues.map((v) => v.venueId)).toEqual([SAVED]);
  expect(result.current.allVenues.map((v) => v.id)).toEqual([OTHER]);
  expect(api.sent('/venues').query).toEqual({ limit: '100' });
});

it('a favourites read that fails keeps the lists and the suggestions as they were', async () => {
  api.on('GET', '/favourites', Reply.ok({ venues: [favouriteJSON(SAVED)], activities: [] }));
  api.on('GET', '/venues', venuesPage([venueJSON(OTHER)]));
  const { result } = await renderHook(() => useSavedLoad());
  await act(async () => result.current.load());

  api.on('GET', '/favourites', Reply.problem(500, 'internal_error'));
  api.on('GET', '/venues', venuesPage([]));
  await act(async () => result.current.load());
  expect(result.current.venues).toHaveLength(1);
  expect(result.current.allVenues).toHaveLength(1);
  expect(result.current.isLoading).toBe(false);
});

it('a venues read that fails empties the suggestions (try? ?? [])', async () => {
  api.on('GET', '/favourites', Reply.ok({ venues: [], activities: [] }));
  api.on('GET', '/venues', venuesPage([venueJSON(OTHER)]));
  const { result } = await renderHook(() => useSavedLoad());
  await act(async () => result.current.load());
  expect(result.current.allVenues).toHaveLength(1);

  api.on('GET', '/venues', Reply.problem(500, 'internal_error'));
  await act(async () => result.current.load());
  expect(result.current.allVenues).toEqual([]);
});
