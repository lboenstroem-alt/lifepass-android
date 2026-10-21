/**
 * Typed words that ask for a plan: iOS `CoachPlanIntent` (a day,
 * Models/CoachPlan.swift) and `CoachProgramIntent` (weeks,
 * Models/CoachProgramWizard.swift).
 *
 * WHO CALLS THESE. COACH-1's send pipeline (../flows/types.ts) runs the
 * flows in iOS `CoachViewModel.send` order; two of its steps are these
 * intents, each inside the flow it starts:
 *   - `program.start` (the programme wizard, COACH-4): when
 *     `programIntentMatches(text)`, the flow calls
 *     `context.abandonOpenQuestions()`, posts the member's words as an
 *     `isHealth` bubble, then the programme question `program.intent.offer`
 *     with the chips `coach.chip.program` (value `program.intent.program`)
 *     and `coach.chip.plan_day` (value `program.intent.day`). Nothing starts
 *     until a chip is tapped.
 *   - `dayPlan.start` (the day-plan wizard, COACH-3): when
 *     `planIntentAnswers(text)` is not null, the flow calls
 *     `context.abandonOpenQuestions()` and starts its wizard with those
 *     answers already given (iOS `startPlanFlow(userText:answers:)`).
 * The pipeline runs neither step for a prompt the app parked
 * (`detectPlanRequest` off): Home's own wording must not start a wizard.
 *
 * Both are deliberately narrow. A false positive interrupts someone who
 * asked a plain question, or swaps the free venue wizard for a billed plan
 * call; a false negative costs nothing, because both wizards are a tap away
 * on the empty screen. So they match whole phrases only, and a question about
 * the MEMBERSHIP plan never matches either.
 *
 * Every word table here is iOS's, verbatim, in the folded spelling of
 * ./tokens.ts.
 */
import { detectVenueCategory, type VenueCategory } from '../../../data/coachQuestions';
import { hasPhrase, phraseOf, tokens } from './tokens';

// ─── Weeks: the programme wizard (iOS CoachProgramIntent) ─────────────────────

/**
 * True when the words ask for a plan spanning weeks rather than a day (iOS
 * `CoachProgramIntent.matches`). A match OFFERS the programme wizard and
 * starts nothing: "a workout plan" is said by people who want a month and by
 * people who want this evening.
 */
export function programIntentMatches(text: string): boolean {
  const words = tokens(text);
  if (words.length === 0) return false;
  // A question about the membership is never a programme request, the same
  // rule the day-plan intent keeps ("which plan includes the pool?").
  if (isAboutMembership(words)) return false;
  return hasPhrase(phraseOf(words), PROGRAM_INTENT_PHRASES);
}

/** Whole phrases, folded (iOS `CoachProgramIntent.phrases`). */
export const PROGRAM_INTENT_PHRASES: readonly string[] = [
  // English
  'workout plan', 'training plan', 'workout program', 'workout programme',
  'training program', 'training programme', 'fitness plan', 'gym plan',
  'gym program', 'monthly plan', '4 week plan', 'four week plan',
  '8 week plan', '12 week plan', 'plan for the month',
  'lose weight', 'gain weight', 'build muscle', 'get fitter',
  // Icelandic, folded
  'aefingaaaetlun', 'aefingaplan', 'aefingaprogramm', 'programm',
  'manadaraaetlun', 'aaetlun fyrir manudinn',
  'lettast', 'thyngjast', 'byggja upp vodva', 'koma mer i form',
];

// ─── A day: the day-plan wizard (iOS CoachPlanIntent) ─────────────────────────

/** The day-plan goals, as the intake sends them (iOS `CoachGoal` raw values). */
export type PlanIntentGoal = 'workout' | 'class' | 'relax' | 'outdoors' | 'mix';

/**
 * What a typed day request already answers, for the day-plan wizard to skip
 * those questions (iOS `CoachPlanAnswers` as `CoachPlanIntent.answers`
 * returns it). Only answers, never the member's words: the wizard keeps
 * nothing they typed (owner ruling P1).
 */
export interface PlanIntentAnswers {
  /** `outdoors` for a hike, trail, waterfall or walk; else the named venue type's goal; else not answered. */
  readonly goal: PlanIntentGoal | null;
  /** `yoga` or `pilates` when the words named a yoga venue type (answers the class-type question); else not answered. */
  readonly classType: 'yoga' | 'pilates' | null;
  /** `today` when the words asked what to do today; else not answered. */
  readonly when: 'today' | null;
  /**
   * The venue category the words named, kept so the model-less fallback
   * searches what they asked for ("pools" comes back as pools) rather than
   * the goal's nearest category. A CATEGORY, never their words.
   */
  readonly searchCategory: VenueCategory | null;
}

/**
 * The day-plan wizard's starting answers for words that clearly ask for a
 * plan or an outdoor day ("plan my day", "a hike", "hvað á ég að gera í
 * dag"), or null for words that keep the path they had before plans existed
 * (iOS `CoachPlanIntent.answers(for:)`): a venue search runs the free venue
 * wizard, anything else goes to the chat. When in doubt, null.
 */
export function planIntentAnswers(text: string): PlanIntentAnswers | null {
  const words = tokens(text);
  if (words.length === 0) return null;
  const phrase = phraseOf(words);

  // A question about the membership is never a day plan, whatever else it
  // mentions ("which plan has hiking?", "Is Sky Lagoon in the Plus plan?",
  // "hvað kostar áskriftin?").
  if (isAboutMembership(words) || hasPhrase(phrase, MEMBERSHIP_PHRASES)) return null;

  const category = detectVenueCategory(text);
  const today = hasPhrase(phrase, TODAY_PHRASES);
  const plan = asksForPlan(words);
  const trip = words.some((word) => TRIP_WORDS.has(word));
  const walk = words.some((_, index) => isWalk(words, index));

  // A named venue type keeps the free venue wizard unless the words clearly
  // ask for a day: a plan, "what should I do today", or a hike, trail or
  // waterfall. A walk alone does not outweigh it, because next to a venue it
  // is usually a distance ("a gym I can walk to").
  const asksForDay = plan || today || trip;
  if (!asksForDay && !(category === null && walk)) return null;

  let goal: PlanIntentGoal | null = null;
  let classType: 'yoga' | 'pilates' | null = null;
  if (trip || walk) {
    goal = 'outdoors';
  } else if (category !== null) {
    const implied = goalForSearchCategory(category);
    if (implied !== null) {
      goal = implied;
      if (category === 'yoga') classType = words.includes('pilates') ? 'pilates' : 'yoga';
    }
  }
  return { goal, classType, when: today ? 'today' : null, searchCategory: category };
}

/**
 * The goal a venue type named in a day request implies, for the types a plan
 * can serve (iOS `CoachPlanAnswers.goal(forSearchCategory:)`). Golf has no
 * plan shape (one course, no classes, no soak rule), so a golf plan request
 * starts at the goal question.
 */
export function goalForSearchCategory(category: string): PlanIntentGoal | null {
  switch (category) {
    case 'gym':
      return 'workout';
    case 'yoga':
      return 'class';
    case 'swimming':
    case 'spa':
    case 'lagoon':
      return 'relax';
    default:
      return null;
  }
}

/** The word at `index`, or "" outside the words (iOS `word(_:)`). */
function at(words: readonly string[], index: number): string {
  return index >= 0 && index < words.length ? words[index]! : '';
}

// MARK: Asking for a plan

/**
 * True only for the ways people ask for a day to be planned: "plan my day",
 * "plan something for Saturday", "planning a day out", "make me a plan", "a
 * plan for tomorrow", "Skipuleggðu daginn", "gerðu plan fyrir mig". "I plan
 * to swim" and "planning to visit" say what someone intends, and "the Plus
 * plan" is a membership, so neither counts.
 */
function asksForPlan(words: readonly string[]): boolean {
  // "plan" on its own, as a command.
  if (words.length === 1 && (words[0] === 'plan' || words[0] === 'planning')) return true;
  // The Icelandic verbs only ever mean planning something.
  if (words.some((word) => ICELANDIC_PLAN_VERBS.has(word))) return true;

  for (let index = 0; index < words.length; index += 1) {
    const current = words[index]!;
    if (current !== 'plan' && current !== 'planning') continue;
    const next = at(words, index + 1);
    if (PLAN_OBJECTS.has(next)) return true;
    if (['the', 'this', 'next'].includes(next) && DAY_WORDS.has(at(words, index + 2))) return true;
    if (next === 'for' || next === 'fyrir') {
      const target = at(words, index + 2);
      if (FOR_TARGETS.has(target)) return true;
      if (['the', 'this', 'next', 'my', 'our'].includes(target) && DAY_WORDS.has(at(words, index + 3))) return true;
    }

    if (current !== 'plan') continue;
    const previous = at(words, index - 1);
    // "a day plan"
    if (previous === 'day' || previous === 'daily') return true;
    // "make a plan", "give me a plan", "can you make a plan"
    if ((previous === 'a' || previous === 'an') && (MAKE_VERBS.has(at(words, index - 2)) || MAKE_VERBS.has(at(words, index - 3)))) {
      return true;
    }
    // "gerðu plan", "geturðu gert plan", "búðu til plan"
    if (ICELANDIC_MAKE_VERBS.has(previous)) return true;
    if (previous === 'til' && ['bua', 'budu', 'buid', 'buum'].includes(at(words, index - 2))) return true;
  }
  return false;
}

/** Icelandic verbs for planning. Unlike English "plan" they have no membership sense. */
const ICELANDIC_PLAN_VERBS: ReadonlySet<string> = new Set(['plana', 'skipuleggja', 'skipuleggdu']);

/** What directly follows "plan" or "planning" when a day is being planned. */
const PLAN_OBJECTS: ReadonlySet<string> = new Set([
  'my', 'our', 'me', 'us', 'a', 'an', 'some', 'something', 'out',
  'today', 'tomorrow', 'tonight', 'day', 'trip', 'weekend', 'evening', 'morning', 'afternoon',
  'daginn', 'dagana', 'helgina', 'kvoldid', 'ferd', 'ferdina', 'morgundaginn',
]);

/** What "plan for ..." is for when it is a day: a time. Not "for me": "the best plan for me" is a membership question. */
const FOR_TARGETS: ReadonlySet<string> = new Set([
  'today', 'tomorrow', 'tonight', 'weekend',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'daginn', 'morgundaginn', 'helgina', 'kvoldid',
]);

/** Stretches of time a plan can cover ("plan the day", "a plan for this weekend"). */
const DAY_WORDS: ReadonlySet<string> = new Set([
  'day', 'days', 'weekend', 'evening', 'morning', 'afternoon', 'night', 'week', 'trip', 'visit', 'holiday', 'stay',
]);

/** Verbs that ask for "a plan" to be made. */
const MAKE_VERBS: ReadonlySet<string> = new Set(['make', 'create', 'build', 'give', 'suggest', 'draft', 'write', 'put']);
const ICELANDIC_MAKE_VERBS: ReadonlySet<string> = new Set(['gera', 'gert', 'gerdu', 'gerir', 'gerid', 'gerum']);

// MARK: An outdoor day

/**
 * Hikes, trails and waterfalls, with the common Icelandic forms of
 * gönguleið, gönguferð and foss. Whole words only, so a town like Selfoss
 * stays a place and never reads as a waterfall. Clear enough to start a plan
 * even next to a named venue type ("a hike and then a hot spring").
 */
const TRIP_WORDS: ReadonlySet<string> = new Set([
  'hike', 'hikes', 'hiking', 'trail', 'trails', 'waterfall', 'waterfalls',
  'gonguferd', 'gonguleid', 'gonguleidir', 'gonguleidum', 'gonguleidina',
  'foss', 'fossa', 'fossar', 'fossinn', 'fossum',
]);

/**
 * A walk, when the word is really about walking. "walk-in" (a venue's door),
 * "walk me through", "within walking distance", "a gym I can walk to", "a
 * short walk from Hlemmur", "a 5 minute walk" and "a walk of ten minutes" are
 * not walks; nor are "ganga í" (join), "ganga frá" (settle a payment), "ganga
 * inn" (go in), "ganga úr" (leave, as in "ganga úr áskriftinni") or "5
 * mínútna ganga". "walk out of", "walk out on", "ganga út úr" and "ganga út
 * af" are leaving only when what follows is something a member pays for
 * ("walk out of my contract", "walking out on LifePass", "ganga út úr
 * samningnum"); out of a place they are walks ("a walk out of town", "göngu
 * út úr bænum", "a walk out on the pier"). A walk with minutes that goes
 * somewhere ("a 30 minute walk along the coast", "a 30 minute walk out of
 * town", "30 mínútna ganga meðfram sjónum") is still a walk.
 */
function isWalk(words: readonly string[], index: number): boolean {
  const next = at(words, index + 1);
  // "walk out of my contract" and "ganga út úr samningnum" are leaving.
  if (leavesAfterOut(words, index) === true) return false;
  switch (words[index]) {
    case 'walk':
    case 'walks':
    case 'walking':
      return !NOT_A_WALK.has(next) && !isDistanceBefore(words, index);
    case 'ganga':
      if (ICELANDIC_NOT_A_WALK.has(next)) return false;
      // "ganga í dag" and "ganga í kringum Tjörnina" are still walks.
      if (next === 'i') return WALK_AFTER_I.has(at(words, index + 2));
      return !isDistanceBefore(words, index);
    case 'gongu':
      return !ICELANDIC_NOT_A_WALK.has(next) && !isDistanceBefore(words, index);
    default:
      return false;
  }
}

/**
 * For a walk word followed by "out of", "out on", "út úr" or "út af": true
 * when that leaves something a member pays for, false when it is where the
 * walk goes; null when the walk word is followed by none of them.
 */
function leavesAfterOut(words: readonly string[], index: number): boolean | null {
  const first = at(words, index + 1);
  const second = at(words, index + 2);
  if ((first === 'out' && (second === 'of' || second === 'on')) || (first === 'ut' && (second === 'ur' || second === 'af'))) {
    return leavesMembership(words, index + 2);
  }
  return null;
}

/**
 * True when "out of", "out on", "út úr" or "út af", ending at `index`, leaves
 * something a member pays for: a membership, subscription, contract, plan,
 * LifePass or billing word within the next three words ("walk out of my
 * contract", "walk out of the Plus plan", "ganga út úr samningnum", "ganga út
 * úr LifePass"). Out of anything else ("out of town", "út úr bænum") is where
 * the walk goes.
 *
 * Only the object of "out of" counts, so the window ends at the first word
 * that starts something else ("a walk out of town with LifePass", "ganga út
 * úr bænum með LifePass vinum", "a walk out of town, no plans"). Articles,
 * possessives, numbers and lengths of time are not among the three words
 * ("walk out of my existing annual contract", "the 3 month contract",
 * "þessum 12 mánaða samningi"). A tier name counts only when it is the whole
 * object ("walk out of Plus and move to Base", not "a walk out of base
 * camp").
 */
function leavesMembership(words: readonly string[], index: number): boolean {
  if (index < 0 || index >= words.length) return false;
  // Folded, "á" and "í" read as the English "a" and "I": after "út úr" they
  // end the object, after "out of" "a" is an article.
  const objectEnds = words[index] === 'ur' || words[index] === 'af' ? ICELANDIC_OBJECT_ENDS : ENGLISH_OBJECT_ENDS;
  const ends = (position: number): boolean =>
    position >= words.length ||
    objectEnds.has(words[position]!) ||
    ROUTE_WORDS.has(words[position]!) ||
    OBJECT_TAILS.has(words[position]!);

  let counted = 0;
  let position = index + 1;
  while (position < words.length && counted < 3) {
    const word = words[position]!;
    if (objectEnds.has(word) || ROUTE_WORDS.has(word)) break;
    if (isPaidFor(word)) return true;
    if (counted === 0 && TIER_NAMES.has(word) && ends(position + 1)) return true;
    if (!OBJECT_MODIFIERS.has(word) && !isCount(word)) counted += 1;
    position += 1;
  }
  return false;
}

/**
 * A membership, subscription, contract, plan, LifePass or billing word.
 * Icelandic contracts, subscriptions and memberships are matched by their
 * stems anywhere in the word, so case endings and compounds count
 * ("samningnum", "árssamningnum", "þjónustusamningnum",
 * "mánaðaráskriftinni", "fjölskylduaðildinni"), and "LifePass", "binding",
 * "árskort" and "samkomulag" by how they start ("LifePassinu",
 * "bindingunni", "árskortinu", "samkomulaginu").
 */
function isPaidFor(word: string): boolean {
  return (
    MEMBERSHIP_WORDS.has(word) ||
    PLAN_NOUNS.has(word) ||
    CONTRACT_WORDS.has(word) ||
    word.includes('samning') ||
    word.includes('askrift') ||
    word.includes('adild') ||
    word.startsWith('lifepass') ||
    word.startsWith('binding') ||
    word.startsWith('arskort') ||
    word.startsWith('samkomulag')
  );
}

/** Contracts and other things a member can walk out of, in English. */
const CONTRACT_WORDS: ReadonlySet<string> = new Set([
  'contract', 'contracts', 'agreement', 'agreements', 'deal', 'deals', 'sub', 'subs', 'paying',
]);

/**
 * Words that end the object of "out of" or "out on": what comes next is
 * something else ("with LifePass", "and then", "to Esja", "no plans"). The
 * route words ("along", "up", "meðfram") end it too.
 */
const ENGLISH_OBJECT_ENDS: ReadonlySet<string> = new Set([
  'with', 'and', 'then', 'to', 'on', 'for', 'or', 'but', 'before', 'after',
  'at', 'in', 'into', 'from', 'near', 'via', 'no', 'not', 'without',
]);

/** The same after "út úr" or "út af": með, og, svo, síðan, til, á, í, fyrir, eða, en, við, frá, án, ekki, ekkert, engin. */
const ICELANDIC_OBJECT_ENDS: ReadonlySet<string> = new Set([
  'med', 'og', 'svo', 'sidan', 'til', 'a', 'i', 'fyrir', 'eda', 'en', 'vid', 'fra',
  'an', 'ekki', 'ekkert', 'engin',
]);

/** Words that can close a sentence right after a tier name ("walk out of Plus early"). */
const OBJECT_TAILS: ReadonlySet<string> = new Set([
  'early', 'now', 'today', 'soon', 'please', 'snemma', 'strax', 'nuna',
]);

/**
 * Articles, possessives and lengths of time, which do not count toward the
 * three words after "out of" ("my existing annual contract", "the 3 month
 * contract", "þessum 12 mánaða samningi", "núverandi samningi").
 */
const OBJECT_MODIFIERS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'current', 'existing', 'whole',
  'month', 'months', 'monthly', 'year', 'years', 'yearly', 'annual', 'week', 'weeks',
  'minum', 'minu', 'mina', 'minn', 'min', 'okkar', 'thessum', 'thessu', 'thessari', 'thessi',
  'thetta', 'thennan', 'nuverandi', 'manada', 'manadar', 'ara', 'ars',
]);

/** Leading digits (any script, as Swift `Character.isNumber`). */
const LEADING_NUMBER = /^\p{N}+/u;

/** A number: "12", "12month", "two", "tveggja". */
function isCount(word: string): boolean {
  if (LEADING_NUMBER.test(word)) {
    const unit = word.replace(LEADING_NUMBER, '');
    return unit.length === 0 || OBJECT_MODIFIERS.has(unit);
  }
  return COUNT_WORDS.has(word);
}

const COUNT_WORDS: ReadonlySet<string> = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'eins', 'tveggja', 'thriggja', 'fjogurra', 'fimm', 'sex', 'sjo', 'atta', 'niu', 'tiu', 'ellefu', 'tolf',
]);

/** The word after "walk" that makes it a door, a tour of the app or a distance. */
const NOT_A_WALK: ReadonlySet<string> = new Set([
  'in', 'ins', 'me', 'us', 'to', 'from', 'away', 'of', 'distance', 'distances',
]);

/**
 * The word after "ganga" or "göngu" that makes it something else: "frá"
 * (settle, or a distance from), "inn" (go in), "úr" (leave) and a distance
 * ("göngu fjarlægð", written apart).
 */
const ICELANDIC_NOT_A_WALK: ReadonlySet<string> = new Set(['fra', 'inn', 'ur', 'fjarlaegd', 'fjarlaegdar', 'faeri']);

/** The word after "ganga í" that keeps it a walk. */
const WALK_AFTER_I: ReadonlySet<string> = new Set(['dag', 'kvold', 'fyrramalid', 'kringum']);

/**
 * True when the words just before a walk make it a distance: minutes ("a 5
 * minute walk", "a minute's walk", "5min walk", "5 mínútna ganga") or
 * "within" a few words back ("within walking", "within a short walk", "innan
 * við 5 mínútna göngu"). Minutes followed by where the walk goes ("a 30
 * minute walk along the coast", "a 45 minute walk up Esja", "30 mínútna
 * ganga meðfram sjónum") are how long a walk lasts, so that stays a walk.
 */
function isDistanceBefore(words: readonly string[], index: number): boolean {
  const previous = at(words, index - 1);
  // "a minute's walk" splits into "minute", "s", "walk".
  const duration = previous === 's' ? at(words, index - 2) : previous;
  if (isMinutes(duration) && !routeFollows(words, index)) return true;
  const start = Math.max(0, index - 4);
  return words.slice(start, index).some((word) => WITHIN_WORDS.has(word));
}

/**
 * True when the words after a walk say where it goes ("along", "up",
 * "around", "through", "by", "meðfram", "upp", "um", "í kringum"), and "out
 * of", "out on", "út úr" or "út af" a place rather than a membership ("out of
 * town", "út úr bænum"). Directions that are really a distance ("around the
 * corner", "up the street", "by foot") and "um það bil" (about) do not count.
 */
function routeFollows(words: readonly string[], index: number): boolean {
  // "a 30 minute walk out of town", "30 mínútna ganga út úr bænum".
  const leaves = leavesAfterOut(words, index);
  if (leaves !== null) return !leaves;
  const next = at(words, index + 1);
  if (next === 'i') return at(words, index + 2) === 'kringum';
  if (!ROUTE_WORDS.has(next)) return false;
  if (next === 'um' && at(words, index + 2) === 'thad' && at(words, index + 3) === 'bil') return false;
  const object = at(words, index + 2) === 'the' ? at(words, index + 3) : at(words, index + 2);
  return !NOT_A_ROUTE.has(object);
}

const ROUTE_WORDS: ReadonlySet<string> = new Set([
  'along', 'up', 'around', 'round', 'through', 'by',
  'medfram', 'upp', 'um', 'kringum',
]);

/** What follows a route word when the walk is directions, not a walk. */
const NOT_A_ROUTE: ReadonlySet<string> = new Set(['corner', 'street', 'road', 'block', 'foot']);

/** "minute", "mins", "mínútna", and the same run together with a number ("5min"). */
function isMinutes(word: string): boolean {
  return MINUTE_WORDS.has(word.replace(LEADING_NUMBER, ''));
}

const MINUTE_WORDS: ReadonlySet<string> = new Set([
  'minute', 'minutes', 'min', 'mins', 'minutna', 'minutu', 'minutur', 'minutum',
]);

const WITHIN_WORDS: ReadonlySet<string> = new Set(['within', 'innan']);

const TODAY_PHRASES: readonly string[] = [
  'what should i do today', 'what should we do today',
  'hvad a eg ad gera i dag', 'hvad eigum vid ad gera i dag',
];

// MARK: The membership

/**
 * True for words about the plan a member pays for rather than a day (iOS
 * `CoachPlanIntent.isAboutMembership`). Shared by both intents: the
 * programme intent makes the same judgement before it offers a four-week
 * programme, and two copies of this list would drift.
 */
export function isAboutMembership(words: readonly string[]): boolean {
  if (words.some((word) => MEMBERSHIP_WORDS.has(word))) return true;
  for (let index = 0; index < words.length; index += 1) {
    if (!PLAN_NOUNS.has(words[index]!)) continue;
    // "the Plus plan", "a student plan", "Max planið"
    if (PLAN_TYPE_WORDS.has(at(words, index - 1))) return true;
    // "a plan for students", "plan fyrir námsmenn"
    const next = at(words, index + 1);
    if (next === 'for' || next === 'fyrir') {
      const target = ['a', 'the', 'my', 'our'].includes(at(words, index + 2)) ? at(words, index + 3) : at(words, index + 2);
      if (PLAN_TYPE_WORDS.has(target)) return true;
    }
    // "Is the plan worth it?", "What does the plan cover?"
    if (words.some((word) => PLAN_MEMBERSHIP_CONTEXT.has(word))) return true;
  }
  return false;
}

/** Membership and billing words: the plan a member pays for, not a day. */
const MEMBERSHIP_WORDS: ReadonlySet<string> = new Set([
  'membership', 'memberships', 'subscription', 'subscriptions', 'subscribe', 'subscribed',
  'price', 'prices', 'pricing', 'cost', 'costs', 'pay', 'payment', 'billing',
  'cancel', 'cancelled', 'canceled', 'cancellation', 'upgrade', 'downgrade',
  'tier', 'trial', 'refund', 'renew', 'renewal', 'commitment',
  'include', 'includes', 'included',
  'askrift', 'askriftin', 'askriftina', 'askriftar', 'askriftinni', 'askriftir', 'askriftarleid', 'askriftarleidir',
  'adild', 'adildar', 'adildin', 'adildina', 'adildinni',
  'verd', 'verdid', 'verdi', 'verdskra', 'kostar', 'kosta', 'kostnadur',
  'borga', 'greida', 'greidsla', 'greidslan', 'greidslu', 'greidsluna', 'greidslunni', 'greidslur',
  'uppsogn', 'uppsagnar', 'uppfaera', 'innifalid', 'innifalin', 'innifalinn',
]);

/** "plan" as a noun, in both languages. */
const PLAN_NOUNS: ReadonlySet<string> = new Set(['plan', 'plans', 'planid', 'planinu', 'plani', 'planinn']);

/** The membership tiers by name. */
const TIER_NAMES: ReadonlySet<string> = new Set(['base', 'basic', 'plus', 'max', 'premium']);

/**
 * Tier and plan-type names, and the words people compare memberships with:
 * next to "plan" they make it a membership ("the best plan").
 */
const PLAN_TYPE_WORDS: ReadonlySet<string> = new Set([
  ...TIER_NAMES,
  'student', 'students', 'family', 'families',
  'best', 'better', 'right',
  'company', 'companies', 'corporate', 'business', 'annual', 'yearly', 'monthly',
  'couple', 'couples', 'senior', 'seniors', 'individual',
  'namsmenn', 'namsmann', 'namsmanna', 'fjolskyldu', 'fjolskyldur', 'fyrirtaeki', 'fyrirtaekja',
]);

/** Words that, next to any "plan", ask about what the membership gives. */
const PLAN_MEMBERSHIP_CONTEXT: ReadonlySet<string> = new Set([
  'worth', 'cover', 'covers', 'covered', 'benefits', 'perks', 'cheapest', 'cheaper', 'expensive',
]);

const MEMBERSHIP_PHRASES: readonly string[] = [
  'which plan', 'what plan', 'my plan', 'your plan', 'current plan',
  'change plan', 'switch plan', 'hvada plan', 'planid mitt', 'segja upp',
];
