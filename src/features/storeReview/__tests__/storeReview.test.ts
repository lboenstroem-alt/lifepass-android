/**
 * The Google Play rating ask (docs/05 "Rating the app"; owner's rule "after
 * a happy moment"): the two happy moments, and the gates, all of them: an
 * account more than 7 days old, no ask from this phone for this account in
 * 4 months (recorded whenever Google Play's API is called), and no booking,
 * payment or check-in flow on screen. Google Play's card only where the
 * phone has it; never a home-made one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storeReviewState } from '@test/mocks/expoStoreReview';
import * as StoreReview from 'expo-store-review';

import { decodeProfile } from '../../../api/profile';
import { reportCheckInProofClosed } from '../../../checkin/checkInFacts';
import {
  attachRecoveryProgressHost,
  endRecoveryProgress,
  resetRecoveryProgress,
  startRecoveryProgress,
} from '../../../payments/recoveryProgress';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import {
  addMonths,
  askForStoreReview,
  lastAskedKey,
  setStoreReviewDepsForTests,
  storeReviewRefusal,
  type StoreReviewMoment,
} from '../storeReview';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-27T14:00:00.000Z');
const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '9d3d2c47-3b8f-4c2a-8f1f-3a2d5e1b0d22';
const HAPPY_VISIT: StoreReviewMoment = { kind: 'visitRating' };
const FIFTH_CHECK_IN: StoreReviewMoment = { kind: 'checkIn', lifetimeCheckIns: 5 };

const gates = (overrides: Partial<Parameters<typeof storeReviewRefusal>[1]> = {}) => ({
  accountCreatedAt: new Date(NOW.getTime() - 30 * DAY),
  lastAskedAt: null,
  flowOnScreen: false,
  now: NOW,
  ...overrides,
});

describe('the rule (pure)', () => {
  it('a happy visit rating, or a check-in from the fifth, with every gate open, may ask', () => {
    expect(storeReviewRefusal(HAPPY_VISIT, gates())).toBeNull();
    expect(storeReviewRefusal(FIFTH_CHECK_IN, gates())).toBeNull();
    expect(storeReviewRefusal({ kind: 'checkIn', lifetimeCheckIns: 40 }, gates())).toBeNull();
  });

  it('a check-in before the fifth, or one whose count is unknown, is not a happy moment', () => {
    expect(storeReviewRefusal({ kind: 'checkIn', lifetimeCheckIns: 4 }, gates())).toBe('notHappy');
    expect(storeReviewRefusal({ kind: 'checkIn', lifetimeCheckIns: null }, gates())).toBe('notHappy');
  });

  it('the account must be MORE than 7 days old (and known)', () => {
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ accountCreatedAt: new Date(NOW.getTime() - 7 * DAY) }))).toBe('newAccount');
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ accountCreatedAt: new Date(NOW.getTime() - 7 * DAY - 1) }))).toBeNull();
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ accountCreatedAt: null }))).toBe('unknownAccount');
  });

  it('not again for 4 months after an ask', () => {
    const asked = new Date('2026-06-27T14:00:00.000Z');
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ lastAskedAt: asked, now: new Date('2026-10-27T13:59:59.999Z') }))).toBe(
      'askedRecently',
    );
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ lastAskedAt: asked, now: new Date('2026-10-27T14:00:00.000Z') }))).toBeNull();
  });

  it('never over a booking, payment or check-in flow', () => {
    expect(storeReviewRefusal(HAPPY_VISIT, gates({ flowOnScreen: true }))).toBe('flowOnScreen');
    expect(storeReviewRefusal(FIFTH_CHECK_IN, gates({ flowOnScreen: true }))).toBe('flowOnScreen');
  });

  it('four calendar months, held to the end of a shorter month', () => {
    expect(addMonths(new Date('2026-10-31T09:30:00.000Z'), 4).toISOString()).toBe('2027-02-28T09:30:00.000Z');
    expect(addMonths(new Date('2027-10-31T09:30:00.000Z'), 4).toISOString()).toBe('2028-02-29T09:30:00.000Z');
    expect(addMonths(new Date('2026-06-15T00:00:00.000Z'), 4).toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('asking (the app store, the phone and Google Play)', () => {
  let now = NOW;
  let flow = false;

  function signedIn(member: string, createdAt: Date) {
    useAppStore.setState({
      isAuthenticated: true,
      isLoading: false,
      userId: member,
      profile: decodeProfile({
        id: member,
        kennitalaVerified: false,
        marketingConsent: false,
        createdAt: createdAt.toISOString(),
      }),
    });
  }

  beforeEach(() => {
    resetAppStoreForTests();
    now = NOW;
    flow = false;
    // The app's own dependencies, but this test's clock and screen.
    setStoreReviewDepsForTests({ now: () => now, flowOnScreen: () => flow });
    signedIn(MEMBER, new Date(NOW.getTime() - 30 * DAY));
  });

  afterEach(() => setStoreReviewDepsForTests(null));

  it('asks Google Play once, and records it per account on this phone', async () => {
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(true);
    expect(storeReviewState.requests()).toBe(1);
    expect(StoreReview.isAvailableAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBe(NOW.toISOString());

    // A month later: not yet.
    now = new Date(NOW.getTime() + 30 * DAY);
    await expect(askForStoreReview(FIFTH_CHECK_IN)).resolves.toBe(false);
    expect(storeReviewState.requests()).toBe(1);

    // Another account on the same phone keeps its own 4 months.
    signedIn(OTHER, new Date(NOW.getTime() - 300 * DAY));
    await expect(askForStoreReview(FIFTH_CHECK_IN)).resolves.toBe(true);
    expect(storeReviewState.requests()).toBe(2);

    // Four months after the first: the first account may be asked again.
    signedIn(MEMBER, new Date(NOW.getTime() - 30 * DAY));
    now = addMonths(NOW, 4);
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(true);
    expect(storeReviewState.requests()).toBe(3);
  });

  it('a new account (7 days or less) is never asked', async () => {
    signedIn(MEMBER, new Date(NOW.getTime() - 3 * DAY));
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(false);
    expect(storeReviewState.requests()).toBe(0);
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBeNull();
  });

  it('nothing while a flow is on screen, and nothing recorded', async () => {
    flow = true;
    await expect(askForStoreReview(FIFTH_CHECK_IN)).resolves.toBe(false);
    expect(storeReviewState.requests()).toBe(0);
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBeNull();
  });

  it('a flow still on screen a moment after Done is waited out, then the card is asked for', async () => {
    // The app's own screen this time: "Confirming your payment…" is up.
    setStoreReviewDepsForTests({ now: () => now });
    const detach = attachRecoveryProgressHost();
    try {
      startRecoveryProgress({ attemptId: 'attempt-1', rail: 'walk_in' });
      const asking = askForStoreReview(FIFTH_CHECK_IN);
      await new Promise((resolve) => setImmediate(resolve));
      expect(storeReviewState.requests()).toBe(0);
      endRecoveryProgress('attempt-1');
      await expect(asking).resolves.toBe(true);
      expect(storeReviewState.requests()).toBe(1);
    } finally {
      resetRecoveryProgress();
      detach();
    }
  });

  it('a flow that outlasts the wait: the moment has passed, nothing is asked or recorded', async () => {
    setStoreReviewDepsForTests({ now: () => now, waitForNoFlow: async () => false });
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(false);
    expect(storeReviewState.requests()).toBe(0);
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBeNull();
  });

  it('a phone without Google Play is never asked (and keeps its 4 months unspent)', async () => {
    storeReviewState.setAvailable(false);
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBeNull();
  });

  it('a card Google refused still counts as asked', async () => {
    jest.mocked(StoreReview.requestReview).mockRejectedValueOnce(new Error('quota'));
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(true);
    expect(await AsyncStorage.getItem(lastAskedKey(MEMBER))).toBe(NOW.toISOString());
  });

  it('signed out: nothing', async () => {
    resetAppStoreForTests();
    await expect(askForStoreReview(HAPPY_VISIT)).resolves.toBe(false);
    expect(storeReviewState.requests()).toBe(0);
  });

  it('two moments at once ask once', async () => {
    const both = await Promise.all([askForStoreReview(HAPPY_VISIT), askForStoreReview(FIFTH_CHECK_IN)]);
    expect(both).toEqual([true, true]);
    expect(storeReviewState.requests()).toBe(1);
  });

  it('the check-in moment: leaving the proof of the fifth check-in asks (register.ts); the fourth does not', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../register');
    reportCheckInProofClosed({ lifetimeCheckIns: 4 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(storeReviewState.requests()).toBe(0);
    reportCheckInProofClosed({ lifetimeCheckIns: 5 });
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(storeReviewState.requests()).toBe(1);
  });
});
