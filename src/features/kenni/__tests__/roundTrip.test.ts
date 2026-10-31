/**
 * The in-flight record of a Kenni round trip (Android only): written when the
 * tab opens, spent at the completion, forgotten at sign-out, and what decides
 * whether a redirect that came without its tab may be completed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { runSignOutCleaners } from '../../../app/signOut';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import {
  KENNI_RESUME_WINDOW_MS,
  KENNI_ROUND_TRIP_KEY,
  kenniRoundTrip,
  readKenniRoundTrip,
  roundTripAllowsResume,
} from '../roundTrip';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

beforeEach(() => {
  resetAppStoreForTests();
});

afterEach(() => {
  resetAppStoreForTests();
});

it('begin records when and for whom; spend removes it', async () => {
  useAppStore.setState({ userId: MEMBER });
  const before = Date.now();
  await kenniRoundTrip.begin();
  const record = await readKenniRoundTrip();
  expect(record?.member).toBe(MEMBER);
  expect(record?.startedAt).toBeGreaterThanOrEqual(before);
  expect(record?.startedAt).toBeLessThanOrEqual(Date.now());

  await kenniRoundTrip.spend();
  expect(await readKenniRoundTrip()).toBeNull();
});

it('allows a resume only for the same member, within the window', () => {
  const now = 1_000_000_000;
  const record = { startedAt: now - 60_000, member: MEMBER };
  expect(roundTripAllowsResume(record, MEMBER, now)).toBe(true);
  expect(roundTripAllowsResume({ startedAt: now - KENNI_RESUME_WINDOW_MS, member: MEMBER }, MEMBER, now)).toBe(true);
  expect(roundTripAllowsResume({ startedAt: now - KENNI_RESUME_WINDOW_MS - 1, member: MEMBER }, MEMBER, now)).toBe(false);
  // A clock that moved back is not "recent".
  expect(roundTripAllowsResume({ startedAt: now + 60_000, member: MEMBER }, MEMBER, now)).toBe(false);
  expect(roundTripAllowsResume(record, 'someone-else', now)).toBe(false);
  expect(roundTripAllowsResume(record, null, now)).toBe(false);
  expect(roundTripAllowsResume({ startedAt: now, member: null }, MEMBER, now)).toBe(false);
  expect(roundTripAllowsResume(null, MEMBER, now)).toBe(false);
});

it('the window outlasts the server state (about ten minutes), so a late return still hears why', () => {
  expect(KENNI_RESUME_WINDOW_MS).toBeGreaterThan(10 * 60 * 1000);
});

it('an unreadable record allows nothing', async () => {
  await AsyncStorage.setItem(KENNI_ROUND_TRIP_KEY, 'not json');
  expect(await readKenniRoundTrip()).toBeNull();
  await AsyncStorage.setItem(KENNI_ROUND_TRIP_KEY, JSON.stringify({ member: MEMBER }));
  expect(await readKenniRoundTrip()).toBeNull();
});

it('is forgotten at sign-out (the state is the member who started it)', async () => {
  useAppStore.setState({ userId: MEMBER });
  await kenniRoundTrip.begin();
  await runSignOutCleaners({ memberId: MEMBER });
  expect(await AsyncStorage.getItem(KENNI_ROUND_TRIP_KEY)).toBeNull();
});
