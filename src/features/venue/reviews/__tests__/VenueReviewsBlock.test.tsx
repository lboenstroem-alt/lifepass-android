/**
 * The reviews block on the venue page (iOS VenueDetailView.reviewsBlock).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { resetVenueReviews } from '../store';
import VenueReviewsBlock from '../VenueReviewsBlock';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const mockNavigate = jest.fn();
jest.mock('../../../../navigation/hooks', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate }),
}));

stubApiClientPerTest();

const V = 'aaaaaaaa-0000-4000-8000-000000000001';

const row = (id: string, rating: number, comment: string, createdAt: string) => ({
  id,
  venueId: V,
  rating,
  title: null,
  comment,
  visitDate: '2026-10-01',
  isVerifiedVisit: true,
  createdAt,
  updatedAt: createdAt,
  reviewer: { profileId: 'cccccccc-0000-4000-8000-000000000003', fullNameInitial: 'J', fullName: null },
  images: [],
});

const answer = (rows: unknown[]) =>
  Reply.ok({
    summary: { averageRating: 0, totalReviews: rows.length, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    rows,
    nextCursor: null,
    canWriteReview: true,
  });

const settle = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));

afterEach(() => {
  resetVenueReviews();
  mockNavigate.mockReset();
});

it.each([
  ['en', "NOBODY'S REVIEWED YET", 'Write one', 'Be the first to review'],
  ['is', 'ENGINN HEFUR SKRIFAÐ ENN', 'Skrifa umsögn', 'Vertu fyrstur til að skrifa umsögn'],
] as const)('with no reviews, invites the first one (%s)', async (lang, kicker, action, card) => {
  setCurrentLanguage(lang);
  api.on('GET', '/venues/:venueId/reviews', answer([]));
  await render(<VenueReviewsBlock venueId={V} venueName="Laugar" />);
  await settle();
  expect(screen.getByText(kicker)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: action })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: card }));
  expect(mockNavigate).toHaveBeenCalledWith('VenueReviews', { venueId: V, venueName: 'Laugar' });
});

it('shows the two latest reviews and "See all"', async () => {
  setCurrentLanguage('en');
  api.on(
    'GET',
    '/venues/:venueId/reviews',
    answer([
      row('11111111-0000-4000-8000-000000000001', 5, 'Newest', '2026-10-16T12:00:00Z'),
      row('11111111-0000-4000-8000-000000000002', 4, 'Middle', '2026-10-10T12:00:00Z'),
      row('11111111-0000-4000-8000-000000000003', 3, 'Oldest', '2026-10-01T12:00:00Z'),
    ]),
  );
  await render(<VenueReviewsBlock venueId={V} venueName="Laugar" />);
  await settle();
  expect(screen.getByText('FROM OTHER MEMBERS')).toBeOnTheScreen();
  expect(screen.getByText('Newest')).toBeOnTheScreen();
  expect(screen.getByText('Middle')).toBeOnTheScreen();
  expect(screen.queryByText('Oldest')).toBeNull();
  expect(screen.getByText('16 October 2026')).toBeOnTheScreen();
  expect(screen.getByLabelText('5 out of 5 stars')).toBeOnTheScreen();
  // The card is cut at four lines, as iOS's lineLimit(4).
  expect(screen.getByText('Newest').props.numberOfLines).toBe(4);
  await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
  expect(mockNavigate).toHaveBeenCalledWith('VenueReviews', { venueId: V, venueName: 'Laugar' });
});

it('a failed read offers a retry rather than claiming nobody has reviewed', async () => {
  setCurrentLanguage('en');
  api.on('GET', '/venues/:venueId/reviews', Reply.problem(500, 'internal_error'));
  await render(<VenueReviewsBlock venueId={V} venueName="Laugar" />);
  await settle();
  expect(screen.queryByText('Be the first to review')).toBeNull();
  expect(screen.getByText('Something went wrong. Please try again.')).toBeOnTheScreen();
  // The reviews page (its own retry, and the write sheet) is still one tap away.
  await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
  expect(mockNavigate).toHaveBeenCalledWith('VenueReviews', { venueId: V, venueName: 'Laugar' });

  api.on(
    'GET',
    '/venues/:venueId/reviews',
    Reply.delayed(20, answer([row('11111111-0000-4000-8000-000000000001', 5, 'Back', '2026-10-16T12:00:00Z')])),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  // While the retry is on its way: a spinner, not an empty block.
  expect(screen.getByTestId('venue-reviews-block-loading')).toBeOnTheScreen();
  expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 40)));
  expect(screen.getByText('Back')).toBeOnTheScreen();
  expect(screen.queryByTestId('venue-reviews-block-loading')).toBeNull();
});
