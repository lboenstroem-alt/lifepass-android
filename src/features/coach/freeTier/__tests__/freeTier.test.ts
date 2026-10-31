/**
 * The Coach's free tier on the phone (server PR #239): the port of iOS
 * CoachFreeTierTests (the view-model cases, run against the same rules the
 * store applies; the profile block's decoding is F3's, in
 * src/api/__tests__/profile.test.ts, and "no free tier line says tomorrow" is
 * F1's, in src/i18n/__tests__/featureCopy.test.ts).
 *
 * An account with neither a membership nor an active visitor pass has 3
 * messages in any rolling 30 days, then a membership prompt. The two limits
 * must never be mistaken for each other, and a free account is never told
 * to come back tomorrow.
 */
import { decodeProblemDetails, ProblemError, type CoachFreeMessages } from '../../../../api';
import type { ProfileCoachBlock } from '../../../../api/profile';
import { lookup, translate, type Lang, type Params } from '../../../../i18n';
import {
  applyCoachLimit,
  applyProfileCoach,
  forNewChat,
  INITIAL_FREE_TIER,
  inputPromptKey,
  isAILocked,
  isCoachBusy,
  isExhausted,
  recordFreeMessages,
  type FreeTierState,
} from '../freeTier';
import { freeLimitBody } from '../FreeTierStrip';

// expo-font (behind @expo/vector-icons, which the UI kit draws with) imports
// expo-asset, which npm left nested under expo/ where Jest cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

/** The server's pinned 429 (`route.test.ts`). */
const FREE_LIMIT_BODY = {
  type: 'https://lifepass.is/problems/coach-free-limit',
  title: 'coach_free_limit',
  status: 429,
  detail: 'You have used your 3 free Coach messages. Want to keep going?',
  instance: '/api/v1/coach',
  freeMessages: { limit: 3, remaining: 0, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' },
  upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
};

function problem(body: Record<string, unknown>): ProblemError {
  const details = decodeProblemDetails(body);
  if (!details) throw new Error('not a problem body');
  return new ProblemError(details, typeof body.status === 'number' ? body.status : 0);
}

const counts = (remaining: number, resetsAt?: Date): CoachFreeMessages => ({ limit: 3, remaining, resetsAt });

const block = (
  tier: ProfileCoachBlock['tier'],
  freeMessages: CoachFreeMessages | null = null,
): ProfileCoachBlock => ({ tier, freeMessages, upgrade: null });

// ---------------------------------------------------------------------------

describe('the refusal', () => {
  it('carries the count and the way on (testTheFreeLimitRefusalCarriesTheCountAndTheWayOn)', () => {
    const error = problem(FREE_LIMIT_BODY);
    expect(error.isProblem('coach-free-limit')).toBe(true);
    expect(error.status).toBe(429);
    expect(error.freeMessages?.limit).toBe(3);
    expect(error.freeMessages?.remaining).toBe(0);
    expect(error.upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/plans' });
    expect(error.messageIn('en')).toBe('You have used your 3 free Coach messages. Want to keep going?');
  });

  it('a malformed count leaves the refusal readable (testAMalformedCountLeavesTheRefusalReadable)', () => {
    const error = problem({
      type: 'https://lifepass.is/problems/coach-free-limit',
      status: 429,
      detail: 'Used.',
      freeMessages: { limit: 'three' },
      upgrade: 'plans',
    });
    expect(error.isProblem('coach_free_limit')).toBe(true);
    expect(error.freeMessages).toBeUndefined();
    expect(error.upgrade).toBeUndefined();
    expect(error.messageIn('en')).toBe('Used.');
  });
});

// ---------------------------------------------------------------------------

describe('the locks', () => {
  it('tells the two limits apart (testTheTwoLimitsAreToldApart)', () => {
    const free = applyCoachLimit(INITIAL_FREE_TIER, problem(FREE_LIMIT_BODY));
    expect(free.kind).toBe('free');
    expect(free.state.freeLimitReached).toBe(true);
    // A free account has no daily cap to be back from tomorrow.
    expect(free.state.limitReached).toBe(false);
    expect(isAILocked(free.state)).toBe(true);
    expect(free.state.upgrade?.action).toBe('plans');

    const daily = applyCoachLimit(
      INITIAL_FREE_TIER,
      problem({
        type: 'https://lifepass.is/problems/coach-daily-limit',
        title: 'coach_daily_limit',
        status: 429,
        detail: "You have used all of today's coach messages. They come back at midnight, Iceland time.",
      }),
    );
    expect(daily.kind).toBe('daily');
    expect(daily.state.limitReached).toBe(true);
    expect(daily.state.freeLimitReached).toBe(false);
    expect(daily.state.freeMessages).toBeNull();
  });

  it('a free-limit refusal with no count reads as nothing left, keeping what was known', () => {
    const resetsAt = new Date('2099-01-01T00:00:00Z');
    const before: FreeTierState = { ...INITIAL_FREE_TIER, freeMessages: { limit: 5, remaining: 1, resetsAt } };
    const { state } = applyCoachLimit(
      before,
      problem({ type: 'https://lifepass.is/problems/coach-free-limit', status: 429 }),
    );
    expect(state.freeMessages).toEqual({ limit: 5, remaining: 0, windowDays: 30, resetsAt });
    expect(state.freeLimitReached).toBe(true);
    expect(state.freeCountHeardAt).not.toBeNull();
  });

  it('a busy Coach is a retry, not a lock (testABusyCoachIsARetryNotALock)', () => {
    const busy = problem({
      type: 'https://lifepass.is/problems/coach-busy',
      title: 'coach_busy',
      status: 503,
      detail: 'The coach is getting a lot of requests from your network right now.',
    });
    expect(isCoachBusy(busy)).toBe(true);
    const result = applyCoachLimit(INITIAL_FREE_TIER, busy);
    expect(result.kind).toBeNull();
    expect(result.state).toBe(INITIAL_FREE_TIER);
    expect(isAILocked(result.state)).toBe(false);

    const upstream = problem({ type: 'https://lifepass.is/problems/coach_upstream_error', status: 502 });
    expect(isCoachBusy(upstream)).toBe(false);
    // A 503 that is not the busy guard is not busy either.
    expect(isCoachBusy(problem({ type: 'https://lifepass.is/problems/internal_error', status: 503 }))).toBe(false);
  });

  it('a new chat stays locked while nothing is left (testANewChatStaysLockedWhileNothingIsLeft)', () => {
    let state = applyCoachLimit(INITIAL_FREE_TIER, problem(FREE_LIMIT_BODY)).state;
    state = forNewChat(state);
    expect(state.freeLimitReached).toBe(true);
    expect(isAILocked(state)).toBe(true);

    // One frees up (the window moved on): the next chat is open again.
    state = recordFreeMessages(state, counts(1));
    state = forNewChat(state);
    expect(state.freeLimitReached).toBe(false);

    // The daily lock of a member still clears on a new chat, as before.
    const member = applyCoachLimit(
      INITIAL_FREE_TIER,
      problem({ type: 'https://lifepass.is/problems/coach-daily-limit', status: 429 }),
    ).state;
    expect(forNewChat(member).limitReached).toBe(false);
  });

  it('the answer that spends the last free message brings the prompt (testTheAnswerThatSpendsTheLastFreeMessageBringsThePrompt)', () => {
    const now = Date.now();
    let state = recordFreeMessages(INITIAL_FREE_TIER, counts(1), now);
    expect(state.freeLimitReached).toBe(false);
    state = recordFreeMessages(state, counts(0, new Date(now + 86_400_000)), now);
    expect(state.freeLimitReached).toBe(true);
    // A reset time already passed means a message has freed up.
    state = recordFreeMessages(state, counts(0, new Date(now - 60_000)), now);
    expect(state.freeLimitReached).toBe(false);
  });

  it('nothing left with no reset time is exhausted', () => {
    expect(isExhausted(counts(0))).toBe(true);
    expect(isExhausted(counts(2))).toBe(false);
  });

  it('a membership bought lifts the free lock (testAMembershipBoughtLiftsTheFreeLock)', () => {
    let state = applyProfileCoach(INITIAL_FREE_TIER, block('free', counts(0, new Date(Date.now() + 86_400_000))), null);
    expect(state.freeLimitReached).toBe(true);
    state = applyProfileCoach(state, block('member'), null);
    expect(state.freeLimitReached).toBe(false);
    expect(state.freeMessages).toBeNull();
    // A block the server could not read changes nothing.
    expect(applyProfileCoach(state, null, null)).toBe(state);
    expect(isAILocked(state)).toBe(false);
  });

  it('a pass holder has the full Coach too, and an unknown tier changes nothing', () => {
    const locked = applyProfileCoach(INITIAL_FREE_TIER, block('free', counts(0)), null);
    expect(applyProfileCoach(locked, block('pass_holder'), null).freeLimitReached).toBe(false);
    expect(applyProfileCoach(locked, block('unknown'), null)).toBe(locked);
    expect(applyProfileCoach(locked, block(null), null)).toBe(locked);
  });

  it('a free block keeps an upgrade it brings', () => {
    const state = applyProfileCoach(
      INITIAL_FREE_TIER,
      { tier: 'free', freeMessages: counts(3), upgrade: { action: 'plans', url: 'https://www.lifepass.is/is/plans' } },
      null,
    );
    expect(state.upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/is/plans' });
    expect(state.freeMessages?.remaining).toBe(3);
  });

  /**
   * The Coach tab hands the store the profile it has on every visit, often
   * the one read at launch. That read must not put back a count an answer
   * replaced, nor lift the lock the third answer set.
   */
  it('an older profile read never undoes what an answer said (testAnOlderProfileReadNeverUndoesWhatAnAnswerSaid)', () => {
    const now = Date.now();
    const launchRead = new Date(now - 120_000);
    const unspent = block('free', counts(3));

    let state = applyProfileCoach(INITIAL_FREE_TIER, unspent, launchRead, now);
    expect(state.freeMessages?.remaining).toBe(3);

    // One answer: 2 left. The tab is left and opened again.
    state = recordFreeMessages(state, counts(2), now);
    state = applyProfileCoach(state, unspent, launchRead, now);
    expect(state.freeMessages?.remaining).toBe(2);

    // All three spent: the lock and the prompt survive the same visit.
    state = applyCoachLimit(state, problem(FREE_LIMIT_BODY), now).state;
    state = applyProfileCoach(state, unspent, launchRead, now);
    expect(state.freeLimitReached).toBe(true);
    expect(state.freeMessages?.remaining).toBe(0);
    // A block with no read time never overrides an answer.
    state = applyProfileCoach(state, unspent, null, now);
    expect(state.freeLimitReached).toBe(true);

    // A read sent AFTER the refusal is newer than it, and wins: the
    // membership bought from the prompt lifts the lock.
    state = applyProfileCoach(state, block('member'), new Date(now + 1_000), now);
    expect(state.freeLimitReached).toBe(false);
    expect(state.freeMessages).toBeNull();
  });

  it('a newer profile read replaces an older count (testANewerProfileReadReplacesAnOlderCount)', () => {
    const now = Date.now();
    let state = recordFreeMessages(INITIAL_FREE_TIER, counts(1), now);
    state = applyProfileCoach(state, block('free', counts(2)), new Date(now + 1_000), now);
    expect(state.freeMessages?.remaining).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('the words', () => {
  it('the placeholder never says "back tomorrow" to a free account', () => {
    expect(inputPromptKey({ limitReached: false, freeLimitReached: false })).toBe('coach.input.placeholder');
    expect(inputPromptKey({ limitReached: true, freeLimitReached: false })).toBe('coach.input.limit_reached');
    expect(inputPromptKey({ limitReached: true, freeLimitReached: true })).toBe('coach.input.free_limit');
    expect(inputPromptKey({ limitReached: false, freeLimitReached: true })).toBe('coach.input.free_limit');
  });

  const tFor =
    (lang: Lang) =>
    (key: string, params?: Readonly<Record<string, string | number>>): string =>
      translate(key, lang, params as Params);

  it('the card names the day the next free message is ready, only when it is still ahead', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const resetsAt = new Date('2026-10-10T08:00:00Z');
    const en = freeLimitBody(counts(0, resetsAt), 'en', tFor('en'), now);
    expect(en.startsWith(lookup('coach.free.limit.body', 'en'))).toBe(true);
    expect(en).toContain(lookup('coach.free.limit.next', 'en').split('{date}')[0]!.trim());
    expect(en).toMatch(/10/);

    // Past or absent: the membership line alone.
    expect(freeLimitBody(counts(0, new Date(now - 1_000)), 'en', tFor('en'), now)).toBe(lookup('coach.free.limit.body', 'en'));
    expect(freeLimitBody(counts(0), 'en', tFor('en'), now)).toBe(lookup('coach.free.limit.body', 'en'));
    expect(freeLimitBody(null, 'en', tFor('en'), now)).toBe(lookup('coach.free.limit.body', 'en'));
  });

  it('the Icelandic short day loses its own full stop: the sentence brings one', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const text = freeLimitBody(counts(0, new Date('2026-10-10T08:00:00Z')), 'is', tFor('is'), now);
    expect(text.startsWith(lookup('coach.free.limit.body', 'is'))).toBe(true);
    expect(text).not.toMatch(/\.\./);
    expect(text).not.toMatch(/\. \./);
  });
});
