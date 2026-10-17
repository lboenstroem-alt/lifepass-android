/**
 * The week strip's rules: week moves over server-day strings (month and
 * year boundaries, any phone zone), the day number, the status word, and the
 * cell's TalkBack name, which always carries the status as a word.
 */
import { decodeWeekView, type WeekDayCell } from '../../../../health';
import { translate, type Lang } from '../../../../i18n';
import { cellAccessibilityLabel, cellStatus, cellWeekday, dayNumber, movedWeekStart, relativeDay, statusWord } from '../weekRules';

const tFor = (lang: Lang) => (key: string) => translate(key, lang);
const t = tFor('en');

function cell(overrides: Partial<WeekDayCell> = {}): WeekDayCell {
  return {
    date: '2026-09-17',
    weekday: 4,
    inProgram: true,
    sessionId: 's-1',
    kind: 'strength',
    title: 'Full body',
    minutes: 40,
    status: 'done',
    isToday: false,
    ...overrides,
  };
}

describe('moving a week', () => {
  it('adds and subtracts seven days on server-day strings', () => {
    expect(movedWeekStart({ weekStartsOn: '2026-09-14' }, 1)).toBe('2026-09-21');
    expect(movedWeekStart({ weekStartsOn: '2026-09-14' }, -1)).toBe('2026-09-07');
    expect(movedWeekStart({ weekStartsOn: '2026-09-14' }, 2)).toBe('2026-09-28');
  });

  it('crosses month and year boundaries', () => {
    expect(movedWeekStart({ weekStartsOn: '2026-09-28' }, 1)).toBe('2026-10-05');
    expect(movedWeekStart({ weekStartsOn: '2026-10-05' }, -1)).toBe('2026-09-28');
    expect(movedWeekStart({ weekStartsOn: '2026-12-28' }, 1)).toBe('2027-01-04');
    expect(movedWeekStart({ weekStartsOn: '2027-01-04' }, -1)).toBe('2026-12-28');
    // A leap day.
    expect(movedWeekStart({ weekStartsOn: '2028-02-28' }, 1)).toBe('2028-03-06');
  });

  it('moves nothing without a start', () => {
    expect(movedWeekStart({ weekStartsOn: null }, 1)).toBeNull();
    expect(movedWeekStart(decodeWeekView({}, 'week'), -1)).toBeNull();
  });
});

describe('a cell', () => {
  it('reads its status from the server, else planned inside the programme', () => {
    expect(cellStatus({ status: 'missed', inProgram: true })).toBe('missed');
    expect(cellStatus({ status: null, inProgram: true })).toBe('planned');
    expect(cellStatus({ status: null, inProgram: false })).toBe('unknown');
    expect(cellStatus({ status: null, inProgram: null })).toBe('unknown');
  });

  it('shows the day of the month without its leading zero', () => {
    expect(dayNumber('2026-09-17')).toBe('17');
    expect(dayNumber('2026-10-05')).toBe('5');
    expect(dayNumber('2026-10-10')).toBe('10');
  });

  it('shows the weekday in the account language, Monday when it has none', () => {
    expect(cellWeekday({ weekday: 3 }, 'en')).toBe('Wed');
    expect(cellWeekday({ weekday: null }, 'en')).toBe('Mon');
    expect(cellWeekday({ weekday: 3 }, 'is')).not.toBe('Wed');
  });
});

describe('the status as a word, never colour alone', () => {
  it('names done, planned, skipped and missed; rest says nothing', () => {
    expect(statusWord('done', t)).toBe('done');
    expect(statusWord('planned', t)).toBe('planned');
    expect(statusWord('skipped', t)).toBe('skipped');
    expect(statusWord('missed', t)).toBe('missed');
    expect(statusWord('rest', t)).toBeNull();
    expect(statusWord('unknown', t)).toBeNull();
    expect(statusWord(null, t)).toBeNull();
  });

  it("carries the status word in the cell's label, in both languages", () => {
    const en = cellAccessibilityLabel(cell(), 'en', t);
    expect(en).toMatch(/^Thu 17 Sep/);
    expect(en).toContain('Full body');
    expect(en.endsWith(', done')).toBe(true);
    const is = cellAccessibilityLabel(cell({ status: 'missed' }), 'is', tFor('is'));
    expect(is.endsWith(`, ${translate('a11y.status.missed', 'is')}`)).toBe(true);
  });

  it('names a rest day and leaves out the word it has none for', () => {
    const label = cellAccessibilityLabel(cell({ title: null, status: 'rest', inProgram: false }), 'en', t);
    expect(label.endsWith(', Rest day')).toBe(true);
  });

  it('says the date once', () => {
    const label = cellAccessibilityLabel(cell(), 'en', t);
    expect(label.match(/Thu/g)).toHaveLength(1);
  });
});

describe('the selection analytics', () => {
  it('says today, past or future against the server day', () => {
    expect(relativeDay('2026-10-17', '2026-10-17')).toBe('today');
    expect(relativeDay('2026-10-16', '2026-10-17')).toBe('past');
    expect(relativeDay('2026-10-18', '2026-10-17')).toBe('future');
  });
});
