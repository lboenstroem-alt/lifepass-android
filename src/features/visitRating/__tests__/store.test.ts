/**
 * The visit rating's rules (./store.ts) on fake dependencies: when the card
 * asks the server (once per foreground, never over a flow, never signed
 * out), the sheet from a star and from a notification, Send's key (one per
 * tap, the same one when that send is tried again), the refusals, "Not now",
 * the happy moment after the thank-you, and the sign-out fence.
 */
import { ProblemError, TransportError } from '../../../api';
import type { VisitRatingAnswerResult, VisitRatingPrompt } from '../../../api/visitRating';
import { answerInput, canSend, clampStars } from '../store';

import { HAPPY_ANSWER, prompt, PROMPT_ID, storeOnFakes } from './fixtures';

const problem = (status: number, slug: string, extra: Record<string, unknown> = {}, retryAfterSeconds?: number) =>
  new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status, ...extra }, status, {
    retryAfterSeconds,
  });

/** A promise this test resolves itself. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the card asks the server', () => {
  it('not before the first activation, then once per foreground', async () => {
    const { store, deps } = storeOnFakes();
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(0);

    store.getState().noteForeground();
    await store.getState().checkForCard();
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(1);
    expect(store.getState().card?.id).toBe(PROMPT_ID);

    store.getState().noteForeground();
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(2);
  });

  it('never while a booking, payment or check-in flow is on screen; once it is over, it asks', async () => {
    const { store, deps } = storeOnFakes();
    store.getState().noteForeground();
    deps.flow = true;
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(0);
    deps.flow = false;
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(1);
  });

  it('never signed out', async () => {
    const { store, deps } = storeOnFakes();
    store.getState().noteForeground();
    deps.signedIn = false;
    await store.getState().checkForCard();
    expect(deps.fetches).toBe(0);
  });

  it('null is no card; an older server or no network is no card either, and nothing breaks', async () => {
    let answer: () => Promise<VisitRatingPrompt | null> = async () => null;
    const { store } = storeOnFakes({ current: () => answer() });
    store.getState().noteForeground();
    await store.getState().checkForCard();
    expect(store.getState().card).toBeNull();

    answer = async () => prompt();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    expect(store.getState().card).not.toBeNull();

    answer = async () => {
      throw problem(404, 'not_found');
    };
    store.getState().noteForeground();
    await expect(store.getState().checkForCard()).resolves.toBeUndefined();
    expect(store.getState().card).toBeNull();

    answer = async () => {
      throw new TransportError('offline');
    };
    store.getState().noteForeground();
    await store.getState().checkForCard();
    expect(store.getState().card).toBeNull();
  });

  it('two callers at once share one request', async () => {
    const held = deferred<VisitRatingPrompt | null>();
    const { store, deps } = storeOnFakes({ current: () => held.promise });
    store.getState().noteForeground();
    const card = store.getState().checkForCard();
    const tap = store.getState().openFromNotification();
    held.resolve(prompt());
    await Promise.all([card, tap]);
    expect(deps.fetches).toBe(1);
    expect(store.getState().sheet?.prompt.id).toBe(PROMPT_ID);
  });
});

describe('the sheet', () => {
  it('a star on the card opens it with that overall chosen', async () => {
    const { store } = storeOnFakes();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().openFromCard(4);
    expect(store.getState().sheet).toMatchObject({ overall: 4, equipment: 0, cleanliness: 0, comment: '', phase: 'form' });
  });

  it('a tapped notification opens it for what the server says is current, and nothing for null', async () => {
    let answer: VisitRatingPrompt | null = null;
    const { store } = storeOnFakes({ current: async () => answer });
    await store.getState().openFromNotification();
    expect(store.getState().sheet).toBeNull();
    answer = prompt({ hasWrittenReview: true });
    await store.getState().openFromNotification();
    expect(store.getState().sheet).toMatchObject({ overall: 0, hasWrittenReview: true });
    expect(store.getState().card?.id).toBe(PROMPT_ID);
  });

  it('the rows: the overall cannot be taken back, the optional ones can; the comment stops at 500', async () => {
    const { store } = storeOnFakes();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().openFromCard(3);
    store.getState().setStars('overall', 0);
    store.getState().setStars('equipment', 7);
    store.getState().setStars('cleanliness', 2);
    store.getState().setStars('cleanliness', 0);
    store.getState().setComment('x'.repeat(600));
    expect(store.getState().sheet).toMatchObject({ overall: 3, equipment: 5, cleanliness: 0 });
    expect(store.getState().sheet?.comment).toHaveLength(500);
    expect(clampStars(2.6)).toBe(3);
    expect(clampStars(Number.NaN)).toBe(0);
  });

  it('Send waits for the overall; a written review sends no comment', () => {
    const sheet = {
      prompt: prompt(),
      overall: 0,
      equipment: 4,
      cleanliness: 0,
      comment: 'Spotless',
      phase: 'form' as const,
      errorKey: null,
      sendBlockedUntil: null,
      happyMoment: false,
      hasWrittenReview: false,
    };
    expect(canSend(sheet)).toBe(false);
    expect(answerInput(sheet)).toBeNull();
    expect(answerInput({ ...sheet, overall: 5 })).toEqual({
      rating: 5,
      equipmentRating: 4,
      cleanlinessRating: null,
      comment: 'Spotless',
    });
    expect(answerInput({ ...sheet, overall: 5, hasWrittenReview: true })?.comment).toBeNull();
    expect(canSend({ ...sheet, overall: 1, sendBlockedUntil: 10_000 }, 9_999)).toBe(false);
    expect(canSend({ ...sheet, overall: 1, sendBlockedUntil: 10_000 }, 10_000)).toBe(true);
  });
});

describe('Send', () => {
  async function openSheet(overrides: Parameters<typeof storeOnFakes>[0] = {}) {
    const fakes = storeOnFakes(overrides);
    fakes.store.getState().noteForeground();
    await fakes.store.getState().checkForCard();
    fakes.store.getState().openFromCard(5);
    return fakes;
  }

  it('the thank-you: the card and the notification go, and the Google Play ask waits for the sheet to go', async () => {
    const { store, deps } = await openSheet();
    await store.getState().send();
    expect(store.getState().sheet).toMatchObject({ phase: 'thanks', happyMoment: true, hasWrittenReview: false });
    expect(store.getState().card).toBeNull();
    expect(deps.cancelled).toEqual([PROMPT_ID]);
    expect(deps.answers[0].input).toEqual({ rating: 5, equipmentRating: null, cleanlinessRating: null, comment: '' });

    store.getState().closeSheet();
    expect(deps.happyMoments).toBe(0); // still sliding away
    store.getState().sheetGone();
    expect(deps.happyMoments).toBe(1);
    store.getState().sheetGone();
    expect(deps.happyMoments).toBe(1);
  });

  it('three stars or fewer is no happy moment', async () => {
    const { store, deps } = await openSheet({ answer: async () => ({ ...HAPPY_ANSWER, happyMoment: false }) });
    await store.getState().send();
    store.getState().closeSheet();
    store.getState().sheetGone();
    expect(deps.happyMoments).toBe(0);
  });

  it('"Write a public review" goes to the venue, with no Google Play popup over it', async () => {
    const { store, deps } = await openSheet();
    await store.getState().send();
    expect(store.getState().writeReview()?.venueSlug).toBe('world-class-laugar');
    expect(store.getState().sheet).toBeNull();
    store.getState().sheetGone();
    expect(deps.happyMoments).toBe(0);
  });

  it('no "Write a public review" over a written review', async () => {
    const { store } = await openSheet({ answer: async () => ({ ...HAPPY_ANSWER, hasWrittenReview: true }) });
    await store.getState().send();
    expect(store.getState().writeReview()).toBeNull();
    expect(store.getState().sheet?.phase).toBe('thanks');
  });

  it('one key per tap of Send; the same answer sent again after a failure reuses it; a changed one does not', async () => {
    let fail = true;
    const { store, deps } = await openSheet({
      answer: async () => {
        if (fail) throw new TransportError('offline');
        return HAPPY_ANSWER;
      },
    });
    await store.getState().send();
    expect(store.getState().sheet).toMatchObject({ phase: 'form', errorKey: 'visitRating.error.network' });
    await store.getState().send();
    expect(deps.answers.map((answer) => answer.key)).toEqual(['key-1', 'key-1']);

    store.getState().setStars('equipment', 3);
    await store.getState().send();
    expect(deps.answers[2].key).toBe('key-2');

    fail = false;
    await store.getState().send();
    expect(deps.answers[3].key).toBe('key-2');
    expect(store.getState().sheet?.phase).toBe('thanks');
  });

  it('a new sheet is a new answer under a new key', async () => {
    const { store, deps } = await openSheet({ answer: async () => HAPPY_ANSWER });
    await store.getState().send();
    store.getState().closeSheet();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().openFromCard(5);
    await store.getState().send();
    expect(deps.answers.map((answer) => answer.key)).toEqual(['key-1', 'key-2']);
  });

  it.each([
    ['409 answered', problem(409, 'visit_rating_prompt_closed', { reason: 'answered' }), 'visitRating.error.answered'],
    ['409 expired', problem(409, 'visit_rating_prompt_closed', { reason: 'expired' }), 'visitRating.error.expired'],
    ['409 dismissed', problem(409, 'visit_rating_prompt_closed', { reason: 'dismissed' }), 'visitRating.error.dismissed'],
    ['403 voided visit', problem(403, 'review_visit_required'), 'visitRating.error.visitGone'],
    ['404 not this member', problem(404, 'visit_rating_prompt_not_found'), 'visitRating.error.dismissed'],
  ])('%s: closes the sheet, cancels the notification and says why once it has gone', async (_name, error, key) => {
    const { store, deps } = await openSheet({
      answer: async () => {
        throw error;
      },
    });
    await store.getState().send();
    expect(store.getState().sheet).toBeNull();
    expect(store.getState().card).toBeNull();
    expect(deps.cancelled).toEqual([PROMPT_ID]);
    expect(store.getState().takeNotice()).toBe(key);
    expect(store.getState().takeNotice()).toBeNull();
  });

  it('400 keeps the sheet open', async () => {
    const { store, deps } = await openSheet({
      answer: async () => {
        throw problem(400, 'invalid-visit-rating-answer');
      },
    });
    await store.getState().send();
    expect(store.getState().sheet).toMatchObject({ phase: 'form', errorKey: 'visitRating.error.network' });
    expect(deps.cancelled).toEqual([]);
  });

  it('429 holds Send back for Retry-After', async () => {
    const { store, deps } = await openSheet({
      answer: async () => {
        throw problem(429, 'rate-limited', {}, 20);
      },
    });
    await store.getState().send();
    const sheet = store.getState().sheet;
    expect(sheet).toMatchObject({ phase: 'form', errorKey: 'visitRating.error.network', sendBlockedUntil: deps.clock + 20_000 });
    await store.getState().send();
    expect(deps.answers).toHaveLength(1);
    deps.clock += 20_000;
    await store.getState().send();
    expect(deps.answers).toHaveLength(2);
    expect(deps.answers[1].key).toBe(deps.answers[0].key);
  });

  it('a 5xx keeps the sheet and lets the member try again', async () => {
    const { store } = await openSheet({
      answer: async () => {
        throw problem(503, 'internal_error');
      },
    });
    await store.getState().send();
    expect(store.getState().sheet).toMatchObject({ phase: 'form', errorKey: 'visitRating.error.network' });
  });

  it('cannot be closed while sending; a second tap sends nothing', async () => {
    const held = deferred<VisitRatingAnswerResult>();
    const { store, deps } = await openSheet({ answer: () => held.promise });
    const sending = store.getState().send();
    expect(store.getState().sheet?.phase).toBe('sending');
    store.getState().closeSheet();
    store.getState().notNow();
    void store.getState().send();
    expect(store.getState().sheet?.phase).toBe('sending');
    held.resolve(HAPPY_ANSWER);
    await sending;
    expect(deps.answers).toHaveLength(1);
    expect(deps.dismissed).toEqual([]);
  });

  it('an answer that lands after a sign-out writes nothing', async () => {
    const held = deferred<VisitRatingAnswerResult>();
    const { store, deps } = await openSheet({ answer: () => held.promise });
    const sending = store.getState().send();
    store.getState().reset();
    held.resolve(HAPPY_ANSWER);
    await sending;
    expect(store.getState().sheet).toBeNull();
    expect(store.getState().card).toBeNull();
    expect(deps.cancelled).toEqual([]);
  });
});

describe('"Not now"', () => {
  it('from the card: dismissed on the server, the card and the notification gone', async () => {
    const { store, deps } = storeOnFakes();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().notNow();
    expect(store.getState().card).toBeNull();
    expect(deps.dismissed).toEqual([PROMPT_ID]);
    expect(deps.cancelled).toEqual([PROMPT_ID]);
  });

  it('from the sheet: the same', async () => {
    const { store, deps } = storeOnFakes();
    await store.getState().openFromNotification();
    store.getState().notNow();
    expect(store.getState().sheet).toBeNull();
    expect(deps.dismissed).toEqual([PROMPT_ID]);
  });

  it('an ask the server still shows after "Not now" (the dismiss never reached it) is dismissed again, not shown', async () => {
    const { store, deps } = storeOnFakes();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().notNow();
    await new Promise((resolve) => setImmediate(resolve));
    store.getState().noteForeground();
    await store.getState().checkForCard();
    expect(store.getState().card).toBeNull();
    expect(deps.dismissed).toEqual([PROMPT_ID, PROMPT_ID]);
  });

  it('closing the sheet without an answer keeps the card', async () => {
    const { store, deps } = storeOnFakes();
    store.getState().noteForeground();
    await store.getState().checkForCard();
    store.getState().openFromCard(2);
    store.getState().closeSheet();
    store.getState().sheetGone();
    expect(store.getState().card?.id).toBe(PROMPT_ID);
    expect(deps.dismissed).toEqual([]);
    expect(deps.happyMoments).toBe(0);
  });
});
