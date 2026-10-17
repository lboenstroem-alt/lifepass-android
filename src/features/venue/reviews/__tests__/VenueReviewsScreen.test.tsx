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
import VenueReviewsScreen, { isOwnReview } from '../VenueReviewsScreen';

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

const answer = (rows: unknown[], ownReviewId: string | null = null) =>
  Reply.ok({
    summary: { averageRating: 0, totalReviews: rows.length, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
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

it('the summary is computed from the loaded rows: average, half stars, count and bars', async () => {
  api.on(
    'GET',
    '/venues/:venueId/reviews',
    answer([
      row('11111111-0000-4000-8000-000000000001', 5, 'Superb'),
      row('11111111-0000-4000-8000-000000000002', 4, 'Good'),
      row('11111111-0000-4000-8000-000000000003', 5, 'Great'),
      row('11111111-0000-4000-8000-000000000004', 4, 'Fine'),
    ]),
  );
  await renderPage();
  const summary = within(screen.getByTestId('reviews-summary'));
  // The big number is drawn for the eye; TalkBack hears it once, from the stars.
  expect(summary.getByText('4.5', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(summary.getByLabelText('Average rating 4.5 out of 5')).toBeOnTheScreen();
  expect(summary.getByText('4 reviews')).toBeOnTheScreen();
  expect(summary.getByLabelText('Rated 5: 2')).toBeOnTheScreen();
  expect(summary.getByLabelText('Rated 1: 0')).toBeOnTheScreen();
  expect(screen.getByTestId('reviews-bar-fill-5')).toHaveStyle({ width: '50%' });
  // Every card, the whole comment.
  expect(screen.getByText('Fine').props.numberOfLines).toBeUndefined();
});

it('says "1 review" for one', async () => {
  setCurrentLanguage('is');
  api.on('GET', '/venues/:venueId/reviews', answer([row('11111111-0000-4000-8000-000000000001', 3, 'Ok')]));
  await renderPage();
  expect(screen.getByText('1 umsögn')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Umsagnir' })).toBeOnTheScreen();
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
    createdAt: null,
    reviewerProfileId: ME,
  };
  it('knows the member’s review by the server’s ownReviewId or by its author', () => {
    expect(isOwnReview(review, MINE.toUpperCase(), null)).toBe(true);
    expect(isOwnReview(review, null, ME.toUpperCase())).toBe(true);
    expect(isOwnReview({ ...review, reviewerProfileId: OTHER }, THEIRS, ME)).toBe(false);
    expect(isOwnReview({ ...review, reviewerProfileId: null }, null, null)).toBe(false);
  });
});
