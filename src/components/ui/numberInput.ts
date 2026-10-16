// The rules for numbers a member types into a stepper field, ported from iOS
// HealthFormat (parseDecimal, parseInt, decimal) and the check-in sheet's
// stepWeight. Pure, so the money-free but body-sensitive arithmetic is tested.
//
// WHY NOT Number() OR Intl. A member types "72,5" on an Icelandic keyboard and
// "72.5" on an English one, whatever the phone's region; both mean the same.
// Anything else (letters, two separators, a minus in the middle, grouping, a
// space between digits) is refused rather than guessed, so "7.250" never
// silently becomes 7.25 and "7 2" never becomes 72. Nothing here rewrites
// what the member typed: the field keeps it, and the caller shows its error.

/** iOS HealthFormat.parseDecimal: "72,5", "72.5" and " 72,5 " are 72.5. */
export function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalised = trimmed.replace(/,/g, '.');
  let seenDot = false;
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index];
    if (character === '-') {
      if (index !== 0) return null;
      continue;
    }
    if (character === '.') {
      if (seenDot) return null;
      seenDot = true;
      continue;
    }
    if (character < '0' || character > '9') return null;
  }
  if (normalised === '-' || normalised === '.' || normalised === '-.') return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** iOS HealthFormat.parseInt: a rep count is a whole number, never rounded silently. */
export function parseWholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '-' && index === 0) continue;
    if (character < '0' || character > '9') return null;
  }
  if (trimmed === '-') return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A number for an editable field: at most `maxFractionDigits` decimals,
 * trailing zeros dropped ("72" for 72.0), the Icelandic comma in Icelandic.
 * No digit grouping, because a typed field must read back the same
 * (`parseDecimal` refuses grouping); display elsewhere uses F1's formatters.
 */
export function formatDecimalInput(value: number, language: 'en' | 'is', maxFractionDigits = 1): string {
  const factor = Math.pow(10, maxFractionDigits);
  const rounded = Math.round(value * factor) / factor;
  let text = rounded.toFixed(maxFractionDigits);
  if (maxFractionDigits > 0) text = text.replace(/\.?0+$/, '');
  if (text === '-0') text = '0';
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
  language: 'en' | 'is';
};

/**
 * One step up (`direction` 1) or down (-1) from what the field holds, the
 * port of the weekly check-in's stepWeight: read the field (or the fallback),
 * add the step, round to the step's precision, and refuse a value outside the
 * range by returning null (the field keeps what it had; it is not clamped).
 */
export function stepText(text: string, direction: 1 | -1, rule: StepRule): string | null {
  const digits = rule.maxFractionDigits ?? decimalsOf(rule.step);
  const current = parseDecimal(text) ?? rule.fallback;
  const factor = Math.pow(10, digits);
  const next = Math.round((current + direction * rule.step) * factor) / factor;
  if (next < rule.min || next > rule.max) return null;
  return formatDecimalInput(next, rule.language, digits);
}

/** How many decimals a step has (0.1 → 1, 2.5 → 1, 5 → 0). */
export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}
