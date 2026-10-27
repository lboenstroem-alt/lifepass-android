/**
 * What a walk-in tells the visit rating and the Google Play ask (API
 * 0.46.0): the check-in answer's fail-soft `ratingPrompt` and
 * `lifetimeCheckIns`, reported when the check-in stands (the direct POST
 * and the hosted page alike), and the member leaving the proof reported only
 * once the proof is down, with the count the check-in said.
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { onCheckInFacts, type CheckInFacts, type ProofClosedFacts } from '../../../../checkin/checkInFacts';
import { decodeWalkInResult, type WalkInResult } from '../service';

import { checkInJSON, previewJSON, SKY_LAGOON_ID, walkInStoreForTest, walkInTestEnvironment } from './walkInHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const PAID_LINK = { type: 'success', url: 'lifepass://payment-success' } as WebBrowser.WebBrowserAuthSessionResult;

walkInTestEnvironment();

const RATING_PROMPT = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  venueId: SKY_LAGOON_ID,
  venueName: 'Sky Lagoon',
  dueAt: '2026-09-25T10:00:00.000Z',
  expiresAt: '2026-09-28T10:00:00.000Z',
};

describe('the answer', () => {
  it('an absent, null or unreadable ratingPrompt is no ask; the check-in decodes all the same', () => {
    for (const ratingPrompt of [undefined, null, { id: 'nope' }, 'soon']) {
      const result = decodeWalkInResult(checkInJSON(ratingPrompt === undefined ? {} : { ratingPrompt }));
      expect(result.ratingPrompt).toBeNull();
      expect(result.checkInId).toBe('9d7c1b2a-0000-4000-8000-000000000001');
    }
  });

  it('an ask and the count are read', () => {
    const result = decodeWalkInResult(checkInJSON({ ratingPrompt: RATING_PROMPT, lifetimeCheckIns: 5 }));
    expect(result.ratingPrompt).toEqual({
      id: RATING_PROMPT.id,
      venueId: SKY_LAGOON_ID,
      venueName: 'Sky Lagoon',
      dueAt: new Date(RATING_PROMPT.dueAt),
      expiresAt: new Date(RATING_PROMPT.expiresAt),
    });
    expect(result.lifetimeCheckIns).toBe(5);
    expect(decodeWalkInResult(checkInJSON({ lifetimeCheckIns: 'five' })).lifetimeCheckIns).toBeNull();
  });
});

describe('a walk-in that stands', () => {
  it('reports its ask and count, keeps the count for the proof, and reports leaving the proof once it is down', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON({ ratingPrompt: RATING_PROMPT, lifetimeCheckIns: 5 }), 201));
    const checkedIn = jest.fn<void, [CheckInFacts]>();
    const proofUpWhenLeft: boolean[] = [];
    const leftProof = jest.fn<void, [ProofClosedFacts]>(() => {
      proofUpWhenLeft.push(store.getState().showSuccess);
    });
    const store = walkInStoreForTest({ checkedIn, leftProof });

    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().showSuccess).toBe(true);
    expect(checkedIn).toHaveBeenCalledTimes(1);
    expect(checkedIn.mock.calls[0][0].ratingPrompt?.id).toBe(RATING_PROMPT.id);
    expect(checkedIn.mock.calls[0][0].lifetimeCheckIns).toBe(5);
    expect(store.getState().successLifetimeCheckIns).toBe(5);
    // Nothing is asked while the proof reception reads is up.
    expect(leftProof).not.toHaveBeenCalled();

    store.getState().resetSuccess();
    expect(leftProof).toHaveBeenCalledWith({ lifetimeCheckIns: 5 });
    expect(proofUpWhenLeft).toEqual([false]);
    expect(store.getState().successLifetimeCheckIns).toBeNull();

    // Done again with nothing up says nothing.
    store.getState().resetSuccess();
    expect(leftProof).toHaveBeenCalledTimes(1);
  });

  it('an older server (no count) leaves the proof with an unknown count', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const leftProof = jest.fn<void, [ProofClosedFacts]>();
    const checkedIn = jest.fn<void, [CheckInFacts]>();
    const store = walkInStoreForTest({ checkedIn, leftProof });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(checkedIn).toHaveBeenCalledWith({ ratingPrompt: null, lifetimeCheckIns: null });
    store.getState().resetSuccess();
    expect(leftProof).toHaveBeenCalledWith({ lifetimeCheckIns: null });
  });

  it('a check-in that lands after a sign-out reports nothing (the next member must not be asked)', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    let land: (result: WalkInResult) => void = () => undefined;
    const confirm = jest.fn(
      () =>
        new Promise<WalkInResult>((resolve) => {
          land = resolve;
        }),
    );
    const checkedIn = jest.fn<void, [CheckInFacts]>();
    const store = walkInStoreForTest({ confirm, checkedIn });
    const started = store.getState().startWalkIn(SKY_LAGOON_ID);
    await new Promise((resolve) => setImmediate(resolve));
    expect(confirm).toHaveBeenCalledTimes(1);
    store.getState().reset();
    land(decodeWalkInResult(checkInJSON({ ratingPrompt: RATING_PROMPT, lifetimeCheckIns: 9 })));
    await started;
    expect(checkedIn).not.toHaveBeenCalled();
    expect(store.getState().showSuccess).toBe(false);
  });

  it('a walk-in paid on the hosted page reports the confirm’s ask, and its proof keeps the count', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on(
      'POST',
      '/bookings/payment-sessions',
      Reply.ok({ hasCard: false, externalSessionId: 'kling_cs_9', url: 'https://pay.kling.is/c/kling_cs_9', amountIsk: 1500 }),
    );
    api.on(
      'POST',
      '/bookings/payment-sessions/confirm',
      Reply.ok({
        status: 'fulfilled',
        checkInId: '9d7c1b2a-0000-4000-8000-000000000001',
        ratingPrompt: RATING_PROMPT,
        lifetimeCheckIns: 7,
      }),
    );
    openAuthSession.mockResolvedValue(PAID_LINK);
    const reported: CheckInFacts[] = [];
    const stop = onCheckInFacts('walkInVisitRating.test', (facts) => reported.push(facts));
    const leftProof = jest.fn<void, [ProofClosedFacts]>();
    try {
      const store = walkInStoreForTest({ leftProof });
      await store.getState().startWalkIn(SKY_LAGOON_ID);
      await store.getState().acceptWalkInCharge();

      expect(store.getState().showSuccess).toBe(true);
      expect(reported).toHaveLength(1);
      expect(reported[0].ratingPrompt?.id).toBe(RATING_PROMPT.id);
      expect(reported[0].lifetimeCheckIns).toBe(7);
      // The confirm carried the header that reserves the ask.
      expect(api.sent('/bookings/payment-sessions/confirm', 'POST').headers['x-lifepass-features']).toBe(
        'visit-rating-prompts',
      );
      expect(api.sent('/check-ins/walk-in', 'POST').headers['x-lifepass-features']).toBe('visit-rating-prompts');

      store.getState().resetSuccess();
      expect(leftProof).toHaveBeenCalledWith({ lifetimeCheckIns: 7 });
    } finally {
      stop();
    }
  });

  it('a recovered proof keeps the count its confirm said', () => {
    const store = walkInStoreForTest();
    store.getState().showRecoveredProof(
      { venueId: SKY_LAGOON_ID, venueName: 'Sky Lagoon', venueSlug: 'sky-lagoon', activityId: null, activityName: null, party: null },
      6,
    );
    expect(store.getState().successLifetimeCheckIns).toBe(6);
  });
});
