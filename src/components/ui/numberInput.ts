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
 *
 * ROUNDING is iOS HealthFormat.decimal's: NumberFormatter rounds half to
 * EVEN, on the shortest decimal that reads back as the value (ICU), not on
 * the binary float. So 72.25 is "72.2" and 72.35 is "72.4", as on iOS, where
 * `Math.round(value * 10)` would give 72.3 for both (72.35 * 10 is
 * 723.4999...). A stored weight prefilled into a field reads the same on both
 * phones.
 */
export function formatDecimalInput(value: number, language: 'en' | 'is', maxFractionDigits = 1): string {
  if (!Number.isFinite(value)) return String(value);
  const text = roundHalfEven(value, Math.max(0, Math.floor(maxFractionDigits)));
  return language === 'is' ? text.replace('.', ',') : text;
}

/**
 * `value` rounded half to even at `fractionDigits` decimals, written plainly
 * (no exponent, no grouping, trailing zeros and a bare point dropped, never
 * "-0"). Works on the digits of `String(value)`, JavaScript's shortest
 * round-trip decimal, which is the one ICU rounds.
 */
function roundHalfEven(value: number, fractionDigits: number): string {
  const negative = value < 0;
  const [mantissa, exponentText] = String(Math.abs(value)).split('e');
  const [integerPart, fractionPart = ''] = mantissa.split('.');
  // value = 0.<digits> x 10^point
  let digits = integerPart + fractionPart;
  let point = integerPart.length + (exponentText ? Number(exponentText) : 0);
  while (digits.length > 1 && digits[0] === '0') {
    digits = digits.slice(1);
    point -= 1;
  }

  // The digits of round(|value| x 10^fractionDigits).
  const keep = point + fractionDigits;
  let scaled: string;
  if (keep >= digits.length) {
    scaled = digits + '0'.repeat(keep - digits.length);
  } else if (keep < 0) {
    // Below half of the last kept place: it rounds to zero.
    scaled = '0';
  } else {
    const kept = digits.slice(0, keep);
    const dropped = digits.slice(keep);
    const lastKeptOdd = kept.length > 0 && Number(kept[kept.length - 1]) % 2 === 1;
    const beyondHalf = /[1-9]/.test(dropped.slice(1));
    const roundsUp = dropped[0] > '5' || (dropped[0] === '5' && (beyondHalf || lastKeptOdd));
    scaled = roundsUp ? incrementDigits(kept) : kept || '0';
  }

  const padded = scaled.padStart(fractionDigits + 1, '0');
  const whole = padded.slice(0, padded.length - fractionDigits).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(padded.length - fractionDigits).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/** "129" -> "130", "99" -> "100", "" -> "1": one added to a string of digits. */
function incrementDigits(digits: string): string {
  const out = digits.split('');
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (out[index] !== '9') {
      out[index] = String(Number(out[index]) + 1);
      return out.join('');
    }
    out[index] = '0';
  }
  return `1${out.join('')}`;
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
   * with `parseWholeNumber`, so "170.5" counts as unreadable and the step
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
    const current = parseWholeNumber(text) ?? rule.fallback;
    const next = current + direction * rule.step;
    if (next < rule.min || next > rule.max) return null;
    return formatDecimalInput(next, rule.language, 0);
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
