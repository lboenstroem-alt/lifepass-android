/**
 * String rules the meal models share with iOS, where Swift and JavaScript
 * disagree about what a "character" or "white space" is.
 *
 * - `characterPrefix`: Swift's `String.prefix(n)` counts CHARACTERS
 *   (extended grapheme clusters), so a label capped at 80 never cuts an
 *   emoji, a flag or an accented letter in half. `String.slice` counts
 *   UTF-16 units and would.
 * - `trimWhitespace`: Swift's `.whitespacesAndNewlines`, which trims NEL
 *   (U+0085) and keeps the byte-order mark (U+FEFF); `String.trim` does the
 *   opposite on both.
 */
import Graphemer from 'graphemer';

let splitter: Graphemer | null = null;

function graphemes(text: string): string[] {
  splitter ??= new Graphemer();
  return splitter.splitGraphemes(text);
}

/** The first `count` characters of `text`, as Swift's `prefix(count)` reads them. */
export function characterPrefix(text: string, count: number): string {
  // Cheap path: a string no longer than `count` UTF-16 units has at most
  // `count` characters, so it is already whole.
  if (text.length <= count) return text;
  return graphemes(text).slice(0, Math.max(0, count)).join('');
}

/** Unicode white space (category Z), the C0 controls U+0009 to U+000D, and NEL. */
const SWIFT_WHITESPACE = '[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const LEADING = new RegExp(`^${SWIFT_WHITESPACE}+`);
const TRAILING = new RegExp(`${SWIFT_WHITESPACE}+$`);

/** `text.trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWhitespace(text: string): string {
  return text.replace(LEADING, '').replace(TRAILING, '');
}
