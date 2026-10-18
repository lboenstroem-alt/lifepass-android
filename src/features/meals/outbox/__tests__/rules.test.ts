/**
 * The meal outbox's decisions (iOS MealOutboxRuleTests, `ios-ux.md` 16.6): a
 * logged meal is never lost, never logged twice, and a background flush
 * never asks anything.
 */
import {
  DecodingError,
  HttpStatusError,
  NotAuthenticatedError,
  ProblemError,
  TransportError,
  type ApiError,
} from '../../../../api';
import { draftInput, quickAddDraft, type MealCreateBody } from '../../types';
import { decodeOutboxQueue, encodeOutboxItem } from '../mealOutbox';
import { isTooOld, MEAL_OUTBOX_CAPACITY, MEAL_OUTBOX_MAX_AGE_MS, mealOutboxStep, type MealOutboxItem } from '../rules';

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

const background = { foreground: false, entitled: true };
const foreground = { foreground: true, entitled: true };

function body(overrides: Partial<MealCreateBody> = {}): MealCreateBody {
  return { slot: 'lunch', loggedAt: new Date(), logDate: '2026-09-22', source: 'search', items: [], ...overrides };
}

describe('MealOutboxRules.step', () => {
  it('a success or a replay removes the entry (testASuccessOrAReplayRemovesTheEntry)', () => {
    expect(mealOutboxStep(null, background)).toBe('sent');
  });

  it('no network keeps it and stops (testNoNetworkKeepsItAndStops)', () => {
    expect(mealOutboxStep(new TransportError('offline'), background)).toBe('stop');
    expect(mealOutboxStep(problem('internal_error', 500), foreground)).toBe('stop');
    expect(mealOutboxStep(problem('rate-limited', 429), foreground)).toBe('stop');
  });

  it('a timeout, a dropped connection and a lost session keep it too', () => {
    expect(mealOutboxStep(new TransportError('timeout'), background)).toBe('stop');
    expect(mealOutboxStep(new TransportError('network'), background)).toBe('stop');
    expect(mealOutboxStep(new NotAuthenticatedError(), foreground)).toBe('stop');
  });

  it('what the server will never take is dropped (testWhatTheServerWillNeverTakeIsDropped)', () => {
    for (const slug of ['health_meal_deleted', 'idempotency_key_reused', 'invalid-meal', 'health_meal_not_found']) {
      expect([slug, mealOutboxStep(problem(slug, 409), foreground)]).toEqual([slug, 'drop']);
    }
  });

  it('any other not-found, a hyphenated spelling, and any other 400 are dropped', () => {
    expect(mealOutboxStep(problem('health-meal-deleted', 409), foreground)).toBe('drop');
    expect(mealOutboxStep(problem('invalid_meal', 400), foreground)).toBe('drop');
    expect(mealOutboxStep(problem('food_not_found', 404), background)).toBe('drop');
    expect(mealOutboxStep(problem('validation_failed', 400), background)).toBe('drop');
  });

  it('a membership or consent refusal waits for the member (testAMembershipOrConsentRefusalWaitsForTheMember)', () => {
    expect(mealOutboxStep(problem('no_active_plan_or_pass', 403), foreground)).toBe('markFailed');
    expect(mealOutboxStep(problem('health_consent_required', 409), foreground)).toBe('markFailed');
  });

  it('a pending deletion, a minor and an unknown refusal wait for the member as well', () => {
    expect(mealOutboxStep(problem('account_pending_deletion', 403), background)).toBe('markFailed');
    expect(mealOutboxStep(problem('health_minor_blocked', 403), background)).toBe('markFailed');
    expect(mealOutboxStep(problem('something_new', 403), background)).toBe('markFailed');
  });

  it('a background consent refusal reconciles (testABackgroundConsentRefusalReconciles)', () => {
    expect(mealOutboxStep(problem('health_consent_required', 409), background)).toBe('reconcile');
    expect(mealOutboxStep(problem('health_consent_required', 409), { foreground: true, entitled: false })).toBe('reconcile');
  });

  it('a page from the edge never drops a queued meal (testAPageFromTheEdgeNeverDropsAQueuedMeal)', () => {
    for (const code of [401, 403, 404, 410]) {
      expect([code, mealOutboxStep(new HttpStatusError(code, '<html>'), background)]).toEqual([code, 'markFailed']);
    }
    for (const code of [0, 429, 502, 503]) {
      expect([code, mealOutboxStep(new HttpStatusError(code, '<html>'), background)]).toEqual([code, 'stop']);
    }
  });

  it('an answer that could not be read means it was stored', () => {
    expect(mealOutboxStep(new DecodingError('{"ok":true'), background)).toBe('sent');
  });
});

describe('the queue limits', () => {
  it('an entry older than seven days is too old (testAnEntryOlderThanSevenDaysIsTooOld)', () => {
    const now = new Date();
    const day = 86_400_000;
    const fresh: MealOutboxItem = { id: 'a', body: body(), key: 'k', createdAt: new Date(now.getTime() - 6 * day), state: 'pending' };
    const stale: MealOutboxItem = { id: 'b', body: body(), key: 'k', createdAt: new Date(now.getTime() - 8 * day), state: 'pending' };
    expect(isTooOld(fresh, now)).toBe(false);
    expect(isTooOld(stale, now)).toBe(true);
    expect(MEAL_OUTBOX_CAPACITY).toBe(10);
    expect(MEAL_OUTBOX_MAX_AGE_MS).toBe(7 * day);
  });

  it('a queued meal round-trips with its key (testAQueuedMealRoundTripsWithItsKey)', () => {
    const item = quickAddDraft({ label: 'Soup', kcal: 320, protein: null, carbs: null, fat: null, servingLabel: '1 serving' });
    const entry: MealOutboxItem = {
      id: 'a',
      body: body({ loggedAt: new Date(1_790_000_000_000), source: 'quick_add', items: [draftInput(item)] }),
      key: 'key-123',
      createdAt: new Date(1_790_000_000_000),
      state: 'pending',
    };
    const [back] = decodeOutboxQueue(JSON.parse(JSON.stringify([encodeOutboxItem(entry)])));
    expect(back).toEqual(entry);
    expect(back?.body.items[0]?.perServing?.kcal).toBe(320);
    // The per-serving macros nobody typed stay explicit nulls on disk, as on the wire.
    expect(JSON.stringify(encodeOutboxItem(entry))).toContain('"proteinG":null');
  });

  it('one entry that cannot be read is dropped; the others stand', () => {
    const entry: MealOutboxItem = { id: 'a', body: body(), key: 'k-a', createdAt: new Date(1_790_000_000_000), state: 'failed' };
    const queue = decodeOutboxQueue([{ id: 'x', state: 'pending' }, encodeOutboxItem(entry), { ...encodeOutboxItem(entry), state: 'sending' }]);
    expect(queue.map((item) => [item.id, item.state])).toEqual([['a', 'failed']]);
    expect(() => decodeOutboxQueue({ items: [] })).toThrow();
  });
});
