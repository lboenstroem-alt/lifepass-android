/* eslint lifepass/no-literal-copy: "error" */
/**
 * The venue wizard: the Coach's free, model-less venue search (iOS
 * `CoachViewModel`'s "Automated Q&A wizard": `startQAFlow`, `selectOption`,
 * `queryVenues`, `applyLocationFilter`). A `CoachFlow` for COACH-1's store
 * (./types.ts explains the contract).
 *
 * HOW IT STARTS
 * - A category tile, the strip after a search, or the lagoon chip (`enter`
 *   with a category, iOS `startSearch`): under the tile's own translated
 *   label, so an Icelandic member sees an Icelandic bubble. The store has
 *   abandoned every open question first.
 * - Typed words that name a venue type (`startFrom`, the pipeline's last
 *   step, iOS `send`'s `venueWizardCategory`): a question about classes or a
 *   time goes to the chat instead (../routing/scheduleCue.ts). A prompt the
 *   app parked (Home's cards) skips that check, so "Suggest gym classes I
 *   should try this week." still opens the gym wizard.
 *
 * WHAT IT ASKS. The category's questions (src/data/coachQuestions.ts), one
 * bubble at a time. A chip answers with its internal value; words typed
 * while a question is open are taken as its answer, value and label both
 * (iOS `send`: "treat the text as the answer to the current open question").
 * ONLY THE LAST OPEN QUESTION ANSWERS: a chip left on an earlier, abandoned
 * bubble must never inject its value into this flow's answers (iOS
 * `selectOption`'s guard). Starting any other flow abandons this one
 * (`abandon`, from the store's `abandonOpenQuestions`).
 *
 * WHERE. A location fix is warmed the moment the wizard starts (and not when
 * the Coach tab opens), so "15-min drive" has a real position by the time
 * the last question is answered; the location question comes second or later
 * in every set. The distance is measured on the phone, in a straight line
 * (owner decision D11; see `DRIVE_RADIUS_METRES`). The position never leaves
 * the phone: `GET /venues` is asked for the category only.
 *
 * WHAT IT SHOWS. `GET /venues?category=&limit=100` (a narrower category when
 * a type chip maps to one, falling back to the broad one when that comes back
 * empty), filtered by the location answer on the phone, at most 10 cards:
 * "Found N ... options for you:" (or the location note), then "Want to
 * explore something else?" with the category strip. It never calls the
 * model, so it keeps working at the free-tier lock and the daily cap.
 */
import { isApiError } from '../../../api';
import { fetchVenues } from '../../../api/venues';
import {
  apiCategory,
  applyLocationFilter,
  coachCategoryOverride,
  coachLocationFilter,
  detectVenueCategory,
  displayCategoryName,
  isVenueCategory,
  venueQuestions,
  type QuestionDef,
  type VenueCategory,
} from '../../../data/coachQuestions';
import { locationStore } from '../../../stores/locationStore';
import type { Venue } from '../../../types/venue';
import { venueWizardCategory } from '../routing/scheduleCue';
import { coachHost } from '../store/host';
import { lastOpenQuestion } from '../store/messages';
import type { CoachFlow, CoachFlowEntry, CoachSendOptions } from './types';

/** At most this many venue cards under one answer (iOS `prefix(10)`). */
export const MAX_VENUE_CARDS = 10;
/**
 * The wizard's own page size (iOS `queryVenues` asks for `limit: 100`). Kept
 * here, not borrowed from the general page default, so the location filter
 * always has as many rows to choose from as on iOS.
 */
export const WIZARD_FETCH_LIMIT = 100;

/** The wizard in progress (iOS `CoachQAFlow`), or null. */
interface WizardState {
  readonly category: VenueCategory;
  /** The index of the question on screen. */
  readonly step: number;
  /** The values answered so far, in order (a chip's value, or typed words). */
  readonly answers: readonly string[];
  /** The bubble of the question on screen: the only one that may answer. */
  readonly questionId: string;
}

let wizard: WizardState | null = null;

/** The category's questions in the Coach's language. */
function questionsFor(category: VenueCategory): readonly QuestionDef[] {
  const host = coachHost();
  return venueQuestions((key) => host.t(key))[category];
}

/** The bubble that asks `question` (answered back through the store's `selectOption`). */
function questionBubble(question: QuestionDef) {
  return { role: 'assistant' as const, text: question.text, options: question.options, flow: 'venueWizard' as const };
}

/**
 * Asks for a location fix. The system dialog shows only while the member
 * has not decided (never again after a no), and a fix is read only when
 * location is allowed (the location store's policy).
 */
function warmLocation(): void {
  try {
    void locationStore
      .getState()
      .requestLocation()
      .catch(() => undefined);
  } catch {
    // No location at all: "15-min drive" measures from Reykjavík centre.
  }
}

/** iOS `startQAFlow`: the member's bubble, then the first question. */
function start(userText: string, category: VenueCategory): boolean {
  const first = questionsFor(category)[0];
  if (!first) return false;
  warmLocation();
  const [, questionId] = coachHost().append({ role: 'user', text: userText }, questionBubble(first));
  wizard = { category, step: 0, answers: [], questionId: questionId! };
  return true;
}

/** True while `messageId` is this wizard's question AND the last open question in the chat. */
function isCurrentQuestion(messageId: string): boolean {
  if (!wizard || wizard.questionId !== messageId) return false;
  return lastOpenQuestion(coachHost().messages())?.id === messageId;
}

/** A chip, an "Other" field or typed words answered the question on screen (iOS `selectOption`). */
async function answer(messageId: string, value: string, label: string): Promise<void> {
  const current = wizard;
  if (!current || !isCurrentQuestion(messageId)) return;
  const host = coachHost();
  host.markAnswered(messageId, label);

  const questions = questionsFor(current.category);
  const answers = [...current.answers, value];
  const nextStep = current.step + 1;
  const next = questions[nextStep];
  if (next) {
    const [, questionId] = host.append({ role: 'user', text: label }, questionBubble(next));
    wizard = { category: current.category, step: nextStep, answers, questionId: questionId! };
    return;
  }
  // Every question answered: the venues, honouring the location chip (and
  // any narrower type) the member picked.
  host.append({ role: 'user', text: label });
  wizard = null;
  await runVenueQuery(current.category, answers);
}

/**
 * The venues for a category and the wizard's answers, appended to the chat
 * (iOS `queryVenues`). Exported for the day plan's free fallback (COACH-3,
 * iOS `runVenueFallback`), which passes a location value and "pilates".
 *
 * The typing dots show while it runs. A New chat, a restore or a sign-out
 * meanwhile drops the answer (the busy token), as iOS checks
 * `chatGeneration`. An error shows the API's own sentence (offline, a
 * timeout) or `coach.venues_error`; it is never a Coach lock (this is
 * `/venues`, not `/coach`).
 */
export async function runVenueQuery(category: string, answers: readonly string[]): Promise<void> {
  const host = coachHost();
  const busy = host.busy();
  try {
    // A type chip that names a narrower database category ("MMA & Combat"
    // queries "MMA"), falling back to the broad category when that is empty.
    const broad = apiCategory(category);
    const override = coachCategoryOverride(answers);
    // A generous page (the API has no geo filter), so the location filter has
    // enough to choose from before the cards are trimmed to 10.
    let all: readonly Venue[] = await fetchVenues({ category: override ?? broad, limit: WIZARD_FETCH_LIMIT });
    // Whether the narrow category produced what is shown: the sentence says
    // what is shown, not what was asked for.
    let usedOverride = override !== null;
    if (all.length === 0 && override !== null) {
      all = await fetchVenues({ category: broad, limit: WIZARD_FETCH_LIMIT });
      usedOverride = false;
    }
    // iOS reads the last fix as the filter runs (no wait): the warm-up at the
    // wizard's start has had every question to arrive.
    const fix = locationStore.getState().currentLocation;
    const result = applyLocationFilter(all, coachLocationFilter(answers), fix);
    const shown = result.venues.slice(0, MAX_VENUE_CARDS);

    // The chat changed while the venues loaded: never into another chat.
    if (!busy.isCurrent()) return;

    const t = (key: string) => host.t(key);
    const named = displayCategoryName(category, t);
    const wanted = override ?? named;
    const showing = (usedOverride ? override : null) ?? named;
    if (shown.length === 0) {
      host.append({ role: 'assistant', text: host.t('coach.no_results', { wanted }) });
    } else {
      // iOS picks .one/.many by the English rule in both languages (never pluralKey).
      const foundKey = shown.length > 1 ? 'coach.found.many' : 'coach.found.one';
      const intro = result.noteKey
        ? host.t(result.noteKey)
        : host.t(foundKey, { count: String(shown.length), category: showing });
      host.append({ role: 'assistant', text: intro, venues: shown });
    }
    // An invitation to look for something else: a tile starts a new wizard.
    host.append({ role: 'assistant', text: host.t('coach.explore_else'), showCategoryStrip: true });
  } catch (error) {
    if (!busy.isCurrent()) return;
    const sentence = isApiError(error) ? error.messageIn(host.language()) : '';
    host.append({ role: 'assistant', text: sentence || host.t('coach.venues_error') });
  } finally {
    busy.end();
  }
}

export const venueWizardFlow: CoachFlow = {
  id: 'venueWizard',

  isActive: () => wizard !== null,

  hasOpenQuestion: () => wizard !== null && isCurrentQuestion(wizard.questionId),

  async takeTyped(text: string) {
    // iOS: typed words while a question is open are its answer, as typed.
    if (!wizard || !isCurrentQuestion(wizard.questionId)) return false;
    await answer(wizard.questionId, text, text);
    return true;
  },

  startFrom(text: string, options: CoachSendOptions) {
    // Typed: a schedule question goes to the chat. Parked: the app's own
    // wording, which has always run the wizard.
    const category = options.detectScheduleQuestion ? venueWizardCategory(text) : detectVenueCategory(text);
    if (category === null) return false;
    return start(text, category);
  },

  abandon() {
    wizard = null;
  },

  reset() {
    wizard = null;
  },

  // The wizard draws with the chat's own bubbles: questions, venue cards and
  // the category strip.
  renderers: {},

  enter(entry: CoachFlowEntry) {
    if (entry.kind !== 'category' || !isVenueCategory(entry.category)) return;
    start(entry.userText, entry.category);
  },

  selectOption(messageId: string, value: string, label: string) {
    return answer(messageId, value, label);
  },
};

/** The wizard's state, for tests. */
export function venueWizardStateForTests(): { readonly category: VenueCategory; readonly step: number; readonly answers: readonly string[] } | null {
  return wizard ? { category: wizard.category, step: wizard.step, answers: [...wizard.answers] } : null;
}
