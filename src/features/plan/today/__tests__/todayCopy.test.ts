/**
 * The Today card's words in both languages: the kicker and meta line, the
 * recovery chip, the note's reasons, the hike line, the skip and done-source
 * lines, the "more exercises" plural and the extras (iOS LogWorkoutTests
 * `testTheExtraLineSaysTheTypeOnlyWhenThereIsOne`).
 */
import { decodeHealthDay, decodeSessionView, type ExtraWorkoutView } from '../../../../health';
import { translate, type Lang } from '../../../../i18n';
import {
  doneSourceLine,
  extraLine,
  extraRemoveLabel,
  extraTypeWord,
  hikeLine,
  metaLine,
  moreExercisesLine,
  noteHasContent,
  noteReasonLines,
  previewMetaLine,
  recoveryBandWord,
  skipReasonWord,
  todayKicker,
  todayTitle,
  type Translate,
} from '../copy';

const tIn =
  (lang: Lang): Translate =>
  (key, params) =>
    translate(key, lang, params);
const en = tIn('en');
const is = tIn('is');

const session = (json: Record<string, unknown>) => decodeSessionView({ id: 's-1', ...json }, 'session');
const extra = (json: Partial<ExtraWorkoutView>): ExtraWorkoutView => ({
  index: 0,
  loggedAt: null,
  minutes: null,
  feeling: null,
  performed: null,
  id: null,
  kind: null,
  note: null,
  title: null,
  canRemove: null,
  ...json,
});

describe('the header', () => {
  const day = decodeHealthDay({ date: '2026-10-14', today: '2026-10-16', program: { id: 'p', weekNo: 2, weeks: 4 } });

  it('says today or the date, with the week', () => {
    expect(todayKicker(day, true, en, 'en')).toBe('Today · week 2 of 4');
    expect(todayKicker(day, true, is, 'is')).toBe('Í dag · vika 2 af 4');
    expect(todayKicker(day, false, en, 'en')).toMatch(/^Wed 14 Oct.* · week 2 of 4$/);
    const noCounter = decodeHealthDay({ date: '2026-10-16' });
    expect(todayKicker(noCounter, true, en, 'en')).toBe('Today · week 1 of 4');
  });

  it('titles a date with no session a rest day', () => {
    expect(todayTitle(null, en)).toBe('Rest day');
    expect(todayTitle(session({ title: 'Full body strength' }), en)).toBe('Full body strength');
  });

  it('prints minutes and intensity for a workout only', () => {
    expect(metaLine(session({ kind: 'strength', minutes: 45, intensity: 'hard' }), en)).toBe('45 min · Hard');
    expect(metaLine(session({ kind: 'strength', minutes: 45 }), is)).toBe('45 mín · Miðlungs');
    expect(metaLine(session({ kind: 'strength', minutes: 45, intensity: 'brutal' }), en)).toBe('45 min · Moderate');
    expect(metaLine(session({ kind: 'rest', minutes: 45 }), en)).toBeNull();
    expect(metaLine(session({ kind: 'strength', minutes: 0 }), en)).toBeNull();
    expect(metaLine(session({ minutes: 30 }), en)).toBeNull();
    expect(metaLine(null, en)).toBeNull();
    expect(previewMetaLine(session({}), en)).toBe('0 min · Moderate');
  });

  it('shows the recovery chip today, for a band it knows', () => {
    const scored = (band: string) => decodeHealthDay({ date: '2026-10-16', scores: { recoveryBand: band } });
    expect(recoveryBandWord(scored('low'), true, en)).toBe('Low');
    expect(recoveryBandWord(scored('high'), true, is)).toBe('Góð');
    expect(recoveryBandWord(scored('low'), false, en)).toBeNull();
    expect(recoveryBandWord(scored('stellar'), true, en)).toBeNull();
    expect(recoveryBandWord(decodeHealthDay({ date: '2026-10-16' }), true, en)).toBeNull();
  });
});

describe('the note', () => {
  it('is drawn when it has a title or a body', () => {
    expect(noteHasContent(null)).toBe(false);
    expect(noteHasContent({ date: null, templateId: null, title: '', body: '', reasonCodes: null, notificationKey: null })).toBe(false);
    expect(noteHasContent({ date: null, templateId: null, title: 'Go easy', body: null, reasonCodes: null, notificationKey: null })).toBe(true);
  });

  it('prints the reasons it knows and drops the ones it does not', () => {
    const note = { reasonCodes: ['first_week', 'a_rule_from_next_year', 'short_sleep'] };
    expect(noteReasonLines(note, en)).toEqual(['Week one starts gently.', 'You slept less than 6 hours.']);
    expect(noteReasonLines(note, is)).toEqual([translate('note.reason.first_week', 'is'), translate('note.reason.short_sleep', 'is')]);
    expect(noteReasonLines(null, en)).toEqual([]);
  });
});

describe('the session lines', () => {
  it('reads a hike with and without its ascent', () => {
    const sight = { slug: 'esja', name: 'Esja', difficulty: 'hard', durationMinutes: 150, ascentM: 640 };
    expect(hikeLine(sight, en, 'en')).toBe('Hard · 2 h 30 min · 640 m up');
    expect(hikeLine({ ...sight, ascentM: null }, is, 'is')).toBe('Erfið · 2 klst 30 mín');
    expect(hikeLine({ ...sight, difficulty: null }, en, 'en')).toBe('Moderate · 2 h 30 min · 640 m up');
  });

  it('names the skip reason, paused included, and anything else as something else', () => {
    expect(skipReasonWord('tired', en)).toBe('tired');
    expect(skipReasonWord('paused', en)).toBe('plan paused');
    expect(skipReasonWord('unknown', en)).toBe('something else');
    expect(skipReasonWord(null, is)).toBe('eitthvað annað');
  });

  it('says where a done session was counted from, never naming Apple Health', () => {
    expect(doneSourceLine(session({ doneSource: 'check_in', checkInVenueName: 'Sundhöllin' }), en)).toBe(
      'Counted from your check-in at Sundhöllin',
    );
    const watch = doneSourceLine(session({ doneSource: 'wearable' }), en);
    expect(watch).toBe('Counted from a workout your watch or phone recorded');
    expect(watch).not.toMatch(/Apple/);
    expect(doneSourceLine(session({ doneSource: 'wearable' }), is)).toBe('Talið út frá æfingu sem úrið eða síminn skráði');
    expect(doneSourceLine(session({ doneSource: 'member' }), en)).toBeNull();
    expect(doneSourceLine(session({}), en)).toBeNull();
  });

  it('counts the exercises past the first three, with the Icelandic plural', () => {
    expect(moreExercisesLine(1, en, 'en')).toBe('and 1 more');
    expect(moreExercisesLine(2, en, 'en')).toBe('and 2 more');
    expect(moreExercisesLine(21, is, 'is')).toBe(translate('plan.more_exercises.one', 'is', { count: 21 }));
    expect(moreExercisesLine(11, is, 'is')).toBe('og 11 í viðbót');
  });
});

describe('the extras', () => {
  it('the extra line says the type only when there is one', () => {
    const gym = extra({ minutes: 45, kind: 'strength', title: 'Gym' });
    expect(extraLine(gym, en, 'en')).toBe('Extra workout · Gym · 45 min');
    expect(extraRemoveLabel(gym, en, 'en')).toBe('Remove extra workout: Gym, 45 minutes');

    const other = extra({ minutes: 30, kind: 'other' });
    expect(extraLine(other, en, 'en')).toBe('Extra workout · 30 min');
    expect(extraRemoveLabel(other, en, 'en')).toBe('Remove extra workout: 30 minutes');

    const legacy = extra({ minutes: 20 });
    expect(extraLine(legacy, is, 'is')).toBe('Aukaæfing · 20 mín');

    const swim = extra({ minutes: 21, kind: 'swim' });
    expect(extraLine(swim, is, 'is')).toBe('Aukaæfing · Sund · 21 mín');
    // 21 takes the singular in Icelandic.
    expect(extraRemoveLabel(swim, is, 'is')).toBe('Fjarlægja aukaæfingu: Sund, 21 mínúta');
  });

  it("prefers the server's title and ignores a blank one", () => {
    expect(extraTypeWord(extra({ title: '  ', kind: 'cardio' }), en)).toBe('Run or walk');
    expect(extraTypeWord(extra({ title: 'Spinning', kind: 'cardio' }), en)).toBe('Spinning');
    expect(extraTypeWord(extra({ kind: 'unknown' }), en)).toBeNull();
  });
});
