/**
 * A feed row's chip (the precedence of iOS `ClassFeedChip` / the web's
 * `capacityChip`), its identity, its bookable activity, and the session it
 * hands the class sheet (iOS ClassBookingSheetTests.testAFeedRowKeepsItsSession).
 */
import { translate } from '../../../../i18n';
import { classItem } from '../../__tests__/feedFixtures';
import { chipCopy, classFeedChip, type ClassFeedChip } from '../chip';
import { bookableActivity, classFeedRowId, toOccurrence } from '../occurrence';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const PAST = '2026-10-01T12:00:00.000Z';
const FUTURE = '2026-10-03T12:00:00.000Z';

function chipFor(extra: Record<string, unknown>): ClassFeedChip {
  return classFeedChip(classItem({ startsAt: new Date('2026-10-05T06:00:00Z'), extra }), NOW);
}

describe('the registration chip', () => {
  it.each<[string, Record<string, unknown>, ClassFeedChip]>([
    // Abler's explicit "no": not open, closed, full, or just unavailable.
    ['event_not_open, opens later', { canBook: false, canBookReason: 'event_not_open', registrationOpensAt: FUTURE }, { kind: 'notOpen', opensAt: new Date(FUTURE) }],
    ['event_not_open, no opening time', { canBook: false, canBookReason: 'event_not_open' }, { kind: 'notOpen', opensAt: null }],
    ['outside the window, opened already', { canBook: false, canBookReason: 'outside_registration_window', registrationOpensAt: PAST }, { kind: 'registrationClosed' }],
    ['opens exactly now: closed', { canBook: false, canBookReason: 'event_not_open', registrationOpensAt: NOW.toISOString() }, { kind: 'registrationClosed' }],
    ['class_full', { canBook: false, canBookReason: 'class_full' }, { kind: 'full' }],
    ['not bookable and full', { canBook: false, canBookReason: 'something', full: true }, { kind: 'full' }],
    ['not bookable for another reason', { canBook: false, canBookReason: 'member_banned' }, { kind: 'unavailable' }],
    ['not open outranks full', { canBook: false, canBookReason: 'event_not_open', full: true }, { kind: 'notOpen', opensAt: null }],
    // Abler's "yes" outranks a stale full.
    ['bookable with spots', { canBook: true, attendance: { current: 9, limit: 14 } }, { kind: 'left', count: 5 }],
    ['bookable with a stale full', { canBook: true, full: true, attendance: { current: 14, limit: 14 } }, { kind: 'open' }],
    ['bookable, unlimited', { canBook: true, attendance: { current: 3, limit: -1 } }, { kind: 'open' }],
    ['bookable, no attendance', { canBook: true, attendance: null }, { kind: 'open' }],
    // No verdict (first-party): derived from capacity.
    ['no verdict, full', { canBook: null, full: true }, { kind: 'full' }],
    ['no verdict, no attendance', { canBook: null, attendance: null }, { kind: 'open' }],
    ['no verdict, unlimited', { canBook: null, attendance: { current: 40, limit: -1 } }, { kind: 'open' }],
    ['no verdict, limit 0', { canBook: null, attendance: { current: 0, limit: 0 } }, { kind: 'unavailable' }],
    ['no verdict, spots left', { canBook: null, attendance: { current: 2, limit: 10 } }, { kind: 'left', count: 8 }],
    ['no verdict, over the limit reads 0 left', { canBook: null, attendance: { current: 12, limit: 10 } }, { kind: 'left', count: 0 }],
  ])('%s', (_name, extra, expected) => {
    expect(chipFor(extra)).toEqual(expected);
  });

  it('reads in both languages', () => {
    const words = (chip: ClassFeedChip, lang: 'en' | 'is') => {
      const copy = chipCopy(chip);
      return translate(copy.key, lang, copy.params);
    };
    expect(words({ kind: 'open' }, 'en')).toBe('Open');
    expect(words({ kind: 'open' }, 'is')).toBe('Laust');
    expect(words({ kind: 'full' }, 'is')).toBe('Fullbókað');
    expect(words({ kind: 'left', count: 3 }, 'en')).toBe('3 left');
    expect(words({ kind: 'left', count: 3 }, 'is')).toBe('3 laus');
    expect(words({ kind: 'notOpen', opensAt: null }, 'en')).toBe('Not open for registration');
    expect(words({ kind: 'notOpen', opensAt: null }, 'is')).toBe('Skráning ekki opin');
    expect(words({ kind: 'registrationClosed' }, 'en')).toBe('Registration closed');
    expect(words({ kind: 'registrationClosed' }, 'is')).toBe('Skráningu lokið');
    expect(words({ kind: 'unavailable' }, 'is')).toBe('Ekki í boði');
  });

  it('takes the tone iOS gives each state', () => {
    expect(chipCopy({ kind: 'left', count: 1 }).tone).toBe('positive');
    expect(chipCopy({ kind: 'full' }).tone).toBe('negative');
    expect(chipCopy({ kind: 'registrationClosed' }).tone).toBe('negative');
    expect(chipCopy({ kind: 'notOpen', opensAt: null }).tone).toBe('quiet');
    expect(chipCopy({ kind: 'unavailable' }).tone).toBe('quiet');
  });
});

describe('a feed row keeps its session (iOS testAFeedRowKeepsItsSession)', () => {
  const ACTIVITY = '1f2e3d4c-5b6a-4987-8e1f-0a1b2c3d4e5f';
  const start = new Date('2026-10-05T10:00:00.000Z');
  const item = (booking: Record<string, unknown>) =>
    classItem({
      name: 'Yoga Flow',
      startsAt: start,
      booking,
      extra: { instructor: 'Sigrún', surchargeFromIsk: 1990, attendance: { current: 9, limit: 14 } },
    });

  it('an Abler row books its own event, labelled by the venue', () => {
    const abler = item({ kind: 'class', activityId: ACTIVITY, eventId: 4242 });
    const occurrence = toOccurrence(abler);
    expect(occurrence).not.toBeNull();
    expect(occurrence!.handle).toEqual({ kind: 'ablerClass', eventId: 4242 });
    expect(occurrence!.activity).toEqual({ id: ACTIVITY, name: 'Hress', provider: 'abler' });
    expect(occurrence!.startsAt).toEqual(start);
    expect(occurrence!.endsAt).toEqual(new Date(start.getTime() + 3_600_000));
    expect(occurrence!.className).toBe('Yoga Flow');
    expect(occurrence!.venueName).toBe('Hress');
    expect(occurrence!.venueId).toBe(abler.venue.id);
    expect(occurrence!.instructor).toBe('Sigrún');
    expect(occurrence!.surchargeFromIsk).toBe(1990);
    expect(occurrence!.snapshot?.attendanceLimit).toBe(14);
    expect(occurrence!.id).toBe(classFeedRowId(abler));
  });

  it("a slot keeps its handle's own end, labelled by the class", () => {
    const slotEnd = new Date(start.getTime() + 2_700_000);
    const slot = item({ kind: 'slot', activityId: ACTIVITY, startsAt: start.toISOString(), endsAt: slotEnd.toISOString() });
    const occurrence = toOccurrence(slot);
    expect(occurrence!.handle).toEqual({ kind: 'slot' });
    expect(occurrence!.activity).toEqual({ id: ACTIVITY, name: 'Yoga Flow', provider: 'internal' });
    expect(occurrence!.endsAt).toEqual(slotEnd);
  });

  it('a slot with no class name is labelled by the venue', () => {
    const slot = classItem({
      name: null,
      startsAt: start,
      booking: { kind: 'slot', activityId: ACTIVITY, startsAt: start.toISOString(), endsAt: start.toISOString() },
    });
    expect(bookableActivity(slot)?.name).toBe('Hress');
  });

  it('a kind this build does not know stays non-tappable', () => {
    const unknown = item({ kind: 'waitlist', activityId: ACTIVITY });
    expect(toOccurrence(unknown)).toBeNull();
    expect(bookableActivity(unknown)).toBeNull();
  });

  it('the row id names the venue, the activity, the start and the handle', () => {
    const abler = item({ kind: 'class', activityId: ACTIVITY, eventId: 7 });
    const seconds = Math.trunc(start.getTime() / 1000);
    expect(classFeedRowId(abler)).toBe(`${abler.venue.id}-${ACTIVITY}-${seconds}-e7`);
    const slot = item({ kind: 'slot', activityId: ACTIVITY, startsAt: start.toISOString(), endsAt: start.toISOString() });
    expect(classFeedRowId(slot).endsWith('-slot')).toBe(true);
    expect(classFeedRowId(item({ kind: 'later', activityId: ACTIVITY })).endsWith('-x')).toBe(true);
  });
});
