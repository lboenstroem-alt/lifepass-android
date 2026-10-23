/**
 * Typed words that ask to CHANGE the plan that is running: iOS
 * `PlanEditIntent` (Models/PlanEditIntent.swift). The send pipeline's
 * `planEdit.start` step (../flows/planEdit.ts) runs it only while the server
 * changes plans by chat and a plan is live (./availability.ts); a match
 * sends the words to OP-58, which can still answer "not a plan edit", and
 * then the words go on through the Coach as before.
 *
 * THE RULE (spec "ROUTING TYPED TEXT", step 4), deliberately narrow:
 *
 *   (an EDIT verb AND a plan object)  OR  (a "don't have" phrase AND an equipment or exercise word)
 *   AND NOT a question without an edit verb
 *
 * A false positive costs a refunded model call, a moment and one of the
 * member's hourly attempts; a false negative costs nothing, because the
 * words reach the chat as they always did and "Change my plan" is a tap
 * away. So whole words and phrases only, in the folded spelling every Coach
 * reader shares (../routing/tokens.ts: lower case, no diacritics, ð as d, þ
 * as th, æ as ae; German ü, ö, ä lose their dots, ß stays).
 *
 * Plan objects include the plan's own words: the folded names of the
 * exercises and days the cached plan shows (`planVocabularyFrom`), so
 * "swap bench press for push-ups" matches when the plan has a bench press.
 *
 * Every table is the same in iOS, and both apps must pass the shared router
 * corpus (__tests__/fixtures/plan-edit-router-corpus.json) 100%.
 */
import type { HealthDay } from '../../../health/models';
import { hasPhrase, phraseOf, tokens } from '../routing/tokens';

// ---------------------------------------------------------------------------
// Tables (folded)

/** Single words that ask for a change. */
export const EDIT_VERBS: ReadonlySet<string> = new Set([
  // English
  'swap', 'replace', 'change', 'switch', 'move', 'add', 'remove', 'drop', 'rename',
  // Icelandic
  'skipta', 'skiptu', 'breyta', 'breyttu', 'faera', 'faerdu', 'taktu',
  // German
  'tauschen', 'tausch', 'tausche', 'ersetzen', 'ersetze', 'statt', 'anstatt', 'andern', 'verschieben',
  'verschieb', 'verschiebe', 'hinzufugen', 'fug', 'entfernen', 'entferne', 'streichen', 'streich',
]);

/** Phrases that ask for a change. */
export const EDIT_PHRASES: readonly string[] = [
  'instead of',
  'i stadinn fyrir', 'baeta vid', 'baettu vid', 'taka ut', 'taktu ut',
];

/**
 * "make" asks for a change only with a rest day or a dose ("make Thursday a
 * rest day", "make it 4 sets"): "make me a plan" is the programme wizard's.
 */
const MAKE_VERBS: ReadonlySet<string> = new Set(['make']);

/** The plan's things, as words. */
export const PLAN_OBJECT_WORDS: ReadonlySet<string> = new Set([
  // English
  'exercise', 'exercises', 'workout', 'workouts', 'set', 'sets', 'rep', 'reps',
  // Icelandic
  'aefing', 'aefingu', 'aefingar', 'aefingum', 'aefinguna', 'aefingin', 'sett', 'settum', 'settin',
  'hvildardagur', 'hvildardag', 'hvildardegi', 'aaetlun', 'aaetlunina', 'aaetluninni',
  // German
  'ubung', 'ubungen', 'satze', 'satz', 'wiederholungen', 'ruhetag', 'trainingsplan',
]);

/** The plan's things, as phrases. */
export const PLAN_OBJECT_PHRASES: readonly string[] = ['rest day', 'my plan', 'the plan', 'my workout plan'];

/** What "make" needs next to it (a rest day or a dose). */
const MAKE_OBJECT_WORDS: ReadonlySet<string> = new Set([
  'set', 'sets', 'rep', 'reps', 'seconds', 'minutes', 'sett', 'endurtekningar', 'satze', 'wiederholungen', 'sekunden',
]);
const MAKE_OBJECT_PHRASES: readonly string[] = ['rest day'];

/** "I don't have", "there's no", "ég er ekki með", "ich habe keine", "mein Gym hat keine". */
export const DONT_HAVE_PHRASES: readonly string[] = [
  // English ("don't" folds to "don t")
  'don t have', 'dont have', 'do not have', 'doesn t have', 'does not have', 'there s no', 'there is no',
  'haven t got', 'no longer have',
  // Icelandic
  'ekki med', 'hef ekki',
  // German
  'habe keine', 'habe keinen', 'habe kein', 'hab keine', 'hab keinen', 'hab kein', 'hat keine', 'hat keinen',
  'hat kein', 'gibt es kein', 'gibt es keine', 'gibt es keinen', 'gibt keine', 'gibt keinen',
];

/** "No ... at my gym", "engin ... í ræktinni": the absence word, then the place. */
const ABSENCE_WORDS: ReadonlySet<string> = new Set(['no', 'engin', 'enginn', 'ekkert', 'engar', 'engir']);
const AT_MY_GYM_PHRASES: readonly string[] = ['at my gym', 'in my gym', 'at the gym', 'i raektinni', 'i raektinni minni'];

/** Equipment, the thing a member does not have. */
export const EQUIPMENT_WORDS: ReadonlySet<string> = new Set([
  // English
  'machine', 'machines', 'cable', 'cables', 'barbell', 'barbells', 'dumbbell', 'dumbbells', 'dumbells',
  'kettlebell', 'kettlebells', 'band', 'bands', 'bench', 'rack', 'equipment', 'weights', 'plates', 'rings',
  'treadmill', 'rower', 'bike', 'smith', 'trx', 'box', 'bar',
  // Icelandic
  'vel', 'velar', 'velina', 'kapalvel', 'kapalvelina', 'kapall', 'stong', 'stangir', 'stongina', 'handlod',
  'handlodin', 'ketilbjalla', 'ketilbjollu', 'ketilbjollur', 'teygja', 'teygju', 'teygjur', 'bekkur', 'bekk',
  'bunad', 'bunadinn', 'bunadur', 'bunadi', 'lod', 'lodin', 'fotapressa', 'fotapressu',
  // German
  'maschine', 'maschinen', 'kabel', 'kabelzug', 'kabelmaschine', 'langhantel', 'langhanteln', 'kurzhantel',
  'kurzhanteln', 'hantel', 'hanteln', 'bander', 'bank', 'beinpresse', 'klimmzugstange', 'gerat', 'gerate',
  'gewichte', 'rudergerat', 'laufband',
]);

/** Equipment named in two words. */
export const EQUIPMENT_PHRASES: readonly string[] = [
  'leg press', 'squat rack', 'pull up bar', 'pullup bar', 'chin up bar', 'cable machine', 'rowing machine',
];

/** Words that make a question of what was typed. */
export const QUESTION_WORDS: ReadonlySet<string> = new Set([
  'how', 'what', 'which', 'why', 'should',
  'hvada', 'hvernig', 'hvad',
  'welche', 'welcher', 'welches', 'wie', 'was', 'warum', 'soll', 'sollte',
]);
const QUESTION_PHRASES: readonly string[] = ['af hverju'];

/** Words too common to stand for an exercise or a day on their own. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'with', 'each', 'side', 'sides', 'body', 'strength', 'upper', 'lower', 'full', 'light', 'heavy', 'easy', 'hard',
  'holds', 'hold', 'day', 'days', 'rest', 'session', 'class', 'walk', 'swim', 'cardio', 'mobility', 'training',
  'workout', 'exercise', 'stretch', 'other', 'their', 'there', 'about', 'after', 'before', 'morgen', 'heute',
]);

// ---------------------------------------------------------------------------
// The plan's own words

/** The folded words and phrases that name something in the cached plan. */
export interface PlanVocabulary {
  /** Single words (at least five letters, not generic). */
  readonly words: ReadonlySet<string>;
  /** Phrases of two or more words. */
  readonly phrases: readonly string[];
}

export const EMPTY_VOCABULARY: PlanVocabulary = { words: new Set(), phrases: [] };

/**
 * The vocabulary of a list of names: each whole name, each run of two or
 * more of its words, and each of its words that could only mean it. A day
 * title is cut at its first bracket ("Push (Brust & Trizeps)" is "push").
 */
export function vocabularyOf(names: readonly (string | null | undefined)[]): PlanVocabulary {
  const words = new Set<string>();
  const phrases = new Set<string>();
  for (const raw of names) {
    if (!raw) continue;
    for (const part of [raw, raw.split('(')[0] ?? '']) {
      const folded = tokens(part);
      if (folded.length === 0) continue;
      for (let start = 0; start < folded.length; start += 1) {
        for (let end = start + 2; end <= folded.length; end += 1) phrases.add(folded.slice(start, end).join(' '));
      }
      for (const word of folded) {
        if (word.length >= 5 && !GENERIC_WORDS.has(word) && !/^\d+$/.test(word)) words.add(word);
      }
      if (folded.length === 1 && folded[0]!.length >= 4 && !GENERIC_WORDS.has(folded[0]!)) words.add(folded[0]!);
    }
  }
  return { words, phrases: [...phrases] };
}

/**
 * The names the cached Today read shows: today's exercises and title, the
 * week's day titles, the upcoming rows' titles. Only what is already on the
 * phone; nothing is read for this.
 */
export function planVocabularyFrom(day: HealthDay | null | undefined): PlanVocabulary {
  if (!day) return EMPTY_VOCABULARY;
  const names: (string | null)[] = [];
  const session = day.day?.session ?? null;
  if (session) {
    names.push(session.title);
    for (const block of session.blocks ?? []) names.push(block.name);
  }
  for (const cell of day.week?.days ?? []) names.push(cell.title);
  for (const row of day.upcoming ?? []) names.push(row.title);
  return vocabularyOf(names);
}

// ---------------------------------------------------------------------------
// The rule

function hasWord(words: readonly string[], set: ReadonlySet<string>): boolean {
  return words.some((word) => set.has(word));
}

function namesPlanThing(words: readonly string[], phrase: string, vocabulary: PlanVocabulary): boolean {
  return (
    hasWord(words, PLAN_OBJECT_WORDS) ||
    hasPhrase(phrase, PLAN_OBJECT_PHRASES) ||
    hasWord(words, vocabulary.words) ||
    hasPhrase(phrase, vocabulary.phrases)
  );
}

function asksForChange(words: readonly string[], phrase: string, vocabulary: PlanVocabulary): boolean {
  if (hasWord(words, EDIT_VERBS) || hasPhrase(phrase, EDIT_PHRASES)) return true;
  if (!hasWord(words, MAKE_VERBS)) return false;
  // "make it 4 sets", "make Thursday a rest day", "make squats 10x30".
  return (
    hasWord(words, MAKE_OBJECT_WORDS) ||
    hasPhrase(phrase, MAKE_OBJECT_PHRASES) ||
    words.some((word) => /^\d+x\d+$/.test(word)) ||
    hasWord(words, vocabulary.words) ||
    hasPhrase(phrase, vocabulary.phrases)
  );
}

function saysDontHave(words: readonly string[], phrase: string): boolean {
  if (hasPhrase(phrase, DONT_HAVE_PHRASES)) return true;
  return hasWord(words, ABSENCE_WORDS) && hasPhrase(phrase, AT_MY_GYM_PHRASES);
}

function namesEquipmentOrExercise(words: readonly string[], phrase: string, vocabulary: PlanVocabulary): boolean {
  return hasWord(words, EQUIPMENT_WORDS) || hasPhrase(phrase, EQUIPMENT_PHRASES) || namesPlanThing(words, phrase, vocabulary);
}

/** A question: it opens with a question word, or ends with "?" and has one. */
function isQuestion(text: string, words: readonly string[], phrase: string): boolean {
  if (words.length > 0 && QUESTION_WORDS.has(words[0]!)) return true;
  if (hasPhrase(phrase, QUESTION_PHRASES) && phrase.startsWith(` ${QUESTION_PHRASES[0]} `)) return true;
  return text.trim().endsWith('?') && (hasWord(words, QUESTION_WORDS) || hasPhrase(phrase, QUESTION_PHRASES));
}

/** True when the words ask to change the running plan (see the file comment). */
export function planEditIntentMatches(text: string, vocabulary: PlanVocabulary = EMPTY_VOCABULARY): boolean {
  const words = tokens(text);
  if (words.length === 0) return false;
  const phrase = phraseOf(words);
  const change = asksForChange(words, phrase, vocabulary);
  // A question with no edit verb is the chat's ("how many sets should I do?",
  // "hvaða æfing er góð fyrir bakið?", "Welche Übung ist gut für den Rücken?").
  if (!change && isQuestion(text, words, phrase)) return false;
  if (change && namesPlanThing(words, phrase, vocabulary)) return true;
  return saysDontHave(words, phrase) && namesEquipmentOrExercise(words, phrase, vocabulary);
}
