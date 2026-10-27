/**
 * A fake of `expo-store-review` for unit tests (the Google Play in-app review
 * card, API 0.46.0's "Rating the app"). It answers whether the card is
 * available and counts the times the app asked for it, so a test can say the
 * gates held it back or let it through:
 *
 *   import { storeReviewState } from '@test/mocks/expoStoreReview';
 *   storeReviewState.setAvailable(false);
 *   expect(storeReviewState.requests()).toBe(1);
 *
 * Every function is a jest.fn; `reset()` (run after every test by
 * jest.setup.ts) puts the fake's own behaviour back.
 */
const state = { available: true, requests: 0 };

export const isAvailableAsync = jest.fn(async () => state.available);

export const requestReview = jest.fn(async () => {
  state.requests += 1;
});

export const storeUrl = jest.fn((): string | null => null);

export const hasAction = jest.fn(async () => state.available);

/** Test controls for the fake. */
export const storeReviewState = {
  /** Whether Google Play's card is on the phone (`isAvailableAsync`). */
  setAvailable(available: boolean): void {
    state.available = available;
  },
  /** How many times the app called `requestReview()`. */
  requests(): number {
    return state.requests;
  },
  reset(): void {
    state.available = true;
    state.requests = 0;
    isAvailableAsync.mockImplementation(async () => state.available);
    requestReview.mockImplementation(async () => {
      state.requests += 1;
    });
    storeUrl.mockImplementation(() => null);
    hasAction.mockImplementation(async () => state.available);
  },
};
