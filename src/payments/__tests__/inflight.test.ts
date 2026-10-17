/**
 * The in-flight records on the phone: per member, short, dropped after a day
 * or when they do not read, wiped on sign-out, and claimed by one owner at a
 * time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { registeredHookIds, runSignOutCleaners } from '../../app/signOut';
import {
  attemptAction,
  attemptIdentity,
  attemptState,
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  heldRecord,
  holdAttempt,
  INFLIGHT_MAX_AGE_MS,
  INFLIGHT_MAX_RECORDS,
  inflightStorageKey,
  isAttemptLive,
  readInflight,
  releaseAbandonedHolds,
  releaseAttempt,
  resetInflightMemoryForTests,
  resumeAttempt,
  saveInflight,
  updateInflight,
  wipeInflight,
  type NewInflightRecord,
} from '../inflight';

import { MEMBER_A, MEMBER_B } from './paymentsHarness';
// The app loads this with the session hooks (an F3 SHARED_LAYERS entry).
import '../register';

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

it('one key is one attempt: a retry under the same key replaces its record', async () => {
  const first = await saveInflight(booking(MEMBER_A, 'key-same-0001'));
  await updateInflight(MEMBER_A, first.attemptId, (record) => ({ ...record, presentedProcessing: true }));
  const other = await saveInflight(booking(MEMBER_A, 'key-other-001'));
  const retry = await saveInflight(booking(MEMBER_A, 'key-same-0001'));
  const stored = JSON.parse((await AsyncStorage.getItem(inflightStorageKey(MEMBER_A)))!) as { attemptId: string }[];
  expect(stored.map((r) => r.attemptId)).toEqual([other.attemptId, retry.attemptId]);
  const left = await readInflight(MEMBER_A);
  expect(left.map((r) => r.attemptId)).toEqual([other.attemptId, retry.attemptId]);
  // The member was on the page again: the new record waits for its own answer.
  expect(left[1].presentedProcessing).toBeUndefined();
});

it('a Kling session is one attempt; a session-less checkout or a card setup never merges', async () => {
  const plan = (externalSessionId: string | null): NewInflightRecord => ({
    rail: 'plan',
    memberId: MEMBER_A,
    externalSessionId,
    plan: { productSlug: 'pass-day', prePurchasePassIds: [], prePurchaseSubSlug: null },
  });
  await saveInflight(plan('0F1E2D3C-4B5A-4968-8776-655443322110'));
  await saveInflight(plan('0f1e2d3c-4b5a-4968-8776-655443322110'));
  await saveInflight(plan(null));
  await saveInflight(plan(null));
  await saveInflight({ rail: 'card_setup', memberId: MEMBER_A });
  await saveInflight({ rail: 'card_setup', memberId: MEMBER_A });
  expect((await readInflight(MEMBER_A)).map((r) => r.rail)).toEqual(['plan', 'plan', 'plan', 'card_setup', 'card_setup']);
});

it('two records of one payment left by anything older read as the newest', async () => {
  const saved = await saveInflight(booking(MEMBER_A, 'key-dupe-0001'));
  const raw = JSON.parse((await AsyncStorage.getItem(inflightStorageKey(MEMBER_A)))!) as object[];
  await AsyncStorage.setItem(inflightStorageKey(MEMBER_A), JSON.stringify([{ ...raw[0], attemptId: 'older' }, ...raw]));
  expect((await readInflight(MEMBER_A)).map((r) => r.attemptId)).toEqual([saved.attemptId]);
});

it('says which payment and which action a record is', () => {
  const record = booking(MEMBER_A, 'key-0001');
  expect(attemptIdentity(record)).toBe('booking:key-0001');
  expect(attemptAction(record)).toBe('booking|7a1c2b3d-0000-4000-8000-0000000000aa|event:4242');
  const slot = (startsAt: string): NewInflightRecord => ({
    rail: 'booking',
    memberId: MEMBER_A,
    key: 'k',
    amountIsk: 1,
    booking: { kind: 'slot', activityId: '7A1C2B3D-0000-4000-8000-0000000000AA', startsAt },
  });
  // One slot, however its start is spelled.
  expect(attemptAction(slot('2026-10-20T10:00:00Z'))).toBe(attemptAction(slot('2026-10-20T10:00:00.000Z')));
  expect(attemptAction(slot('2026-10-20T11:00:00Z'))).not.toBe(attemptAction(slot('2026-10-20T10:00:00Z')));
  expect(
    attemptAction({
      rail: 'walk_in',
      memberId: MEMBER_A,
      key: 'w',
      amountIsk: 1,
      walkIn: { venueId: '3F2B8C1E-7D4A-4B6E-9C2F-1A2B3C4D5E6F', activityId: null },
    }),
  ).toBe('walk_in|3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
  expect(attemptAction({ rail: 'card_setup', memberId: MEMBER_A })).toBeNull();
});

it('a screen that holds an attempt and is gone lets go of it at the next recovery', async () => {
  const saved = await saveInflight(booking(MEMBER_A));
  let alive = true;
  claimAttempt(saved.attemptId, 'payment');
  holdAttempt(saved.attemptId, { record: saved, isScreenAlive: () => alive });
  claimAttempt('no-screen-test', 'payment');
  holdAttempt('no-screen-test');
  expect(heldRecord(saved.attemptId)).toEqual(saved);
  expect(releaseAbandonedHolds()).toEqual([]);
  alive = false;
  expect(releaseAbandonedHolds()).toEqual([saved.attemptId]);
  expect(isAttemptLive(saved.attemptId)).toBe(false);
  // Without a test of its screen, a hold stays until the screen lets go.
  expect(attemptState('no-screen-test')).toEqual({ owner: 'flow', phase: 'held' });
});

it('the session hooks are registered when the register file loads', () => {
  const ids = registeredHookIds();
  expect(ids.signOut).toContain('payments.inflight');
  expect(ids.activation).toContain('payments.recovery');
});
