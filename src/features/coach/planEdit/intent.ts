/**
 * Words that ask to change the plan that is running: the Android port of
 * iOS `PlanEditIntent` (Models/PlanEditIntent.swift), table for table. The
 * send pipeline's `planEdit.start` step (../flows/planEdit.ts) runs it only
 * while the server changes plans by chat and a plan is live
 * (./availability.ts); a match sends the words to OP-58, which can still
 * answer "not a plan edit", and then the words go on through the Coach.
 *
 * NARROW ON PURPOSE (spec, critic 15). A message goes to the plan change
 * when it has an EDIT VERB and something of the PLAN in it ("swap bench for
 * dips", "færðu æfinguna á laugardag", "Tausch die Klimmzüge"), says the
 * member DOESN'T HAVE a piece of equipment or an exercise ("I don't have a
 * cable machine", "Ich habe keine Beinpresse"), or that it is back ("I have
 * dumbbells again"). A question with no edit verb is advice, and goes to the
 * chat ("how many sets should I do?", "hvaða æfing er góð fyrir bakið?").
 * Anything about a booking stays out.
 *
 * A word missed here reaches the chat, which cannot change a plan; a word
 * caught wrongly costs one refunded call, and the server answers
 * `not_plan_edit` so the same words go on down the normal path.
 *
 * The plan's own words count too: the names of the exercises and days the
 * cached plan shows (`planVocabularyFrom`). Both apps pass the shared router
 * corpus (__tests__/fixtures/plan-edit-router-corpus.json, the same bytes in
 * iOS and the monorepo) 100%.
 */
import type { HealthDay } from '../../../health/models';

// ---------------------------------------------------------------------------
// Folding

/** Icelandic letters that are letters of their own, spelled out as iOS does. */
const ICELANDIC_LETTERS: Readonly<Record<string, string>> = { ð: 'd', þ: 'th', æ: 'ae' };
const COMBINING_MARKS = /\p{M}/gu;
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]+/u;

/**
 * Lower case, apostrophes dropped ("don't" is "dont"), `ß` as `ss`, `ð` as
 * `d`, `þ` as `th`, `æ` as `ae`, diacritics off, split on anything that is
 * not a letter or a digit (iOS `PlanEditIntent.tokens(of:)`). So "Ég er ekki
 * með handlóð" and "eg er ekki med handlod" read the same, and so do "Übung"
 * and "Ubung".
 */
export function planEditTokens(text: string): string[] {
  const folded = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[ðþæ]/g, (letter) => ICELANDIC_LETTERS[letter] ?? letter)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');
  return folded.split(NOT_A_WORD_CHARACTER).filter((word) => word.length > 0);
}

function containsAny(phrase: string, phrases: readonly string[]): boolean {
  return phrases.some((candidate) => phrase.includes(` ${candidate} `));
}

function intersects(words: ReadonlySet<string>, table: Iterable<string>): boolean {
  for (const word of table) if (words.has(word)) return true;
  return false;
}

/** A question form: it ends with a question mark, or opens with a question word. */
function isQuestion(text: string, words: readonly string[], phrase: string): boolean {
  if (text.trim().endsWith('?')) return true;
  const first = words[0];
  if (first === undefined) return false;
  return QUESTION_STARTERS.has(first) || phrase.startsWith(' af hverju ');
}

/** The significant words of the plan's own day titles and exercise names. */
export function vocabularyTokens(vocabulary: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const name of vocabulary) {
    for (const word of planEditTokens(name)) {
      if (word.length >= 4 && !VOCABULARY_STOPWORDS.has(word)) result.add(word);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// The rule

/** True when the words ask to change the running plan (see the file comment). */
export function planEditIntentMatches(text: string, vocabulary: readonly string[] = []): boolean {
  const words = planEditTokens(text);
  if (words.length === 0) return false;
  const phrase = ` ${words.join(' ')} `;
  const wordSet = new Set(words);
  if (intersects(wordSet, BOOKING_WORDS)) return false;
  const hasEditVerb =
    intersects(wordSet, EDIT_VERBS) ||
    containsAny(phrase, EDIT_PHRASES) ||
    (wordSet.has('make') && containsAny(phrase, MAKE_TARGETS)) ||
    (intersects(wordSet, ['mach', 'mache', 'gerdu']) && containsAny(phrase, MAKE_TARGETS));
  // Advice: a question that asks for no change.
  if (isQuestion(text, words, phrase) && !hasEditVerb) return false;

  const vocabularyWords = vocabularyTokens(vocabulary);
  const namesSomething =
    intersects(wordSet, EXERCISE_WORDS) ||
    intersects(wordSet, EQUIPMENT_WORDS) ||
    containsAny(phrase, EXERCISE_PHRASES) ||
    containsAny(phrase, EQUIPMENT_PHRASES) ||
    intersects(wordSet, vocabularyWords);
  const namesPlan = namesSomething || intersects(wordSet, PLAN_WORDS) || containsAny(phrase, PLAN_PHRASES);
  if (hasEditVerb && namesPlan) return true;

  // "I have dumbbells again": the equipment comes back.
  const hasAgain =
    intersects(wordSet, ['again', 'aftur', 'wieder']) && intersects(wordSet, ['have', 'got', 'med', 'habe', 'hab', 'hat', 'gibt']);
  if (hasAgain && namesSomething) return true;

  const saysDoesNotHave =
    containsAny(phrase, DONT_HAVE_PHRASES) ||
    (wordSet.has('no') && intersects(wordSet, ['gym', 'here'])) ||
    (intersects(wordSet, ['kein', 'keine', 'keinen']) && intersects(wordSet, ['gym', 'studio', 'fitnessstudio', 'hier']));
  return saysDoesNotHave && namesSomething;
}

// ---------------------------------------------------------------------------
// The plan's own words

/**
 * The names the cached Today read shows for the live plan (iOS
 * `HealthStore.planVocabulary`): today's session title, its exercises and
 * its pool alternative's, the week's day titles, the upcoming rows' titles.
 * Only what is already on the phone; nothing is read for this.
 */
export function planVocabularyFrom(day: HealthDay | null | undefined): string[] {
  const program = day?.program;
  if (!day || !program || (program.status !== 'active' && program.status !== 'paused')) return [];
  const names: (string | null)[] = [];
  const session = day.day?.session ?? null;
  if (session) {
    names.push(session.title);
    for (const block of session.blocks ?? []) names.push(block.name);
    for (const block of session.poolAlternative?.blocks ?? []) names.push(block.name);
  }
  for (const cell of day.week?.days ?? []) names.push(cell.title);
  for (const row of day.upcoming ?? []) names.push(row.title);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw?.trim() ?? '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    result.push(name);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tables (folded, iOS's verbatim)

/** Words in a title that say nothing about which day or exercise it is. */
const VOCABULARY_STOPWORDS: ReadonlySet<string> = new Set([
  'with', 'and', 'the', 'your', 'body', 'full', 'easy', 'hard', 'rest', 'strength',
  'moderate', 'minutes', 'plan', 'this', 'that', 'from', 'workout', 'session',
  'und', 'mit', 'oder', 'fur', 'dein', 'deine',
  'med', 'fyrir', 'dagur', 'eftir',
]);

/** Single-word edit verbs, EN / IS / DE, in the forms people type. */
export const EDIT_VERBS: ReadonlySet<string> = new Set([
  // English
  'swap', 'swaps', 'swapping', 'swapped', 'replace', 'replaces', 'replacing', 'replaced',
  'change', 'changes', 'changing', 'changed', 'switch', 'switching', 'switched',
  'move', 'moves', 'moving', 'moved', 'add', 'adding', 'added',
  'remove', 'removes', 'removing', 'removed', 'drop', 'dropping', 'dropped',
  'rename', 'renaming', 'renamed', 'delete', 'instead', 'exchange', 'substitute',
  'put', 'shorten', 'lengthen', 'reduce', 'increase', 'adjust', 'tweak', 'edit', 'modify',
  // Icelandic
  'skipta', 'skiptu', 'skipti', 'breyta', 'breyttu', 'breytt', 'faera', 'faerdu', 'faert',
  'taktu', 'fjarlaegdu', 'fjarlaegja', 'baettu', 'settu', 'faekkadu', 'fjolgadu',
  'lengdu', 'styttu', 'nefndu', 'adlaga', 'adlagadu', 'lagadu',
  // German
  'tauschen', 'tausch', 'tausche', 'ersetzen', 'ersetze', 'ersetz', 'statt', 'anstatt',
  'andern', 'ander', 'andere', 'verschieben', 'verschieb', 'verschiebe',
  'hinzufugen', 'fug', 'fuge', 'entfernen', 'entfern', 'entferne', 'streichen', 'streich',
  'streiche', 'nimm', 'wechsel', 'wechseln', 'wechsle',
  'umbenennen', 'reduzier', 'reduziere', 'erhoh', 'erhohe', 'anpassen',
]);

/** What "make" (and "mach", "gerðu") changes when it is an edit: "make it 4 sets", "make Thursday a rest day". */
const MAKE_TARGETS: readonly string[] = [
  'rest day', 'ruhetag', 'hvildardag', 'hvildardegi', 'sets', 'reps', 'workout',
  'shorter', 'longer', 'easier', 'harder', 'kurzer', 'langer', 'styttri', 'lengri',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

/** Edit verbs of more than one word. */
const EDIT_PHRASES: readonly string[] = [
  'instead of', 'get rid of', 'take out', 'take off', 'switch out', 'swap out', 'make it',
  'i stadinn fyrir', 'i stad', 'baeta vid', 'taka ut', 'taka af', 'setja inn',
  'fuge hinzu', 'fug hinzu', 'nimm raus', 'raus nehmen', 'rausnehmen',
];

/** A day, the plan, or a part of a workout. */
const PLAN_WORDS: ReadonlySet<string> = new Set([
  // English
  'exercise', 'exercises', 'workout', 'workouts', 'session', 'sessions', 'set', 'sets',
  'rep', 'reps', 'routine', 'warmup', 'cardio', 'stretch', 'stretches', 'stretching',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays',
  // Icelandic
  'aefing', 'aefingu', 'aefingar', 'aefingum', 'aefingin', 'aefinguna', 'aefingunni',
  'aefingarnar', 'aefinganna', 'sett', 'settin', 'settum', 'settunum', 'endurtekningar',
  'endurtekningum', 'hvildardag', 'hvildardagur', 'hvildardaginn', 'hvildardegi',
  'aaetlun', 'aaetlunin', 'aaetlunina', 'aaetluninni', 'aaetlunarinnar', 'upphitun',
  'aefingaaaetlun', 'aefingaaaetlunin', 'aefingaaaetlunina', 'aefingaaaetluninni',
  'aefingadag', 'aefingadagur', 'aefingadaginn', 'aefingadegi',
  'manudag', 'manudagur', 'manudaginn', 'thridjudag', 'thridjudagur', 'thridjudaginn',
  'midvikudag', 'midvikudagur', 'midvikudaginn', 'fimmtudag', 'fimmtudagur', 'fimmtudaginn',
  'fostudag', 'fostudagur', 'fostudaginn', 'laugardag', 'laugardagur', 'laugardaginn',
  'sunnudag', 'sunnudagur', 'sunnudaginn',
  // German
  'ubung', 'ubungen', 'satz', 'satze', 'wiederholungen', 'ruhetag', 'ruhetage', 'trainingsplan',
  'training', 'trainingstag', 'einheit', 'aufwarmen',
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags', 'sonntags',
]);

const PLAN_PHRASES: readonly string[] = [
  'rest day', 'rest days', 'training day', 'training days', 'leg day', 'push day', 'pull day',
  'warm up', 'my plan', 'the plan', 'this plan', 'my training', 'my routine',
  'meinen plan', 'mein plan', 'den plan', 'meinem plan', 'dem plan',
];

/** Exercise names people type without the plan in front of them. */
const EXERCISE_WORDS: ReadonlySet<string> = new Set([
  // English
  'bench', 'squat', 'squats', 'deadlift', 'deadlifts', 'curl', 'curls', 'press', 'presses',
  'row', 'rows', 'pullup', 'pullups', 'pushup', 'pushups', 'chinup', 'chinups', 'plank',
  'planks', 'lunge', 'lunges', 'dips', 'pushdown', 'pushdowns', 'fly', 'flys',
  'flyes', 'flies', 'raise', 'raises', 'burpees', 'crunches', 'situps', 'pulldown',
  'pulldowns', 'kickback', 'kickbacks', 'thrust', 'thrusts', 'handstand', 'lsit', 'kickups',
  // Icelandic
  'hnebeygja', 'hnebeygjur', 'hnebeygju', 'bekkpressa', 'bekkpressu', 'armbeygjur',
  'armbeygju', 'upphifingar', 'upphifingum', 'rettstoduloft', 'uthrysting', 'planki',
  'planka', 'framstig',
  // German
  'bankdrucken', 'kniebeuge', 'kniebeugen', 'kreuzheben', 'klimmzug', 'klimmzuge',
  'liegestutz', 'liegestutze', 'rudern', 'ausfallschritte', 'seitheben', 'bizepscurls',
]);

const EXERCISE_PHRASES: readonly string[] = [
  'pull up', 'pull ups', 'push up', 'push ups', 'chin up', 'chin ups', 'sit ups',
  'bench press', 'leg press', 'lat pulldown', 'hip thrust',
];

/** Equipment, for "I don't have ...". */
const EQUIPMENT_WORDS: ReadonlySet<string> = new Set([
  // English
  'machine', 'machines', 'cable', 'cables', 'dumbbell', 'dumbbells', 'barbell', 'barbells',
  'kettlebell', 'kettlebells', 'band', 'bands', 'rack', 'treadmill', 'rower', 'equipment',
  'weights', 'parallettes', 'rings',
  // Icelandic
  'velina', 'velar', 'velarnar', 'kapalvel', 'kapalvelina', 'kapalvelar', 'handlod',
  'handlodin', 'handlodum', 'stong', 'stongina', 'stongum', 'lod', 'lodin', 'ketilbjalla',
  'ketilbjollu', 'ketilbjollur', 'teygja', 'teygju', 'teygjur', 'bekk', 'bekkinn', 'bunad',
  'bunadinn', 'bunadur', 'bunadurinn', 'fotapressa', 'fotapressu',
  // German
  'maschine', 'maschinen', 'kabel', 'kabelzug', 'kurzhantel', 'kurzhanteln', 'langhantel',
  'langhanteln', 'hantel', 'hanteln', 'bander', 'bank', 'beinpresse', 'gerat', 'gerate',
  'latzug', 'klimmzugstange', 'stange',
]);

const EQUIPMENT_PHRASES: readonly string[] = [
  'pull up bar', 'cable machine', 'smith machine', 'resistance band', 'resistance bands',
];

/** "I don't have", "there's no", "ég er ekki með", "Ich habe keine". */
const DONT_HAVE_PHRASES: readonly string[] = [
  'dont have', 'do not have', 'doesnt have', 'does not have', 'havent got', 'have not got',
  'dont got', 'have no', 'has no', 'theres no', 'there is no', 'there are no', 'no longer have',
  'ekki med', 'engin', 'enginn', 'ekkert', 'eg a ekki', 'ekki til',
  'habe keine', 'habe keinen', 'habe kein', 'hab keine', 'hab keinen', 'hab kein',
  'gibt es kein', 'gibt es keine', 'gibt es keinen', 'gibt kein', 'gibt keine', 'gibt keinen',
  'hat keine', 'hat keinen', 'hat kein',
];

/** The words a question opens with. A question without an edit verb is advice for the chat. */
const QUESTION_STARTERS: ReadonlySet<string> = new Set([
  'how', 'what', 'which', 'why', 'should', 'whats', 'when', 'where', 'is', 'are',
  'can', 'could', 'do', 'does',
  'hvada', 'hvernig', 'hvad', 'hvers', 'hvenaer', 'hvar', 'aetti', 'get', 'ma',
  'welche', 'welcher', 'welches', 'wie', 'was', 'warum', 'soll', 'sollte', 'wann', 'wo',
  'kann', 'kannst', 'ist', 'sind',
]);

/** A booking is not the plan. */
const BOOKING_WORDS: ReadonlySet<string> = new Set([
  'book', 'booking', 'bookings', 'booked', 'reservation', 'reserve',
  'boka', 'bokun', 'bokunin', 'bokunina', 'bokuninni', 'bokunar', 'bokanir', 'bokadu',
  'buchen', 'buchung', 'buche', 'reservieren',
]);
