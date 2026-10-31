/**
 * The day plan's request side: the Android port of iOS `CoachIntake`,
 * `CoachArea`, `CoachWhen`, `CoachRefineChange` and the wizard's
 * `CoachPlanAnswers` (Models/CoachPlan.swift).
 *
 * The Coach's v2 contract (`POST /coach`): a short preset intake goes up, and
 * ONE model call comes back as a Before / Main / After plan (./decode.ts).
 * Nothing here calls anything; the wizard (./wizard.ts) asks the questions
 * these rules derive, and sends what `planIntake` builds.
 *
 * TWO RULES SHAPE THE INTAKE.
 * - The next question is DERIVED from the answers, never stored, so a goal
 *   the member already typed ("a hike") skips the first question, and a goal
 *   without intensity never asks it.
 * - A question the wizard would not ask for this goal or time is dropped from
 *   the intake too (`asksTimeOfDay`, `asksIntensity`, `asksClassType`), so a
 *   stale answer carried over from an earlier goal never reaches the
 *   server's cache key or the model.
 *
 * THE MEMBER'S WORDS ARE NOT KEPT (owner ruling P1). There is no `note`: the
 * day-plan body never carries anything the member typed, only the chips'
 * wire values, and a typed class type cut to the server's 40 units.
 */
import { LocationValue } from '../../../data/coachQuestions';
import { roundHalfAwayFromZero } from '../../../i18n/format';
import { truncatedToUTF16 } from '../chat/text';
import type { PlanIntentAnswers } from '../routing/intents';

// MARK: - The intake (request)

/** What the member is in the mood for (iOS `CoachGoal` raw values; `class` is the wire value). */
export type CoachGoal = 'workout' | 'class' | 'relax' | 'outdoors' | 'mix';
/** In the order the goal chips show (iOS `CoachGoal.allCases`). */
export const COACH_GOALS: readonly CoachGoal[] = ['workout', 'class', 'relax', 'outdoors', 'mix'];

/**
 * The server's ATTRACTION_REGIONS, in its own order (iOS `CoachArea.regions`).
 * The chips are labelled with `attraction.region.*`, so the Coach and the
 * sight card never name a region two ways.
 */
export const COACH_REGIONS = ['capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands'] as const;
export type CoachRegion = (typeof COACH_REGIONS)[number];

/** Where the plan should happen: the member's (coarse) position, or a region. */
export type CoachArea =
  | { readonly kind: 'near'; readonly latitude: number; readonly longitude: number }
  | { readonly kind: 'region'; readonly region: string };

/**
 * A position to two decimals (iOS `CoachArea.coarse`): roughly a kilometre in
 * Iceland, plenty for the server's 25 km "close by" rule. It keeps a precise
 * position off the server and lets neighbours share its short response
 * cache. Rounded half away from zero, as Swift's `.rounded()`.
 */
export function coarseArea(latitude: number, longitude: number): CoachArea {
  return {
    kind: 'near',
    latitude: roundHalfAwayFromZero(latitude * 100) / 100,
    longitude: roundHalfAwayFromZero(longitude * 100) / 100,
  };
}

/** When (iOS `CoachWhen`): a word, or a venue-local day (YYYY-MM-DD). The wizard only sends the words. */
export type CoachWhenWord = 'now' | 'today' | 'tomorrow' | 'weekend';
export type CoachWhen = CoachWhenWord | { readonly date: string };
/** In the order the chips show. */
export const COACH_WHEN_WORDS: readonly CoachWhenWord[] = ['now', 'today', 'tomorrow', 'weekend'];

export type CoachTimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';
export const COACH_TIMES_OF_DAY: readonly CoachTimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];

export type CoachDuration = 'short' | 'half_day' | 'full_day';
export const COACH_DURATIONS: readonly CoachDuration[] = ['short', 'half_day', 'full_day'];

export type CoachIntensity = 'easy' | 'moderate' | 'hard';
export const COACH_INTENSITIES: readonly CoachIntensity[] = ['easy', 'moderate', 'hard'];

/**
 * The class-type chips: the class feed's own tag slugs (web class-tags.ts),
 * the vocabulary the server already filters the feed by, labelled with the
 * Classes tab's `classes.cat_*` (iOS `CoachIntake.classTypes`).
 */
export const COACH_CLASS_TYPES = ['yoga', 'pilates', 'hiit', 'strength', 'boxing', 'cycling', 'swimming', 'dance'] as const;

/**
 * The server's own cap on a typed class type (`classType: max(40)`). A
 * longer one is not truncated up there, it refuses the whole request (400),
 * so the phone cuts to the SAME number, in UTF-16 units (a JS string's
 * length), never splitting a character.
 */
export const CLASS_TYPE_LIMIT = 40;

/** The intake as it goes on the wire (iOS `CoachIntake`; absent optionals are left out, as Swift's encoder does). */
export interface CoachIntake {
  readonly goal: CoachGoal;
  readonly area: CoachArea;
  readonly when: CoachWhen;
  readonly timeOfDay?: CoachTimeOfDay;
  readonly duration: CoachDuration;
  readonly intensity?: CoachIntensity;
  readonly classType?: string;
}

/** "Right now" already fixes the time of day. */
export function asksTimeOfDay(when: CoachWhen): boolean {
  return when !== 'now';
}

/** Intensity only means something for a workout or a walk. */
export function asksIntensity(goal: CoachGoal): boolean {
  return goal === 'workout' || goal === 'outdoors';
}

/** A class type only narrows a class or a workout. */
export function asksClassType(goal: CoachGoal): boolean {
  return goal === 'class' || goal === 'workout';
}

/**
 * The intake the wizard is allowed to send (iOS `CoachIntake.init`): every
 * answer the wizard would not have asked for this goal or time is dropped,
 * and a class type is trimmed and cut to `CLASS_TYPE_LIMIT`.
 */
export function makeIntake(fields: {
  readonly goal: CoachGoal;
  readonly area: CoachArea;
  readonly when: CoachWhen;
  readonly timeOfDay: CoachTimeOfDay | null;
  readonly duration: CoachDuration;
  readonly intensity: CoachIntensity | null;
  readonly classType: string | null;
}): CoachIntake {
  const timeOfDay = asksTimeOfDay(fields.when) ? fields.timeOfDay : null;
  const intensity = asksIntensity(fields.goal) ? fields.intensity : null;
  const type = fields.classType?.trim() ?? '';
  const classType = asksClassType(fields.goal) && type !== '' ? truncatedToUTF16(type, CLASS_TYPE_LIMIT) : null;
  return {
    goal: fields.goal,
    area: fields.area,
    when: fields.when,
    ...(timeOfDay !== null ? { timeOfDay } : {}),
    duration: fields.duration,
    ...(intensity !== null ? { intensity } : {}),
    ...(classType !== null ? { classType } : {}),
  };
}

// MARK: - Refinements

/** What a refinement chip asks the server to change (iOS `CoachRefineChange`). */
export type CoachRefineChange = 'closer' | 'easier' | 'harder' | 'earlier' | 'later' | 'different';
export const COACH_REFINE_CHANGES: readonly CoachRefineChange[] = ['closer', 'easier', 'harder', 'earlier', 'later', 'different'];

/** `POST /coach`'s `refine`: the plan the member is looking at, and the change. */
export interface CoachRefine {
  readonly planId: string;
  readonly change: CoachRefineChange;
}

export function isRefineChange(value: string): value is CoachRefineChange {
  return (COACH_REFINE_CHANGES as readonly string[]).includes(value);
}

/**
 * Case and accents folded (Swift `.folding([.caseInsensitive,
 * .diacriticInsensitive])` then `.lowercased()`). Letters that are not an
 * accent on another letter (ð, þ, æ) stay as they are, on both sides of the
 * comparison.
 */
function foldChip(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase();
}

/**
 * A worded chip's keywords, in both languages, in the order they are tried
 * (iOS `CoachRefineChange.forChip`). Matched anywhere in the folded label.
 */
const REFINE_KEYWORDS: readonly (readonly [CoachRefineChange, readonly string[]])[] = [
  ['closer', ['closer', 'nearer', 'nearby', 'near', 'nær', 'naer', 'styttra']],
  ['easier', ['easier', 'gentler', 'lighter', 'relaxed', 'léttara', 'lettara', 'rólegra', 'rolegra', 'auðveldara', 'audveldara']],
  ['harder', ['harder', 'tougher', 'intense', 'challeng', 'erfiðara', 'erfidara', 'krefjandi']],
  ['earlier', ['earlier', 'sooner', 'morning', 'fyrr', 'fyrir hádegi']],
  ['later', ['later', 'evening', 'seinna', 'síðar', 'sidar', 'kvöld', 'kvold']],
];

/**
 * The change a chip's wording asks for (iOS `CoachRefineChange.forChip`): a
 * chip that IS a change name is that change; a worded label ("Somewhere
 * closer", "Nær") is read by keyword; anything else asks for something
 * different.
 */
export function refineChangeForChip(chip: string): CoachRefineChange {
  const folded = foldChip(chip.trim());
  if (isRefineChange(folded)) return folded;
  for (const [change, words] of REFINE_KEYWORDS) {
    if (words.some((word) => folded.includes(foldChip(word)))) return change;
  }
  return 'different';
}

/**
 * True when the chip is literally a change name ("closer"), so the app
 * labels it from its own dictionary (`coach.plan.refine.*`) instead of
 * printing a wire key (iOS `CoachRefineChange.isChangeName`).
 */
export function isChangeName(chip: string): boolean {
  return isRefineChange(chip.trim().toLowerCase());
}

/** What a refinement chip says: a bare change name worded by the app, anything else the server's own label. */
export function refineChipLabel(chip: string, t: (key: string) => string): string {
  if (!isChangeName(chip)) return chip;
  return t(`coach.plan.refine.${chip.trim().toLowerCase()}`);
}

// MARK: - The wizard's answers

/** The preset questions, in the order they are asked (iOS `CoachPlanQuestion`). */
export type PlanQuestion = 'goal' | 'area' | 'when' | 'timeOfDay' | 'duration' | 'intensity' | 'classType';

/**
 * The answers gathered so far (iOS `CoachPlanAnswers`). The `*Answered`
 * flags exist because "Any time" and "Surprise me" are answers that send
 * nothing.
 */
export interface PlanAnswers {
  readonly goal: CoachGoal | null;
  /**
   * "near" or a region slug. The coordinates are read at submit time, when
   * the location fix has had the rest of the wizard to arrive.
   */
  readonly areaChoice: string | null;
  readonly when: CoachWhen | null;
  readonly timeOfDay: CoachTimeOfDay | null;
  readonly timeOfDayAnswered: boolean;
  readonly duration: CoachDuration | null;
  readonly intensity: CoachIntensity | null;
  readonly intensityAnswered: boolean;
  readonly classType: string | null;
  readonly classTypeAnswered: boolean;
  /**
   * The venue category the member's own words named ("swimming", "lagoon"),
   * when a typed plan request named one. The wizard never asks for a venue
   * type, and a goal is coarser than what they asked for (swimming and
   * lagoon both become "relax"), so the model-less fallback searches this.
   * A CATEGORY, never their words.
   */
  readonly searchCategory: string | null;
}

/** "Near me": the coordinates are read at submit (iOS `nearChoice`). */
export const NEAR_CHOICE = 'near';
/** "Surprise me": a class type that sends none (iOS `anyClassType`). */
export const ANY_CLASS_TYPE = 'any';

/** A wizard started from a chip: nothing answered yet. */
export const EMPTY_PLAN_ANSWERS: PlanAnswers = {
  goal: null,
  areaChoice: null,
  when: null,
  timeOfDay: null,
  timeOfDayAnswered: false,
  duration: null,
  intensity: null,
  intensityAnswered: false,
  classType: null,
  classTypeAnswered: false,
  searchCategory: null,
};

/** The next question, derived from the answers (iOS `nextQuestion`); null once every question is answered. */
export function nextPlanQuestion(answers: PlanAnswers): PlanQuestion | null {
  const { goal, when } = answers;
  if (goal === null) return 'goal';
  if (answers.areaChoice === null) return 'area';
  if (when === null) return 'when';
  if (asksTimeOfDay(when) && !answers.timeOfDayAnswered) return 'timeOfDay';
  if (answers.duration === null) return 'duration';
  if (asksIntensity(goal) && !answers.intensityAnswered) return 'intensity';
  if (asksClassType(goal) && !answers.classTypeAnswered) return 'classType';
  return null;
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/**
 * A chip's value recorded against the question it answers (iOS
 * `record(_:for:)`). Null for a value that does not belong to that
 * question, which leaves the answers untouched.
 *
 * The class type is the only free-text answer ("Other", or words typed while
 * that question is open): cut to the server's limit HERE, so every way in
 * is inside it. "Surprise me" answers it with nothing.
 */
export function recordPlanAnswer(answers: PlanAnswers, value: string, question: PlanQuestion): PlanAnswers | null {
  switch (question) {
    case 'goal':
      return isOneOf(COACH_GOALS, value) ? { ...answers, goal: value } : null;
    case 'area':
      return value === NEAR_CHOICE || isOneOf(COACH_REGIONS, value) ? { ...answers, areaChoice: value } : null;
    case 'when':
      return isOneOf(COACH_WHEN_WORDS, value) ? { ...answers, when: value } : null;
    case 'timeOfDay':
      if (!isOneOf(COACH_TIMES_OF_DAY, value)) return null;
      return { ...answers, timeOfDay: value === 'any' ? null : value, timeOfDayAnswered: true };
    case 'duration':
      return isOneOf(COACH_DURATIONS, value) ? { ...answers, duration: value } : null;
    case 'intensity':
      return isOneOf(COACH_INTENSITIES, value) ? { ...answers, intensity: value, intensityAnswered: true } : null;
    case 'classType': {
      const trimmed = truncatedToUTF16(value.trim(), CLASS_TYPE_LIMIT);
      if (trimmed === '') return null;
      return { ...answers, classType: trimmed === ANY_CLASS_TYPE ? null : trimmed, classTypeAnswered: true };
    }
  }
}

/**
 * The intake, once every question is answered (iOS `intake(location:)`).
 * `location` is the fix to use for "near"; without one there is no intake
 * (the wizard plans for the capital instead and says so).
 */
export function planIntake(
  answers: PlanAnswers,
  location: { readonly latitude: number; readonly longitude: number } | null,
): CoachIntake | null {
  const { goal, areaChoice, when, duration } = answers;
  if (nextPlanQuestion(answers) !== null || goal === null || areaChoice === null || when === null || duration === null) {
    return null;
  }
  let area: CoachArea;
  if (areaChoice === NEAR_CHOICE) {
    if (!location) return null;
    area = coarseArea(location.latitude, location.longitude);
  } else {
    area = { kind: 'region', region: areaChoice };
  }
  return makeIntake({
    goal,
    area,
    when,
    timeOfDay: answers.timeOfDay,
    duration,
    intensity: answers.intensity,
    classType: answers.classType,
  });
}

/**
 * The wizard's starting answers for a typed day request (iOS
 * `CoachPlanIntent.answers`, which records through `record`): its goal, a
 * yoga or pilates class type, "today", and the venue category it named.
 */
export function answersFromIntent(intent: PlanIntentAnswers): PlanAnswers {
  let answers: PlanAnswers = EMPTY_PLAN_ANSWERS;
  if (intent.goal !== null) answers = recordPlanAnswer(answers, intent.goal, 'goal') ?? answers;
  if (intent.classType !== null) answers = recordPlanAnswer(answers, intent.classType, 'classType') ?? answers;
  if (intent.when !== null) answers = recordPlanAnswer(answers, intent.when, 'when') ?? answers;
  return { ...answers, searchCategory: intent.searchCategory };
}

// MARK: - The free fallback

/**
 * The venue wizard's category for a goal (iOS `fallbackCategory(for:classType:)`):
 * the free, model-less list when a plan cannot be made.
 */
export function fallbackCategory(goal: CoachGoal, classType: string | null): string {
  switch (goal) {
    case 'workout':
      return 'gym';
    case 'class':
      return classType === 'yoga' || classType === 'pilates' ? 'yoga' : 'gym';
    case 'relax':
    case 'outdoors':
    case 'mix':
      return 'spa';
  }
}

/**
 * What the fallback searches (iOS `fallbackVenueCategory`): what the member
 * actually named ("pools" comes back as pools), and only otherwise the
 * goal's closest category.
 */
export function fallbackVenueCategory(answers: PlanAnswers): string {
  return answers.searchCategory ?? fallbackCategory(answers.goal ?? 'mix', answers.classType);
}

/**
 * The venue wizard's location answer for an area choice (iOS
 * `fallbackLocationValue`), or null where the venue wizard has no bucket
 * (the Highlands).
 */
export function fallbackLocationValue(areaChoice: string | null): string | null {
  switch (areaChoice) {
    case NEAR_CHOICE:
      return LocationValue.drive;
    case 'capital':
    case 'reykjanes':
      return LocationValue.capital;
    case 'south':
      return LocationValue.south;
    case 'west':
    case 'westfjords':
      return LocationValue.west;
    case 'north':
      return LocationValue.north;
    case 'east':
      return LocationValue.east;
    default:
      return null;
  }
}

/**
 * The venue wizard's answers for the fallback (iOS `runVenueFallback`): the
 * location, and "pilates", a value the venue wizard already narrows on
 * (`coachCategoryOverride`), so Pilates studios surface rather than every
 * yoga venue.
 */
export function fallbackWizardAnswers(answers: PlanAnswers): string[] {
  const result: string[] = [];
  const location = fallbackLocationValue(answers.areaChoice);
  if (location !== null) result.push(location);
  if (answers.classType === 'pilates') result.push('pilates');
  return result;
}
