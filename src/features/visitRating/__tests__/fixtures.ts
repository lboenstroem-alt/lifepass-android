/**
 * Shared shapes for the visit rating tests: the ask as `current` returns it
 * (wire and decoded), and a store on fake dependencies whose calls a test
 * can read and steer.
 */
import { decodeVisitRatingPrompt, type VisitRatingAnswerInput, type VisitRatingAnswerResult, type VisitRatingPrompt } from '../../../api/visitRating';
import { createVisitRatingStore, type VisitRatingDeps } from '../store';

export const PROMPT_ID = '6f1c2a4e-0000-4000-8000-000000000001';
export const VENUE_ID = '3f2b8c1e-0000-4000-8000-0000000000a1';

/** `GET /visit-rating-prompts/current`'s `prompt`, as the server sends it. */
export function promptJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROMPT_ID,
    venueId: VENUE_ID,
    venueName: 'World Class Laugar',
    venueSlug: 'world-class-laugar',
    checkedInAt: '2026-10-27T12:05:00.000Z',
    dueAt: '2026-10-27T13:05:00.000Z',
    expiresAt: '2026-10-30T13:05:00.000Z',
    shownAt: '2026-10-27T13:09:41.000Z',
    answeredAt: null,
    dismissedAt: null,
    hasWrittenReview: false,
    ...extra,
  };
}

export function prompt(extra: Record<string, unknown> = {}): VisitRatingPrompt {
  return decodeVisitRatingPrompt(promptJSON(extra));
}

export const HAPPY_ANSWER: VisitRatingAnswerResult = { prompt: null, happyMoment: true, hasWrittenReview: false };

export interface FakeDeps extends VisitRatingDeps {
  readonly answers: { promptId: string; input: VisitRatingAnswerInput; key: string }[];
  readonly dismissed: string[];
  readonly cancelled: string[];
  happyMoments: number;
  flow: boolean;
  signedIn: boolean;
  clock: number;
  fetches: number;
}

/** A store on fakes: `current` answers `current()`, the answer answers `answer()`. */
export function storeOnFakes(
  overrides: {
    current?: () => Promise<VisitRatingPrompt | null>;
    answer?: (input: VisitRatingAnswerInput, key: string) => Promise<VisitRatingAnswerResult>;
  } = {},
) {
  let keys = 0;
  const deps: FakeDeps = {
    answers: [],
    dismissed: [],
    cancelled: [],
    happyMoments: 0,
    flow: false,
    signedIn: true,
    clock: Date.parse('2026-10-27T14:00:00.000Z'),
    fetches: 0,
    fetchCurrent: async () => {
      deps.fetches += 1;
      return (overrides.current ?? (async () => prompt()))();
    },
    answer: async (promptId, input, key) => {
      deps.answers.push({ promptId, input, key });
      return (overrides.answer ?? (async () => HAPPY_ANSWER))(input, key);
    },
    dismiss: async (promptId) => {
      deps.dismissed.push(promptId);
    },
    cancelNotification: async (promptId) => {
      deps.cancelled.push(promptId);
    },
    isSignedIn: () => deps.signedIn,
    flowOnScreen: () => deps.flow,
    happyMoment: () => {
      deps.happyMoments += 1;
    },
    newKey: () => `key-${++keys}`,
    now: () => deps.clock,
  };
  const store = createVisitRatingStore(deps);
  return { store, deps };
}
