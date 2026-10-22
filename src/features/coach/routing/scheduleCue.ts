/**
 * Questions about classes or a time go to the chat, not the venue wizard:
 * iOS `venueWizardCategory` and `hasScheduleCue` (Models/CoachQuestions.swift,
 * since 2.5.3).
 *
 * A question about classes or a time often names a venue type too ("yoga
 * classes in Akureyri", "a workout today at 9", "spinning á morgun"). The
 * wizard only finds places; the chat reads the class timetable on the server
 * before its one model call (monorepo docs/12_COACH.md 5.1). So typed words
 * with a schedule cue go to the chat, and plain venue finding ("find me a
 * gym", "pool near me", "sauna") keeps the free wizard. A schedule question
 * that goes to the chat costs a Coach message; a near miss ("opening times",
 * "3 times a week", "at 10 locations") must not, so the cue is narrow.
 *
 * Prompts the app parks (Home's cards) skip this check: their wording has
 * always run the wizard (`PARKED_SEND` in ../store/coachStore.ts).
 *
 * Every word table below is iOS's, verbatim, in the folded spelling of
 * ./tokens.ts. The clock-time patterns are iOS's too, with two mechanical
 * changes that keep them identical in meaning on Hermes and V8: iOS's `\b`
 * (ICU word boundary, Unicode-aware) is spelled out, and each lookbehind is
 * written as "the start, or a character that is not one of these".
 */
import { detectVenueCategory, type VenueCategory } from '../../../data/coachQuestions';
import { hasPhrase, phraseOf, tokens } from './tokens';

/**
 * The venue wizard's category for words the member TYPED, or null when they
 * go to the chat instead (iOS `venueWizardCategory`): a schedule cue wins over
 * a venue type. `detectVenueCategory` itself is unchanged, because the
 * day-plan intent still reads it.
 */
export function venueWizardCategory(text: string): VenueCategory | null {
  if (hasScheduleCue(text)) return null;
  return detectVenueCategory(text);
}

/**
 * True when the words ask about classes or a time rather than a place, in
 * English or Icelandic, typed with or without an Icelandic keyboard
 * (iOS `hasScheduleCue`):
 * - a class word: class, classes, course, lesson, session, timetable,
 *   schedule, stundaskrá, námskeið..., tími, tímar (and tíma, tímum),
 *   hóptím..., tímatafla, or "times" right after a venue type ("yoga
 *   times"); not "World Class" (a gym), "first class", "high-class", "golf
 *   course", "of course", "sauna session" or "allan tímann" (the whole time);
 * - a question about when: what time, when is / are / does / do, when's,
 *   hvenær;
 * - a day or a part of one: today, tomorrow, tonight, the weekend, a
 *   weekday, this morning / afternoon / evening, in the morning / afternoon /
 *   evening, after work, before work, noon, midday, lunchtime, at lunch;
 *   í dag, á morgun, í morgun, í kvöld, í fyrramálið, annað kvöld, hinn
 *   daginn, um helgina, um helgar, eftir vinnu, fyrir vinnu, hádegi...,
 *   seinnipartinn, á morgnana, á kvöldin, or an Icelandic weekday in any case
 *   (á laugardaginn, á mánudegi);
 * - a clock time: "at 9", "after 5", "before 7:30", "kl. 17", "klukkan
 *   níu", 17:30, 17.30, 6pm, "9 o'clock". "at 25m", "after 3 months", "at
 *   101 Reykjavík", "at 10 locations", "1.25 km" and "10.50 m" are not times.
 */
export function hasScheduleCue(text: string): boolean {
  const words = tokens(text);
  if (words.length === 0) return false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const previous = index > 0 ? words[index - 1]! : '';
    if (SCHEDULE_WORDS.has(word) || SCHEDULE_DAY_WORDS.has(word)) {
      if (SCHEDULE_WORD_EXCEPTIONS.get(word)?.has(previous)) continue;
      return true;
    }
    if (SCHEDULE_WORD_PREFIXES.some((prefix) => word.startsWith(prefix))) return true;
    // "yoga times", "spinning times"; not "3 times a week".
    if (word === 'times' && detectVenueCategory(previous) !== null) return true;
  }
  if (hasPhrase(phraseOf(words), SCHEDULE_DAY_PHRASES)) return true;

  const lowered = text.toLowerCase();
  return SCHEDULE_TIME_PATTERNS.some((pattern) => pattern.test(lowered));
}

/** Folded whole words that ask about classes, or when (hvenær). */
const SCHEDULE_WORDS: ReadonlySet<string> = new Set([
  'class', 'classes', 'timetable', 'timetables', 'schedule', 'schedules',
  'course', 'courses', 'lesson', 'lessons', 'session', 'sessions',
  'stundaskra', 'stundaskrar', 'stundaskrana', 'stundaskranni',
  'timi', 'timar', 'tima', 'timum', 'timana', 'timann', 'timanum', 'timinn',
  'hvenaer',
]);

/**
 * A schedule word that means something else right after one of these folded
 * words: "World Class" is a gym, "first class" and "high-class" are praise
 * (the hyphen is not a word), "golf course" is a place, "of course" agrees, a
 * "sauna session" is a visit, and "allan tímann" (the whole time), "langan
 * tíma" (a long time) and "sama tíma" (the same time) are not a class.
 */
const SCHEDULE_WORD_EXCEPTIONS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const notAClass = new Set(['world', 'first', 'high', 'top']);
  const notACourse = new Set(['golf', 'of']);
  const notASession = new Set(['sauna', 'spa', 'steam', 'massage', 'lagoon', 'recovery', 'wellness']);
  const notAClassTime = new Set([
    'allan', 'langan', 'langur', 'stuttan', 'stuttur', 'lengri', 'styttri', 'sama', 'naegan', 'godan',
  ]);
  return new Map<string, ReadonlySet<string>>([
    ['class', notAClass],
    ['course', notACourse],
    ['courses', notACourse],
    ['session', notASession],
    ['sessions', notASession],
    ['timi', notAClassTime],
    ['tima', notAClassTime],
    ['timann', notAClassTime],
    ['timanum', notAClassTime],
    ['timinn', notAClassTime],
  ]);
})();

/** Folded whole words that name a day or a time of one. */
const SCHEDULE_DAY_WORDS: ReadonlySet<string> = new Set([
  'today', 'tomorrow', 'tonight', 'weekend', 'weekends', 'noon', 'midday', 'lunchtime',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays',
  'helgina', 'helginni', 'seinnipartinn',
]);

/**
 * Folded word starts: group classes, courses, the timetable, noon, and the
 * Icelandic weekdays in every case ("laugardag..." and "laugardeg..."; never
 * "Laugardal...", the Reykjavík valley with the pool).
 */
const SCHEDULE_WORD_PREFIXES: readonly string[] = [
  'hoptim', 'timataf', 'timatof', 'namskei', 'hadeg',
  'manudag', 'manudeg', 'thridjudag', 'thridjudeg', 'midvikudag', 'midvikudeg',
  'fimmtudag', 'fimmtudeg', 'fostudag', 'fostudeg', 'laugardag', 'laugardeg',
  'sunnudag', 'sunnudeg',
];

/**
 * Folded phrases that ask when, or name a day or a part of one. "when s" is
 * "when's" (the apostrophe is not a word).
 */
const SCHEDULE_DAY_PHRASES: readonly string[] = [
  'what time', 'what times', 'when is', 'when are', 'when does', 'when do', 'when s',
  'this morning', 'this afternoon', 'this evening',
  'in the morning', 'in the afternoon', 'in the evening',
  'after work', 'before work', 'at lunch', 'lunch break', 'lunch time',
  'i dag', 'a morgun', 'i morgun', 'i kvold', 'i fyrramalid', 'annad kvold', 'hinn daginn',
  'um helgar', 'naestu helgi', 'eftir vinnu', 'fyrir vinnu', 'seinni partinn',
  'a morgnana', 'a kvoldin',
];

// ─── Clock times ──────────────────────────────────────────────────────────────

/** NSRegularExpression's word characters (ICU `\w`): letters, marks, decimal digits, connector punctuation. */
const WORD_CHARACTER = '\\p{L}\\p{M}\\p{Nd}\\p{Pc}';
/** iOS `\b` in front of a word: the start, or a character that is not a word character. */
const WORD_START = `(?:^|[^${WORD_CHARACTER}])`;
/** iOS `\b` after a word. */
const WORD_END = `(?![${WORD_CHARACTER}])`;

/**
 * After a number: a unit, a length of time or a count of places, which make
 * it a measure or a count rather than a clock time ("at 25m", "after 3
 * months", "10.50 m lanes", "at 10 locations").
 */
const NOT_A_CLOCK_AFTER =
  '(?!\\s*(?:%|°|(?:km|m|kg|kr|isk|eur|euros?|min|mins|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?' +
  '|people|persons?|kids|times|reps|sets|stars?|metres?|meters?|miles?|locations?|places?|venues?|gyms?' +
  `|pools?|studios?|branches?|sites?|clubs?)${WORD_END}))`;

/**
 * Clock times, read from the lower-cased words as typed (the folded words
 * have lost the colon). An hour is 0 to 23, and a number followed by a unit,
 * a length of time or a count of places is not one.
 */
const SCHEDULE_TIME_PATTERNS: readonly RegExp[] = [
  // "at 9", "after 5", "before 7:30", "at 6pm"; "at 10.50 m" is a length.
  new RegExp(`${WORD_START}(?:at|after|before)\\s+(?:[01]?\\d|2[0-3])(?:[:.][0-5]\\d)?(?!\\d|[:.]\\d)${NOT_A_CLOCK_AFTER}`, 'u'),
  // "kl. 9", "kl 17:30", "klukkan níu".
  new RegExp(`${WORD_START}kl\\.?\\s*\\d`, 'u'),
  new RegExp(`${WORD_START}klukkan${WORD_END}`, 'u'),
  // "17:30", "5:30".
  new RegExp(`(?:^|[^\\d:.])(?:[01]?\\d|2[0-3]):[0-5]\\d(?![\\d:])${NOT_A_CLOCK_AFTER}`, 'u'),
  // "17.30", as Icelandic writes it: a two-digit hour only, so "2.50" and
  // "1.25 km" are not times, nor is "10.50 m".
  new RegExp(`(?:^|[^\\d.,])(?:0[5-9]|1\\d|2[0-3])\\.[0-5]\\d(?![\\d.,])${NOT_A_CLOCK_AFTER}`, 'u'),
  // "9am", "6 pm", "7.30pm", "9 o'clock".
  new RegExp(`${WORD_START}(?:[1-9]|1[0-2])(?:[:.][0-5]\\d)?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.|o['’]?clock)(?![a-z])`, 'u'),
];
