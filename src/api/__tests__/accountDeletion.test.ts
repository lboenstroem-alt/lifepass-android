/**
 * The account-deletion operations (iOS `AccountDeletionService` and its
 * models in AccountDeletionSheet.swift), checked against the contract: what
 * the phone SENDS (no body, the caller's Idempotency-Key) and how it reads
 * the answers (every field optional, a wrong type refused where the sheet
 * draws from the field and read as null where nothing does, an unknown
 * obligation kind kept as a string).
 */
import { api, Reply } from '@test/server';

import {
  ACCOUNT_DELETION_TIMEOUT_MS,
  cancelAccountDeletion,
  decodeAccountDeletionRequestResult,
  decodeAccountDeletionState,
  fetchAccountDeletionState,
  isDeletionPending,
  requestAccountDeletion,
  stateOfRequestResult,
} from '../accountDeletion';
import { API_TIMEOUTS } from '../client';
import { DecodingError } from '../errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

/** A pending state as the server writes it. */
const pending = {
  accountStatus: 'deletion_pending',
  deletionRequestedAt: '2026-10-17T09:12:44.120Z',
  erasureScheduledAt: '2026-11-10T00:00:00.000Z',
  obligations: [
    { kind: 'subscription', count: 1, clearsAt: '2026-11-10T00:00:00.000Z' },
    { kind: 'future_booking', count: 2, clearsAt: '2026-10-30T18:00:00.000Z' },
    { kind: 'pending_charge', count: 1, clearsAt: null },
  ],
};

describe('reading the state', () => {
  it('GET /account/deletion reads the contract sample', async () => {
    api.on('GET', '/account/deletion', replyFromContract('GET', '/account/deletion', 200, 'full'));
    const state = await fetchAccountDeletionState();
    expect(typeof state.accountStatus).toBe('string');
    expect(Array.isArray(state.obligations)).toBe(true);
    expectSentToMatchContract('GET', '/account/deletion');
  });

  it('decodes a pending state with its dates as instants', async () => {
    api.on('GET', '/account/deletion', Reply.ok(pending));
    const state = await fetchAccountDeletionState();
    expect(isDeletionPending(state)).toBe(true);
    expect(state.erasureScheduledAt?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(state.obligations).toHaveLength(3);
    expect(state.obligations?.[1]).toEqual({
      kind: 'future_booking',
      count: 2,
      clearsAt: new Date('2026-10-30T18:00:00.000Z'),
    });
    expect(state.obligations?.[2]?.clearsAt).toBeNull();
  });

  it('every field is optional: an empty answer is an unknown, not-pending state', () => {
    const state = decodeAccountDeletionState({});
    expect(state).toEqual({ accountStatus: null, deletionRequestedAt: null, erasureScheduledAt: null, obligations: null });
    expect(isDeletionPending(state)).toBe(false);
  });

  it('an obligation kind this build does not know is kept, not refused', () => {
    const state = decodeAccountDeletionState({ ...pending, obligations: [{ kind: 'gift_card', count: 3, clearsAt: null }] });
    expect(state.obligations?.[0]?.kind).toBe('gift_card');
  });

  it('a field the sheet draws from fails the read when its type is wrong, as Swift Decodable does', async () => {
    expect(() => decodeAccountDeletionState({ ...pending, erasureScheduledAt: 'soon' })).toThrow();
    expect(() => decodeAccountDeletionState({ ...pending, obligations: [{ kind: 'subscription', count: 1.5 }] })).toThrow();
    expect(() => decodeAccountDeletionState('<html>')).toThrow();
    api.on('GET', '/account/deletion', Reply.ok({ ...pending, accountStatus: 7 }));
    await expect(fetchAccountDeletionState()).rejects.toBeInstanceOf(DecodingError);
  });

  it('a field the sheet never draws reads as null when its type is wrong, and the state still decodes', () => {
    const state = decodeAccountDeletionState({
      ...pending,
      deletionRequestedAt: 'yesterday',
      obligations: [{ kind: 'future_booking', count: 2, clearsAt: 1730000000 }],
    });
    expect(isDeletionPending(state)).toBe(true);
    expect(state.deletionRequestedAt).toBeNull();
    expect(state.erasureScheduledAt?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(state.obligations).toEqual([{ kind: 'future_booking', count: 2, clearsAt: null }]);
  });

  it('is active only when the server says deletion_pending', () => {
    expect(isDeletionPending(decodeAccountDeletionState({ accountStatus: 'active' }))).toBe(false);
    expect(isDeletionPending(decodeAccountDeletionState({ accountStatus: 'anonymised' }))).toBe(false);
    expect(isDeletionPending(null)).toBe(false);
  });
});

describe('requesting the deletion', () => {
  it('POST /account/deletion sends NO body, the given key, and reads the result', async () => {
    api.on(
      'POST',
      '/account/deletion',
      Reply.ok({ ...pending, alreadyPending: false, healthDeleted: { bodyMeasurements: 24, mealLogs: 58 } }),
    );
    const result = await requestAccountDeletion('deletion-key-0001');
    const sent = expectSentToMatchContract('POST', '/account/deletion');
    expect(sent.rawBody === null || sent.rawBody === '').toBe(true);
    expect(sent.body).toBeUndefined();
    expect(sent.headers['content-type']).toBeUndefined();
    expect(sent.headers['idempotency-key']).toBe('deletion-key-0001');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(result.alreadyPending).toBe(false);
    expect(result.healthDeleted).toEqual({ bodyMeasurements: 24, mealLogs: 58 });
    expect(isDeletionPending(stateOfRequestResult(result))).toBe(true);
  });

  it('reads the contract sample of the result', async () => {
    api.on('POST', '/account/deletion', replyFromContract('POST', '/account/deletion', 200, 'full'));
    const result = await requestAccountDeletion('deletion-key-0002');
    expect(typeof result.accountStatus).toBe('string');
  });

  it('healthDeleted is null when no consent stood; the state part drops the request fields', () => {
    const result = decodeAccountDeletionRequestResult({ ...pending, alreadyPending: true, healthDeleted: null });
    expect(result.healthDeleted).toBeNull();
    expect(result.alreadyPending).toBe(true);
    expect(Object.keys(stateOfRequestResult(result)).sort()).toEqual([
      'accountStatus',
      'deletionRequestedAt',
      'erasureScheduledAt',
      'obligations',
    ]);
  });

  it('a malformed healthDeleted or alreadyPending still decodes to the pending answer', async () => {
    // The server has deleted the account by the time it answers: a field
    // nothing shows must never turn that into "Something went wrong" (and a
    // retry with the same key replays the same body).
    api.on(
      'POST',
      '/account/deletion',
      Reply.ok({ ...pending, alreadyPending: 'no', healthDeleted: { bodyMeasurements: 24, mealLogs: '58', notes: 1.5 } }),
    );
    const result = await requestAccountDeletion('deletion-key-0003');
    expect(isDeletionPending(stateOfRequestResult(result))).toBe(true);
    expect(result.alreadyPending).toBeNull();
    expect(result.healthDeleted).toEqual({ bodyMeasurements: 24 });

    for (const healthDeleted of ['24 rows', [24], 7, true]) {
      const decoded = decodeAccountDeletionRequestResult({ ...pending, healthDeleted });
      expect(decoded.healthDeleted).toBeNull();
      expect(isDeletionPending(stateOfRequestResult(decoded))).toBe(true);
    }
    const lateClear = decodeAccountDeletionRequestResult({
      ...pending,
      deletionRequestedAt: 17,
      obligations: [{ kind: 'subscription', count: 1, clearsAt: 'when the period ends' }],
    });
    expect(lateClear.deletionRequestedAt).toBeNull();
    expect(lateClear.obligations?.[0]?.clearsAt).toBeNull();
    expect(lateClear.erasureScheduledAt?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });

  it('the fields the sheet draws still fail the request answer when malformed, as on iOS', () => {
    expect(() => decodeAccountDeletionRequestResult({ ...pending, erasureScheduledAt: 'soon' })).toThrow();
    expect(() => decodeAccountDeletionRequestResult({ ...pending, accountStatus: 7 })).toThrow();
    expect(() => decodeAccountDeletionRequestResult({ ...pending, obligations: [{ kind: 3, count: 1 }] })).toThrow();
  });

  it('POST /account/deletion/cancel sends no body and its own key', async () => {
    api.on('POST', '/account/deletion/cancel', Reply.ok({ accountStatus: 'active', deletionRequestedAt: null, erasureScheduledAt: null, obligations: [] }));
    const state = await cancelAccountDeletion('cancel-key-0001');
    const sent = expectSentToMatchContract('POST', '/account/deletion/cancel');
    expect(sent.body).toBeUndefined();
    expect(sent.headers['idempotency-key']).toBe('cancel-key-0001');
    expect(state.accountStatus).toBe('active');
  });

  it('waits as long as the iOS health session does', () => {
    expect(ACCOUNT_DELETION_TIMEOUT_MS).toBe(API_TIMEOUTS.healthSession);
  });
});
