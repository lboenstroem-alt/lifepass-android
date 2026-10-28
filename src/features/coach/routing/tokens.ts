/**
 * The words of what a member typed, folded so that a member typing without
 * an Icelandic keyboard ("gonguleid", "hvad a eg ad gera i dag") is read the
 * same as one typing with it: iOS `CoachPlanIntent.tokens(of:)`
 * (Models/CoachPlan.swift).
 *
 * Every typed-text reader in the Coach shares this one fold (the schedule
 * cue, the day-plan intent, the programme intent), so their phrase tables are
 * all written in the same folded spelling: lower case, no diacritics, `ð` as
 * `d`, `þ` as `th`, `æ` as `ae`.
 *
 * iOS folds with `.diacriticInsensitive` (á→a, é→e, í→i, ó→o, ú→u, ý→y,
 * ö→o) and THEN replaces ð, þ and æ, which are letters of their own and have
 * no diacritic to drop. Here the Icelandic letters are folded by an explicit
 * map first, so the result never depends on the engine's Unicode tables, and
 * a canonical decomposition with its combining marks dropped is the backstop
 * for any other accented letter (ü, ñ, ç...).
 */

/** The Icelandic letters, folded as iOS folds them (diacritics dropped; ð, þ, æ spelled out). */
const ICELANDIC_FOLD: Readonly<Record<string, string>> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ý: 'y',
  ö: 'o',
  ð: 'd',
  þ: 'th',
  æ: 'ae',
};

const ICELANDIC_LETTERS = /[áéíóúýöðþæ]/g;

/** Combining marks left by a canonical decomposition (the accents themselves). */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Splits on anything that is not a letter or a number (Swift
 * `Character.isLetter || isNumber`): spaces, punctuation, apostrophes and
 * hyphens all end a word, so "when's" is "when", "s" and "world-class" is
 * "world", "class".
 */
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]+/u;

/** Lower case, Icelandic letters and other diacritics folded (iOS's fold, before the split). */
export function foldText(text: string): string {
  const lowered = text.toLowerCase().replace(ICELANDIC_LETTERS, (letter) => ICELANDIC_FOLD[letter] ?? letter);
  return lowered.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * The folded words of `text`, in order, with nothing empty (iOS `split`
 * drops empty pieces): `tokens("æfingaáætlun")` is `["aefingaaaetlun"]`.
 */
export function tokens(text: string): string[] {
  return foldText(text)
    .split(NOT_A_WORD_CHARACTER)
    .filter((word) => word.length > 0);
}

/**
 * The words as one string with a space at each end, so a whole phrase is
 * found with `includes(" " + phrase + " ")` and never inside another word
 * (iOS builds `" " + words.joined(separator: " ") + " "` in each matcher).
 */
export function phraseOf(words: readonly string[]): string {
  return ` ${words.join(' ')} `;
}

/** True when `phrase` (from `phraseOf`) holds one of `phrases` as whole words. */
export function hasPhrase(phrase: string, phrases: readonly string[]): boolean {
  return phrases.some((candidate) => phrase.includes(` ${candidate} `));
}
