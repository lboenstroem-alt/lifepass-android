/**
 * The date step's month grid is the venue's calendar (Reykjavík, UTC),
 * Monday first, in the account language, whatever zone the phone is on
 * (scripts/ci.sh runs this suite under New York and Tokyo too).
 */
import { addMonths, dayLabel, dayNumber, monthBefore, monthGrid, monthOf, monthTitle, weekdayHeads } from '../calendar';

it('a month is Monday-first weeks of seven, blanks outside it', () => {
  // 1 March 2030 is a Friday.
  const weeks = monthGrid({ year: 2030, month: 3 });
  expect(weeks[0]).toEqual([null, null, null, null, '2030-03-01', '2030-03-02', '2030-03-03']);
  expect(weeks.every((week) => week.length === 7)).toBe(true);
  const days = weeks.flat().filter((day): day is string => day !== null);
  expect(days).toHaveLength(31);
  expect(days.at(-1)).toBe('2030-03-31');
  // A month starting on a Monday has no leading blanks (1 April 2030).
  expect(monthGrid({ year: 2030, month: 4 })[0][0]).toBe('2030-04-01');
});

it('February of a leap year has 29 days', () => {
  expect(monthGrid({ year: 2028, month: 2 }).flat().filter(Boolean)).toHaveLength(29);
});

it('months step across years and compare', () => {
  expect(addMonths({ year: 2030, month: 12 }, 1)).toEqual({ year: 2031, month: 1 });
  expect(addMonths({ year: 2030, month: 1 }, -1)).toEqual({ year: 2029, month: 12 });
  expect(monthBefore({ year: 2029, month: 12 }, { year: 2030, month: 1 })).toBe(true);
  expect(monthBefore({ year: 2030, month: 1 }, { year: 2030, month: 1 })).toBe(false);
  expect(monthOf('2030-03-14')).toEqual({ year: 2030, month: 3 });
});

it('the month, weekdays and days read in the account language', () => {
  expect(monthTitle({ year: 2030, month: 10 }, 'en')).toBe('October 2030');
  expect(monthTitle({ year: 2030, month: 10 }, 'is')).toBe('október 2030');
  expect(weekdayHeads('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  expect(weekdayHeads('is')[0]).toBe('mán.');
  expect(dayNumber('2030-03-07')).toBe('7');
  expect(dayLabel('2030-09-25', 'en')).toBe('25 September 2030');
  expect(dayLabel('2030-09-25', 'is')).toBe('25. september 2030');
});
