/**
 * Text limits the Coach's server counts in UTF-16 units (iOS `CoachText`,
 * Models/CoachPlan.swift).
 *
 * The server checks JS string length: 4,000 units per chat turn, 300 for a
 * plan's note, 40 for a typed class type. A JS `slice` could cut an emoji
 * (a surrogate pair) or a flag in half, and a cut by characters could still
 * overshoot; so the text is walked one user-perceived character (grapheme)
 * at a time, as Swift walks `Character`s, and stops before the one that would
 * pass the limit.
 */
import Graphemer from 'graphemer';

const splitter = new Graphemer();

/** At most `limit` UTF-16 units of `text`, never splitting a character. */
export function truncatedToUTF16(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let result = '';
  for (const character of splitter.iterateGraphemes(text)) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
}

/**
 * The first `count` characters of `text` (graphemes, as Swift's
 * `String.prefix`), for a title that must not end in half an emoji.
 */
export function prefixCharacters(text: string, count: number): string {
  let result = '';
  let taken = 0;
  for (const character of splitter.iterateGraphemes(text)) {
    if (taken >= count) break;
    result += character;
    taken += 1;
  }
  return result;
}

/** How many characters (graphemes) `text` has, as Swift's `String.count`. */
export function characterCount(text: string): number {
  return splitter.countGraphemes(text);
}
