/**
 * The write sheet (iOS WriteReviewSheet): Submit's rules, what is sent, and
 * what happens after.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { resetVenueReviews, venueReviewsStore } from '../store';
import WriteReviewScreen from '../WriteReviewScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const V = 'aaaaaaaa-0000-4000-8000-000000000001';
const LONG = 'The lagoon was warm and calm, and the staff were kind to us all evening.';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
type Props = ComponentProps<typeof WriteReviewScreen>;

async function renderSheet() {
  const props = { navigation, route: { key: 'w', name: 'WriteReview', params: { venueId: V, venueName: 'Laugar' } } };
  await render(<WriteReviewScreen {...(props as unknown as Props)} />);
}

const submit = () => screen.getByTestId('write-review-submit');
const settle = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));

beforeEach(() => setCurrentLanguage('en'));

afterEach(() => {
  resetVenueReviews();
  navigation.goBack.mockReset();
  navigation.navigate.mockReset();
});

it.each([
  ['en', 'Write a review', 'How was your experience?', 'Tell other members what made this venue special…', 'Submit review', 'Cancel'],
  ['is', 'Skrifa umsögn', 'Hvernig var upplifunin þín?', 'Segðu öðrum hvað gerði þennan stað sérstakan…', 'Senda umsögn', 'Hætta við'],
] as const)('speaks the iOS copy (%s)', async (lang, title, question, placeholder, submitLabel, cancel) => {
  setCurrentLanguage(lang);
  await renderSheet();
  expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: question })).toBeOnTheScreen();
  expect(screen.getByPlaceholderText(placeholder)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: submitLabel })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: cancel })).toBeOnTheScreen();
});

it('Submit stays off with no rating or under 50 trimmed characters; the counter shows meanwhile', async () => {
  await renderSheet();
  expect(submit()).toBeDisabled();
  expect(screen.getByTestId('write-review-counter')).toHaveTextContent('0/50');

  await fireEvent.changeText(screen.getByTestId('write-review-comment'), `   ${'x'.repeat(49)}   `);
  expect(screen.getByTestId('write-review-counter')).toHaveTextContent('49/50');
  await fireEvent.press(screen.getByTestId('write-review-star-4'));
  expect(submit()).toBeDisabled();

  await fireEvent.changeText(screen.getByTestId('write-review-comment'), LONG);
  expect(screen.queryByTestId('write-review-counter')).toBeNull();
  expect(submit()).toBeEnabled();
});

it('Submit stays off with 50 characters but no rating', async () => {
  await renderSheet();
  await fireEvent.changeText(screen.getByTestId('write-review-comment'), LONG);
  expect(submit()).toBeDisabled();
});

it('the stars are a radio group TalkBack can read', async () => {
  await renderSheet();
  await fireEvent.press(screen.getByRole('radio', { name: '3 out of 5 stars' }));
  expect(screen.getByRole('radio', { name: '3 out of 5 stars' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '5 out of 5 stars' })).not.toBeChecked();
});

it('sends the rating, the trimmed comment and today, then reloads the reviews and closes', async () => {
  api.on('POST', '/venues/:venueId/reviews', Reply.ok({ review: {} }, 201));
  api.on('GET', '/venues/:venueId/reviews', Reply.ok({ rows: [], nextCursor: null, canWriteReview: false }));
  await renderSheet();
  await fireEvent.press(screen.getByTestId('write-review-star-5'));
  await fireEvent.changeText(screen.getByTestId('write-review-comment'), `\n  ${LONG}  \n`);
  await fireEvent.press(submit());
  await settle();

  const sent = api.sent(`/venues/${V}/reviews`, 'POST');
  expect(sent.body).toEqual({ rating: 5, comment: LONG, visitDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(sent.headers['idempotency-key']).toEqual(expect.any(String));
  expect(api.sentAll(`/venues/${V}/reviews`, 'GET')).toHaveLength(1);
  expect(venueReviewsStore.getState().byVenue[V]).toMatchObject({ loaded: true });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('after a review is posted, Submit stays off while the sheet closes (no second POST)', async () => {
  api.on('POST', '/venues/:venueId/reviews', Reply.ok({ review: {} }, 201));
  api.on('GET', '/venues/:venueId/reviews', Reply.ok({ rows: [], nextCursor: null, canWriteReview: false }));
  await renderSheet();
  await fireEvent.press(screen.getByTestId('write-review-star-4'));
  await fireEvent.changeText(screen.getByTestId('write-review-comment'), LONG);
  await fireEvent.press(submit());
  await settle();
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  // The modal is still animating away: the button keeps "Submitting…" and is off.
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  await fireEvent.press(submit());
  await settle();
  expect(api.sentAll(`/venues/${V}/reviews`, 'POST')).toHaveLength(1);
});

it('the comment box is five lines tall and never grows (iOS lineLimit(5, reservesSpace: true))', async () => {
  await renderSheet();
  const field = screen.getByTestId('write-review-comment');
  await fireEvent.changeText(field, `${LONG}\n`.repeat(12));
  expect(field).toHaveStyle({ minHeight: 128, maxHeight: 128 });
});

it('shows "Submitting…" while it is sent, and ignores a second press', async () => {
  api.on('POST', '/venues/:venueId/reviews', Reply.delayed(40, Reply.ok({ review: {} }, 201)));
  api.on('GET', '/venues/:venueId/reviews', Reply.ok({ rows: [], nextCursor: null, canWriteReview: false }));
  await renderSheet();
  await fireEvent.press(screen.getByTestId('write-review-star-5'));
  await fireEvent.changeText(screen.getByTestId('write-review-comment'), LONG);
  await fireEvent.press(submit());
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  await fireEvent.press(submit());
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 70)));
  await settle();
  expect(api.sentAll(`/venues/${V}/reviews`, 'POST')).toHaveLength(1);
});

it('a refusal shows in red under the field, in the formatter’s words, and the sheet stays', async () => {
  setCurrentLanguage('is');
  api.on('POST', '/venues/:venueId/reviews', Reply.problem(409, 'review_exists'));
  await renderSheet();
  await fireEvent.press(screen.getByTestId('write-review-star-2'));
  await fireEvent.changeText(screen.getByTestId('write-review-comment'), LONG);
  await fireEvent.press(submit());
  await settle();
  expect(screen.getByTestId('write-review-error')).toBeOnTheScreen();
  expect(screen.getByTestId('write-review-error')).not.toHaveTextContent('');
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(submit()).toBeEnabled();
});

it('Cancel closes without sending', async () => {
  await renderSheet();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(api.requests).toHaveLength(0);
});
