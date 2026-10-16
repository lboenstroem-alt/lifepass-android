// Numbers, dates, durations and prices in the ACCOUNT language: a port of
// iOS HealthFormat (Services/HealthFormat.swift), VenueTimeFormat
// (Services/BookingService.swift), the class feed's day words
// (ViewModels/ClassesViewModel.swift) and Venue.iskPrefix (Models/Venue.swift).
//
// WHY NOT `toLocaleString` / `Intl`. LifePass follows the account language
// (profiles.locale), not the device: a tourist with an English phone can run
// the app in Icelandic and the other way round. The device's locale would
// print "1,900 kcal" to someone whose whole plan is in Icelandic. And the
// engine's own Intl data is not the same on every phone (Hermes builds,
// Android versions), so the two conventions the app speaks are written out
// here, from the CLDR data ICU ships on both platforms:
//   - Icelandic (is_IS): "1.900", "72,5", "mið., 17. sep.", "17. september";
//   - English (en_GB, for every non-Icelandic account): "1,900", "72.5",
//     "Wed 17 Sept", "17 September". Metric, 24-hour, day first.
//
// TIME ZONES. Two kinds of time, never mixed:
//   - Server calendar days (`YYYY-MM-DD`) and venue clocks are Iceland time,
//     which is UTC all year (no daylight saving since 1968). They are read on
//     a UTC calendar whatever zone the phone is in: shifting a server day into
//     the phone's zone moves a Sunday session to Saturday for a member out at
//     23:30, and a 14:00 Reykjavík slot read "10:00 AM" on a phone still on
//     New York time (the 2.5.0 audit fix).
//   - `localTime` is the one wall-clock reading in the PHONE's zone, as iOS
//     HealthFormat.time is.
//
// ROUNDING follows the iOS formatters exactly: NumberFormatter rounds half to
// even on the number's shortest decimal form (72.25 → "72,2", 0.15 → "0.2"),
// `String(format: "%.1f")` rounds the exact binary value half to even, and
// Swift's `.rounded()` rounds half away from zero.
import type { Lang } from './tables';

// MARK: - CLDR tables (format context)

type CalendarWords = {
  /** January first. */
  readonly monthsLong: readonly string[];
  readonly monthsShort: readonly string[];
  /** Sunday first, as Foundation's weekday symbols are. */
  readonly weekdaysLong: readonly string[];
  readonly weekdaysShort: readonly string[];
};

const CALENDAR_WORDS: Record<Lang, CalendarWords> = {
  en: {
    monthsLong: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
    // en_GB abbreviates September as "Sept" (CLDR 38 onwards, on both phones).
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'],
    weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  is: {
    monthsLong: [
      'janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní',
      'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember',
    ],
    monthsShort: ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'],
    weekdaysLong: [
      'sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur',
    ],
    weekdaysShort: ['sun.', 'mán.', 'þri.', 'mið.', 'fim.', 'fös.', 'lau.'],
  },
};

/**
 * Icelandic names a day in the accusative with the article ("á mánudaginn",
 * "mánudaginn 5. október"); the system formatters only know the nominative
 * ("mánudagur"). Sunday first.
 */
export const ICELANDIC_ACCUSATIVE_WEEKDAYS: readonly string[] = [
  'sunnudaginn', 'mánudaginn', 'þriðjudaginn', 'miðvikudaginn', 'fimmtudaginn', 'föstudaginn', 'laugardaginn',
];

/** The month and weekday words for a language (format context). */
export function calendarWords(lang: Lang): CalendarWords {
  return CALENDAR_WORDS[lang === 'is' ? 'is' : 'en'];
}

/**
 * The pattern each language's formatter picks for a template, as Foundation's
 * `setLocalizedDateFormatFromTemplate` (ICU's best-pattern match) does. The
 * keys are templates with the spaces removed ("EEE d MMM" → "EEEdMMM").
 */
const TEMPLATE_PATTERNS: Record<string, Record<Lang, string>> = {
  EEEdMMM: { en: 'EEE d MMM', is: 'EEE, d. MMM' },
  EEEEdMMMM: { en: 'EEEE d MMMM', is: 'EEEE, d. MMMM' },
  dMMM: { en: 'd MMM', is: 'd. MMM' },
  dMMMM: { en: 'd MMMM', is: 'd. MMMM' },
  dMMMy: { en: 'd MMM y', is: 'd. MMM y' },
  dMMMMy: { en: 'd MMMM y', is: 'd. MMMM y' },
  MMMMy: { en: 'MMMM y', is: 'MMMM y' },
  EEE: { en: 'EEE', is: 'EEE' },
  EEEE: { en: 'EEEE', is: 'EEEE' },
  'HH:mm': { en: 'HH:mm', is: 'HH:mm' },
};

export type DateTemplate = keyof typeof TEMPLATE_PATTERNS;

/**
 * Which clock a date is read on: `'iceland'` for server days and venue times
 * (UTC, see the file comment), `'phone'` for the member's own clock.
 */
export type Clock = 'iceland' | 'phone';

type DateParts = { year: number; month: number; day: number; weekday: number; hours: number; minutes: number; seconds: number };

function partsOf(date: Date, clock: Clock): DateParts {
  return clock === 'iceland'
    ? {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        hours: date.getUTCHours(),
        minutes: date.getUTCMinutes(),
        seconds: date.getUTCSeconds(),
      }
    : {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        weekday: date.getDay(),
        hours: date.getHours(),
        minutes: date.getMinutes(),
        seconds: date.getSeconds(),
      };
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * Format a date with an explicit pattern, as a `DateFormatter` with
 * `dateFormat` set does: `EEEE` `EEE` `E` (weekday), `d` `dd`, `MMMM` `MMM`
 * `MM` `M`, `y` `yyyy`, `HH` `H`, `mm`, `ss`; text in single quotes is
 * literal, as is any character that is not a letter.
 */
export function formatDatePattern(date: Date, pattern: string, lang: Lang, clock: Clock = 'iceland'): string {
  const parts = partsOf(date, clock);
  const words = calendarWords(lang);
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "'") {
      // '' is a quote; 'text' is literal text, with '' inside it a quote.
      if (pattern[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < pattern.length) {
        if (pattern[j] === "'") {
          if (pattern[j + 1] !== "'") break;
          out += "'";
          j += 2;
          continue;
        }
        out += pattern[j];
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) {
      out += c;
      i += 1;
      continue;
    }
    let j = i;
    while (j < pattern.length && pattern[j] === c) j += 1;
    const n = j - i;
    switch (c) {
      case 'E':
        out += n >= 4 ? words.weekdaysLong[parts.weekday] : words.weekdaysShort[parts.weekday];
        break;
      case 'd':
        out += pad(parts.day, n);
        break;
      case 'M':
        out += n >= 4 ? words.monthsLong[parts.month] : n === 3 ? words.monthsShort[parts.month] : pad(parts.month + 1, n);
        break;
      case 'y':
        out += n === 2 ? pad(parts.year % 100, 2) : pad(parts.year, n);
        break;
      case 'H':
        out += pad(parts.hours, n);
        break;
      case 'm':
        out += pad(parts.minutes, n);
        break;
      case 's':
        out += pad(parts.seconds, n);
        break;
      default:
        throw new Error(`formatDatePattern: unsupported field "${c}" in "${pattern}"`);
    }
    i = j;
  }
  return out;
}

/** Format with a template, as `setLocalizedDateFormatFromTemplate` does. */
export function formatDateTemplate(date: Date, template: DateTemplate | string, lang: Lang, clock: Clock = 'iceland'): string {
  const patterns = TEMPLATE_PATTERNS[template.replace(/\s+/g, '')];
  if (!patterns) throw new Error(`formatDateTemplate: no pattern for template "${template}"`);
  return formatDatePattern(date, patterns[lang === 'is' ? 'is' : 'en'], lang, clock);
}

// MARK: - Rounding

/** Swift's `.rounded()`: to nearest, a half away from zero. */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * The shortest decimal digits of a finite, non-negative number and where its
 * point goes: 72.25 → { digits: '7225', point: 2 }, 0.05 → { '5', -1 }.
 */
function shortestDecimal(abs: number): { digits: string; point: number } {
  const [mantissa = '0', exponent = '0'] = abs.toString().split('e');
  const dot = mantissa.indexOf('.');
  const raw = mantissa.replace('.', '');
  let point = (dot === -1 ? mantissa.length : dot) + Number(exponent);
  const leading = raw.length - raw.replace(/^0+/, '').length;
  const digits = raw.slice(leading).replace(/0+$/, '');
  point -= leading;
  return digits ? { digits, point } : { digits: '0', point: 1 };
}

/** Add one to a string of decimal digits ("199" → "200", "99" → "100", "" → "1"). */
function incrementDigits(digits: string): string {
  const chars = digits.split('');
  for (let k = chars.length - 1; k >= 0; k -= 1) {
    if (chars[k] === '9') {
      chars[k] = '0';
    } else {
      chars[k] = String(Number(chars[k]) + 1);
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

/**
 * Round a non-negative number to `fractionDigits`, half to even on its
 * shortest decimal form (ICU's NumberFormatter default), and return the
 * integer and fraction digits with trailing fraction zeros dropped.
 */
function roundHalfEven(abs: number, fractionDigits: number): { integer: string; fraction: string } {
  let { digits, point } = shortestDecimal(abs);
  // `keep` digits reach the last place shown. Pad on the left so it is never
  // negative (0.004 to one place keeps no digit of "04" at point -1).
  let keep = point + fractionDigits;
  if (keep < 0) {
    digits = '0'.repeat(-keep) + digits;
    point -= keep;
    keep = 0;
  }
  if (keep < digits.length) {
    const kept = digits.slice(0, keep);
    const rest = digits.slice(keep);
    const lastKept = kept ? Number(kept[kept.length - 1]) : 0;
    const roundUp = rest[0]! > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || lastKept % 2 === 1));
    if (!roundUp) {
      if (!kept) return { integer: '0', fraction: '' };
      digits = kept;
    } else {
      // A carry out of the first digit ("99" → "100", or nothing kept → "1")
      // moves the point one place right.
      const bumped = incrementDigits(kept);
      if (bumped.length > kept.length) point += 1;
      digits = bumped;
    }
  }
  // Split at the point, padding with zeros on either side.
  let integer: string;
  let fraction: string;
  if (point <= 0) {
    integer = '0';
    fraction = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    integer = digits + '0'.repeat(point - digits.length);
    fraction = '';
  } else {
    integer = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  fraction = fraction.slice(0, fractionDigits).replace(/0+$/, '');
  integer = integer.replace(/^0+(?=\d)/, '');
  return { integer, fraction };
}

const SEPARATORS: Record<Lang, { group: string; decimal: string }> = {
  en: { group: ',', decimal: '.' },
  is: { group: '.', decimal: ',' },
};

function groupThousands(integer: string, separator: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * A grouped number with at most `maxFractionDigits`, trailing zeros dropped,
 * in a language's separators. A negative value keeps its sign even when it
 * rounds to zero ("-0"), as ICU prints it.
 */
function formatNumber(value: number, separators: { group: string; decimal: string }, maxFractionDigits: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  const negative = value < 0 || Object.is(value, -0);
  const { integer, fraction } = roundHalfEven(Math.abs(value), Math.max(0, Math.floor(maxFractionDigits)));
  const grouped = groupThousands(integer, separators.group);
  return `${negative ? '-' : ''}${grouped}${fraction ? separators.decimal + fraction : ''}`;
}

/**
 * C's `String(format: "%.<digits>f")`: the exact binary value rounded half to
 * even (JavaScript's `toFixed` rounds an exact tie up instead), with a point.
 */
export function printfFixed(value: number, digits: number): string {
  const abs = Math.abs(value);
  let text = abs.toFixed(digits);
  // An exact tie is a value whose binary expansion ends one bit past the last
  // kept decimal place: abs * 2^(digits + 1) is an odd integer.
  const scaled = abs * 2 ** (digits + 1);
  if (Number.isInteger(scaled) && scaled % 2 === 1) {
    // toFixed took the upper neighbour; half to even wants the lower one when
    // the upper is odd. Its last digit is then odd, so this never borrows.
    const last = Number(text[text.length - 1]);
    if (last % 2 === 1) text = text.slice(0, -1) + String(last - 1);
  }
  const negative = value < 0 || Object.is(value, -0);
  return negative ? `-${text}` : text;
}

// MARK: - Parsing member input

/**
 * Parse a decimal typed on any keyboard in any region.
 *
 * Accepts both "72,5" and "72.5" whatever the device's separator, trims
 * whitespace, and rejects everything else (letters, two separators, a stray
 * minus in the middle). Deliberately not a locale-aware parser: that is
 * region-bound, so an Icelandic phone would silently read "72.5" as 725.
 */
export function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalised = trimmed.replace(/,/g, '.');
  let seenDot = false;
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index]!;
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

/**
 * Parse a whole number typed by the member (iOS `HealthFormat.parseInt`).
 * Rejects decimals outright so "3.5 reps" never silently becomes 3.
 */
export function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

// MARK: - Numbers

/**
 * Grouped integer: "1,900" (en) / "1.900" (is). A fraction is rounded half to
 * even, and a zero is never "-0" (the iOS value is an Int, which has no
 * negative zero).
 */
export function integer(value: number, lang: Lang): string {
  return wholeNumber(value, SEPARATORS[lang === 'is' ? 'is' : 'en']);
}

function wholeNumber(value: number, separators: { group: string; decimal: string }): string {
  const text = formatNumber(value, separators, 0);
  return text === '-0' ? '0' : text;
}

/** One decimal by default, trailing zero dropped: "72.5" / "72,5", and "72" for 72.0. */
export function decimal(value: number, lang: Lang, maxFractionDigits = 1): string {
  return formatNumber(value, SEPARATORS[lang === 'is' ? 'is' : 'en'], maxFractionDigits);
}

/** "72,5 kg" / "72.5 kg". */
export function weight(kg: number, lang: Lang): string {
  return `${decimal(kg, lang)} kg`;
}

/** "1.900 kcal" / "1,900 kcal". The unit word is the same in both. */
export function kcal(value: number, lang: Lang): string {
  return `${integer(value, lang)} kcal`;
}

/**
 * "1.800 til 2.000 kcal" / "1,800 to 2,000 kcal". Ranges are written with the
 * word, never a dash (the copy rules forbid en and em dashes).
 */
export function kcalRange(low: number, high: number, lang: Lang): string {
  if (low === high) return kcal(low, lang);
  const joiner = lang === 'is' ? 'til' : 'to';
  return `${integer(low, lang)} ${joiner} ${integer(high, lang)} kcal`;
}

/** "120 g", "7,5 g", or ml for a liquid item (1 g = 1 ml). */
export function grams(value: number, lang: Lang, liquid = false): string {
  return `${decimal(value, lang, value < 10 ? 1 : 0)} ${liquid ? 'ml' : 'g'}`;
}

/**
 * The web's customer price, "ISK 14,900", in BOTH languages (`formatISKPrefix`
 * on lifepass.is, iOS `Venue.iskPrefix`): a locale-grouped "ISK 14.900" would
 * read as fourteen point nine on an English phone.
 */
export function iskPrefix(value: number): string {
  return `ISK ${wholeNumber(value, SEPARATORS.en)}`;
}

/**
 * A distance as the web rounds it: "350 m", "2.4 km" ("2,4 km" in
 * Icelandic), "12 km" (iOS `ClassesViewModel.formatDistance`).
 */
export function formatDistance(km: number, lang: Lang): string {
  if (km < 1) return `${roundHalfAwayFromZero(km * 1000)} m`;
  if (km < 10) {
    const value = printfFixed(km, 1);
    return `${lang === 'is' ? value.replace('.', ',') : value} km`;
  }
  return `${roundHalfAwayFromZero(km)} km`;
}

// MARK: - Durations

/** "40 min" / "40 mín"; "1 h 20 min" / "1 klst 20 mín"; "2 h" / "2 klst". */
export function duration(minutes: number, lang: Lang): string {
  const minuteWord = lang === 'is' ? 'mín' : 'min';
  if (minutes < 60) return `${minutes} ${minuteWord}`;
  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  const hourWord = lang === 'is' ? 'klst' : 'h';
  if (rest <= 0) return `${hours} ${hourWord}`;
  return `${hours} ${hourWord} ${rest} ${minuteWord}`;
}

// MARK: - Server calendar days (Iceland time = UTC)

/**
 * `YYYY-MM-DD` to a Date at NOON UTC (noon, not midnight, so a formatter
 * handed the phone's zone by mistake still lands on the right day), or null
 * when it is not a day.
 */
export function dateFromServerDay(day: string): Date | null {
  // Swift's split drops empty pieces; Int() takes an optional sign.
  const parts = day.split('-').filter((part) => part.length > 0);
  if (parts.length !== 3 || !parts.every((part) => /^[+-]?\d+$/.test(part))) return null;
  const [year, month, dayOfMonth] = parts.map(Number) as [number, number, number];
  const date = new Date(0);
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0 to 99 as 19xx.
  date.setUTCFullYear(year, month - 1, dayOfMonth);
  date.setUTCHours(12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A Date to the server's `YYYY-MM-DD` (Iceland time, which is UTC). */
export function serverDay(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Today as the server sees it. */
export function todayServerDay(now: Date = new Date()): string {
  return serverDay(now);
}

/** The server day `days` after (or before, when negative) `day`; null when `day` is not one. */
export function addServerDays(day: string, days: number): string | null {
  const date = dateFromServerDay(day);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return serverDay(date);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a server day; null when it is not one. */
export function isoWeekday(day: string | Date): number | null {
  const date = typeof day === 'string' ? dateFromServerDay(day) : day;
  if (!date) return null;
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/**
 * "Wed 17 Sept" / "mið., 17. sep." from a server calendar day (shown as
 * itself when it is not one) or an instant read on Iceland's calendar.
 */
export function shortDay(day: string | Date, lang: Lang): string {
  if (typeof day !== 'string') return Number.isNaN(day.getTime()) ? '' : formatDateTemplate(day, 'EEEdMMM', lang);
  const date = dateFromServerDay(day);
  return date ? formatDateTemplate(date, 'EEEdMMM', lang) : day;
}

/** "17 September" / "17. september" for a header line. */
export function longDay(day: string, lang: Lang): string {
  const date = dateFromServerDay(day);
  if (!date) return day;
  return formatDateTemplate(date, 'dMMMM', lang);
}

/** Weekday abbreviation for an ISO weekday (1 = Monday), for the week strip; '' outside 1 to 7. */
export function weekdayAbbreviation(isoWeekdayNumber: number, lang: Lang): string {
  if (!Number.isInteger(isoWeekdayNumber) || isoWeekdayNumber < 1 || isoWeekdayNumber > 7) return '';
  // The symbols start on Sunday; ISO weekdays start on Monday.
  return calendarWords(lang).weekdaysShort[isoWeekdayNumber % 7]!;
}

/**
 * "18:00" for a wall-clock time in the PHONE's zone (iOS `HealthFormat.time`):
 * an instant the member reads off their own clock, unlike a venue time.
 */
export function localTime(date: Date): string {
  return formatDatePattern(date, 'HH:mm', 'en', 'phone');
}

// MARK: - Venue clock (Reykjavík)

/**
 * "14:00": a slot, class or registration time as the venue's clock reads it,
 * 24-hour, whatever zone the phone is on.
 */
export function venueTime(date: Date): string {
  return formatDatePattern(date, 'HH:mm', 'en', 'iceland');
}

/** "25 September 2026" / "25. september 2026", the venue's calendar day. */
export function venueDate(date: Date, lang: Lang): string {
  return formatDateTemplate(date, 'dMMMMy', lang);
}

/** "Thu 25 Sept, 14:00" / "fim., 25. sep., 14:00". */
export function venueDayTime(date: Date, lang: Lang): string {
  return `${formatDateTemplate(date, 'EEEdMMM', lang)}, ${venueTime(date)}`;
}

/** "Thu 14:00" / "fim. 14:00". */
export function venueWeekdayTime(date: Date, lang: Lang): string {
  return `${formatDateTemplate(date, 'EEE', lang)} ${venueTime(date)}`;
}

/**
 * The venue's calendar day as `YYYY-MM-DD`, the `?start=`/`?end=` an
 * availability request asks for (iOS `BookingService.ymd`).
 */
export function venueDay(date: Date): string {
  return serverDay(date);
}

// MARK: - The class feed's day words (iOS ClassesViewModel)

/** "Mon 5 Oct" / "mán. 5. okt." (the feed's own pattern, no comma). */
export function classShortDay(date: Date, lang: Lang): string {
  return formatDatePattern(date, lang === 'is' ? 'EEE d. MMM' : 'EEE d MMM', lang);
}

/**
 * "Monday 5 October" / "mánudaginn 5. október": Icelandic in the accusative
 * with the article, the way a sentence names a day.
 */
export function classLongDay(date: Date, lang: Lang): string {
  if (lang !== 'is') return formatDatePattern(date, 'EEEE d MMMM', 'en');
  return `${ICELANDIC_ACCUSATIVE_WEEKDAYS[date.getUTCDay()]} ${formatDatePattern(date, 'd. MMMM', 'is')}`;
}

// MARK: - Day energy (iOS HealthFormat.dayEnergy)

/** A day's eaten totals (iOS `MealDayTotals`). */
export type DayTotals = { readonly kcalLow: number; readonly kcalHigh: number; readonly proteinG: number };

/** A day's target (iOS `NutritionTarget`; only these fields are read). */
export type DayTarget = { readonly kcalLow: number; readonly kcalHigh: number; readonly proteinG: number };

/** A copy key plus its values; the screen resolves it in the account language. */
export type CopyLine = { readonly key: string; readonly params: Readonly<Record<string, string>> };

export type DayEnergy = {
  /** The midpoint of the eaten range, rounded to 10 kcal. */
  readonly eatenMidKcal: number;
  /** The midpoint of the target range, or null without a target. */
  readonly targetMidKcal: number | null;
  readonly eaten: CopyLine;
  /** The day still holds a photo estimate, so the eaten line is a range. */
  readonly showsEstimateChip: boolean;
  /** 0 to 1, or null without a target (the bars are then hidden). */
  readonly kcalFill: number | null;
  readonly proteinFill: number | null;
  /** Left, within or over. Always neutral copy: over target is never red. */
  readonly status: CopyLine | null;
};

/** Round to the nearest 10, the unit every kcal figure is shown in. */
export function round10(value: number): number {
  return roundHalfAwayFromZero(value / 10) * 10;
}

/**
 * The one place every surface turns a day's totals into words and bars: Plan,
 * the Diary, the meal editor's day line and meal history all call this (and
 * the web panel mirrors it), so the same day never says two different things.
 */
export function dayEnergy(totals: DayTotals, target: DayTarget | null): DayEnergy {
  const eatenMid = round10((totals.kcalLow + totals.kcalHigh) / 2);
  const isRange = totals.kcalLow !== totals.kcalHigh;
  const eaten: CopyLine = isRange
    ? { key: 'plan.nutrition.eaten_range', params: { low: String(totals.kcalLow), high: String(totals.kcalHigh) } }
    : { key: 'plan.nutrition.eaten', params: { kcal: String(eatenMid) } };

  if (!target) {
    return {
      eatenMidKcal: eatenMid,
      targetMidKcal: null,
      eaten,
      showsEstimateChip: isRange,
      kcalFill: null,
      proteinFill: null,
      status: null,
    };
  }

  const targetMid = round10((target.kcalLow + target.kcalHigh) / 2);
  const kcalFill = targetMid > 0 ? Math.min(eatenMid / targetMid, 1) : 0;
  const proteinFill = target.proteinG > 0 ? Math.min(totals.proteinG / target.proteinG, 1) : 0;

  let status: CopyLine;
  if (eatenMid < target.kcalLow) {
    status = { key: 'diary.left', params: { kcal: String(targetMid - eatenMid) } };
  } else if (eatenMid <= target.kcalHigh) {
    status = { key: 'diary.within', params: {} };
  } else {
    status = { key: 'diary.over', params: { kcal: String(eatenMid - target.kcalHigh) } };
  }

  return { eatenMidKcal: eatenMid, targetMidKcal: targetMid, eaten, showsEstimateChip: isRange, kcalFill, proteinFill, status };
}

// MARK: - The iOS names

/**
 * The same functions under the iOS type's name, so a port of Swift reads like
 * the Swift: `HealthFormat.kcalRange(1800, 2000, lang)`.
 */
export const HealthFormat = {
  parseDecimal,
  parseInt: parseInteger,
  integer,
  decimal,
  weight,
  kcal,
  kcalRange,
  grams,
  duration,
  dateFromServerDay,
  serverDay,
  todayServerDay,
  shortDay,
  longDay,
  weekdayAbbreviation,
  time: localTime,
  round10,
  dayEnergy,
} as const;

/** iOS `VenueTimeFormat`: the venue's clock, whatever zone the phone is on. */
export const VenueTimeFormat = {
  time: venueTime,
  date: venueDate,
  dayTime: venueDayTime,
  weekdayTime: venueWeekdayTime,
  day: venueDay,
} as const;
