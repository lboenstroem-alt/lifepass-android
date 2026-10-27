/* eslint lifepass/no-literal-copy: "error" */
/**
 * "How was your visit?": the Home card, the sheet and its thank-you, as a
 * framework-free zustand store (docs/05, "Visit ratings ("How was your
 * visit?") and the App Store ask"; owner decisions of 27 October 2026).
 *
 *   foreground ─► Home on screen, nothing to cover ─► GET current ─┬─ an ask: the card
 *                                                                  └─ null: nothing
 *   card star ─► the sheet, that overall chosen
 *   notification tap ─► GET current ─► the sheet (nothing when it answers null)
 *   Send ─► POST answer ─┬─ the thank-you ─► Done ─► (4 or 5 stars) the Google Play ask
 *                        └─ refused: the error table (`answerFailure`)
 *   "Not now" ─► POST dismiss, the card and the notification gone
 *
 * THE SERVER DECIDES. When to ask, and which visit, is the server's (at most
 * once a member in 30 days, never a venue twice in 90). This store shows
 * what `current` returns and nothing else.
 *
 * `current` STAMPS THE ASK SHOWN on its first answer, so it is called only
 * when the card or the sheet is about to show it: Home on screen (the card's
 * place), at most once per return to the foreground, and never while a
 * booking, payment or check-in flow is on screen (src/app/flowsOnScreen.ts).
 * A tap on the notification asks once more, for the sheet. Two callers at
 * once share one request.
 *
 * FAIL SOFT. An older server (no route), no network, a 429 or a body that
 * does not read: no card, nothing said, nothing broken.
 *
 * SEND'S KEY. One Idempotency-Key per tap of Send. A send that did not go
 * through (no answer, a 5xx, a 429, a 400) keeps its key, and the next tap
 * with the same answer reuses it: that is the same send tried again, and if
 * the first one did land the server answers it again (the thank-you)
 * instead of "You've already rated this visit". A changed answer is a new
 * send, under a new key.
 *
 * THE FENCE. The store outlives every screen and the session: a sign-out
 * (`reset`) begins a new session, and an answer that lands after it writes
 * nothing.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  answerFailure,
  answerVisitRatingPrompt,
  dismissVisitRatingPrompt,
  fetchCurrentVisitRatingPrompt,
  VISIT_RATING_COMMENT_MAX,
  visitRatingAnswerBody,
  type Stars,
  type VisitRatingAnswerInput,
  type VisitRatingAnswerResult,
  type VisitRatingPrompt,
} from '../../api/visitRating';
import { newIdempotencyKey } from '../../api/idempotency';
import { flowOnScreen } from '../../app/flowsOnScreen';
import { useAppStore } from '../../stores/appStore';
import { askForStoreReview } from '../storeReview';

import { cancelVisitRatingNotification } from './notifications';

// ---------------------------------------------------------------------------
// State

/** The sheet's three rows of stars. */
export type StarRow = 'overall' | 'equipment' | 'cleanliness';

export type SheetPhase = 'form' | 'sending' | 'thanks';

export interface VisitRatingSheetState {
  readonly prompt: VisitRatingPrompt;
  /** 0 until chosen (Send waits for it); 1 to 5. */
  readonly overall: number;
  /** 0 is "not given" (optional). */
  readonly equipment: number;
  /** 0 is "not given" (optional). */
  readonly cleanliness: number;
  /** What the member typed (at most `VISIT_RATING_COMMENT_MAX` characters). */
  readonly comment: string;
  readonly phase: SheetPhase;
  /** The words under the form after a send that did not go through (a visitRating.error.* key). */
  readonly errorKey: string | null;
  /** After a 429: Send waits until then (ms since epoch). */
  readonly sendBlockedUntil: number | null;
  /** The thank-you: 4 or 5 stars (the Google Play ask follows the thank-you). */
  readonly happyMoment: boolean;
  /**
   * The member's row is a written review: the form hides the comment and
   * says the stars replace the review's; the thank-you offers no "Write a
   * public review". From the ask, then from the answer.
   */
  readonly hasWrittenReview: boolean;
}

export interface VisitRatingState {
  /** The ask Home's card shows, or null. */
  readonly card: VisitRatingPrompt | null;
  /** The sheet on screen, or null. */
  readonly sheet: VisitRatingSheetState | null;
  /**
   * Bumped at every activation (the first profile read, each return to the
   * foreground); 0 until the first, when the card waits.
   */
  readonly foreground: number;
  /** Something to say once the sheet has gone (a visitRating.error.* key), or null. */
  readonly notice: string | null;
}

export interface VisitRatingActions {
  /** The app came to the foreground (or the profile loaded) with a member signed in. */
  noteForeground(): void;
  /**
   * Home's card is on screen: asks `current` if this foreground has not yet,
   * and no flow it must not cover is on screen. Never throws.
   */
  checkForCard(): Promise<void>;
  /** A star on the card: the sheet, with that overall chosen. */
  openFromCard(stars: number): void;
  /** The notification was tapped: the sheet for what `current` returns (nothing for null). */
  openFromNotification(): Promise<void>;
  setStars(row: StarRow, stars: number): void;
  setComment(text: string): void;
  /** Send (see SEND'S KEY in the file comment). */
  send(): Promise<void>;
  /** "Not now", on the card or the sheet. */
  notNow(): void;
  /** Done, back or a pan down. Refused while sending. */
  closeSheet(): void;
  /** The sheet has left the screen: what waits for that happens now (the Google Play ask). */
  sheetGone(): void;
  /** "Write a public review": closes the thank-you; returns the ask whose venue page to open. */
  writeReview(): VisitRatingPrompt | null;
  /** Takes what is to be said (cleared). */
  takeNotice(): string | null;
  /** Everything forgotten (sign-out). */
  reset(): void;
}

export type VisitRatingStore = VisitRatingState & VisitRatingActions;

export const INITIAL_VISIT_RATING_STATE: VisitRatingState = Object.freeze({
  card: null,
  sheet: null,
  foreground: 0,
  notice: null,
});

// ---------------------------------------------------------------------------
// Pure helpers

/** A star count as the sheet keeps it: a whole number from 0 to 5. */
export function clampStars(stars: number): number {
  if (!Number.isFinite(stars)) return 0;
  return Math.min(5, Math.max(0, Math.round(stars)));
}

function asStars(value: number): Stars | null {
  const stars = clampStars(value);
  return stars >= 1 ? (stars as Stars) : null;
}

/** What Send posts for this sheet; null until the overall is chosen. */
export function answerInput(sheet: VisitRatingSheetState): VisitRatingAnswerInput | null {
  const rating = asStars(sheet.overall);
  if (rating === null) return null;
  return {
    rating,
    equipmentRating: asStars(sheet.equipment),
    cleanlinessRating: asStars(sheet.cleanliness),
    // A written review keeps its words: the field is hidden and nothing is sent.
    comment: sheet.hasWrittenReview ? null : sheet.comment,
  };
}

/** Send is possible: the overall is chosen, nothing in flight, no 429 wait running. */
export function canSend(sheet: VisitRatingSheetState | null, now: number = Date.now()): boolean {
  if (!sheet || sheet.phase !== 'form' || clampStars(sheet.overall) < 1) return false;
  return sheet.sendBlockedUntil === null || now >= sheet.sendBlockedUntil;
}

function newSheet(prompt: VisitRatingPrompt, overall: number): VisitRatingSheetState {
  return {
    prompt,
    overall: clampStars(overall),
    equipment: 0,
    cleanliness: 0,
    comment: '',
    phase: 'form',
    errorKey: null,
    sendBlockedUntil: null,
    happyMoment: false,
    hasWrittenReview: prompt.hasWrittenReview,
  };
}

// ---------------------------------------------------------------------------
// Dependencies

export interface VisitRatingDeps {
  fetchCurrent(): Promise<VisitRatingPrompt | null>;
  answer(promptId: string, input: VisitRatingAnswerInput, idempotencyKey: string): Promise<VisitRatingAnswerResult>;
  dismiss(promptId: string): Promise<void>;
  /** The ask is closed: its notification goes (pending or in the shade). */
  cancelNotification(promptId: string): Promise<void>;
  /** A member is signed in and launch has settled. */
  isSignedIn(): boolean;
  /** A booking, payment or check-in flow is on screen. */
  flowOnScreen(): boolean;
  /** The thank-you of a 4 or 5 star answer has gone: the Google Play ask (its own gates). */
  happyMoment(): void;
  newKey(): string;
  now(): number;
}

export const defaultVisitRatingDeps: VisitRatingDeps = {
  fetchCurrent: () => fetchCurrentVisitRatingPrompt(),
  answer: (promptId, input, key) => answerVisitRatingPrompt(promptId, input, key),
  dismiss: (promptId) => dismissVisitRatingPrompt(promptId),
  cancelNotification: (promptId) => cancelVisitRatingNotification(promptId),
  isSignedIn: () => {
    const { isAuthenticated, isLoading } = useAppStore.getState();
    return isAuthenticated && !isLoading;
  },
  flowOnScreen: () => flowOnScreen() !== null,
  happyMoment: () => void askForStoreReview({ kind: 'visitRating' }),
  newKey: () => newIdempotencyKey(),
  now: () => Date.now(),
};

/** What `current` answered: the ask (or null), or no answer at all. */
type CurrentOutcome = { readonly ok: true; readonly prompt: VisitRatingPrompt | null } | { readonly ok: false };

/** A send that did not go through, kept for the same send tried again (SEND'S KEY). */
interface UnsentAnswer {
  readonly promptId: string;
  readonly body: string;
  readonly key: string;
}

// ---------------------------------------------------------------------------
// The store

export function createVisitRatingStore(overrides: Partial<VisitRatingDeps> = {}): StoreApi<VisitRatingStore> {
  const deps: VisitRatingDeps = { ...defaultVisitRatingDeps, ...overrides };
  /** Bumped at sign-out: an answer for the member who left writes nothing. */
  let session = 0;
  /** The foreground `current` was last asked in (-1: never). */
  let checkedFor = -1;
  let inFlight: Promise<CurrentOutcome> | null = null;
  let unsent: UnsentAnswer | null = null;
  /** "Not now" said here, this app session: the server may not have heard it yet. */
  const dismissedHere = new Set<string>();
  /** The thank-you of a 4 or 5 star answer closed: the Google Play ask, once the sheet has gone. */
  let happyMomentPending = false;

  return createStore<VisitRatingStore>()((set, get) => {
    /** One `current` at a time; a second caller joins it. Never rejects. */
    function askCurrent(): Promise<CurrentOutcome> {
      if (inFlight) return inFlight;
      const request: Promise<CurrentOutcome> = Promise.resolve()
        .then(() => deps.fetchCurrent())
        .then(
          (prompt): CurrentOutcome => ({ ok: true, prompt }),
          (): CurrentOutcome => ({ ok: false }),
        )
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });
      inFlight = request;
      return request;
    }

    /** What `current` said, applied to the card. Returns the ask to show, or null. */
    function applyCurrent(outcome: CurrentOutcome): VisitRatingPrompt | null {
      if (!outcome.ok || outcome.prompt === null) {
        // Fail soft: no card. (A sheet up keeps its own ask.)
        set({ card: null });
        return null;
      }
      const prompt = outcome.prompt;
      if (dismissedHere.has(prompt.id)) {
        // "Not now" that never reached the server: say it again, show nothing.
        void deps.dismiss(prompt.id).catch(() => undefined);
        set({ card: null });
        return null;
      }
      set({ card: prompt });
      return prompt;
    }

    function updateSheet(promptId: string, change: Partial<VisitRatingSheetState>): void {
      const sheet = get().sheet;
      if (!sheet || sheet.prompt.id !== promptId) return;
      set({ sheet: { ...sheet, ...change } });
    }

    /** The ask is over (answered, dismissed, closed by the server): no card, no notification. */
    function closeAsk(promptId: string): void {
      if (get().card?.id === promptId) set({ card: null });
      void deps.cancelNotification(promptId).catch(() => undefined);
    }

    return {
      ...INITIAL_VISIT_RATING_STATE,

      noteForeground() {
        set({ foreground: get().foreground + 1 });
      },

      async checkForCard() {
        if (!deps.isSignedIn()) return;
        const generation = get().foreground;
        // Not before the first activation (the member's profile has loaded),
        // and once per foreground after it.
        if (generation === 0 || checkedFor === generation || get().sheet !== null) return;
        if (deps.flowOnScreen()) return;
        checkedFor = generation;
        const run = session;
        const outcome = await askCurrent();
        if (run !== session) return;
        applyCurrent(outcome);
      },

      openFromCard(stars) {
        const card = get().card;
        if (!card || get().sheet?.phase === 'sending') return;
        set({ sheet: newSheet(card, stars) });
      },

      async openFromNotification() {
        if (!deps.isSignedIn() || get().sheet !== null) return;
        const run = session;
        const outcome = await askCurrent();
        if (run !== session) return;
        // This answer is as fresh as a card check: the card shows it too.
        checkedFor = get().foreground;
        const prompt = applyCurrent(outcome);
        if (prompt === null || get().sheet !== null) return;
        set({ sheet: newSheet(prompt, 0) });
      },

      setStars(row, stars) {
        const sheet = get().sheet;
        if (!sheet || sheet.phase !== 'form') return;
        const value = clampStars(stars);
        // The overall is required: once chosen it can change, not go.
        if (row === 'overall' && value < 1) return;
        set({ sheet: { ...sheet, [row]: value } });
      },

      setComment(text) {
        const sheet = get().sheet;
        if (!sheet || sheet.phase !== 'form') return;
        set({ sheet: { ...sheet, comment: text.slice(0, VISIT_RATING_COMMENT_MAX) } });
      },

      async send() {
        const sheet = get().sheet;
        if (!sheet || !canSend(sheet, deps.now())) return;
        const input = answerInput(sheet);
        if (!input) return;
        const promptId = sheet.prompt.id;
        const body = JSON.stringify(visitRatingAnswerBody(input));
        const key =
          unsent && unsent.promptId === promptId && unsent.body === body ? unsent.key : deps.newKey();
        unsent = { promptId, body, key };
        const run = session;
        set({ sheet: { ...sheet, phase: 'sending', errorKey: null, sendBlockedUntil: null } });

        let result: VisitRatingAnswerResult;
        try {
          result = await deps.answer(promptId, input, key);
        } catch (error) {
          if (run !== session) return;
          const failure = answerFailure(error);
          switch (failure.kind) {
            case 'signedOut':
              // The app is on its way to sign-in; the sign-out clears the rest.
              unsent = null;
              set({ sheet: null });
              return;
            case 'closed':
              // Answered, dismissed or lapsed (409), the visit voided (403),
              // not this member's (404): over for good, and said once the
              // sheet has gone.
              unsent = null;
              set({ sheet: null, notice: failure.messageKey });
              closeAsk(promptId);
              return;
            case 'rateLimited':
              updateSheet(promptId, {
                phase: 'form',
                errorKey: failure.messageKey,
                sendBlockedUntil:
                  failure.retryAfterSeconds !== null && failure.retryAfterSeconds > 0
                    ? deps.now() + failure.retryAfterSeconds * 1000
                    : null,
              });
              return;
            case 'keepOpen':
            case 'retry':
              updateSheet(promptId, { phase: 'form', errorKey: failure.messageKey });
              return;
          }
        }
        if (run !== session) return;
        unsent = null;
        updateSheet(promptId, {
          phase: 'thanks',
          errorKey: null,
          happyMoment: result.happyMoment,
          hasWrittenReview: result.hasWrittenReview,
        });
        closeAsk(promptId);
      },

      notNow() {
        const { sheet, card } = get();
        if (sheet?.phase === 'sending' || sheet?.phase === 'thanks') return;
        const prompt = sheet?.prompt ?? card;
        if (!prompt) return;
        dismissedHere.add(prompt.id);
        unsent = null;
        set({ card: null, sheet: null });
        void deps.cancelNotification(prompt.id).catch(() => undefined);
        void deps.dismiss(prompt.id).catch(() => undefined);
      },

      closeSheet() {
        const sheet = get().sheet;
        if (!sheet || sheet.phase === 'sending') return;
        happyMomentPending = sheet.phase === 'thanks' && sheet.happyMoment;
        set({ sheet: null });
      },

      sheetGone() {
        if (!happyMomentPending) return;
        happyMomentPending = false;
        try {
          deps.happyMoment();
        } catch {
          // The ask's own failure; the rating is saved either way.
        }
      },

      writeReview() {
        const sheet = get().sheet;
        if (!sheet || sheet.phase !== 'thanks' || sheet.hasWrittenReview) return null;
        // The member goes on to write: no Google Play popup over the venue page.
        happyMomentPending = false;
        set({ sheet: null });
        return sheet.prompt;
      },

      takeNotice() {
        const notice = get().notice;
        if (notice !== null) set({ notice: null });
        return notice;
      },

      reset() {
        session += 1;
        checkedFor = -1;
        inFlight = null;
        unsent = null;
        dismissedHere.clear();
        happyMomentPending = false;
        set({ ...INITIAL_VISIT_RATING_STATE });
      },
    };
  });
}

/** The app's one visit rating. */
export const visitRatingStore: StoreApi<VisitRatingStore> = createVisitRatingStore();
