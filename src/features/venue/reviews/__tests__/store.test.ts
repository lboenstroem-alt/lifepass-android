/**
 * The shared reviews store: the venue page, the reviews page and the write
 * sheet read one copy per venue.
 */
import type { VenueReviewsPage } from '../api';
import type { VenueReview } from '../model';
import { createVenueReviewsStore } from '../store';

const V = 'aaaaaaaa-0000-4000-8000-000000000001';

const review = (id: string, rating = 5): VenueReview => ({
  id,
  venueId: V,
  rating,
  comment: 'Lovely',
  authorInitial: 'A',
  createdAt: new Date('2026-10-02T14:00:00Z'),
  reviewerProfileId: null,
});

const page = (...reviews: VenueReview[]): VenueReviewsPage => ({ reviews, ownReviewId: null, canWriteReview: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('reads a venue once for everyone who asks at the same time', async () => {
  const fetch = jest.fn(async () => page(review('r1')));
  const store = createVenueReviewsStore({ fetch });
  const [a, b] = await Promise.all([store.getState().load(V), store.getState().ensureLoaded(V.toUpperCase())]);
  expect(a).toBe(b);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(store.getState().byVenue[V]).toMatchObject({ status: 'loaded', loaded: true });
  // Already read: the reviews page opens on the venue page's rows.
  await store.getState().ensureLoaded(V);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('a reload after a post replaces the rows; the old ones stay on screen meanwhile', async () => {
  const second = deferred<VenueReviewsPage>();
  let calls = 0;
  const store = createVenueReviewsStore({
    fetch: () => {
      calls += 1;
      return calls === 1 ? Promise.resolve(page(review('r1'))) : second.promise;
    },
  });
  await store.getState().load(V);
  const reloading = store.getState().load(V, { force: true });
  expect(store.getState().byVenue[V]).toMatchObject({ status: 'loading', loaded: true });
  expect(store.getState().byVenue[V].reviews.map((r) => r.id)).toEqual(['r1']);
  second.resolve(page(review('r2'), review('r1')));
  await reloading;
  expect(store.getState().byVenue[V].reviews.map((r) => r.id)).toEqual(['r2', 'r1']);
});

it('a failed read rejects for the venue page and keeps the rows it had', async () => {
  let fail = false;
  const store = createVenueReviewsStore({
    fetch: async () => {
      if (fail) throw new Error('offline');
      return page(review('r1'));
    },
  });
  await store.getState().load(V);
  fail = true;
  await expect(store.getState().load(V, { force: true })).rejects.toThrow('offline');
  expect(store.getState().byVenue[V]).toMatchObject({ status: 'failed', loaded: true });
  expect(store.getState().byVenue[V].reviews).toHaveLength(1);
  expect(store.getState().byVenue[V].error).toEqual(expect.any(String));
});

it('only the latest read of a venue lands', async () => {
  const first = deferred<VenueReviewsPage>();
  const second = deferred<VenueReviewsPage>();
  const answers = [first.promise, second.promise];
  const store = createVenueReviewsStore({ fetch: () => answers.shift()! });
  const a = store.getState().load(V);
  const b = store.getState().load(V, { force: true });
  second.resolve(page(review('new')));
  await b;
  first.resolve(page(review('old')));
  await a;
  expect(store.getState().byVenue[V].reviews.map((r) => r.id)).toEqual(['new']);
});

it('sign-out forgets every venue and drops answers on their way', async () => {
  const late = deferred<VenueReviewsPage>();
  const store = createVenueReviewsStore({ fetch: () => late.promise });
  const loading = store.getState().load(V);
  store.getState().reset();
  late.resolve({ ...page(review('r1')), ownReviewId: 'r1' });
  await loading;
  expect(store.getState().byVenue).toEqual({});
});
