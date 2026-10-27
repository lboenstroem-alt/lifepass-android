/**
 * The development fixture (`visitRating=<variant>`, ./fixtures.ts): each
 * variant's state, nothing sent to the server, nothing scheduled, Google
 * Play never asked, and nothing at all in a release bundle.
 */
import { setDev, setEnv } from '@test/harness';
import { notificationsState } from '@test/mocks/expoNotifications';
import { storeReviewState } from '@test/mocks/expoStoreReview';
import { api } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import {
  applyVisitRatingFixture,
  resetVisitRatingFixtureForTests,
  takeVisitRatingFixture,
  visitRatingFixtureVariant,
} from '../fixtures';
import { createVisitRatingStore } from '../store';

stubApiClientPerTest();

beforeEach(() => resetVisitRatingFixtureForTests());

it('reads its variant in a development build, once per run, and nothing in release', () => {
  setDev(true);
  setEnv({ EXPO_PUBLIC_FIXTURE: 'state=pass-holder,visitRating=sheet' });
  expect(visitRatingFixtureVariant()).toBe('sheet');
  expect(takeVisitRatingFixture()).toBe('sheet');
  expect(takeVisitRatingFixture()).toBeNull();

  resetVisitRatingFixtureForTests();
  setEnv({ EXPO_PUBLIC_FIXTURE: 'visitRating=nonsense' });
  expect(takeVisitRatingFixture()).toBeNull();

  resetVisitRatingFixtureForTests();
  setDev(false);
  setEnv({ EXPO_PUBLIC_FIXTURE: 'visitRating=card' });
  expect(takeVisitRatingFixture()).toBeNull();
});

it.each([
  ['card', { card: true, sheet: null }],
  ['sheet', { card: true, sheet: { phase: 'form', overall: 4, equipment: 5, hasWrittenReview: false } }],
  ['written', { card: true, sheet: { phase: 'form', overall: 4, hasWrittenReview: true } }],
  ['thanks', { card: false, sheet: { phase: 'thanks', happyMoment: true } }],
] as const)('%s: its state, with no request, no notification and no Google Play ask', async (variant, expected) => {
  const store = createVisitRatingStore();
  await applyVisitRatingFixture(variant, store);
  await store.getState().checkForCard();
  const state = store.getState();
  expect(state.card !== null).toBe(expected.card);
  if (expected.sheet === null) expect(state.sheet).toBeNull();
  else expect(state.sheet).toMatchObject(expected.sheet);
  if (variant === 'sheet') expect(state.sheet?.comment).not.toBe('');

  store.getState().closeSheet();
  store.getState().sheetGone();
  store.getState().notNow();
  expect(api.sentAll('/visit-rating-prompts/current')).toEqual([]);
  expect(notificationsState.scheduled()).toEqual([]);
  expect(storeReviewState.requests()).toBe(0);
});
