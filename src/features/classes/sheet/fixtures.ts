/**
 * `EXPO_PUBLIC_FIXTURE="classSheet=<variant>"` (iOS `-LPScreenshotClassSheet
 * <variant>`, `ClassSheetScreenshotFixtures` in ClassBookingSheet.swift): the
 * class sheet in a known state, for device checks and screenshots of a
 * development build (src/dev/fixtures.ts).
 *
 * Variants: `included` (a visit the plan covers), `surcharge` (ISK 1,990
 * above Confirm), `full` (the class is full, See other times) and `noplan`
 * (the membership refusal with its plans step). The session is tomorrow
 * 10:00 to 11:00 Reykjavík, so it is always upcoming.
 *
 * The venue is named by its slug only, so "See other times" has somewhere
 * to go: the full flow when the phone has loaded the venues (its timetable
 * then reads a made-up activity and finds nothing, as iOS's fixture flow
 * does), else the venue's page. Neither is a write.
 *
 * SAFETY, as on iOS: development builds only (`fixtureArg` is null in a
 * release bundle), reachable only through the variable, and it makes NO
 * request: the session is seeded with the state a re-check and a preview
 * would leave it in, and the sheet's own re-check is skipped. Confirm is
 * never sent anywhere either: the fixture session's create and payment
 * calls are refused on the phone, so a stray tap reads as a failed booking
 * and nothing reaches the server. iOS's other two variants (`refusal`,
 * `classpay`) run the real sheet against an in-process stub server, which
 * the Android booking calls have no seam for yet; they open nothing here.
 */
import type { ActivityClass, BookingPreview } from '../../../api/bookings';
import { fixtureArg } from '../../../dev/fixtures';
import { addServerDays, todayServerDay } from '../../../i18n/format';
import { gateRefusalForCode, type BookingSessionStore, type CreateBookingSessionOptions } from '../../booking';
import type { ClassOccurrence } from '../model/occurrence';
import { toBookingOccurrence } from './model';

export const CLASS_SHEET_FIXTURE_VARIANTS = ['included', 'surcharge', 'full', 'noplan'] as const;

export type ClassSheetFixtureVariant = (typeof CLASS_SHEET_FIXTURE_VARIANTS)[number];

/** The fixture session's id: only this occurrence is ever seeded. */
export const CLASS_SHEET_FIXTURE_ID = 'screenshot-class-sheet';

/** The variant this development build was started with, or null (always null in release). */
export function classSheetFixtureVariant(): ClassSheetFixtureVariant | null {
  const value = fixtureArg('classSheet');
  return (CLASS_SHEET_FIXTURE_VARIANTS as readonly string[]).includes(value ?? '') ? (value as ClassSheetFixtureVariant) : null;
}

/** The fixture opens once per run, not again when the tabs remount. */
let fixtureTaken = false;

/** The variant to open now: once per run, then null. */
export function takeClassSheetFixture(): ClassSheetFixtureVariant | null {
  const variant = classSheetFixtureVariant();
  if (!variant || fixtureTaken) return null;
  fixtureTaken = true;
  return variant;
}

/** For tests: the fixture may open again. */
export function resetClassSheetFixtureForTests(): void {
  fixtureTaken = false;
}

/** Tomorrow 10:00 to 11:00 Reykjavík: Yoga Flow at Hress (iOS's own fixture values). */
export function classSheetFixtureOccurrence(variant: ClassSheetFixtureVariant, now: Date = new Date()): ClassOccurrence {
  const tomorrow = addServerDays(todayServerDay(now), 1) ?? todayServerDay(now);
  const startsAt = new Date(`${tomorrow}T10:00:00Z`);
  return {
    id: CLASS_SHEET_FIXTURE_ID,
    activity: { id: '5f0c2a1e-7b3d-4c8e-9a6f-1d2e3f4a5b6c', name: 'Hress', provider: 'abler' },
    venueId: null,
    venueSlug: 'hress',
    handle: { kind: 'ablerClass', eventId: 4242 },
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    className: 'Yoga Flow',
    venueName: 'Hress',
    instructor: 'Sigrún Jónsdóttir',
    room: 'Salur 3',
    surchargeFromIsk: variant === 'surcharge' ? 1_990 : null,
    snapshot: {
      canBook: true,
      canBookReason: null,
      full: false,
      attendanceCurrent: 9,
      attendanceLimit: 14,
      registrationOpensAt: null,
    },
  };
}

/** Whether `occurrence` is the fixture's (and a fixture build asked for it). */
export function isClassSheetFixture(occurrence: Pick<ClassOccurrence, 'id'>): ClassSheetFixtureVariant | null {
  if (occurrence.id !== CLASS_SHEET_FIXTURE_ID) return null;
  return classSheetFixtureVariant();
}

const refused = (): Promise<never> => Promise.reject(new Error('The class sheet fixture never books.'));

/** The fixture session's calls: nothing is ever sent. */
export const CLASS_SHEET_FIXTURE_SESSION: CreateBookingSessionOptions = {
  deps: {
    fetchClasses: refused,
    fetchAvailability: refused,
    fetchBookingPreview: refused,
    createBooking: refused,
    createPaymentSession: refused,
  },
};

/** Puts the sheet's session in the variant's state, as a re-check and a preview would. */
export function seedClassSheetFixture(store: BookingSessionStore, occurrence: ClassOccurrence, variant: ClassSheetFixtureVariant): void {
  const full = variant === 'full';
  const selectedClass: ActivityClass = {
    eventId: 4242,
    name: occurrence.className,
    description: null,
    start: occurrence.startsAt,
    end: occurrence.endsAt ?? occurrence.startsAt,
    coaches: [],
    attendance: { current: full ? 14 : 9, limit: 14 },
    full,
    canBook: !full,
    canBookReason: full ? 'class_full' : null,
    registrationOpensAt: null,
    room: occurrence.room,
  };
  const free: BookingPreview = {
    kind: 'free',
    topupReason: null,
    surchargeReason: null,
    priceIsk: null,
    remainingMonthly: 7,
    isLastBeforeTopUp: false,
    breakdown: null,
    visitChoice: null,
  };
  const surcharge: BookingPreview = { ...free, kind: 'surcharge', surchargeReason: 'boutique_access', priceIsk: 1_990, remainingMonthly: null };
  const booking = toBookingOccurrence(occurrence);
  store.setState({
    occurrence: booking,
    activity: booking.activity,
    currentStep: 2,
    selectedClass,
    occurrenceStatus: full ? 'notBookable' : 'ready',
    gateRefusal: variant === 'noplan' ? gateRefusalForCode('no_active_plan_or_pass', null, 403) : null,
    preview: variant === 'surcharge' ? surcharge : variant === 'included' ? free : null,
    isLoadingPreview: false,
  });
}
