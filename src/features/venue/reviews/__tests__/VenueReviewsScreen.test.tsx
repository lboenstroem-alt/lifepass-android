/**
 * The reviews page (iOS ReviewsPageView), with Android's "Report review" (D5).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { DialogHost, dismissAllDialogs } from '../../../../components/ui/Dialog';
import { dismissToast, ToastHost } from '../../../../components/ui/Toast';
import { setCurrentLanguage } from '../../../../i18n';
import { useAppStore } from '../../../../stores/appStore';
import { resetVenueReviews, venueReviewsStore } from '../store';
import VenueReviewsScreen, { FRESH_FOR_MS, isOwnReview } from '../VenueReviewsScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const V = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME = 'cccccccc-0000-4000-8000-00000000000c';
const OTHER = 'dddddddd-0000-4000-8000-00000000000d';
const MINE = '11111111-0000-4000-8000-0000000000aa';
const THEIRS = '11111111-0000-4000-8000-0000000000bb';

const row = (id: string, rating: number, comment: string, profileId = OTHER) => ({
  id,
  venueId: V,
  rating,
  title: null,
  comment,
  visitDate: '2026-10-01',
  isVerifiedVisit: true,
  createdAt: '2026-10-16T12:00:00Z',
  updatedAt: '2026-10-16T12:00:00Z',
  reviewer: { profileId, fullNameInitial: 'J', fullName: null },
  images: [],
});

/** The server's summary of exactly these rows (every rating had text). */
function summaryOf(rows: readonly unknown[]) {
  const ratings = rows.map((r) => (r as { rating: number }).rating);
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of ratings) distribution[rating] += 1;
  return {
    averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
    totalReviews: ratings.length,
    totalRatings: ratings.length,
    equipmentRating: null,
    cleanlinessRating: null,
    distribution,
  };
}

/** `'omit'`: an older server's answer, with no summary at all. */
const answer = (rows: unknown[], ownReviewId: string | null = null, summary: object | 'omit' = summaryOf(rows)) =>
  Reply.ok({
    ...(summary === 'omit' ? {} : { summary }),
    rows,
    nextCursor: null,
    ownReviewId,
    canWriteReview: true,
  });

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
type Props = ComponentProps<typeof VenueReviewsScreen>;

async function renderPage() {
  const props = { navigation, route: { key: 'r', name: 'VenueReviews', params: { venueId: V, venueName: 'Laugar' } } };
  await render(
    <View>
      <VenueReviewsScreen {...(props as unknown as Props)} />
      <DialogHost />
      <ToastHost />
    </View>,
  );
  await act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
}

beforeEach(() => {
  setCurrentLanguage('en');
  useAppStore.setState({ userId: ME });
});

afterEach(async () => {
  await act(async () => {
    dismissAllDialogs();
    dismissToast();
  });
  resetVenueReviews();
  navigation.navigate.mockReset();
  navigation.goBack.mockReset();
  useAppStore.setState({ userId: null });
});

it('with no reviews: the write prompt, then the empty state with the venue name', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer([]));
  await renderPage();
  expect(screen.getByRole('header', { name: 'Reviews' })).toBeOnTheScreen();
  expect(screen.getByText('Share your experience at Laugar')).toBeOnTheScreen();
  expect(screen.getByText('No reviews yet')).toBeOnTheScreen();
  expect(screen.getByText('Share your experience to help other visitors discover Laugar.')).toBeOnTheScreen();
  expect(screen.queryByTestId('reviews-summary')).toBeNull();
});

const FOUR_ROWS = [
  row('11111111-0000-4000-8000-000000000001', 5, 'Superb'),
  row('11111111-0000-4000-8000-000000000002', 4, 'Good'),
  row('11111111-0000-4000-8000-000000000003', 5, 'Great'),
  row('11111111-0000-4000-8000-000000000004', 4, 'Fine'),
];

it("the summary is the server's, which counts every rating (API 0.46.0): average, half stars, count, bars, sub-scores", async () => {
  // Two rows with text, out of eight ratings: six quick ones carry no text.
  api.on(
    'GET',
    '/venues/:venueId/reviews',
    answer(FOUR_ROWS.slice(0, 2), null, {
      averageRating: 4.5,
      totalReviews: 2,
      totalRatings: 8,
      equipmentRating: { average: 4.67, count: 3 },
      cleanlinessRating: null,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 5 },
    }),
  );
  await renderPage();
  const summary = within(screen.getByTestId('reviews-summary'));
  // The big number is drawn for the eye; TalkBack hears it once, from the stars.
  expect(summary.getByText('4.5', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(summary.getByLabelText('Average rating 4.5 out of 5')).toBeOnTheScreen();
  expect(summary.getByTestId('reviews-summary-count')).toHaveTextContent('8 ratings', { exact: true });
  expect(summary.getByLabelText('Rated 5: 5')).toBeOnTheScreen();
  expect(summary.getByLabelText('Rated 1: 0')).toBeOnTheScreen();
  expect(screen.getByTestId('reviews-bar-fill-5')).toHaveStyle({ width: '62.5%' });
  // Equipment from 3 ratings up; no Cleanliness row without one.
  const equipment = summary.getByTestId('reviews-summary-subratings.equipment');
  expect(equipment.props.accessibilityLabel).toBe('Equipment, 4.7 out of 5 stars');
  expect(within(equipment).getByText('Equipment')).toBeOnTheScreen();
  expect(within(equipment).getByText('4.7')).toBeOnTheScreen();
  expect(summary.queryByTestId('reviews-summary-subratings.cleanliness')).toBeNull();
  // Every card, the whole comment.
  expect(screen.getByText('Good').props.numberOfLines).toBeUndefined();
});

it('in Icelandic: the decimal comma, "einkunnir", and the sub-scores in their own words', async () => {
  setCurrentLanguage('is');
  api.on(
    'GET',
    '/venues/:venueId/reviews',
    answer(FOUR_ROWS, null, {
      averageRating: 4.6,
      totalReviews: 4,
      totalRatings: 23,
      equipmentRating: { average: 4.5, count: 9 },
      cleanlinessRating: { average: 4.8, count: 12 },
      distribution: { 1: 0, 2: 1, 3: 1, 4: 5, 5: 16 },
    }),
  );
  await renderPage();
  const summary = within(screen.getByTestId('reviews-summary'));
  expect(summary.getByText('4,6', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(summary.getByTestId('reviews-summary-count')).toHaveTextContent('23 einkunnir', { exact: true });
  expect(summary.getByText('Tækjabúnaður')).toBeOnTheScreen();
  expect(summary.getByText('Hreinlæti')).toBeOnTheScreen();
  expect(summary.getByText('4,8')).toBeOnTheScreen();
  expect(summary.getByTestId('reviews-summary-subratings.cleanliness').props.accessibilityLabel).toBe(
    'Hreinlæti, 4,8 af 5 stjörnum',
  );
  expect(screen.getByRole('header', { name: 'Umsagnir' })).toBeOnTheScreen();
});

it('says "1 einkunn" for one rating', async () => {
  setCurrentLanguage('is');
  api.on('GET', '/venues/:venueId/reviews', answer([row('11111111-0000-4000-8000-000000000001', 3, 'Ok')]));
  await renderPage();
  expect(screen.getByTestId('reviews-summary-count')).toHaveTextContent('1 einkunn', { exact: true });
});

it('a venue rated only without text shows its summary, and no empty state', async () => {
  api.on(
    'GET',
    '/venues/:venueId/reviews',
    answer([], null, {
      averageRating: 4,
      totalReviews: 0,
      totalRatings: 2,
      equipmentRating: null,
      cleanlinessRating: null,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 },
    }),
  );
  await renderPage();
  expect(screen.getByTestId('reviews-summary-count')).toHaveTextContent('2 ratings', { exact: true });
  expect(screen.queryByText('No reviews yet')).toBeNull();
  expect(screen.queryByTestId('reviews-summary-subratings')).toBeNull();
});

it('an older server (no summary): the summary iOS computes from the loaded rows, "4 reviews"', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer(FOUR_ROWS, null, 'omit'));
  await renderPage();
  const summary = within(screen.getByTestId('reviews-summary'));
  expect(summary.getByText('4.5', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(summary.getByText('4 reviews')).toBeOnTheScreen();
  expect(summary.getByLabelText('Rated 5: 2')).toBeOnTheScreen();
  expect(screen.getByTestId('reviews-bar-fill-5')).toHaveStyle({ width: '50%' });
});

it('an older server says "1 review" for one', async () => {
  setCurrentLanguage('is');
  api.on('GET', '/venues/:venueId/reviews', answer([row('11111111-0000-4000-8000-000000000001', 3, 'Ok')], null, 'omit'));
  await renderPage();
  expect(screen.getByText('1 umsögn')).toBeOnTheScreen();
});

it('Done closes the page; the write prompt opens the write sheet', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer([]));
  await renderPage();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('reviews-write-prompt'));
  expect(navigation.navigate).toHaveBeenCalledWith('WriteReview', { venueId: V, venueName: 'Laugar' });
});

it('uses the venue page’s rows without reading them again', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 5, 'Shared')]));
  await act(async () => {
    await venueReviewsStore.getState().load(V);
  });
  await renderPage();
  expect(screen.getByText('Shared')).toBeOnTheScreen();
  expect(api.sentAll(`/venues/${V}/reviews`, 'GET')).toHaveLength(1);
});

/** Makes the shared rows look `ms` old (the venue page read them that long ago). */
function ageRows(ms: number) {
  const { byVenue } = venueReviewsStore.getState();
  venueReviewsStore.setState({ byVenue: { ...byVenue, [V]: { ...byVenue[V], readAt: Date.now() - ms } } });
}

it('rows older than the window open at once and are read again behind them', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 5, 'Earlier')]));
  await act(async () => {
    await venueReviewsStore.getState().load(V);
  });
  ageRows(FRESH_FOR_MS + 1);
  api.on('GET', '/venues/:venueId/reviews', Reply.delayed(20, answer([row(MINE, 4, 'Newer', ME), row(THEIRS, 5, 'Earlier')])));
  await renderPage();
  // No spinner: the old rows stay while the new read is on its way.
  expect(screen.getByText('Earlier')).toBeOnTheScreen();
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 40)));
  expect(screen.getByText('Newer')).toBeOnTheScreen();
  expect(api.sentAll(`/venues/${V}/reviews`, 'GET')).toHaveLength(2);
});

it('a failed refresh keeps the rows on screen, with no error state', async () => {
  api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 5, 'Kept')]));
  await act(async () => {
    await venueReviewsStore.getState().load(V);
  });
  ageRows(FRESH_FOR_MS + 1);
  api.on('GET', '/venues/:venueId/reviews', Reply.problem(500, 'internal_error'));
  await renderPage();
  await act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
  expect(screen.getByText('Kept')).toBeOnTheScreen();
  expect(screen.queryByTestId('venue-reviews-error')).toBeNull();
});

it('a failed read shows the error state, and Try again reads again', async () => {
  api.on('GET', '/venues/:venueId/reviews', Reply.problem(500, 'internal_error'));
  await renderPage();
  expect(screen.getByTestId('venue-reviews-error')).toBeOnTheScreen();
  api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 5, 'Now it works')]));
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
  expect(screen.getByText('Now it works')).toBeOnTheScreen();
});

describe('Report review (D5)', () => {
  it('is offered on other members’ reviews, never on the member’s own', async () => {
    api.on('GET', '/venues/:venueId/reviews', answer([row(MINE, 5, 'Mine', ME), row(THEIRS, 2, 'Theirs')], MINE));
    await renderPage();
    expect(screen.queryByTestId(`report-${MINE}`)).toBeNull();
    expect(screen.getByTestId(`report-${THEIRS}`)).toBeOnTheScreen();
  });

  it('asks why, sends the reason, and thanks the member', async () => {
    api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 1, 'Spammy')]));
    api.on('POST', '/venues/:venueId/reviews/:reviewId/report', Reply.ok({ reported: true, alreadyReported: false }));
    await renderPage();
    await fireEvent.press(screen.getByRole('button', { name: 'Report review' }));
    expect(screen.getByText('Why are you reporting this review?')).toBeOnTheScreen();
    for (const label of [
      'Offensive or abusive',
      'Shares personal information',
      'Not a genuine visit',
      'Spam or advertising',
      'Something else',
      'Cancel',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Spam or advertising' }));
    await act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
    expect(api.sent(`/venues/${V}/reviews/${THEIRS}/report`, 'POST').body).toEqual({ reason: 'spam' });
    expect(screen.getByText('Thanks for telling us. The LifePass team will take a look.')).toBeOnTheScreen();
  });

  it('Cancel sends nothing', async () => {
    api.on('GET', '/venues/:venueId/reviews', answer([row(THEIRS, 1, 'Meh')]));
    await renderPage();
    await fireEvent.press(screen.getByRole('button', { name: 'Report review' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.sentAll(`/venues/${V}/reviews/${THEIRS}/report`)).toHaveLength(0);
  });
});

describe('isOwnReview', () => {
  const review = {
    id: MINE,
    venueId: V,
    rating: 5,
    comment: null,
    authorInitial: 'J',
    createdAt: new Date('2026-10-16T12:00:00Z'),
    reviewerProfileId: ME,
    kind: 'written' as const,
    equipmentRating: null,
    cleanlinessRating: null,
  };
  it('knows the member’s review by the server’s ownReviewId or by its author', () => {
    expect(isOwnReview(review, MINE.toUpperCase(), null)).toBe(true);
    expect(isOwnReview(review, null, ME.toUpperCase())).toBe(true);
    expect(isOwnReview({ ...review, reviewerProfileId: OTHER }, THEIRS, ME)).toBe(false);
    expect(isOwnReview({ ...review, reviewerProfileId: null }, null, null)).toBe(false);
  });
});
