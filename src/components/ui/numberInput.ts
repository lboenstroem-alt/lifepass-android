// The rules for numbers a member types into a stepper field: the check-in and
// body sheets' stepWeight / stepHeight / stepCustomKcal, over F1's port of iOS
// HealthFormat (src/i18n/format.ts: parseDecimal, parseInteger, decimal).
// Parsing and rounding live THERE, once; this file only steps and writes a
// value back into a field. Pure, so the money-free but body-sensitive
// arithmetic is tested.
//
// WHY NOT Number() OR Intl. A member types "72,5" on an Icelandic keyboard and
// "72.5" on an English one, whatever the phone's region; both mean the same.
// Anything else (letters, two separators, a minus in the middle, grouping, a
// space between digits) is refused rather than guessed, so "7.250" never
// silently becomes 7.25 and "7 2" never becomes 72. Nothing here rewrites
// what the member typed: the field keeps it, and the caller shows its error.
import { decimal, parseDecimal, parseInteger, wholeNumberOf } from '../../i18n/format';

// iOS HealthFormat.parseDecimal ("72,5", "72.5" and " 72,5 " are 72.5) and
// HealthFormat.parseInt, as F1 ports them.
export { parseDecimal, parseInteger };

/**
 * iOS HealthFormat.parseInt: a rep count is a whole number, never rounded
 * silently.
 * @deprecated The same function as `parseInteger` (src/i18n/format).
 */
export const parseWholeNumber = parseInteger;

/**
 * A number for an editable field: at most `maxFractionDigits` decimals,
 * trailing zeros dropped ("72" for 72.0), the Icelandic comma in Icelandic.
 *
 * ROUNDING is iOS HealthFormat.decimal's (F1's `decimal`): NumberFormatter
 * rounds half to EVEN, on the shortest decimal that reads back as the value
 * (ICU), not on the binary float. So 72.25 is "72.2" and 72.35 is "72.4", as
 * on iOS, where `Math.round(value * 10)` would give 72.3 for both. A stored
 * weight prefilled into a field reads the same on both phones.
 *
 * NO GROUPING, unlike `decimal`: a typed field must read back the same, and
 * `parseDecimal` refuses grouping. iOS groups here too, but only for values
 * of 1,000 and more, which no stepped decimal field reaches (iOS weight stops at
 * 300 kg); a whole-number field is written with `String(n)`, as iOS does. Never
 * "-0" either.
 */
export function formatDecimalInput(value: number, language: 'en' | 'is', maxFractionDigits = 1): string {
  if (!Number.isFinite(value)) return String(value);
  // English separators: "," only ever groups, "." is the decimal point.
  const plain = decimal(value, 'en', maxFractionDigits).replace(/,/g, '');
  const text = /[1-9]/.test(plain) ? plain : plain.replace(/^-/, '');
  return language === 'is' ? text.replace('.', ',') : text;
}

export type StepRule = {
  /** The step, e.g. 0.1 for weight. */
  step: number;
  min: number;
  max: number;
  /** The value to step from while the field is empty or unreadable. */
  fallback: number;
  maxFractionDigits?: number;
  /**
   * A whole-number field (height, a calorie goal, reps): the field is read
   * with `parseInteger`, so "170.5" counts as unreadable and the step
   * starts from the fallback, as iOS stepHeight / stepCustomKcal do
   * (`HealthFormat.parseInt(text) ?? prefilled`). Reading it as a decimal
   * would silently turn the 170.5 the member typed into 172.
   */
  integer?: boolean;
  language: 'en' | 'is';
};

/**
 * One step up (`direction` 1) or down (-1) from what the field holds, the
 * port of the check-in and body sheets' stepWeight / stepHeight: read the
 * field (or the fallback), add the step, round to the step's precision
 * (Swift `.rounded()`, half away from zero), and refuse a value outside the
 * range by returning null (the field keeps what it had; it is not clamped).
 */
export function stepText(text: string, direction: 1 | -1, rule: StepRule): string | null {
  if (rule.integer) {
    // An Int on iOS: a fractional fallback or step can never print "170.5".
    const next = wholeNumberOf((parseInteger(text) ?? rule.fallback) + direction * rule.step);
    if (next < rule.min || next > rule.max) return null;
    // iOS: `heightText = "\(next)"`, no separator of any kind.
    return String(next);
  }
  const digits = rule.maxFractionDigits ?? decimalsOf(rule.step);
  const current = parseDecimal(text) ?? rule.fallback;
  const factor = Math.pow(10, digits);
  const raw = (current + direction * rule.step) * factor;
  const next = (Math.sign(raw) * Math.round(Math.abs(raw))) / factor;
  if (next < rule.min || next > rule.max) return null;
  return formatDecimalInput(next, rule.language, digits);
}

/** How many decimals a step has (0.1 → 1, 2.5 → 1, 5 → 0). */
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}
