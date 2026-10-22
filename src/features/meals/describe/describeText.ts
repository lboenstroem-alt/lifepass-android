/**
 * The words of "Describe what you ate", counted and cleaned exactly as the
 * server does: the port of iOS `MealDescribeText` (Models/MealModels.swift),
 * which copies the web's `cleanDescribeText` step for step.
 *
 * WHY THE PHONE CLEANS AT ALL. The server cleans the words and then measures
 * them (`MEAL_DESCRIBE_TEXT_MIN_CHARS` 2 to `MEAL_DESCRIBE_TEXT_MAX_CHARS`
 * 280, in JavaScript `length`, so UTF-16 units). If the phone counted
 * anything else, a member could type a description the field accepts and the
 * server refuses (140 flags are 140 characters but 560 units), or be stopped
 * by spaces the server would have folded away. So the field caps on the
 * cleaned count, cut between whole characters, and what is sent is already
 * clean (the server's cleaning then changes nothing).
 *
 * THE WORDS STAY IN MEMORY. Nothing here writes, logs or tracks the text.
 */
import Graphemer from 'graphemer';

/** UTF-16 units of the cleaned words (`MEAL_DESCRIBE_TEXT_MAX_CHARS`). */
export const DESCRIBE_MAX_LENGTH = 280;
/** `MEAL_DESCRIBE_TEXT_MIN_CHARS`. */
export const DESCRIBE_MIN_LENGTH = 2;
/** The counter shows once the words come within this many units of the cap. */
export const DESCRIBE_COUNTER_MARGIN = 40;

let splitter: Graphemer | null = null;

/** Whole characters (extended grapheme clusters), as Swift's `Array(String)` reads them. */
function characters(text: string): string[] {
  splitter ??= new Graphemer();
  return splitter.splitGraphemes(text);
}

/**
 * What the server's cleaning turns into a space or trims: the control
 * characters it replaces (`[\u0000-\u001f\u007f-\u009f]`), the angle
 * brackets, and JavaScript's `\s` (which includes U+00A0 and U+FEFF).
 */
function isSpaceOnTheServer(codePoint: number): boolean {
  if (codePoint <= 0x20) return true;
  if (codePoint >= 0x7f && codePoint <= 0xa0) return true;
  if (codePoint === 0x3c || codePoint === 0x3e) return true;
  if (codePoint === 0x1680 || (codePoint >= 0x2000 && codePoint <= 0x200a)) return true;
  return codePoint === 0x2028 || codePoint === 0x2029 || codePoint === 0x202f || codePoint === 0x205f || codePoint === 0x3000 || codePoint === 0xfeff;
}

/** NFC. Hermes on Android backs `normalize` with java.text.Normalizer; a runtime without it sends the words as typed. */
function nfc(text: string): string {
  return typeof text.normalize === 'function' ? text.normalize('NFC') : text;
}

/**
 * The length as the server measures it: JavaScript `length`, UTF-16 units
 * ("🍕" is 2, "🇮🇸" is 4, "þ" is 1).
 */
export function describeLength(text: string): number {
  return text.length;
}

/**
 * `cleanDescribeText`, step for step: NFC; every C0 and C1 control character
 * and every `<` and `>` a space (so the words can never open or close the
 * tag they are sent in); trimmed; each run of white space one space. What is
 * sent, and what is counted.
 */
export function cleanDescribeText(raw: string): string {
  let out = '';
  let spacePending = false;
  // `for...of` walks code points, as Swift's `unicodeScalars` does, so a
  // zero-width joiner inside an emoji (U+200D, not a space) stays put.
  for (const scalar of nfc(raw)) {
    if (isSpaceOnTheServer(scalar.codePointAt(0) ?? 0)) {
      spacePending = true;
      continue;
    }
    if (spacePending && out.length > 0) out += ' ';
    spacePending = false;
    out += scalar;
  }
  return out;
}

/** Whether the cleaned words are a length the server takes (2 to 280 units). */
export function isDescribeSendable(raw: string): boolean {
  const length = describeLength(cleanDescribeText(raw));
  return length >= DESCRIBE_MIN_LENGTH && length <= DESCRIBE_MAX_LENGTH;
}

/**
 * The field's cap: the longest run of whole characters whose cleaned length
 * fits, so an emoji or a flag is never cut in half and spaces the server
 * folds away cost nothing. Words that already fit are returned untouched.
 */
export function capDescribeText(raw: string): string {
  if (describeLength(cleanDescribeText(raw)) <= DESCRIBE_MAX_LENGTH) return raw;
  const whole = characters(raw);
  // The first `low` characters fit; the first `high` do not.
  let low = 0;
  let high = whole.length;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (describeLength(cleanDescribeText(whole.slice(0, mid).join(''))) <= DESCRIBE_MAX_LENGTH) low = mid;
    else high = mid;
  }
  return whole.slice(0, low).join('');
}

/** The "n/280" counter's number, or null while the words are not near the cap. */
export function describeCounter(raw: string): number | null {
  const used = describeLength(cleanDescribeText(raw));
  return used >= DESCRIBE_MAX_LENGTH - DESCRIBE_COUNTER_MARGIN ? used : null;
}

/** iOS `MealDescribeText` under its Swift name, so the port reads like the Swift. */
export const MealDescribeText = {
  maxLength: DESCRIBE_MAX_LENGTH,
  minLength: DESCRIBE_MIN_LENGTH,
  length: describeLength,
  cleaned: cleanDescribeText,
  isSendable: isDescribeSendable,
  capped: capDescribeText,
} as const;
