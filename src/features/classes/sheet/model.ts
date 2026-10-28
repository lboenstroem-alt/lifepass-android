/**
 * The class sheet's own rules, as pure functions of the booking session and a
 * language: the iOS `ClassBookingSheet` computed properties,
 * `ClassSheetPriceLine` and `ClassSheetHeight`
 * (Views/Booking/ClassBookingSheet.swift). The sheet (./ClassBookingSheet.tsx)
 * draws them; the tests read the same sentences.
 *
 * Everything that books (the re-check, the preview, consent, the pay rail,
 * refusals) is the booking core's (src/features/booking); this file only
 * says what the sheet SHOWS for where the session stands.
 */
import { coachNames, type ActivityClass, type AvailabilitySlot } from '../../../api/bookings';
import { bookingProvider } from '../../../api/walkInPreview';
import { iskPrefix, translate, VenueTimeFormat, type Lang } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import {
  bookingCopy,
  confirmChargeIsk,
  isNotOpenReason,
  type BookingOccurrence,
  type BookingSessionState,
  type GateRefusal,
  type OccurrenceStatus,
} from '../../booking';
import type { BookingFlowActivity, BookingFlowParams } from '../../../navigation/types';
import type { ClassOccurrence } from '../model/occurrence';

// ---------------------------------------------------------------------------
// The session the booking core books

/**
 * The feed's (or a Coach plan's) session as the booking core books it: the
 * same activity, handle, times and snapshot. The provider string becomes the
 * core's provider (null is the venue's own, first-party booking).
 */
export function toBookingOccurrence(occurrence: ClassOccurrence): BookingOccurrence {
  return {
    activity: {
      id: occurrence.activity.id,
      name: occurrence.activity.name,
      provider: bookingProvider(occurrence.activity.provider ?? 'internal'),
    },
    handle: occurrence.handle,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    className: occurrence.className,
    instructor: occurrence.instructor,
    snapshot: occurrence.snapshot,
  };
}

// ---------------------------------------------------------------------------
// The header

type Selection = Pick<BookingSessionState, 'selectedClass' | 'selectedSlot'>;

/** The class's name: the feed's, else the re-checked session's, else "Class". */
export function sheetClassName(occurrence: Pick<ClassOccurrence, 'className'>, s: Selection, lang: Lang): string {
  const fresh = s.selectedClass?.name ?? s.selectedSlot?.title ?? null;
  return occurrence.className ?? fresh ?? translate('classes.unnamed', lang);
}

/**
 * "Thu 25 Sep, 10:00–11:00" in the venue's clock and the account's language.
 * The end only when it is after the start (a Coach slot may not know it yet).
 */
export function whenLine(start: Date, end: Date | null, lang: Lang): string {
  let line = VenueTimeFormat.dayTime(start, lang);
  if (end && end.getTime() > start.getTime()) line += `–${VenueTimeFormat.time(end)}`;
  return line;
}

/** The first instructor anyone names: the feed row, the class's coaches, the slot's provider. */
export function instructorLine(occurrence: Pick<ClassOccurrence, 'instructor'>, s: Selection): string | null {
  const candidates = [
    occurrence.instructor,
    s.selectedClass ? coachNames(s.selectedClass) : null,
    s.selectedSlot?.instructor ?? null,
  ];
  return candidates.find((candidate): candidate is string => !!candidate) ?? null;
}

/** "{count} spots left", from the re-checked session, once it is known to be open. */
export function spotsLine(status: OccurrenceStatus, s: Selection, lang: Lang): string | null {
  if (status !== 'ready') return null;
  const klass = s.selectedClass;
  if (klass && klass.attendance.limit > 0) {
    const left = Math.max(klass.attendance.limit - klass.attendance.current, 0);
    return translate('booking.spots_left', lang, { count: `${left}` });
  }
  const left = s.selectedSlot?.remainingCapacity;
  if (left != null) return translate('booking.spots_left', lang, { count: `${left}` });
  return null;
}

/**
 * The header as TalkBack reads it, one element: "Yoga Flow at Hress, Thu 25
 * Sep, 10:00–11:00", then the instructor and the spots (iOS reads those as
 * the element's value, after the label).
 */
export function headerAccessibilityLabel(
  parts: { readonly name: string; readonly venue: string; readonly when: string },
  details: readonly (string | null)[],
  lang: Lang,
): string {
  const label = translate('classsheet.summary_a11y', lang, parts);
  const value = details.filter((detail): detail is string => !!detail).join(', ');
  return value ? `${label}, ${value}` : label;
}

// ---------------------------------------------------------------------------
// The session's own state

/**
 * "Registration hasn't opened" is a neutral state, not an error: the
 * timetable's own rule.
 */
export function isNotOpenYet(status: OccurrenceStatus, selectedClass: Pick<ActivityClass, 'canBookReason'> | null): boolean {
  return status === 'notBookable' && isNotOpenReason(selectedClass?.canBookReason);
}

/**
 * The note is a sentence, not the timetable's one-word chip ("Full"): the
 * create call's own refusal copy, except "Registration opens {time}", which
 * only the chip label can say.
 */
export function notBookableSentence(
  klass: Pick<ActivityClass, 'canBookReason' | 'registrationOpensAt' | 'full'>,
  lang: Lang,
  now: Date = new Date(),
): string {
  switch (klass.canBookReason) {
    case 'event_not_open':
    case 'outside_registration_window':
      if (klass.registrationOpensAt && klass.registrationOpensAt.getTime() > now.getTime()) {
        return bookingCopy(lang).notBookableLabel(klass, now);
      }
      return translate('booking.class.err_not_open', lang);
    case 'class_full':
      return translate('booking.class.err_full', lang);
    default:
      return klass.full ? translate('booking.class.err_full', lang) : translate('classsheet.unavailable', lang);
  }
}

/** What the status note says (empty for the states that show none). */
export function statusText(
  status: OccurrenceStatus,
  s: { readonly selectedClass: ActivityClass | null; readonly selectedSlot: Pick<AvailabilitySlot, 'remainingCapacity'> | null },
  lang: Lang,
  now: Date = new Date(),
): string {
  switch (status) {
    case 'started':
      return translate('booking.class.err_passed', lang);
    case 'gone':
      return translate('classsheet.gone', lang);
    case 'notBookable':
      if (s.selectedClass) return notBookableSentence(s.selectedClass, lang, now);
      if (s.selectedSlot) {
        return s.selectedSlot.remainingCapacity === 0
          ? translate('booking.class.err_full', lang)
          : translate('classsheet.unavailable', lang);
      }
      return translate('classsheet.unavailable', lang);
    case 'unresolved':
      return translate('classsheet.load_error', lang);
    case 'idle':
    case 'checking':
    case 'ready':
      return '';
  }
}

/** The states the sheet announces once the re-check has answered (iOS `announce(_:)`). */
export function announcesStatus(status: OccurrenceStatus): boolean {
  return status === 'started' || status === 'gone' || status === 'notBookable' || status === 'unresolved';
}

/**
 * "See other times" is offered whenever this session can't be booked from
 * here, except a membership refusal, whose answer is the plans step, not
 * another time, and a refusal whose own button already says "Choose another
 * time".
 */
export function showsOtherTimes(status: OccurrenceStatus, gateRefusal: GateRefusal | null): boolean {
  switch (status) {
    case 'started':
    case 'gone':
    case 'notBookable':
    case 'unresolved':
      return true;
    case 'ready':
      return gateRefusal ? gateRefusal.cta !== 'seePlans' && gateRefusal.cta !== 'chooseAnotherTime' : false;
    case 'idle':
    case 'checking':
      return false;
  }
}

/**
 * Confirm is HIDDEN (not just disabled) when the answer is already no: a
 * gate refusal or a session that can't be booked, exactly as the full flow
 * hides it for a refusal. Shown, and disabled, while the session is checked.
 */
export function showsConfirm(status: OccurrenceStatus, gateRefusal: GateRefusal | null): boolean {
  if (gateRefusal) return false;
  switch (status) {
    case 'idle':
    case 'checking':
    case 'ready':
      return true;
    case 'started':
    case 'gone':
    case 'notBookable':
    case 'unresolved':
      return false;
  }
}

// ---------------------------------------------------------------------------
// The price line above Confirm (iOS ClassSheetPriceLine)

/**
 * The line pinned above Confirm: what Confirm charges. "ISK 1,990 charged
 * when you confirm" / "ISK 1,990 gjaldfært þegar þú staðfestir" for a
 * disclosed surcharge or top-up (the selected rung's amount, a group's
 * total, the server's own offer once it made one), in the app's one money
 * format. When the disclosure failed, the feed row's "Surcharge from ISK
 * 1,990" stands in, and the create call's consent names the exact amount.
 * Nothing for an included or pass visit.
 */
export function priceLineText(chargeIsk: number | null, surchargeFromIsk: number | null, lang: Lang): string | null {
  if (chargeIsk != null) return translate('classsheet.price_line', lang, { price: iskPrefix(chargeIsk) });
  if (surchargeFromIsk != null) return translate('classes.surcharge_from', lang, { price: iskPrefix(surchargeFromIsk) });
  return null;
}

/**
 * Confirm's TalkBack label: "Confirm booking: Yoga Flow, Wed 7 Oct,
 * 10:00–11:00. ISK 1,990 charged when you confirm". The price line is a
 * separate element above the button, so without this a TalkBack user already
 * on Confirm could book without hearing the amount.
 */
export function confirmAccessibilityLabel(base: string, priceLine: string | null): string {
  return priceLine ? `${base}. ${priceLine}` : base;
}

/**
 * The feed's "surcharge from" figure stands in for the amount only while the
 * server has no disclosure to say it properly (the preview failed). The
 * create call still asks for consent to the real amount.
 */
export function showsSurchargeHint(
  surchargeFromIsk: number | null,
  s: Pick<BookingSessionState, 'preview' | 'isLoadingPreview' | 'gateRefusal'>,
): boolean {
  return surchargeFromIsk != null && s.preview == null && !s.isLoadingPreview && s.gateRefusal == null;
}

/** The line for the session as it stands, or null (only a ready session has one). */
export function sheetPriceLine(
  s: Pick<
    BookingSessionState,
    'occurrenceStatus' | 'gateRefusal' | 'isLoadingPreview' | 'offeredChargeIsk' | 'preview' | 'activity' | 'visitChoice'
  >,
  surchargeFromIsk: number | null,
  lang: Lang,
): string | null {
  if (s.occurrenceStatus !== 'ready') return null;
  return priceLineText(confirmChargeIsk(s), showsSurchargeHint(surchargeFromIsk, s) ? surchargeFromIsk : null, lang);
}

// ---------------------------------------------------------------------------
// How tall the sheet may be (iOS ClassSheetHeight)

/**
 * The amount rides the bar with Confirm, so half height can never hide it,
 * and a single charge disclosure needs no more. Full height is kept where the
 * sheet genuinely needs the room:
 * - at the accessibility text sizes it is the ONLY height: the header alone
 *   fills half the screen there, and a half-height sheet would leave the bar
 *   no room;
 * - it opens out for the premium rung picker, two priced choices to compare.
 */
export const ClassSheetHeight = {
  /** The heights the sheet may rest at (iOS detents: medium and large, or large only). */
  snapPoints(accessibilitySize: boolean): string[] {
    return accessibilitySize ? ['100%'] : ['50%', '100%'];
  },
  expands(ready: boolean, refused: boolean, offersVisitChoice: boolean): boolean {
    return ready && !refused && offersVisitChoice;
  },
} as const;

// ---------------------------------------------------------------------------
// "See other times"

/** Where "See other times" goes: the full flow on the session's day, or the venue's page. */
export type OtherTimesTarget =
  | { readonly route: 'BookingFlow'; readonly params: BookingFlowParams }
  | { readonly route: 'VenueDetail'; readonly params: { readonly slug: string } };

/**
 * The full booking flow for this activity, opened on the session's day's
 * timetable (today's when it has started: a day in the past is never
 * offered); Back reaches the date picker. A session whose venue id is not
 * known (a Coach plan's own handle) opens the venue's page instead, whose
 * timetable books it.
 */
export function otherTimesTarget(
  occurrence: Pick<ClassOccurrence, 'activity' | 'venueId' | 'venueSlug' | 'startsAt'>,
  now: Date = new Date(),
  venueIdForSlug: (slug: string) => string | null = () => null,
): OtherTimesTarget | null {
  const venueId = occurrence.venueId ?? (occurrence.venueSlug ? venueIdForSlug(occurrence.venueSlug) : null);
  if (venueId) {
    const day = VenueTimeFormat.day(occurrence.startsAt);
    const today = todayServerDay(now);
    const activity: BookingFlowActivity = {
      id: occurrence.activity.id,
      name: occurrence.activity.name,
      provider: occurrence.activity.provider,
    };
    return { route: 'BookingFlow', params: { venueId, activity, initialDate: day < today ? today : day } };
  }
  if (occurrence.venueSlug) return { route: 'VenueDetail', params: { slug: occurrence.venueSlug } };
  return null;
}
