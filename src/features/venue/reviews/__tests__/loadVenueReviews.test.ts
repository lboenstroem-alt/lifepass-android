/**
 * `loadVenueReviews`: the venue page reads its reviews through the shared
 * store, so the reviews page opens on the same rows (iOS hands its sheet the
 * view model's array). It is a drop-in for a page-owned reader: same call,
 * rows with the same fields, and an aborted caller sees a cancellation.
 */
import { api, Reply } from '@test/server';

import { isCancellation } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { loadVenueReviews, resetVenueReviews, venueReviewsStore } from '../store';

stubApiClientPerTest();

const V = 'aaaaaaaa-0000-4000-8000-000000000001';

const wireRow = {
  id: '11111111-0000-4000-8000-000000000001',
  venueId: V,
  rating: 4,
  comment: 'Warm',
  createdAt: '2026-10-16T12:00:00Z',
  reviewer: { fullNameInitial: 'J' },
};

afterEach(() => resetVenueReviews());

it('fills the store the reviews page opens on, with the fields the page block draws', async () => {
  api.on('GET', '/venues/:venueId/reviews', Reply.ok({ rows: [wireRow], nextCursor: null }));
  const rows = await loadVenueReviews(V.toUpperCase());
  expect(rows).toEqual([
    expect.objectContaining({
      id: wireRow.id,
      venueId: V,
      rating: 4,
      comment: 'Warm',
      authorInitial: 'J',
      createdAt: new Date('2026-10-16T12:00:00Z'),
    }),
  ]);
  expect(venueReviewsStore.getState().byVenue[V]).toMatchObject({ loaded: true, reviews: rows });
});

it('a read on its way is joined: the page and the reviews page cost one GET', async () => {
  api.on('GET', '/venues/:venueId/reviews', Reply.delayed(10, Reply.ok({ rows: [wireRow], nextCursor: null })));
  await Promise.all([loadVenueReviews(V), venueReviewsStore.getState().ensureLoaded(V)]);
  expect(api.sentAll(`/venues/${V}/reviews`, 'GET')).toHaveLength(1);
});

it('an aborted caller stops waiting as a cancellation; the shared read still lands', async () => {
  api.on('GET', '/venues/:venueId/reviews', Reply.delayed(20, Reply.ok({ rows: [wireRow], nextCursor: null })));
  const controller = new AbortController();
  const waiting = loadVenueReviews(V, { signal: controller.signal });
  controller.abort();
  expect(isCancellation(await waiting.catch((e: unknown) => e))).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(venueReviewsStore.getState().byVenue[V]).toMatchObject({ loaded: true });
});

it('a signal already aborted sends nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(isCancellation(await loadVenueReviews(V, { signal: controller.signal }).catch((e: unknown) => e))).toBe(true);
  expect(api.requests).toHaveLength(0);
});

it('a failed read rejects with the API error, for the page to word', async () => {
  api.on('GET', '/venues/:venueId/reviews', Reply.problem(500, 'internal_error'));
  const error = await loadVenueReviews(V).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(isCancellation(error)).toBe(false);
  expect(venueReviewsStore.getState().byVenue[V]).toMatchObject({ status: 'failed', loaded: false });
});
