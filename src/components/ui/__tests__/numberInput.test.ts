/**
 * Number entry rules, ported from iOS:
 *   MealItemMathTests (HealthFormat.parseDecimal / parseInt vectors)
 *   TargetWeightValidationTests ("72,5" equals "72.5")
 *   WeeklyCheckInSheet.stepWeight (step, round, refuse outside the range)
 */
import {
  decimalsOf,
  formatDecimalInput,
  parseDecimal,
  parseWholeNumber,
  stepText,
} from '../numberInput';

describe('parseDecimal (HealthFormat.parseDecimal)', () => {
  it('reads both separators, whatever the phone', () => {
    expect(parseDecimal('72.5')).toBe(72.5);
    expect(parseDecimal('72,5')).toBe(72.5);
    expect(parseDecimal(' 72,5 ')).toBe(72.5);
    expect(parseDecimal('72')).toBe(72);
    expect(parseDecimal('72,5')).toBe(parseDecimal('72.5'));
    expect(parseDecimal('-1,5')).toBe(-1.5);
    expect(parseDecimal('.5')).toBe(0.5);
  });

  it('refuses everything else rather than guess', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('kg')).toBeNull();
    expect(parseDecimal('72,5,5')).toBeNull();
    expect(parseDecimal('7 2')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('-')).toBeNull();
    expect(parseDecimal('-.')).toBeNull();
    expect(parseDecimal('7-2')).toBeNull();
    // Grouping is refused, so "7.250" can never silently become 7.25 AND 7250.
    expect(parseDecimal('1.900,5')).toBeNull();
    // Only ASCII digits: an Arabic-Indic five is not a number here.
    expect(parseDecimal('٥')).toBeNull();
  });
});

describe('parseWholeNumber (HealthFormat.parseInt)', () => {
  it('a rep count is a whole number, never rounded silently', () => {
    expect(parseWholeNumber('3.5')).toBeNull();
    expect(parseWholeNumber('12')).toBe(12);
    expect(parseWholeNumber(' 8 ')).toBe(8);
    expect(parseWholeNumber('-2')).toBe(-2);
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('-')).toBeNull();
    expect(parseWholeNumber('1,0')).toBeNull();
  });
});

describe('formatDecimalInput (HealthFormat.decimal, without grouping)', () => {
  it('drops a trailing zero and uses the Icelandic comma', () => {
    expect(formatDecimalInput(72.5, 'en')).toBe('72.5');
    expect(formatDecimalInput(72.5, 'is')).toBe('72,5');
    expect(formatDecimalInput(72, 'is')).toBe('72');
    expect(formatDecimalInput(72.04, 'en')).toBe('72');
    expect(formatDecimalInput(1900, 'is')).toBe('1900');
    expect(formatDecimalInput(2.25, 'en', 2)).toBe('2.25');
    expect(formatDecimalInput(-0.01, 'en')).toBe('0');
  });
});

describe('stepText (WeeklyCheckInSheet.stepWeight)', () => {
  const weight = { step: 0.1, min: 20, max: 400, fallback: 70 };

  it('steps from what the field holds, rounding to the step', () => {
    expect(stepText('72,5', 1, { ...weight, language: 'is' })).toBe('72,6');
    expect(stepText('72.5', -1, { ...weight, language: 'en' })).toBe('72.4');
    // Float noise never leaks into the field.
    expect(stepText('0.2', 1, { ...weight, min: 0, language: 'en' })).toBe('0.3');
  });

  it('starts from the fallback while the field is empty or unreadable', () => {
    expect(stepText('', 1, { ...weight, language: 'en' })).toBe('70.1');
    expect(stepText('abc', -1, { ...weight, language: 'is' })).toBe('69,9');
  });

  it('refuses a step out of range (the field keeps its value; it is not clamped)', () => {
    expect(stepText('400', 1, { ...weight, language: 'en' })).toBeNull();
    expect(stepText('20', -1, { ...weight, language: 'en' })).toBeNull();
  });

  it('whole steps print whole numbers', () => {
    expect(stepText('40', 1, { step: 5, min: 5, max: 180, fallback: 40, language: 'en' })).toBe('45');
    expect(decimalsOf(5)).toBe(0);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(2.5)).toBe(1);
  });
});
