/**
 * Number entry rules, ported from iOS:
 *   MealItemMathTests (HealthFormat.parseDecimal / parseInt vectors)
 *   TargetWeightValidationTests ("72,5" equals "72.5")
 *   WeeklyCheckInSheet.stepWeight (step, round, refuse outside the range)
 *   BodySheet.stepHeight / stepCustomKcal (whole-number fields, parseInt)
 *   HealthFormat.decimal (NumberFormatter: half to even, on the decimal)
 */
import * as format from '../../../i18n/format';
import {
  decimalsOf,
  formatDecimalInput,
  parseDecimal,
  parseInteger,
  parseWholeNumber,
  stepText,
} from '../numberInput';

it("parses with F1's port of HealthFormat, not a copy of its own", () => {
  expect(parseDecimal).toBe(format.parseDecimal);
  expect(parseInteger).toBe(format.parseInteger);
  expect(parseWholeNumber).toBe(format.parseInteger);
});

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
    // Never grouped, so the field reads back as typed (format.decimal groups).
    expect(formatDecimalInput(1234.5, 'is')).toBe('1234,5');
    expect(formatDecimalInput(1234.5, 'en')).toBe('1234.5');
    expect(parseDecimal(formatDecimalInput(1234.5, 'is'))).toBe(1234.5);
    expect(formatDecimalInput(2.25, 'en', 2)).toBe('2.25');
    expect(formatDecimalInput(-0.01, 'en')).toBe('0');
  });

  // NumberFormatter's default rounding is half to even, applied to the
  // shortest decimal of the value (ICU), so a stored 72.35 kg prefills as
  // 72.4 on iOS although 72.35 * 10 is 723.4999... as a float.
  it('rounds half to even on the decimal, as NumberFormatter does', () => {
    expect(formatDecimalInput(72.25, 'en')).toBe('72.2');
    expect(formatDecimalInput(72.35, 'en')).toBe('72.4');
    expect(formatDecimalInput(72.25, 'is')).toBe('72,2');
    expect(formatDecimalInput(72.35, 'is')).toBe('72,4');
    expect(formatDecimalInput(72.26, 'en')).toBe('72.3');
    expect(formatDecimalInput(72.251, 'en')).toBe('72.3');
    expect(formatDecimalInput(0.5, 'en', 0)).toBe('0');
    expect(formatDecimalInput(1.5, 'en', 0)).toBe('2');
    expect(formatDecimalInput(2.5, 'en', 0)).toBe('2');
    expect(formatDecimalInput(-72.35, 'en')).toBe('-72.4');
    expect(formatDecimalInput(1.005, 'en', 2)).toBe('1');
    expect(formatDecimalInput(9.96, 'en')).toBe('10');
    expect(formatDecimalInput(99.95, 'en')).toBe('100');
  });

  it('writes very small and very large numbers plainly', () => {
    expect(formatDecimalInput(0.05, 'en')).toBe('0');
    expect(formatDecimalInput(0.15, 'en')).toBe('0.2');
    expect(formatDecimalInput(1e-7, 'en', 3)).toBe('0');
    expect(formatDecimalInput(1.5e21, 'en', 0)).toBe('1500000000000000000000');
    expect(formatDecimalInput(0, 'is')).toBe('0');
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

  // iOS BodySheet.stepHeight: HealthFormat.parseInt(heightText) ?? prefilled.
  it('a whole-number field reads the field as a whole number, else steps from the fallback', () => {
    const height = { step: 1, min: 100, max: 250, fallback: 170, integer: true, language: 'en' as const };
    expect(stepText('170.5', 1, height)).toBe('171');
    expect(stepText('180', 1, height)).toBe('181');
    expect(stepText('', -1, height)).toBe('169');
    expect(stepText('250', 1, height)).toBeNull();
    // stepCustomKcal: 50 kcal inside 1,000 to 5,000, printed without grouping.
    const kcal = { step: 50, min: 1000, max: 5000, fallback: 2000, integer: true, language: 'is' as const };
    expect(stepText('2,5', 1, kcal)).toBe('2050');
    expect(stepText('1950', 1, kcal)).toBe('2000');
    expect(stepText('1000', -1, kcal)).toBeNull();
  });

  it('whole steps print whole numbers', () => {
    expect(stepText('40', 1, { step: 5, min: 5, max: 180, fallback: 40, language: 'en' })).toBe('45');
    expect(decimalsOf(5)).toBe(0);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(2.5)).toBe(1);
  });
});
