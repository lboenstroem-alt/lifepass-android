// Numbers, dates and durations in the account language. Ports iOS
// HealthFormatTests and the day-energy half of MealItemMathTests
// (MealItemMathTests.swift), VenueTimeTests, ClassDistanceTests' distance
// words and LocalizationDashTests.testKcalRangeUsesAWord.
//
// TIME ZONES. Jest runs in UTC, and scripts/ci.sh runs every suite again
// under America/New_York and Asia/Tokyo. Node fixes the zone per process, so
// to prove the Iceland-clock functions never read the phone's zone in a
// single run, `asIfThePhoneWereIn` also makes Date's local getters answer as
// a phone in another zone would.
import {
  addServerDays,
  calendarWords,
  classLongDay,
  classShortDay,
  dateFromServerDay,
  dayEnergy,
  decimal,
  duration,
  formatDatePattern,
  formatDateTemplate,
  formatDistance,
  grams,
  HealthFormat,
  integer,
  isoWeekday,
  iskPrefix,
  kcal,
  kcalRange,
  localTime,
  longDay,
  parseDecimal,
  parseInteger,
  printfFixed,
  round10,
  roundHalfAwayFromZero,
  serverDay,
  shortDay,
  todayServerDay,
  VenueTimeFormat,
  venueDay,
  weekdayAbbreviation,
  weight,
  type DayTarget,
  type DayTotals,
} from '../format';
import { generatedTables } from '../tables';

const utc = (iso: string) => new Date(iso);

/**
 * Run `body` with Date's local getters answering as a phone `offsetHours`
 * from UTC would (no daylight saving), whatever zone the process is in.
 */
function asIfThePhoneWereIn<T>(offsetHours: number, body: () => T): T {
  const proto = Date.prototype;
  const names = ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getTimezoneOffset'] as const;
  const saved = names.map((name) => [name, proto[name]] as const);
  const shifted = (date: Date) => new Date(date.getTime() + offsetHours * 3_600_000);
  proto.getFullYear = function (this: Date) { return shifted(this).getUTCFullYear(); };
  proto.getMonth = function (this: Date) { return shifted(this).getUTCMonth(); };
  proto.getDate = function (this: Date) { return shifted(this).getUTCDate(); };
  proto.getDay = function (this: Date) { return shifted(this).getUTCDay(); };
  proto.getHours = function (this: Date) { return shifted(this).getUTCHours(); };
  proto.getMinutes = function (this: Date) { return shifted(this).getUTCMinutes(); };
  proto.getSeconds = function (this: Date) { return shifted(this).getUTCSeconds(); };
  proto.getTimezoneOffset = function () { return -offsetHours * 60; };
  try {
    return body();
  } finally {
    for (const [name, original] of saved) (proto as unknown as Record<string, unknown>)[name] = original;
  }
}

const NEW_YORK = -4; // EDT, October 2026
const TOKYO = 9;

// MARK: - HealthFormatTests

describe('parsing member input (HealthFormatTests)', () => {
  it('accepts both decimal separators (testBothDecimalSeparatorsAreAccepted)', () => {
    expect(parseDecimal('72.5')).toBe(72.5);
    expect(parseDecimal('72,5')).toBe(72.5);
    expect(parseDecimal(' 72,5 ')).toBe(72.5);
    expect(parseDecimal('72')).toBe(72);
    expect(parseDecimal('-0,5')).toBe(-0.5);
    expect(parseDecimal('.5')).toBe(0.5);
  });

  it('rejects nonsense rather than guess (testNonsenseIsRejectedRatherThanGuessed)', () => {
    for (const raw of ['', '   ', 'kg', '72,5,5', '7.2.5', '7 2', '.', '-', '-.', '1e3', '5-', 'abc', '٣']) {
      expect([raw, parseDecimal(raw)]).toEqual([raw, null]);
    }
    expect(parseInteger('3.5')).toBeNull();
    expect(parseInteger('3,5')).toBeNull();
  });

  it('reads a whole number, signed, and nothing else', () => {
    expect(parseInteger(' 12 ')).toBe(12);
    expect(parseInteger('-3')).toBe(-3);
    expect(parseInteger('007')).toBe(7);
    for (const raw of ['', '-', '+3', '3-', '1 000', '12a', '99999999999999999999']) {
      expect([raw, parseInteger(raw)]).toEqual([raw, null]);
    }
    expect(HealthFormat.parseInt).toBe(parseInteger);
  });
});

describe('numbers in the account language (HealthFormatTests)', () => {
  it('groups by the account language (testGroupingFollowsTheAccountLanguage)', () => {
    expect(kcal(1900, 'en')).toBe('1,900 kcal');
    expect(kcal(1900, 'is')).toBe('1.900 kcal');
    expect(weight(72.5, 'is')).toBe('72,5 kg');
    expect(weight(72.0, 'en')).toBe('72 kg');
    expect(integer(1900, 'is')).toBe('1.900');
    expect(integer(1900, 'en')).toBe('1,900');
    expect(integer(999, 'is')).toBe('999');
    expect(integer(1234567, 'is')).toBe('1.234.567');
    expect(integer(-1234, 'en')).toBe('-1,234');
  });

  it('shows one decimal with the trailing zero dropped, rounding half to even as NumberFormatter does', () => {
    expect(decimal(72.25, 'en')).toBe('72.2');
    expect(decimal(72.35, 'en')).toBe('72.4');
    expect(decimal(0.15, 'is')).toBe('0,2');
    expect(decimal(72.96, 'en')).toBe('73');
    expect(decimal(9.96, 'is')).toBe('10');
    expect(decimal(1.005, 'en', 2)).toBe('1');
    expect(decimal(1234.5678, 'is', 3)).toBe('1.234,568');
    expect(decimal(0.004, 'en')).toBe('0');
    expect(decimal(-0.04, 'en')).toBe('-0');
    expect(decimal(1e21, 'en')).toBe('1,000,000,000,000,000,000,000');
    expect(decimal(1.5e-7, 'en', 3)).toBe('0');
    expect(decimal(Number.NaN, 'en')).toBe('NaN');
  });

  it('agrees with ICU (half to even, shortest form) for any number', () => {
    // Node's Intl is ICU, as NumberFormatter is on the iPhone.
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const values = [0, 0.05, 0.25, 0.35, 0.45, 1.45, 2.675, 1.005, 999.95, 9999.5, 123456.785, 72.25];
    for (let n = 0; n < 2000; n += 1) {
      const magnitude = 10 ** Math.floor(random() * 8 - 2);
      values.push(Math.round(random() * magnitude * 1000) / 1000, random() * magnitude * (random() < 0.2 ? -1 : 1));
    }
    for (const [lang, locale] of [['en', 'en-GB'], ['is', 'is-IS']] as const) {
      for (const digits of [0, 1, 2, 3]) {
        const icu = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, roundingMode: 'halfEven' } as Intl.NumberFormatOptions);
        for (const value of values) {
          const ours = decimal(value, lang, digits);
          const theirs = icu.format(value);
          if (ours !== theirs) throw new Error(`${value} to ${digits} in ${lang}: ${ours} but ICU says ${theirs}`);
        }
      }
    }
  });

  it('writes a kcal range with a word, never a dash (testKcalRangeUsesAWord)', () => {
    expect(kcalRange(1800, 2000, 'en')).toBe('1,800 to 2,000 kcal');
    expect(kcalRange(1800, 2000, 'is')).toBe('1.800 til 2.000 kcal');
    expect(kcalRange(1800, 2000, 'is')).not.toContain('–');
    expect(kcalRange(1900, 1900, 'en')).toBe('1,900 kcal');
  });

  it('shows grams to one decimal under 10 and whole above, ml for a liquid', () => {
    expect(grams(120, 'en')).toBe('120 g');
    expect(grams(7.5, 'is')).toBe('7,5 g');
    expect(grams(12.6, 'en')).toBe('13 g');
    expect(grams(250, 'is', true)).toBe('250 ml');
  });

  it('rounds kcal to the nearest ten, a half away from zero (testRoundingToTens)', () => {
    expect(round10(1432)).toBe(1430);
    expect(round10(1435)).toBe(1440);
    expect(round10(0)).toBe(0);
    expect(round10(-15)).toBe(-20);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('prices the web way in both languages', () => {
    expect(iskPrefix(14900)).toBe('ISK 14,900');
    expect(iskPrefix(1990)).toBe('ISK 1,990');
    expect(iskPrefix(500)).toBe('ISK 500');
    expect(iskPrefix(1234567)).toBe('ISK 1,234,567');
  });
});

describe('durations (testDurationsReadNaturallyInBothLanguages)', () => {
  it('reads minutes and hours in each language', () => {
    expect(duration(40, 'en')).toBe('40 min');
    expect(duration(40, 'is')).toBe('40 mín');
    expect(duration(80, 'en')).toBe('1 h 20 min');
    expect(duration(80, 'is')).toBe('1 klst 20 mín');
    expect(duration(120, 'is')).toBe('2 klst');
    expect(duration(60, 'en')).toBe('1 h');
    expect(duration(0, 'en')).toBe('0 min');
  });
});

// MARK: - Distances (ClassDistanceTests)

describe('distance words (ClassDistanceTests)', () => {
  it('reads as on the web (testTheDistanceReadsAsOnTheWeb)', () => {
    expect(formatDistance(0.35, 'en')).toBe('350 m');
    expect(formatDistance(2.44, 'en')).toBe('2.4 km');
    expect(formatDistance(9.96, 'en')).toBe('10.0 km');
    expect(formatDistance(12.4, 'en')).toBe('12 km');
  });

  it('writes a decimal comma in Icelandic (testIcelandicDistancesUseADecimalComma)', () => {
    expect(formatDistance(2.44, 'is')).toBe('2,4 km');
    expect(formatDistance(0.35, 'is')).toBe('350 m');
    expect(formatDistance(12.4, 'is')).toBe('12 km');
  });

  it('rounds an exact tie half to even, as String(format:) does', () => {
    expect(printfFixed(2.25, 1)).toBe('2.2');
    expect(printfFixed(2.75, 1)).toBe('2.8');
    expect(printfFixed(1.25, 1)).toBe('1.2');
    // 2.45 is not a tie in binary (2.4500000000000001776...): it rounds up.
    expect(printfFixed(2.45, 1)).toBe('2.5');
    expect(printfFixed(0.125, 2)).toBe('0.12');
    expect(printfFixed(-2.25, 1)).toBe('-2.2');
    expect(formatDistance(2.25, 'is')).toBe('2,2 km');
  });
});

// MARK: - Server days

describe('server calendar days (HealthFormatTests)', () => {
  it('round-trip without time shifting (testServerDaysRoundTripWithoutTimeShifting)', () => {
    const day = '2026-09-13';
    const date = dateFromServerDay(day);
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe('2026-09-13T12:00:00.000Z');
    expect(serverDay(date!)).toBe(day);
    for (const offset of [NEW_YORK, TOKYO, -11, 14]) {
      asIfThePhoneWereIn(offset, () => expect(serverDay(dateFromServerDay(day)!)).toBe(day));
    }
  });

  it('shows a malformed day as itself (testMalformedServerDayIsShownAsItself)', () => {
    expect(shortDay('not-a-day', 'en')).toBe('not-a-day');
    expect(longDay('2026-09', 'is')).toBe('2026-09');
    expect(dateFromServerDay('2026-ab-01')).toBeNull();
    expect(dateFromServerDay('')).toBeNull();
  });

  it('reads a year below 100 as itself, not as the 1900s', () => {
    expect(serverDay(dateFromServerDay('0099-01-02')!)).toBe('0099-01-02');
  });

  it('names a server day the same in every phone zone', () => {
    // 2026-10-19 is a Monday.
    for (const offset of [0, NEW_YORK, TOKYO, -11, 14]) {
      asIfThePhoneWereIn(offset, () => {
        expect(shortDay('2026-10-19', 'en')).toBe('Mon 19 Oct');
        expect(shortDay('2026-10-19', 'is')).toBe('mán., 19. okt.');
        expect(longDay('2026-10-19', 'en')).toBe('19 October');
        expect(longDay('2026-10-19', 'is')).toBe('19. október');
        expect(isoWeekday('2026-10-19')).toBe(1);
      });
    }
  });

  it('says September as the system formatters do', () => {
    expect(shortDay('2026-09-17', 'en')).toBe('Thu 17 Sept');
    expect(shortDay('2026-09-17', 'is')).toBe('fim., 17. sep.');
    expect(longDay('2026-09-17', 'is')).toBe('17. september');
  });

  it('knows today as the server sees it', () => {
    expect(todayServerDay(utc('2026-10-16T23:30:00Z'))).toBe('2026-10-16');
    asIfThePhoneWereIn(TOKYO, () => expect(todayServerDay(utc('2026-10-16T23:30:00Z'))).toBe('2026-10-16'));
  });

  it('steps across months and years, and gives ISO weekdays', () => {
    expect(addServerDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addServerDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addServerDays('nope', 1)).toBeNull();
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(isoWeekday('nope')).toBeNull();
  });

  it('abbreviates ISO weekdays for the week strip, Monday first', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => weekdayAbbreviation(d, 'en'))).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => weekdayAbbreviation(d, 'is'))).toEqual([
      'mán.', 'þri.', 'mið.', 'fim.', 'fös.', 'lau.', 'sun.',
    ]);
    expect(weekdayAbbreviation(0, 'en')).toBe('');
    expect(weekdayAbbreviation(8, 'is')).toBe('');
  });

  it('reads a wall-clock time off the phone’s own clock', () => {
    const start = utc('2026-10-02T14:05:00Z');
    expect(asIfThePhoneWereIn(NEW_YORK, () => localTime(start))).toBe('10:05');
    expect(asIfThePhoneWereIn(TOKYO, () => localTime(start))).toBe('23:05');
    expect(HealthFormat.time(start)).toBe(
      `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    );
  });
});

// MARK: - VenueTimeTests

describe('the venue clock (VenueTimeTests)', () => {
  it('reads a slot as the venue clock, 24-hour (testASlotReadsAsTheVenueClockIn24Hours)', () => {
    const slot = utc('2026-10-02T14:00:00Z'); // 14:00 in Reykjavík, 10:00 in New York
    expect(VenueTimeFormat.time(slot)).toBe('14:00');
    expect(asIfThePhoneWereIn(NEW_YORK, () => VenueTimeFormat.time(slot))).toBe('14:00');
  });

  it('keeps an early slot on its venue date (testAnEarlySlotKeepsItsVenueDate)', () => {
    // 01:30 in Reykjavík on the 3rd is still the 2nd in New York.
    const slot = utc('2026-10-03T01:30:00Z');
    asIfThePhoneWereIn(NEW_YORK, () => {
      expect(VenueTimeFormat.date(slot, 'en')).toBe('3 October 2026');
      expect(VenueTimeFormat.date(slot, 'is')).toBe('3. október 2026');
      expect(VenueTimeFormat.dayTime(slot, 'en').endsWith('01:30')).toBe(true);
    });
  });

  it('asks for the venue day (testTheRequestedDayIsTheVenueDay)', () => {
    const slot = utc('2026-10-03T01:30:00Z');
    expect(asIfThePhoneWereIn(NEW_YORK, () => venueDay(slot))).toBe('2026-10-03');
    expect(VenueTimeFormat.day).toBe(venueDay);
  });

  it('writes day and time as the class sheet shows them (RELEASE-2.5.2)', () => {
    const start = utc('2026-10-07T10:00:00Z');
    expect(VenueTimeFormat.dayTime(start, 'en')).toBe('Wed 7 Oct, 10:00');
    expect(VenueTimeFormat.dayTime(start, 'is')).toBe('mið., 7. okt., 10:00');
    expect(VenueTimeFormat.weekdayTime(start, 'en')).toBe('Wed 10:00');
    expect(VenueTimeFormat.weekdayTime(start, 'is')).toBe('mið. 10:00');
    expect(VenueTimeFormat.dayTime(utc('2026-09-25T14:00:00Z'), 'en')).toBe('Fri 25 Sept, 14:00');
  });
});

describe('the class feed’s day words (ClassesViewModel)', () => {
  it('writes the short day without a comma and the long day in the Icelandic accusative', () => {
    const monday = utc('2026-10-05T06:00:00Z');
    expect(classShortDay(monday, 'en')).toBe('Mon 5 Oct');
    expect(classShortDay(monday, 'is')).toBe('mán. 5. okt.');
    expect(classLongDay(monday, 'en')).toBe('Monday 5 October');
    expect(classLongDay(monday, 'is')).toBe('mánudaginn 5. október');
    expect(classLongDay(utc('2026-10-03T23:30:00Z'), 'is')).toBe('laugardaginn 3. október');
    expect(asIfThePhoneWereIn(TOKYO, () => classLongDay(utc('2026-10-03T23:30:00Z'), 'en'))).toBe('Saturday 3 October');
  });
});

describe('the date tables', () => {
  it('match ICU’s names and patterns for every day of a year, in both languages', () => {
    const cases: [string, Intl.DateTimeFormatOptions][] = [
      ['EEEdMMM', { weekday: 'short', day: 'numeric', month: 'short' }],
      ['dMMMMy', { day: 'numeric', month: 'long', year: 'numeric' }],
      ['dMMMy', { day: 'numeric', month: 'short', year: 'numeric' }],
      ['dMMMM', { day: 'numeric', month: 'long' }],
      ['dMMM', { day: 'numeric', month: 'short' }],
      ['EEE', { weekday: 'short' }],
      ['EEEE', { weekday: 'long' }],
    ];
    for (const [lang, locale] of [['en', 'en-GB'], ['is', 'is-IS']] as const) {
      for (const [template, options] of cases) {
        const icu = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
        for (let day = 0; day < 366; day += 1) {
          const date = new Date(Date.UTC(2026, 0, 1 + day, 12));
          const ours = formatDateTemplate(date, template, lang);
          const theirs = icu.format(date);
          if (ours !== theirs) throw new Error(`${template} ${lang} ${date.toISOString()}: ${ours} but ICU says ${theirs}`);
        }
      }
    }
    expect(calendarWords('is').monthsLong[9]).toBe('október');
  });

  it('formats an explicit pattern with quoted text', () => {
    const date = utc('2026-03-04T05:06:07Z');
    expect(formatDatePattern(date, "yyyy-MM-dd'T'HH:mm:ss", 'en')).toBe('2026-03-04T05:06:07');
    expect(formatDatePattern(date, "d. MMMM 'kl.' HH:mm", 'is')).toBe('4. mars kl. 05:06');
    expect(formatDatePattern(date, "HH 'o''clock', ''yy", 'en')).toBe("05 o'clock, '26");
    expect(() => formatDatePattern(date, 'h:mm a', 'en')).toThrow('unsupported field "h"');
    expect(() => formatDateTemplate(date, 'yQQQ', 'en')).toThrow('no pattern');
  });
});

// MARK: - Day energy (MealItemMathTests)

describe('day energy (MealItemMathTests)', () => {
  const totals = (low: number, high: number, protein = 0): DayTotals => ({ kcalLow: low, kcalHigh: high, proteinG: protein });
  const target = (low: number, high: number, protein = 120): DayTarget => ({ kcalLow: low, kcalHigh: high, proteinG: protein });

  it('reads a point total as one number (testAPointTotalReadsAsOneNumber)', () => {
    const energy = dayEnergy(totals(1432, 1432), null);
    expect(energy.eaten.key).toBe('plan.nutrition.eaten');
    expect(energy.eaten.params.kcal).toBe('1430');
    expect(energy.showsEstimateChip).toBe(false);
  });

  it('keeps both ends of a range and the estimate chip (testARangeTotalKeepsBothEndsAndTheEstimateChip)', () => {
    const energy = dayEnergy(totals(1400, 1700), null);
    expect(energy.eaten.key).toBe('plan.nutrition.eaten_range');
    expect(energy.eaten.params).toEqual({ low: '1400', high: '1700' });
    expect(energy.showsEstimateChip).toBe(true);
    expect(energy.eatenMidKcal).toBe(1550);
  });

  it('has no bars and no status without a target (testWithoutATargetThereAreNoBarsAndNoStatusLine)', () => {
    const energy = dayEnergy(totals(1200, 1200), null);
    expect(energy.kcalFill).toBeNull();
    expect(energy.proteinFill).toBeNull();
    expect(energy.status).toBeNull();
    expect(energy.targetMidKcal).toBeNull();
  });

  it('says how much is left under the target (testUnderTheTargetSaysHowMuchIsLeft)', () => {
    const energy = dayEnergy(totals(1200, 1200, 60), target(1800, 2000));
    expect(energy.status?.key).toBe('diary.left');
    expect(energy.targetMidKcal).toBe(1900);
    expect(energy.status?.params.kcal).toBe('700');
  });

  it('says nothing more inside the range (testInsideTheRangeSaysNothingMore)', () => {
    const energy = dayEnergy(totals(1900, 1900, 120), target(1800, 2000));
    expect(energy.status).toEqual({ key: 'diary.within', params: {} });
  });

  it('says by how much over the target, neutrally (testOverTheTargetSaysByHowMuch)', () => {
    const energy = dayEnergy(totals(2300, 2300, 140), target(1800, 2000));
    expect(energy.status?.key).toBe('diary.over');
    expect(energy.status?.params.kcal).toBe('300');
  });

  it('counts the boundaries as within (testTheBoundariesCountAsWithin)', () => {
    expect(dayEnergy(totals(1800, 1800), target(1800, 2000)).status?.key).toBe('diary.within');
    expect(dayEnergy(totals(2000, 2000), target(1800, 2000)).status?.key).toBe('diary.within');
  });

  it('never overfills a bar (testBarsNeverOverfill)', () => {
    const energy = dayEnergy(totals(4000, 4000, 300), target(1800, 2000, 120));
    expect(energy.kcalFill).toBe(1);
    expect(energy.proteinFill).toBe(1);
  });

  it('fills the bars by the ratio of the midpoints (testBarsAreTheRatioOfTheMidpoints)', () => {
    const energy = dayEnergy(totals(950, 950, 60), target(1800, 2000, 120));
    expect(energy.kcalFill).toBeCloseTo(950 / 1900, 4);
    expect(energy.proteinFill).toBeCloseTo(0.5, 4);
  });

  it('reports a range with a target on its midpoint (testARangeWithATargetUsesTheMidpoint)', () => {
    const energy = dayEnergy(totals(1500, 1900, 90), target(1800, 2000));
    expect(energy.eatenMidKcal).toBe(1700);
    expect(energy.status?.key).toBe('diary.left');
    expect(energy.status?.params.kcal).toBe('200');
    expect(energy.showsEstimateChip).toBe(true);
  });

  it('cannot divide by a zero target (testAZeroTargetCannotDivideByZero)', () => {
    const energy = dayEnergy(totals(0, 0), target(0, 0, 0));
    expect(energy.kcalFill).toBe(0);
    expect(energy.proteinFill).toBe(0);
  });

  it('names keys the tables have', () => {
    const en: Record<string, string> = generatedTables.en;
    for (const key of ['plan.nutrition.eaten', 'plan.nutrition.eaten_range', 'diary.left', 'diary.within', 'diary.over']) {
      expect([key, key in en]).toEqual([key, true]);
    }
  });
});
