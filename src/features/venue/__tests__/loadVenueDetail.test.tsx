/**
 * Loading the venue page (iOS VenueDetailViewModel.load): the venue by slug,
 * then the walk-in preview (best effort) and the reviews side by side, the
 * analytics event, a first-build caller's id, and the hook that only lets the
 * latest load land, never shows one venue's data under another, and reads the
 * page again quietly when the member comes back.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage, translate } from '../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../lib/analytics';
import { resetVenuesStore } from '../../../stores/venuesStore';
import { decodeVenueReviews, loadVenueReviews } from '../reviewsSource';
import { isCountedView, loadVenueDetail, useVenueDetail, type VenueTarget } from '../useVenueDetail';
import { previewJson, REVIEW_A, REVIEW_B, reviewsJson, VENUE_ID, VENUE_SLUG, venueJson } from './fixtures';

stubApiClientPerTest();

const events: [string, AnalyticsParams][] = [];
beforeEach(() => {
  events.length = 0;
  setAnalyticsObserver((event, params) => events.push([event, params]));
  resetVenuesStore();
});
afterEach(() => setAnalyticsObserver(null));

function serveVenue(overrides: Record<string, unknown> = {}) {
  api.on('GET', '/venues/by-slug/:slug', (request) =>
    request.params.slug === VENUE_SLUG ? Reply.ok(venueJson(overrides)) : Reply.problem(404, 'not-found'),
  );
}

function servePreview(slotActivities = previewJson().slotActivities as object[]) {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJson(slotActivities as never)));
}

function serveReviews(rows: object[] = [REVIEW_A, REVIEW_B]) {
  api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.ok(reviewsJson(rows)));
}

describe('loadVenueDetail', () => {
  it('reads the venue by slug, then the preview and the reviews by its id', async () => {
    serveVenue();
    servePreview();
    serveReviews();
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    if (result.kind !== 'loaded') throw new Error('expected a loaded page');
    expect(result.venue.name).toBe('Hress Reykjavík');
    expect(result.slotActivities.map((a) => a.name)).toEqual(['Hot Yoga', 'Spinning']);
    expect(result.reviews?.map((r) => r.rating)).toEqual([5, 4]);
    expect(result.error).toBeNull();
    expect(api.sent('/check-ins/walk-in/preview').query).toEqual({ venueId: VENUE_ID });
    expect(api.sent(`/venues/${VENUE_ID}/reviews`).method).toBe('GET');
  });

  it('a whole load counts as a view, and records nothing by itself (the hook tracks a load that lands)', async () => {
    serveVenue();
    servePreview();
    serveReviews();
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    expect(isCountedView(result)).toBe(true);
    expect(events).toEqual([]);
  });

  it('lists only slot-bookable classes (Kling and an unknown provider are dropped)', async () => {
    serveVenue();
    servePreview([
      { id: '0f1e2d3c-4b5a-4968-8776-655443322110', name: 'Hot Yoga', provider: 'abler' },
      { id: '2f1e2d3c-4b5a-4968-8776-655443322112', name: 'Lagoon entry', provider: 'kling' },
      { id: '3f1e2d3c-4b5a-4968-8776-655443322113', name: 'Mystery', provider: 'teleport' },
    ]);
    serveReviews();
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    expect(result.kind === 'loaded' && result.slotActivities.map((a) => a.name)).toEqual(['Hot Yoga']);
  });

  it('a failed preview keeps the page, with no class list and no alert', async () => {
    serveVenue();
    api.on('GET', '/check-ins/walk-in/preview', Reply.problem(500, 'internal_error'));
    serveReviews();
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    if (result.kind !== 'loaded') throw new Error('expected a loaded page');
    expect(result.walkInPreview).toBeNull();
    expect(result.slotActivities).toEqual([]);
    expect(result.error).toBeNull();
    expect(isCountedView(result)).toBe(true);
  });

  it('failed reviews keep the page and say why in the account language; no analytics, as on iOS', async () => {
    setCurrentLanguage('is');
    serveVenue();
    servePreview();
    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.raw(502, '<html>Bad gateway</html>'));
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    if (result.kind !== 'loaded') throw new Error('expected a loaded page');
    expect(result.venue.slug).toBe(VENUE_SLUG);
    expect(result.reviews).toBeNull();
    expect(result.error).toBe('Þjónninn svaraði á óvæntan hátt (HTTP 502).');
    expect(isCountedView(result)).toBe(false);
  });

  it('a venue that does not load is the failed state, with the reason in the account language', async () => {
    setCurrentLanguage('is');
    api.on('GET', '/venues/by-slug/:slug', Reply.raw(502, '<html>Bad gateway</html>'));
    const result = await loadVenueDetail({ slug: VENUE_SLUG });
    expect(result).toEqual({ kind: 'failed', error: 'Þjónninn svaraði á óvæntan hátt (HTTP 502).' });
    expect(api.requests.filter((r) => r.path.startsWith('/check-ins'))).toEqual([]);
  });

  it("a first-build caller's id is looked up in the catalogue, then loaded by slug", async () => {
    api.on('GET', '/venues', Reply.ok({ data: [venueJson()], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    serveVenue();
    servePreview();
    serveReviews();
    const result = await loadVenueDetail({ venueId: VENUE_ID.toUpperCase() });
    expect(result.kind === 'loaded' && result.venue.id).toBe(VENUE_ID);
    expect(api.sent(`/venues/by-slug/${VENUE_SLUG}`).method).toBe('GET');
  });

  it('an id no venue has: "Could not load venue details."', async () => {
    api.on('GET', '/venues', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    expect(await loadVenueDetail({ venueId: VENUE_ID })).toEqual({
      kind: 'failed',
      error: translate('venue.could_not_load', 'en'),
    });
  });
});

describe('the reviews read', () => {
  it('reads the rows as iOS does (the summary is not used), with the kind and sub-stars of API 0.46.0', () => {
    const [review, quick] = decodeVenueReviews(
      reviewsJson([
        { ...REVIEW_A, comment: undefined },
        { ...REVIEW_A, kind: 'quick', equipmentRating: 4, cleanlinessRating: 9 },
      ]),
    );
    expect(review).toEqual({
      id: REVIEW_A.id,
      venueId: VENUE_ID,
      rating: 5,
      comment: null,
      authorInitial: 'A',
      createdAt: new Date('2026-10-02T09:30:00.000Z'),
      kind: 'written',
      equipmentRating: null,
      cleanlinessRating: null,
    });
    expect(quick).toMatchObject({ kind: 'quick', equipmentRating: 4, cleanlinessRating: null });
  });

  it('a row without its rating fails the read rather than inventing one', () => {
    expect(() => decodeVenueReviews(reviewsJson([{ ...REVIEW_A, rating: '5' }]))).toThrow(/rating/);
    expect(() => decodeVenueReviews({ summary: {} })).toThrow(/rows/);
  });

  it('is keyed by the lower-case venue id', async () => {
    serveReviews();
    await loadVenueReviews(VENUE_ID.toUpperCase());
    expect(api.sent(`/venues/${VENUE_ID}/reviews`).path).toBe(`/venues/${VENUE_ID}/reviews`);
  });
});

describe('useVenueDetail', () => {
  it('starts loading, then holds the page', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(50, Reply.ok(venueJson())));
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.venue?.slug).toBe(VENUE_SLUG);
    expect(result.current.slotActivities).toHaveLength(2);
    expect(result.current.reviews).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('a retry after a failure loads the page', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.fail());
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.venue).toBeNull();
    expect(result.current.error).not.toBeNull();

    serveVenue();
    servePreview();
    serveReviews();
    await act(async () => result.current.load());
    await waitFor(() => expect(result.current.venue).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it('keeps the reviews it had when a later read fails, and the alert can be dismissed', async () => {
    serveVenue();
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.reviews).toHaveLength(2));

    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.problem(500, 'internal_error'));
    await act(async () => result.current.reloadReviews());
    expect(result.current.reviews).toHaveLength(2);

    serveReviews([REVIEW_A]);
    await act(async () => result.current.reloadReviews());
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));
  });

  it('an answer for an older load never lands', async () => {
    let calls = 0;
    api.on('GET', '/venues/by-slug/:slug', () => {
      calls += 1;
      return calls === 1
        ? Reply.delayed(200, Reply.ok(venueJson({ name: 'Stale' })))
        : Reply.ok(venueJson({ name: 'Fresh' }));
    });
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await act(async () => result.current.load());
    await waitFor(() => expect(result.current.venue?.name).toBe('Fresh'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(result.current.venue?.name).toBe('Fresh');
  });

  it('a failed reviews read after the venue loaded is the alert, not the failed state', async () => {
    serveVenue();
    servePreview();
    api.on('GET', `/venues/${VENUE_ID}/reviews`, Reply.problem(500, 'internal_error'));
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.venue).not.toBeNull();
    expect(result.current.error).not.toBeNull();
    await act(async () => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('tracks venue_detail_viewed with the id and name once the load lands', async () => {
    serveVenue();
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(events).toEqual([['venue_detail_viewed', { venue_id: VENUE_ID, venue_name: 'Hress Reykjavík' }]]);
  });

  it('a page closed before its answer records no view and stops its reads', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(100, Reply.ok(venueJson())));
    servePreview();
    serveReviews();
    const { unmount } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(1));
    await act(async () => unmount());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(events).toEqual([]);
    expect(api.requests.filter((r) => r.path.startsWith('/check-ins'))).toEqual([]);
  });
});

describe('useVenueDetail with another venue in the same screen', () => {
  const OTHER_ID = '7b2e1d5f-3c8a-4a2f-8d4b-8e6f9a0b1c2d';
  const OTHER_SLUG = 'sundholl';

  async function renderOnFirstVenue() {
    serveVenue();
    servePreview();
    serveReviews();
    const hook = await renderHook(({ target }: { target: VenueTarget }) => useVenueDetail(target), {
      initialProps: { target: { slug: VENUE_SLUG } },
    });
    await waitFor(() => expect(hook.result.current.reviews).toHaveLength(2));
    return hook;
  }

  it('a venue that does not load is the failed state, never the previous venue', async () => {
    const { result, rerender } = await renderOnFirstVenue();
    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(50, Reply.problem(404, 'not-found')));
    await rerender({ target: { slug: OTHER_SLUG } });
    // At once: nothing of the first venue, only the spinner.
    expect(result.current.venue).toBeNull();
    expect(result.current.reviews).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.venue).toBeNull();
    expect(result.current.reviews).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it("a venue whose reviews fail shows none of the previous venue's reviews", async () => {
    const { result, rerender } = await renderOnFirstVenue();
    api.on('GET', '/venues/by-slug/:slug', Reply.ok(venueJson({ id: OTHER_ID, slug: OTHER_SLUG, name: 'Sundhöll' })));
    api.on('GET', `/venues/${OTHER_ID}/reviews`, Reply.problem(500, 'internal_error'));
    await rerender({ target: { slug: OTHER_SLUG } });
    await waitFor(() => expect(result.current.venue?.name).toBe('Sundhöll'));
    expect(result.current.reviews).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });
});

describe('useVenueDetail coming back to the page', () => {
  it('refresh reads the page again without the spinner and takes the new prices', async () => {
    serveVenue({ inBundle: false, surchargePrice: 1990 });
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.venue?.surchargePrice).toBe(1990));
    events.length = 0;

    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(50, Reply.ok(venueJson({ inBundle: true }))));
    await act(async () => result.current.refresh());
    // The page stays on screen while it reads.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.venue?.surchargePrice).toBe(1990);
    await waitFor(() => expect(result.current.venue?.inBundle).toBe(true));
    expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(2);
    // iOS's `.task` tracks each visit.
    expect(events).toHaveLength(1);
  });

  it('a failed re-read keeps the page and says why ("Heads up")', async () => {
    serveVenue();
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.venue).not.toBeNull());

    api.on('GET', '/venues/by-slug/:slug', Reply.problem(500, 'internal_error'));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.venue?.slug).toBe(VENUE_SLUG);
    expect(result.current.reviews).toHaveLength(2);
  });

  it('does nothing while a load is still on its way', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(100, Reply.ok(venueJson())));
    servePreview();
    serveReviews();
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.sentAll(`/venues/by-slug/${VENUE_SLUG}`)).toHaveLength(1);
  });

  it('with no page yet (a failed first read), it loads with the spinner', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.fail());
    const { result } = await renderHook(() => useVenueDetail({ slug: VENUE_SLUG }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    api.on('GET', '/venues/by-slug/:slug', Reply.delayed(50, Reply.ok(venueJson())));
    servePreview();
    serveReviews();
    await act(async () => result.current.refresh());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.venue).not.toBeNull());
  });
});
