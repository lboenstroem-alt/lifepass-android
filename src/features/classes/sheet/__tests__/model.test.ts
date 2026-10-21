/**
 * The class sheet's own rules (iOS ClassBookingSheet's computed properties,
 * ClassSheetPriceLine and ClassSheetHeight): the line above Confirm and
 * Confirm's spoken label in both languages, which heights the sheet may
 * take, what the status note says for every state, when Confirm and "See
 * other times" show, the header lines, and where "See other times" goes.
 * Ports ClassBookingSheetTests testConfirmsSpokenLabelCarriesTheAmount,
 * testOnlyTheAccessibilitySizesAndTheRungPickerNeedFullHeight and
 * testOtherTimesForAStartedSessionOpensOnToday.
 */
import type { ActivityClass, AvailabilitySlot } from '../../../../api/bookings';
import { lookup, translate, VenueTimeFormat } from '../../../../i18n';
import type { OccurrenceStatus } from '../../../booking';
import type { ClassOccurrence } from '../../model/occurrence';
import {
  announcesStatus,
  ClassSheetHeight,
  confirmAccessibilityLabel,
  headerAccessibilityLabel,
  instructorLine,
  isNotOpenYet,
  notBookableSentence,
  otherTimesTarget,
  priceLineText,
  sheetClassName,
  sheetPriceLine,
  showsConfirm,
  showsOtherTimes,
  showsSurchargeHint,
  spotsLine,
  statusText,
  toBookingOccurrence,
  whenLine,
} from '../model';

// The booking core's refusal steps reach the Kenni sheet, whose icons load a font through expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const START = new Date('2030-03-14T10:00:00Z');
const NOW = new Date('2030-03-10T12:00:00Z');

function klass(overrides: Partial<ActivityClass> = {}): ActivityClass {
  return {
    eventId: 4242,
    name: 'Yoga Flow',
    description: null,
    start: START,
    end: new Date(START.getTime() + 3_600_000),
    coaches: [{ firstName: 'Sigrún', lastName: 'Jónsdóttir', picture: null }],
    attendance: { current: 9, limit: 14 },
    full: false,
    canBook: true,
    canBookReason: null,
    registrationOpensAt: null,
    ...overrides,
  } as ActivityClass;
}

function slot(overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    id: 'slot-1',
    activityId: 'a',
    startTime: START,
    endTime: new Date(START.getTime() + 2_700_000),
    isAvailable: true,
    remainingCapacity: 6,
    instructor: null,
    title: 'Spin',
    ...overrides,
  };
}

function occurrence(overrides: Partial<ClassOccurrence> = {}): ClassOccurrence {
  return {
    id: 'occ-1',
    activity: { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Hress', provider: 'abler' },
    venueId: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1',
    venueSlug: 'hress',
    handle: { kind: 'ablerClass', eventId: 4242 },
    startsAt: START,
    endsAt: new Date(START.getTime() + 3_600_000),
    className: 'Yoga Flow',
    venueName: 'Hress',
    instructor: null,
    surchargeFromIsk: null,
    snapshot: null,
    ...overrides,
  };
}

describe('the price line above Confirm', () => {
  it('names the amount Confirm charges, in the app money format, in both languages', () => {
    expect(priceLineText(1_990, null, 'en')).toBe('ISK 1,990 charged when you confirm');
    expect(priceLineText(1_990, null, 'is')).toBe('ISK 1,990 gjaldfært þegar þú staðfestir');
    expect(priceLineText(12_500, 990, 'en')).toBe('ISK 12,500 charged when you confirm');
  });

  it("falls back to the row's 'from' price when there is no amount, and is absent with neither", () => {
    expect(priceLineText(null, 1_990, 'en')).toBe('Surcharge from ISK 1,990');
    expect(priceLineText(null, 1_990, 'is')).toBe('Aukagjald frá ISK 1,990');
    expect(priceLineText(null, null, 'en')).toBeNull();
  });

  it("the row's figure stands in only while there is no disclosure to say it", () => {
    const failed = { preview: null, isLoadingPreview: false, gateRefusal: null };
    expect(showsSurchargeHint(1_990, failed)).toBe(true);
    expect(showsSurchargeHint(null, failed)).toBe(false);
    expect(showsSurchargeHint(1_990, { ...failed, isLoadingPreview: true })).toBe(false);
    expect(showsSurchargeHint(1_990, { ...failed, gateRefusal: { messageKey: 'booking.err.no_plan', cta: 'seePlans' } })).toBe(
      false,
    );
    expect(
      showsSurchargeHint(1_990, {
        ...failed,
        preview: { kind: 'free', priceIsk: null, remainingMonthly: 5, isLastBeforeTopUp: false } as never,
      }),
    ).toBe(false);
  });

  it('only a ready session has a line', () => {
    const base = {
      gateRefusal: null,
      isLoadingPreview: false,
      offeredChargeIsk: 2_490,
      preview: null,
      activity: { id: 'a', name: 'Hress', provider: 'abler' as const },
      visitChoice: null,
    };
    expect(sheetPriceLine({ ...base, occurrenceStatus: 'ready' }, null, 'en')).toBe('ISK 2,490 charged when you confirm');
    for (const status of ['idle', 'checking', 'started', 'gone', 'notBookable', 'unresolved'] as const) {
      expect(sheetPriceLine({ ...base, occurrenceStatus: status }, 1_990, 'en')).toBeNull();
    }
  });

  it("Confirm's spoken label carries the amount; with nothing to charge it is unchanged", () => {
    const base = translate('classsheet.confirm_a11y', 'en', { name: 'Yoga Flow', when: 'Wed 7 Oct, 10:00–11:00' });
    expect(confirmAccessibilityLabel(base, 'ISK 1,990 charged when you confirm')).toBe(
      'Confirm booking: Yoga Flow, Wed 7 Oct, 10:00–11:00. ISK 1,990 charged when you confirm',
    );
    expect(confirmAccessibilityLabel(base, null)).toBe(base);

    const ice = translate('classsheet.confirm_a11y', 'is', { name: 'Yoga Flow', when: 'mið., 7. okt., 10:00–11:00' });
    expect(confirmAccessibilityLabel(ice, 'ISK 1,990 gjaldfært þegar þú staðfestir')).toBe(
      'Staðfesta bókun: Yoga Flow, mið., 7. okt., 10:00–11:00. ISK 1,990 gjaldfært þegar þú staðfestir',
    );
  });
});

describe('the sheet height', () => {
  it('only the accessibility text sizes and the rung picker need full height', () => {
    expect(ClassSheetHeight.snapPoints(false)).toEqual(['50%', '100%']);
    expect(ClassSheetHeight.snapPoints(true)).toEqual(['100%']);
    expect(ClassSheetHeight.expands(true, false, false)).toBe(false);
    expect(ClassSheetHeight.expands(true, false, true)).toBe(true);
    expect(ClassSheetHeight.expands(true, true, true)).toBe(false);
    expect(ClassSheetHeight.expands(false, false, true)).toBe(false);
  });
});

describe('the status note', () => {
  const none = { selectedClass: null, selectedSlot: null };

  it.each([
    ['started', 'This class has already started.', 'Þessi tími er þegar hafinn.'],
    ['gone', 'This class is no longer on the schedule.', 'Þessi tími er ekki lengur á stundaskránni.'],
    ['notBookable', "This class can't be booked right now.", 'Ekki er hægt að bóka þennan tíma núna.'],
    ['unresolved', "Couldn't load this class.", 'Ekki tókst að sækja tímann.'],
  ] as const)('%s reads the same words as iOS in EN and IS', (status, en, is) => {
    expect(statusText(status, none, 'en', NOW)).toBe(en);
    expect(statusText(status, none, 'is', NOW)).toBe(is);
    expect(announcesStatus(status)).toBe(true);
  });

  it.each(['idle', 'checking', 'ready'] as const)('%s has no note and is not announced', (status) => {
    expect(statusText(status, none, 'en', NOW)).toBe('');
    expect(announcesStatus(status)).toBe(false);
  });

  it("a class that can't be booked says why, in a sentence", () => {
    const full = klass({ canBook: false, canBookReason: 'class_full', full: true });
    expect(statusText('notBookable', { selectedClass: full, selectedSlot: null }, 'en', NOW)).toBe('This class is full.');
    expect(statusText('notBookable', { selectedClass: full, selectedSlot: null }, 'is', NOW)).toBe(
      'Þessi tími er fullbókaður.',
    );
    // No reason, but full: full; neither: can't be booked right now.
    expect(notBookableSentence(klass({ canBook: false, full: true }), 'en', NOW)).toBe('This class is full.');
    expect(notBookableSentence(klass({ canBook: false }), 'en', NOW)).toBe("This class can't be booked right now.");
  });

  it('registration that opens later says when, neutrally; one with no future time is not open', () => {
    const opens = new Date('2030-03-12T08:00:00Z');
    for (const reason of ['event_not_open', 'outside_registration_window']) {
      const later = klass({ canBook: false, canBookReason: reason, registrationOpensAt: opens });
      expect(notBookableSentence(later, 'en', NOW)).toBe(
        translate('booking.class.opens_at', 'en', { time: VenueTimeFormat.dayTime(opens, 'en') }),
      );
      expect(notBookableSentence(later, 'en', NOW)).toMatch(/^Registration opens /);
      expect(notBookableSentence(later, 'is', NOW)).toMatch(/^Skráning opnar /);
      expect(isNotOpenYet('notBookable', later)).toBe(true);

      const past = klass({ canBook: false, canBookReason: reason, registrationOpensAt: new Date('2030-03-01T08:00:00Z') });
      expect(notBookableSentence(past, 'en', NOW)).toBe("This class isn't open for registration.");
      expect(notBookableSentence(klass({ canBook: false, canBookReason: reason }), 'is', NOW)).toBe(
        'Þessi tími er ekki opinn fyrir skráningu.',
      );
      expect(isNotOpenYet('notBookable', past)).toBe(true);
    }
    expect(isNotOpenYet('notBookable', klass({ canBookReason: 'class_full' }))).toBe(false);
    expect(isNotOpenYet('ready', klass({ canBookReason: 'event_not_open' }))).toBe(false);
    expect(isNotOpenYet('notBookable', null)).toBe(false);
  });

  it('a slot with no spots left is full; any other closed slot is not bookable right now', () => {
    expect(statusText('notBookable', { selectedClass: null, selectedSlot: slot({ remainingCapacity: 0 }) }, 'en', NOW)).toBe(
      'This class is full.',
    );
    expect(
      statusText('notBookable', { selectedClass: null, selectedSlot: slot({ isAvailable: false, remainingCapacity: 3 }) }, 'en', NOW),
    ).toBe("This class can't be booked right now.");
  });
});

describe('what shows', () => {
  const plans = { messageKey: 'booking.err.no_plan', cta: 'seePlans' as const };
  const another = { messageKey: 'booking.class.err_full', cta: 'chooseAnotherTime' as const };
  const bookings = { messageKey: 'booking.err.already_booked', cta: 'myBookings' as const };

  it('See other times: whenever the session cannot be booked here, but never beside its own answer', () => {
    const table: [OccurrenceStatus, boolean][] = [
      ['idle', false],
      ['checking', false],
      ['ready', false],
      ['started', true],
      ['gone', true],
      ['notBookable', true],
      ['unresolved', true],
    ];
    for (const [status, shows] of table) expect([status, showsOtherTimes(status, null)]).toEqual([status, shows]);
    expect(showsOtherTimes('ready', plans)).toBe(false);
    expect(showsOtherTimes('ready', another)).toBe(false);
    expect(showsOtherTimes('ready', bookings)).toBe(true);
    expect(showsOtherTimes('ready', { messageKey: 'x', cta: null })).toBe(true);
  });

  it('Confirm: hidden on a refusal or an unbookable session, shown (disabled) while checking', () => {
    const table: [OccurrenceStatus, boolean][] = [
      ['idle', true],
      ['checking', true],
      ['ready', true],
      ['started', false],
      ['gone', false],
      ['notBookable', false],
      ['unresolved', false],
    ];
    for (const [status, shows] of table) expect([status, showsConfirm(status, null)]).toEqual([status, shows]);
    expect(showsConfirm('ready', plans)).toBe(false);
  });
});

describe('the header', () => {
  it("names the class from the row, else the re-checked session, else 'Class'", () => {
    const none = { selectedClass: null, selectedSlot: null };
    expect(sheetClassName(occurrence(), none, 'en')).toBe('Yoga Flow');
    expect(sheetClassName(occurrence({ className: null }), { selectedClass: klass({ name: 'Hot Yoga' }), selectedSlot: null }, 'en')).toBe(
      'Hot Yoga',
    );
    expect(sheetClassName(occurrence({ className: null }), { selectedClass: null, selectedSlot: slot({ title: 'Spin 45' }) }, 'en')).toBe(
      'Spin 45',
    );
    expect(sheetClassName(occurrence({ className: null }), none, 'en')).toBe(lookup('classes.unnamed', 'en'));
    expect(sheetClassName(occurrence({ className: null }), none, 'is')).toBe('Tími');
  });

  it('the when line is the venue day and time, with the end only when it is after the start', () => {
    const end = new Date(START.getTime() + 3_600_000);
    expect(whenLine(START, end, 'en')).toBe(`${VenueTimeFormat.dayTime(START, 'en')}–11:00`);
    expect(whenLine(START, end, 'en')).toMatch(/, 10:00–11:00$/);
    expect(whenLine(START, null, 'en')).toBe(VenueTimeFormat.dayTime(START, 'en'));
    expect(whenLine(START, START, 'is')).toBe(VenueTimeFormat.dayTime(START, 'is'));
  });

  it('the instructor is the first one anyone names', () => {
    const none = { selectedClass: null, selectedSlot: null };
    expect(instructorLine(occurrence({ instructor: 'Anna' }), { selectedClass: klass(), selectedSlot: null })).toBe('Anna');
    expect(instructorLine(occurrence(), { selectedClass: klass(), selectedSlot: null })).toBe('Sigrún Jónsdóttir');
    expect(instructorLine(occurrence(), { selectedClass: klass({ coaches: [] }), selectedSlot: null })).toBeNull();
    expect(instructorLine(occurrence({ instructor: '' }), { selectedClass: null, selectedSlot: slot({ instructor: 'Jón' }) })).toBe(
      'Jón',
    );
    expect(instructorLine(occurrence(), none)).toBeNull();
  });

  it('spots left only once the session is known to be open', () => {
    const open = { selectedClass: klass({ attendance: { current: 9, limit: 14 } }), selectedSlot: null };
    expect(spotsLine('ready', open, 'en')).toBe('5 spots left');
    expect(spotsLine('ready', open, 'is')).toBe('5 laus pláss');
    expect(spotsLine('checking', open, 'en')).toBeNull();
    expect(spotsLine('ready', { selectedClass: klass({ attendance: { current: 20, limit: 14 } }), selectedSlot: null }, 'en')).toBe(
      '0 spots left',
    );
    // Unlimited: nothing to count.
    expect(spotsLine('ready', { selectedClass: klass({ attendance: { current: 3, limit: -1 } }), selectedSlot: null }, 'en')).toBeNull();
    expect(spotsLine('ready', { selectedClass: null, selectedSlot: slot({ remainingCapacity: 6 }) }, 'en')).toBe('6 spots left');
    expect(spotsLine('ready', { selectedClass: null, selectedSlot: slot({ remainingCapacity: null }) }, 'en')).toBeNull();
  });

  it('TalkBack reads the header as one element: name, venue and time, then the instructor and spots', () => {
    const parts = { name: 'Yoga Flow', venue: 'Hress', when: 'Thu 14 Mar, 10:00–11:00' };
    expect(headerAccessibilityLabel(parts, ['Sigrún', '5 spots left'], 'en')).toBe(
      'Yoga Flow at Hress, Thu 14 Mar, 10:00–11:00, Sigrún, 5 spots left',
    );
    expect(headerAccessibilityLabel(parts, [null, null], 'is')).toBe('Yoga Flow hjá Hress, Thu 14 Mar, 10:00–11:00');
  });
});

describe('the session the booking core books', () => {
  it('keeps the handle, times and snapshot, and reads the provider', () => {
    const snapshot = {
      canBook: true,
      canBookReason: null,
      full: false,
      attendanceCurrent: 3,
      attendanceLimit: 12,
      registrationOpensAt: null,
    };
    const abler = toBookingOccurrence(occurrence({ instructor: 'Sigrún', snapshot }));
    expect(abler).toEqual({
      activity: { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Hress', provider: 'abler' },
      handle: { kind: 'ablerClass', eventId: 4242 },
      startsAt: START,
      endsAt: new Date(START.getTime() + 3_600_000),
      className: 'Yoga Flow',
      instructor: 'Sigrún',
      snapshot,
    });
    const slotOccurrence = toBookingOccurrence(
      occurrence({ activity: { id: 'b', name: 'Spin', provider: 'internal' }, handle: { kind: 'slot' }, endsAt: null }),
    );
    expect(slotOccurrence.activity.provider).toBe('internal');
    expect(slotOccurrence.endsAt).toBeNull();
    // The venue's own booking (no provider) is first-party.
    expect(toBookingOccurrence(occurrence({ activity: { id: 'c', name: 'X', provider: null } })).activity.provider).toBe('internal');
  });
});

describe('See other times', () => {
  it("opens the full flow on the session's day, at the venue", () => {
    expect(otherTimesTarget(occurrence(), NOW)).toEqual({
      route: 'BookingFlow',
      params: {
        venueId: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1',
        activity: { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', name: 'Hress', provider: 'abler' },
        initialDate: '2030-03-14',
      },
    });
  });

  it('a session that has started opens on today, never a day in the past', () => {
    const later = new Date('2030-03-15T09:00:00Z');
    const started = otherTimesTarget(occurrence({ startsAt: new Date('2030-03-14T23:30:00Z') }), later);
    expect(started?.route === 'BookingFlow' && started.params.initialDate).toBe('2030-03-15');
  });

  it("a Coach session with no venue id takes the known venue's, else opens the venue page", () => {
    const coach = occurrence({ venueId: null });
    const known = otherTimesTarget(coach, NOW, (slug) => (slug === 'hress' ? 'venue-from-catalogue' : null));
    expect(known?.route === 'BookingFlow' && known.params.venueId).toBe('venue-from-catalogue');
    expect(otherTimesTarget(coach, NOW)).toEqual({ route: 'VenueDetail', params: { slug: 'hress' } });
    expect(otherTimesTarget(occurrence({ venueId: null, venueSlug: null }), NOW)).toBeNull();
  });
});
