/**
 * The words of the cards and filter rows (iOS ClassesDiscoveryView), and the
 * full-schedule calendar's month grid.
 */
import { classItem } from '../../__tests__/feedFixtures';
import { monthGrid, shiftMonth } from '../calendarMonth';
import { tint } from '../color';
import { cardAccessibilityLabel, chipText, dayHeader, quickDateLabel, surchargeText, timeLine } from '../labels';

const start = new Date('2026-10-05T06:00:00.000Z');

describe('the filter rows', () => {
  it('the quick days read Today, Tomorrow, then the weekday, capitalised', () => {
    expect(quickDateLabel(0, '2026-10-02', 'en')).toBe('Today');
    expect(quickDateLabel(1, '2026-10-03', 'en')).toBe('Tomorrow');
    expect(quickDateLabel(2, '2026-10-04', 'en')).toBe('Sunday');
    expect(quickDateLabel(0, '2026-10-02', 'is')).toBe('Í dag');
    expect(quickDateLabel(1, '2026-10-03', 'is')).toBe('Á morgun');
    expect(quickDateLabel(2, '2026-10-06', 'is')).toBe('Þriðjudagur');
  });
});

describe('the day headers', () => {
  it('name the Reykjavík day in the account language', () => {
    expect(dayHeader('2026-10-05', 'en')).toBe('Monday 5 October');
    expect(dayHeader('2026-10-05', 'is')).toBe('mánudagur 5. október');
  });
});

describe('a card', () => {
  it('reads its time in Reykjavík, with the instructor', () => {
    expect(timeLine(classItem({ startsAt: start }))).toBe('06:00–07:00');
    expect(timeLine(classItem({ startsAt: start, extra: { instructor: 'Sigrún' } }))).toBe('06:00–07:00 · Sigrún');
    expect(timeLine(classItem({ startsAt: start, extra: { instructor: '' } }))).toBe('06:00–07:00');
  });

  it('prices a surcharge the way the web does, in both languages', () => {
    const item = classItem({ startsAt: start, extra: { surchargeFromIsk: 1990 } });
    expect(surchargeText(item, 'en')).toBe('Surcharge from ISK 1,990');
    expect(surchargeText(item, 'is')).toBe('Aukagjald frá ISK 1,990');
    expect(surchargeText(classItem({ startsAt: start }), 'en')).toBeNull();
  });

  it('says everything to TalkBack in one element, the distance spoken as such', () => {
    const item = classItem({ name: null, startsAt: start, extra: { attendance: { current: 12, limit: 12 }, canBook: true } });
    expect(cardAccessibilityLabel(item, 2.44, start, 'en')).toBe('Class, 06:00–07:00, Hress, 2.4 km away, Open');
    expect(cardAccessibilityLabel(item, 2.44, start, 'is')).toBe('Tími, 06:00–07:00, Hress, í 2,4 km fjarlægð, Laust');
    expect(cardAccessibilityLabel(item, null, start, 'en')).toBe('Class, 06:00–07:00, Hress, Open');
  });

  it('the chip words follow the precedence', () => {
    const full = classItem({ startsAt: start, extra: { canBook: false, canBookReason: 'class_full' } });
    expect(chipText(full, start, 'en')).toBe('Full');
  });

  it('a tone at an opacity', () => {
    expect(tint('#D02525', 0.12)).toBe('rgba(208,37,37,0.12)');
    expect(tint('rgba(25,28,36,0.48)', 0.35)).toBe('rgba(25,28,36,0.168)');
  });
});

describe('the calendar', () => {
  it('lays a month out Monday first, padded to whole weeks', () => {
    // October 2026 starts on a Thursday.
    const october = monthGrid({ year: 2026, month: 9 });
    expect(october.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(october.filter(Boolean)).toHaveLength(31);
    expect(october.length % 7).toBe(0);
    // February 2027 starts on a Monday.
    expect(monthGrid({ year: 2027, month: 1 })[0]).toBe('2027-02-01');
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
  });
});
