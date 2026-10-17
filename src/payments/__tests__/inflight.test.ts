/**
 * The in-flight records on the phone: per member, short, dropped after a day
 * or when they do not read, wiped on sign-out, and claimed by one owner at a
 * time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { registeredHookIds, runSignOutCleaners } from '../../app/signOut';
import {
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  holdAttempt,
  INFLIGHT_MAX_AGE_MS,
  INFLIGHT_MAX_RECORDS,
  inflightStorageKey,
  isAttemptLive,
  readInflight,
  releaseAttempt,
  resetInflightMemoryForTests,
  resumeAttempt,
  saveInflight,
  updateInflight,
  wipeInflight,
  type NewInflightRecord,
} from '../inflight';

import { MEMBER_A, MEMBER_B } from './paymentsHarness';

const booking = (memberId: string, key = 'booking-key-0001'): NewInflightRecord => ({
  rail: 'booking',
  memberId,
  key,
  amountIsk: 1_990,
  booking: {
    kind: 'class',
    activityId: '7a1c2b3d-0000-4000-8000-0000000000aa',
    eventId: 4242,
    className: 'Hot yoga',
    venueName: 'Laugar Spa',
    startsAt: '2026-10-20T10:00:00Z',
  },
});

beforeEach(() => resetInflightMemoryForTests());

it('saves an attempt per member, stamped, and reads it back', async () => {
  const saved = await saveInflight(booking(MEMBER_A.toUpperCase()));
  expect(saved.memberId).toBe(MEMBER_A);
  expect(saved.v).toBe(1);
  expect(saved.attemptId).toEqual(expect.any(String));
  expect(Date.parse(saved.startedAt)).not.toBeNaN();
  expect(await readInflight(MEMBER_A)).toEqual([saved]);
  expect(await readInflight(MEMBER_B)).toEqual([]);
  expect(await AsyncStorage.getItem(inflightStorageKey(MEMBER_A))).toContain('"rail":"booking"');
});

it('clears one attempt and leaves the others', async () => {
  const first = await saveInflight(booking(MEMBER_A, 'key-first-001'));
  const second = await saveInflight(booking(MEMBER_A, 'key-second-01'));
  await clearInflight(MEMBER_A, first.attemptId);
  expect((await readInflight(MEMBER_A)).map((r) => r.attemptId)).toEqual([second.attemptId]);
  await clearInflight(MEMBER_A, second.attemptId);
  expect(await AsyncStorage.getItem(inflightStorageKey(MEMBER_A))).toBeNull();
});

it('changes one attempt in place', async () => {
  const saved = await saveInflight(booking(MEMBER_A));
  await updateInflight(MEMBER_A, saved.attemptId, (record) => ({ ...record, presentedProcessing: true }));
  expect((await readInflight(MEMBER_A))[0].presentedProcessing).toBe(true);
});

it('drops records older than a day without anyone asking the server', async () => {
  const now = Date.now();
  await saveInflight(booking(MEMBER_A, 'key-stale-001'), now - INFLIGHT_MAX_AGE_MS - 1_000);
  const fresh = await saveInflight(booking(MEMBER_A, 'key-fresh-001'), now - 60_000);
  expect((await readInflight(MEMBER_A, now)).map((r) => r.attemptId)).toEqual([fresh.attemptId]);
  // And the stale one is gone from the phone.
  expect(await AsyncStorage.getItem(inflightStorageKey(MEMBER_A))).not.toContain('key-stale-001');
});

it('drops what does not read: broken JSON, another member, an unknown rail, a missing key', async () => {
  await AsyncStorage.setItem(inflightStorageKey(MEMBER_A), '{not json');
  expect(await readInflight(MEMBER_A)).toEqual([]);
  expect(await AsyncStorage.getItem(inflightStorageKey(MEMBER_A))).toBeNull();

  const good = await saveInflight(booking(MEMBER_A));
  const raw = JSON.parse((await AsyncStorage.getItem(inflightStorageKey(MEMBER_A)))!) as unknown[];
  const startedAt = new Date().toISOString();
  raw.push(
    { ...(raw[0] as object), attemptId: 'x1', memberId: MEMBER_B },
    { v: 1, attemptId: 'x2', memberId: MEMBER_A, startedAt, rail: 'lottery' },
    { v: 1, attemptId: 'x3', memberId: MEMBER_A, startedAt, rail: 'booking', amountIsk: 1, booking: { kind: 'slot', activityId: 'a' } },
    { v: 2, attemptId: 'x4', memberId: MEMBER_A, startedAt, rail: 'card_setup' },
  );
  await AsyncStorage.setItem(inflightStorageKey(MEMBER_A), JSON.stringify(raw));
  expect((await readInflight(MEMBER_A)).map((r) => r.attemptId)).toEqual([good.attemptId]);
});

it('keeps a short list: the oldest go first', async () => {
  const ids: string[] = [];
  for (let i = 0; i < INFLIGHT_MAX_RECORDS + 2; i += 1) {
    ids.push((await saveInflight(booking(MEMBER_A, `booking-key-${i}000`))).attemptId);
  }
  expect((await readInflight(MEMBER_A)).map((r) => r.attemptId)).toEqual(ids.slice(2));
});

it('two rails finishing together never lose each other’s change', async () => {
  const a = await saveInflight(booking(MEMBER_A, 'key-a-000001'));
  const b = await saveInflight(booking(MEMBER_A, 'key-b-000001'));
  await Promise.all([
    clearInflight(MEMBER_A, a.attemptId),
    updateInflight(MEMBER_A, b.attemptId, (record) => ({ ...record, presentedProcessing: true })),
    saveInflight(booking(MEMBER_A, 'key-c-000001')),
  ]);
  const left = await readInflight(MEMBER_A);
  expect(left.map((r) => (r as { key: string }).key)).toEqual(['key-b-000001', 'key-c-000001']);
  expect(left[0].presentedProcessing).toBe(true);
});

it('sign-out wipes every member’s records on the phone', async () => {
  await saveInflight(booking(MEMBER_A));
  await saveInflight(booking(MEMBER_B));
  await AsyncStorage.setItem('unrelated.key', 'kept');
  expect(registeredHookIds().signOut).toContain('payments.inflight');
  await runSignOutCleaners({ memberId: MEMBER_A });
  expect(await readInflight(MEMBER_A)).toEqual([]);
  expect(await readInflight(MEMBER_B)).toEqual([]);
  expect(await AsyncStorage.getItem('unrelated.key')).toBe('kept');
  await expect(wipeInflight()).resolves.toBeUndefined();
});

it('an attempt has one owner at a time', () => {
  expect(claimAttempt('a1', 'payment')).toBe(true);
  expect(claimAttempt('a1', 'payment')).toBe(false);
  expect(isAttemptLive('a1')).toBe(true);
  expect(hasLiveAttempt('payment')).toBe(true);
  expect(hasLiveAttempt('cardSetup')).toBe(false);
  // A screen holding a payment still settling blocks nothing and owns no link.
  holdAttempt('a1');
  expect(isAttemptLive('a1')).toBe(true);
  expect(hasLiveAttempt()).toBe(false);
  resumeAttempt('a1');
  expect(hasLiveAttempt('payment')).toBe(true);
  releaseAttempt('a1');
  expect(isAttemptLive('a1')).toBe(false);
  expect(claimAttempt('a1', 'payment')).toBe(true);
});
