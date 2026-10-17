/**
 * One booking attempt's state machine: the Android port of iOS
 * `BookingViewModel` (ViewModels/BookingViewModel.swift). The full booking
 * flow (./BookingFlowScreen.tsx) and the class sheet (CLASS-2) each make one
 * with `createBookingSession()` and drive it the same way, so every money
 * path (consent, the 402 re-offer, the pay-and-save-card rail, the refusals)
 * is written once.
 *
 * THE RULES IT KEEPS (each is a member's money or seat):
 *
 * - ONE KEY, ONE ATTEMPT. One Idempotency-Key covers one attempt: it is
 *   reused across retries, the consent re-POST and the payment session, and
 *   cleared only on a booking that landed, a new selection,
 *   `booking_not_replayable`, a definitive decline, or a payment that ended
 *   with nothing to resume (unpaid, refunded, expired, never opened).
 * - A 2xx IS NOT A SEAT. Only `confirmed` or `checked_in` is booked;
 *   anything else (`pending`: the capture is still resolving, or stranded)
 *   is "Confirming your payment", with no reminder.
 * - NO ANSWER IS NOT "FAILED". A timeout, or a gateway's own 502, 503 or 504
 *   page, may still book and charge: "Still waiting for an answer" with Check
 *   again, which re-sends the identical body under the same key.
 * - THE SERVER'S WORDS ARE NEVER SHOWN. Every refusal reads through the
 *   refusal table (src/api/refusals.ts); a row that blocks (or whose step
 *   leaves the attempt) goes inline in place of the disclosure with Confirm
 *   hidden, a passing one is an alert whose second button is its step.
 * - ONE ATTEMPT AT A TIME. `bookingInProgress` (creating, the consent up, the
 *   payment page open or settling, a timed-out create waiting) refuses a
 *   second Confirm and holds the screen (src/navigation/guards.ts
 *   `useBusyGuard`): leaving would still book, but with no alert, no
 *   reminder and no refresh behind it.
 *
 * ANDROID'S PAYMENT PAGE. iOS sets `bookingPayURL`, its view opens a Safari
 * cover and settles it on return. Here F8's `payOnHostedPage`
 * (src/payments/attempts.ts) saves the attempt, opens the Custom Tab and
 * settles it (five answers on Done, one after the cancel link) in one call,
 * so the page survives Android closing the app behind it; `bookingPayOpen`
 * stands in for `bookingPayURL != nil`.
 *
 * Everything the store calls out to is a dependency (`BookingSessionDeps`),
 * so the money paths run in tests against the stub server.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  coachNames as classCoachNames,
  createBooking,
  fetchAvailability,
  fetchBookingPreview,
  fetchClasses,
  isClassBookable,
  makeSlot,
  requiresCharge,
  withConsent,
  type ActivityClass,
  type AgeBandOffer,
  type AvailabilitySlot,
  type BookingPreview,
  type CreateBookingInput,
  type VisitChoiceOption,
} from '../../api/bookings';
import { refusalFor, refusalMessage } from '../../api/errorFormatter';
import { HttpStatusError, isProblem, ProblemError, TransportError, type ChargeConsentOffer } from '../../api/errors';
import { newIdempotencyKey } from '../../api/idempotency';
import {
  isKnownRefusal,
  normaliseRefusalCode,
  specificRefusal,
  type MemberRefusal,
  type RefusalCta,
} from '../../api/refusals';
import { usesClasses as providerUsesClasses, type BookableActivity } from '../../api/walkInPreview';
import { toWireDate } from '../../api/wire';
import { currentLanguage, translate, VenueTimeFormat, type Lang } from '../../i18n';
import { addServerDays, todayServerDay } from '../../i18n/format';
import {
  checkPaymentAgain,
  classifySessionCreateError,
  createPaymentSession,
  keyDisposition,
  leaveAttempt,
  payOnHostedPage,
  settlePaymentSession,
  type AttemptRef,
  type BookingAttemptContext,
  type BookingPayOutcome,
  type HostedPayResult,
  type PaymentSessionCreation,
  type PaymentSessionInput,
  type PaySettlement,
} from '../../payments';
import { useAppStore } from '../../stores/appStore';
import { scheduleCheckInReminder } from '../bookings';

// ---------------------------------------------------------------------------
// Types

/** The activity being booked (from the walk-in preview's `slotActivities`). */
export type BookingActivity = BookableActivity;

/** The venue, as far as the screen knows it (for the confirm card and the payment record). */
export interface BookingVenue {
  readonly id: string;
  readonly name: string | null;
  readonly slug: string | null;
}

/**
 * A refusal shown in place of the charge disclosure, with Confirm hidden: the
 * refusal row's words and its next step (iOS `GateRefusal`).
 */
export interface GateRefusal {
  readonly messageKey: string;
  readonly cta: RefusalCta | null;
}

/** Membership-shaped: the answer is the plans page. */
export function needsMembership(refusal: GateRefusal | null): boolean {
  return refusal?.cta === 'seePlans';
}

/**
 * The step leaves the screen for something that can change the answer (a
 * plan bought, an identity verified, a membership resumed, a deletion
 * cancelled), so coming back checks the same selection again.
 */
export function rechecksAfterStep(refusal: GateRefusal | null): boolean {
  switch (refusal?.cta) {
    case 'seePlans':
    case 'verifyIdentity':
    case 'resumeMembership':
    case 'manageMembership':
    case 'cancelDeletion':
      return true;
    default:
      return false;
  }
}

/**
 * Where the class sheet's single session stands (iOS `OccurrenceStatus`).
 * Only `ready` offers Confirm. `idle` in the full flow.
 */
export type OccurrenceStatus = 'idle' | 'checking' | 'ready' | 'started' | 'gone' | 'notBookable' | 'unresolved';

/** The feed's registration state for a session, used only until the day's timetable answers. */
export interface OccurrenceSnapshot {
  readonly canBook: boolean | null;
  readonly canBookReason: string | null;
  readonly full: boolean;
  readonly attendanceCurrent: number | null;
  readonly attendanceLimit: number | null;
  readonly registrationOpensAt: Date | null;
}

/**
 * One dated session the class sheet books (iOS `ClassOccurrence`, the fields
 * the view model reads). CLASS-2 maps its feed rows and Coach plan classes
 * onto it.
 */
export interface BookingOccurrence {
  readonly activity: BookingActivity;
  /** An Abler class by its event; a first-party class by its slot times. */
  readonly handle: { readonly kind: 'ablerClass'; readonly eventId: number } | { readonly kind: 'slot' };
  readonly startsAt: Date;
  /** Null only for a Coach plan's slot handle: the re-check then supplies it. */
  readonly endsAt: Date | null;
  readonly className: string | null;
  readonly instructor: string | null;
  readonly snapshot: OccurrenceSnapshot | null;
}

export type BookingStep = 0 | 1 | 2;

export interface BookingSessionState {
  readonly activity: BookingActivity | null;
  readonly venue: BookingVenue | null;

  /** The venue day the timetable shows (`YYYY-MM-DD`, Reykjavík). */
  readonly selectedDay: string;
  readonly availableSlots: readonly AvailabilitySlot[];
  readonly selectedSlot: AvailabilitySlot | null;
  readonly classes: readonly ActivityClass[];
  readonly selectedClass: ActivityClass | null;

  readonly preview: BookingPreview | null;
  readonly isLoadingPreview: boolean;

  /** The 402 offer being consented to. */
  readonly pendingOffer: ChargeConsentOffer | null;
  readonly showChargeConsent: boolean;
  /** A second 402 replaced the offer with a DIFFERENT price: the consent says so first. */
  readonly offerWasReoffered: boolean;
  /**
   * The amount the server last offered for THIS selection. It is what the
   * member consents to and the session charges, so the price line shows it
   * over the preview's figure from the moment it arrives, and keeps it after
   * a declined consent. Cleared when the price is read again or the
   * selection changes.
   */
  readonly offeredChargeIsk: number | null;

  /** A refusal from the preview or the create, drawn in place of the disclosure with Confirm hidden. */
  readonly gateRefusal: GateRefusal | null;
  /**
   * `402 no_payment_method_on_file` the pay rail cannot take: a server older
   * than web 906f07f8 refuses a class on the session, or the selection lost a
   * datum the session needs. 2.5.4's "add a card" answer.
   */
  readonly needsPaymentMethod: boolean;
  /** The alert's words (already in the language on screen), or null. */
  readonly error: string | null;
  /** The step offered with `error` (the alert's second button); cleared with it. */
  readonly errorCta: RefusalCta | null;

  /** The hosted payment page is opening, open or being settled (iOS `bookingPayURL != nil`). */
  readonly bookingPayOpen: boolean;
  /** A pay-rail ending the screen shows as an alert (a fulfilled one is `bookingComplete`). */
  readonly payOutcome: BookingPayOutcome | null;
  /** The page never came up: the outcome's OK closes the screen. */
  readonly payPageNeverOpened: boolean;

  readonly currentStep: BookingStep;
  /** The timetable is loading. */
  readonly isLoading: boolean;
  /** The create, the session or the confirm is running. */
  readonly isBooking: boolean;
  readonly bookingComplete: boolean;
  /** The booking that landed was paid (saved card with consent, or the page). Set with `bookingComplete`. */
  readonly bookingWasPaid: boolean;
  /** Accepted, not yet confirmed (`pending`): never told a seat is held. */
  readonly bookingPendingConfirmation: boolean;
  /** The create timed out (or a gateway gave up): it may still go through. */
  readonly bookingOutcomeUnknown: boolean;

  /** People on the booking INCLUDING the member (1 to 10; above 1 only for Bókun slots). */
  readonly participants: number;
  /** The bands this venue sells (from the availability answer). */
  readonly offeredAgeBands: readonly AgeBandOffer[];
  /** One band per GUEST seat; index 0 is the second person. */
  readonly guestAgeBands: readonly string[];
  /** The premium rung picked; null follows the server's default. */
  readonly visitChoice: string | null;

  /** The class sheet's single session; null in the full flow. */
  readonly occurrence: BookingOccurrence | null;
  readonly occurrenceStatus: OccurrenceStatus;

  /** The attempt's key (see the file comment). */
  readonly idempotencyKey: string | null;
  /** The last body sent, for Check again. */
  readonly lastSubmittedInput: CreateBookingInput | null;
  /** A payment still settling that this screen holds for Check again (F8). */
  readonly heldAttempt: AttemptRef | null;
}

export interface BookingSessionActions {
  setActivity(activity: BookingActivity | null): void;
  setVenue(venue: BookingVenue | null): void;
  selectDay(day: string): void;
  selectSlot(slot: AvailabilitySlot | null): void;
  selectClass(klass: ActivityClass | null): void;
  resetParty(): void;
  changeParticipants(next: number): Promise<void>;
  changeGuestAgeBand(index: number, band: string): Promise<void>;
  changeVisitChoice(next: string): Promise<void>;
  loadTimetable(): Promise<void>;
  loadPreview(): Promise<void>;
  confirmBooking(): Promise<void>;
  acceptCharge(): Promise<void>;
  declineCharge(): void;
  checkBookingAgain(): Promise<void>;
  /** "Still waiting" dismissed with Cancel: the key is kept, Confirm resends under it. */
  dismissOutcomeUnknown(): void;
  retryAfterRefusal(): Promise<void>;
  returnToTimetable(keepingSelection: boolean): void;
  recheckAfterPlans(): Promise<void>;
  /** "Check again" on "Confirming your payment": the same key, the Done leg. */
  confirmBookingPayment(): Promise<void>;
  /** The pay outcome alert closed. A payment still settling goes back to F8's recovery. */
  dismissPayOutcome(): void;
  dismissError(): void;
  dismissNeedsPaymentMethod(): void;
  /** The confirmed or pending alert closed. */
  dismissBooked(): void;
  prepare(occurrence: BookingOccurrence): Promise<void>;
  refreshOccurrence(): Promise<void>;
  retryOccurrence(): Promise<void>;
  tickOccurrence(now?: Date): void;
  nextStep(): void;
  previousStep(): void;
  openOnTimetable(day: string): void;
  /** False once the screen is gone: a payment outcome is then shown by F8's presenter. */
  setScreenAlive(alive: () => boolean): void;
}

export type BookingSession = BookingSessionState & BookingSessionActions;
export type BookingSessionStore = StoreApi<BookingSession>;

/** Everything the session calls out to (the defaults are the app's). */
export interface BookingSessionDeps {
  readonly fetchAvailability: typeof fetchAvailability;
  readonly fetchClasses: typeof fetchClasses;
  readonly fetchBookingPreview: typeof fetchBookingPreview;
  readonly createBooking: typeof createBooking;
  readonly createPaymentSession: (input: PaymentSessionInput, key: string) => Promise<PaymentSessionCreation>;
  readonly payOnHostedPage: typeof payOnHostedPage;
  readonly checkPaymentAgain: typeof checkPaymentAgain;
  readonly leaveAttempt: typeof leaveAttempt;
  readonly settlePaymentSession: typeof settlePaymentSession;
  readonly newKey: () => string;
  readonly now: () => Date;
  /** The signed-in member (the payment record is theirs). */
  readonly memberId: () => string | null;
  /** The account language, for the reminders written at booking time. */
  readonly language: () => Lang;
  /** iOS `appState.refreshCredits()` after a paid booking. */
  readonly refreshCredits: () => Promise<void>;
  readonly scheduleCheckInReminder: typeof scheduleCheckInReminder;
}

const defaultDeps: BookingSessionDeps = {
  fetchAvailability,
  fetchClasses,
  fetchBookingPreview,
  createBooking,
  createPaymentSession,
  payOnHostedPage,
  checkPaymentAgain,
  leaveAttempt,
  settlePaymentSession,
  newKey: newIdempotencyKey,
  now: () => new Date(),
  memberId: () => {
    const { userId, profile } = useAppStore.getState();
    return userId ?? profile?.id ?? null;
  },
  language: () => currentLanguage(),
  refreshCredits: () => useAppStore.getState().refreshCredits(),
  scheduleCheckInReminder,
};

// ---------------------------------------------------------------------------
// The tables (iOS statics, kept exactly)

/**
 * A gateway's own 502, 503 or 504 (an HTML page, never a problem): the
 * create's outcome is unknown, as on a timeout. A problem with one of these
 * statuses is the server's answer and goes through the table.
 */
export const GATEWAY_GAVE_UP_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * The saved card's definitive declines (402): the server billed nothing and
 * ended that attempt. The payment provider answers a repeated key with that
 * first, declined intent, so "Try again" under the same key would be declined
 * forever: the next Confirm is a new attempt under a new key. A money state
 * that is not certain (`kling_capture_failed`, `booking_charge_unresolved`)
 * keeps its key.
 */
export const DECLINED_ATTEMPT_CODES: ReadonlySet<string> = new Set([
  'surcharge_charge_failed',
  'topup_charge_failed',
  'charge_capture_failed',
  'card_declined',
  'charge_declined',
  'charge_rejected',
  'payment_intent_failed',
]);

/** The prices a stale rung or offer is refused with: the member sees the new price and confirms again. */
export const PRICE_MOVED_CODES: ReadonlySet<string> = new Set([
  'visit_choice_unavailable',
  'visit_choice_not_applicable',
  'booking_payment_option_conflict',
]);

/**
 * A refusal the booking PREVIEW alone may block on (`blocksAtPreview` rows),
 * or null for everything else (429, 5xx, `invalid_*`, an unknown code, a
 * money state), which leaves Confirm up so the create stays the gate.
 */
export function gateRefusalForCode(code: string, reason: string | null = null, status = 409): GateRefusal | null {
  const row = specificRefusal(code, reason, status);
  if (!row || !row.blocksAtPreview) return null;
  return { messageKey: row.messageKey, cta: row.cta };
}

/**
 * True when a create refusal replaces the disclosure (Confirm hidden): a
 * known row that blocks, or whose step leaves this attempt (anything but
 * "Try again").
 */
export function refusalGoesInline(refusal: MemberRefusal, known: boolean): boolean {
  if (!known) return false;
  if (refusal.blocksAtPreview) return true;
  if (!refusal.cta) return false;
  return refusal.cta !== 'tryAgain';
}

/** `slot_unavailable` with its provider `reason` (the class pre-flight), as the panel shows it. */
export function classRefusal(code: string, reason: string | null): GateRefusal | null {
  if (normaliseRefusalCode(code) !== 'slot_unavailable') return null;
  const row = specificRefusal(code, reason, 409);
  return row ? { messageKey: row.messageKey, cta: row.cta } : null;
}

/** iOS `occurrenceStatus(startsAt:bookable:now:)`. */
export function occurrenceStatusFor(startsAt: Date, bookable: boolean, now: Date = new Date()): OccurrenceStatus {
  if (startsAt.getTime() <= now.getTime()) return 'started';
  return bookable ? 'ready' : 'notBookable';
}

// ---------------------------------------------------------------------------
// Derived values (iOS computed properties), as functions of the state

type State = BookingSessionState;

export function usesClasses(s: Pick<State, 'activity'>): boolean {
  return s.activity ? providerUsesClasses(s.activity.provider) : false;
}

/** Bókun slot activities only: the stepper renders there, and the server refuses the rest. */
export function groupBookable(s: Pick<State, 'activity'>): boolean {
  return s.activity?.provider === 'bokun' && !usesClasses(s);
}

/** Whether the per-guest band picker shows at all. */
export function showsAgeBands(s: Pick<State, 'activity' | 'offeredAgeBands' | 'participants'>): boolean {
  return groupBookable(s) && s.offeredAgeBands.length > 1 && s.participants > 1;
}

/** The bands sent on preview and create; null when every guest is an adult (byte-identical to no bands). */
export function guestAgeBandsForRequest(
  s: Pick<State, 'activity' | 'offeredAgeBands' | 'participants' | 'guestAgeBands'>,
): string[] | null {
  if (!showsAgeBands(s) || !s.guestAgeBands.some((band) => band !== 'adult')) return null;
  return [...s.guestAgeBands];
}

/** The rungs the server offered; never for a class (the API refuses a rung beside an `eventId`). */
const NO_OPTIONS: readonly VisitChoiceOption[] = Object.freeze([]);

export function visitChoiceOptions(s: Pick<State, 'activity' | 'preview'>): readonly VisitChoiceOption[] {
  // One empty list, so a selector reading this returns the same value twice.
  if (usesClasses(s)) return NO_OPTIONS;
  return s.preview?.visitChoice?.options ?? NO_OPTIONS;
}

export function selectedVisitChoice(s: Pick<State, 'visitChoice' | 'preview'>): string {
  return s.visitChoice ?? s.preview?.visitChoice?.selected ?? 'spend_visit';
}

/** Everything disclosed or consented reads the SELECTED rung, never the top-level mirror. */
export function selectedVisitOption(s: Pick<State, 'activity' | 'preview' | 'visitChoice'>): VisitChoiceOption | null {
  const chosen = selectedVisitChoice(s);
  return visitChoiceOptions(s).find((option) => option.choice === chosen) ?? null;
}

/** The amount the confirm and pay actions use. */
export function disclosedPriceIsk(s: Pick<State, 'activity' | 'preview' | 'visitChoice'>): number | null {
  return selectedVisitOption(s)?.priceIsk ?? s.preview?.priceIsk ?? null;
}

/**
 * The money Confirm will charge, for the line pinned above it: the server's
 * own offer once one came back, else the disclosed surcharge or top-up (the
 * selected rung's, a group's total). Null when the booking is included or uses
 * a pass, is refused, or the disclosure is loading, failed or names no amount.
 */
export function confirmChargeIsk(
  s: Pick<State, 'gateRefusal' | 'isLoadingPreview' | 'offeredChargeIsk' | 'preview' | 'activity' | 'visitChoice'>,
): number | null {
  if (s.gateRefusal || s.isLoadingPreview) return null;
  if (s.offeredChargeIsk != null && s.offeredChargeIsk > 0) return s.offeredChargeIsk;
  if (!s.preview) return null;
  if (!requiresCharge(s.preview) && !selectedVisitOption(s)) return null;
  const amount = disclosedPriceIsk(s);
  return amount != null && amount > 0 ? amount : null;
}

/** A slot or class is chosen: gates Next and Confirm. */
export function hasSelection(s: Pick<State, 'activity' | 'selectedClass' | 'selectedSlot'>): boolean {
  return usesClasses(s) ? s.selectedClass != null : s.selectedSlot != null;
}

/** The chosen start (slot or class). */
export function selectedStart(s: Pick<State, 'activity' | 'selectedClass' | 'selectedSlot'>): Date | null {
  return (usesClasses(s) ? s.selectedClass?.start : s.selectedSlot?.startTime) ?? null;
}

/** The session's start as the freshest data has it. */
export function occurrenceStart(s: Pick<State, 'activity' | 'selectedClass' | 'selectedSlot' | 'occurrence'>): Date | null {
  return selectedStart(s) ?? s.occurrence?.startsAt ?? null;
}

/** The session's end, likewise. Null only for an unresolved Coach slot. */
export function occurrenceEnd(s: Pick<State, 'activity' | 'selectedClass' | 'selectedSlot' | 'occurrence'>): Date | null {
  return (usesClasses(s) ? s.selectedClass?.end : s.selectedSlot?.endTime) ?? s.occurrence?.endsAt ?? null;
}

/**
 * Confirm is offered only for a re-checked, bookable session with no gate
 * refusal, never while the disclosure loads: a seeded (feed) selection is
 * never submitted mid-refresh.
 */
export function canConfirmOccurrence(
  s: Pick<State, 'occurrenceStatus' | 'gateRefusal' | 'activity' | 'selectedClass' | 'selectedSlot' | 'isBooking' | 'isLoadingPreview'>,
): boolean {
  return s.occurrenceStatus === 'ready' && !s.gateRefusal && hasSelection(s) && !s.isBooking && !s.isLoadingPreview;
}

/**
 * A booking is in flight or waiting on the member: the create or the
 * payment confirm is running, the consent is up, the payment page is open,
 * or a timed-out create waits for Check again. The screen must not be left
 * under it.
 */
export function bookingInProgress(
  s: Pick<State, 'isBooking' | 'showChargeConsent' | 'bookingPayOpen' | 'bookingOutcomeUnknown'>,
): boolean {
  return s.isBooking || s.showChargeConsent || s.bookingPayOpen || s.bookingOutcomeUnknown;
}

/**
 * Whether an appearance must load the opening day's timetable: opened on a
 * day, still on that timetable, and not loaded yet (iOS
 * `loadsInitialDayOnAppear`). Without it a flow opened on a day would spin
 * forever, since its step was 1 from the first frame.
 */
export function loadsInitialDayOnAppear(initialDate: string | null | undefined, step: number, alreadyLoaded: boolean): boolean {
  return !alreadyLoaded && !!initialDate && step === 1;
}

/** The create's body for the current selection, with the party and the rung (iOS `buildInput`). */
export function buildInput(
  s: Pick<State, 'activity' | 'selectedClass' | 'selectedSlot' | 'participants' | 'offeredAgeBands' | 'guestAgeBands' | 'visitChoice'>,
): CreateBookingInput | null {
  if (!s.activity) return null;
  if (usesClasses(s)) {
    if (!s.selectedClass) return null;
    return { kind: 'class', activityId: s.activity.id, eventId: s.selectedClass.eventId };
  }
  if (!s.selectedSlot) return null;
  return {
    kind: 'slot',
    activityId: s.activity.id,
    startsAt: s.selectedSlot.startTime,
    endsAt: s.selectedSlot.endTime,
    participants: groupBookable(s) && s.participants > 1 ? s.participants : null,
    guestAgeBands: guestAgeBandsForRequest(s),
    visitChoice: s.visitChoice,
  };
}

/** Is `day` (YYYY-MM-DD) before `other`? Server days compare as strings. */
function dayBefore(day: string, other: string): boolean {
  return day < other;
}

// ---------------------------------------------------------------------------
// The store

const INITIAL: Omit<BookingSessionState, 'selectedDay'> = {
  activity: null,
  venue: null,
  availableSlots: [],
  selectedSlot: null,
  classes: [],
  selectedClass: null,
  preview: null,
  isLoadingPreview: false,
  pendingOffer: null,
  showChargeConsent: false,
  offerWasReoffered: false,
  offeredChargeIsk: null,
  gateRefusal: null,
  needsPaymentMethod: false,
  error: null,
  errorCta: null,
  bookingPayOpen: false,
  payOutcome: null,
  payPageNeverOpened: false,
  currentStep: 0,
  isLoading: false,
  isBooking: false,
  bookingComplete: false,
  bookingWasPaid: false,
  bookingPendingConfirmation: false,
  bookingOutcomeUnknown: false,
  participants: 1,
  offeredAgeBands: [],
  guestAgeBands: [],
  visitChoice: null,
  occurrence: null,
  occurrenceStatus: 'idle',
  idempotencyKey: null,
  lastSubmittedInput: null,
  heldAttempt: null,
};

export interface CreateBookingSessionOptions {
  /** Start on this activity (the full flow). */
  readonly activity?: BookingActivity | null;
  readonly venue?: BookingVenue | null;
  /**
   * A venue day to open straight on (`YYYY-MM-DD`): the flow starts on that
   * day's timetable, marked loading, instead of the date picker (iOS
   * `BookingFlowView.initialModel`). A day in the past opens on today.
   */
  readonly initialDay?: string | null;
  readonly deps?: Partial<BookingSessionDeps>;
}

/** The selection's patch: changing the chosen slot drops the key, the refusal, the offer and the rung. */
function slotPatch(state: State, slot: AvailabilitySlot | null): Partial<State> {
  if (slot?.id === state.selectedSlot?.id) return { selectedSlot: slot };
  // A new booking target: the next create can't collide (server-side
  // (actor, key) idempotency) with a different slot's in-flight attempt. A
  // rung picked for the previous slot must not ride along either.
  return {
    selectedSlot: slot,
    idempotencyKey: null,
    gateRefusal: null,
    offerWasReoffered: false,
    offeredChargeIsk: null,
    visitChoice: null,
  };
}

function classPatch(state: State, klass: ActivityClass | null): Partial<State> {
  if (klass?.eventId === state.selectedClass?.eventId) return { selectedClass: klass };
  // Classes never carry a rung (the API refuses it with an eventId).
  return {
    selectedClass: klass,
    idempotencyKey: null,
    gateRefusal: null,
    offerWasReoffered: false,
    offeredChargeIsk: null,
    visitChoice: null,
  };
}

/** Keep the guest list exactly `participants - 1` long; grow with adults, shrink from the end. */
function syncedGuestBands(participants: number, bands: readonly string[]): string[] {
  const wanted = Math.max(0, participants - 1);
  if (bands.length > wanted) return bands.slice(0, wanted);
  return [...bands, ...Array<string>(wanted - bands.length).fill('adult')];
}

/** A new booking session (one per screen). */
export function createBookingSession(options: CreateBookingSessionOptions = {}): BookingSessionStore {
  const deps: BookingSessionDeps = { ...defaultDeps, ...options.deps };
  let isScreenAlive: () => boolean = () => true;
  // Only the latest read writes: a day changed, or the party re-priced, while
  // an earlier answer was still on its way.
  let timetableGeneration = 0;
  let previewGeneration = 0;

  const today = () => todayServerDay(deps.now());
  const initialDay = options.initialDay
    ? dayBefore(options.initialDay, today())
      ? today()
      : options.initialDay
    : today();

  return createStore<BookingSession>()((set, get) => {
    // --- Booked ----------------------------------------------------------

    /**
     * The booking landed. The check-in reminders are scheduled the moment it
     * does (iOS `BookingOutcomeHandling` on `bookingComplete`), with the
     * permission asked in context; never for a pending booking.
     */
    function markBooked(paid: boolean): void {
      set({ bookingWasPaid: paid, bookingComplete: true });
      const s = get();
      const startsAt = s.selectedClass?.start ?? s.selectedSlot?.startTime ?? null;
      if (!startsAt) return;
      void deps
        .scheduleCheckInReminder({
          className: s.selectedClass?.name ?? s.activity?.name ?? null,
          startsAt,
          language: deps.language(),
        })
        .catch(() => undefined);
    }

    /** A 402 offer (the create's or the session's): disclose it and ask again. */
    function reoffer(offer: ChargeConsentOffer): void {
      const previous = get().pendingOffer;
      set({
        offerWasReoffered: previous !== null && previous.amountIsk !== offer.amountIsk,
        pendingOffer: offer,
        offeredChargeIsk: offer.amountIsk,
        showChargeConsent: true,
      });
    }

    // --- Create ------------------------------------------------------------

    async function submit(input: CreateBookingInput): Promise<void> {
      set({ isBooking: true, error: null, errorCta: null, lastSubmittedInput: input });
      const key = get().idempotencyKey ?? deps.newKey();
      set({ idempotencyKey: key });
      try {
        const result = await deps.createBooking(input, key);
        // A 2xx is NOT proof the seat is held: a first-party booking is
        // created `pending` and flips to `confirmed` once the card capture
        // lands, and a strand stays `pending`. Only a truly booked status
        // closes the flow as booked.
        if (result.status === 'confirmed' || result.status === 'checked_in') {
          markBooked(input.acceptCharge === true && (input.acceptedChargeAmountIsk ?? 0) > 0);
        } else {
          set({ bookingPendingConfirmation: true });
        }
        set({ idempotencyKey: null, pendingOffer: null, offerWasReoffered: false, offeredChargeIsk: null });
      } catch (error) {
        if (error instanceof ProblemError && error.offer) {
          // 402 charge_consent_required: disclose, then acceptCharge()
          // re-POSTs under the SAME key. A second 402 means the price moved.
          reoffer(error.offer);
        } else if (isProblem(error, 'no_payment_method_on_file')) {
          // No vaulted card: pay the consented amount on Kling's hosted page,
          // which also saves the card, instead of a dead end.
          await startBookingPayment();
        } else if (error instanceof TransportError && error.transport === 'timeout') {
          // No answer is not "no booking". The key is kept, so checking again
          // can only return this booking, never make a second one.
          set({ bookingOutcomeUnknown: true });
        } else if (error instanceof HttpStatusError && GATEWAY_GAVE_UP_STATUSES.has(error.httpStatus)) {
          // The platform's own page: the gateway gave up on a create that
          // may still be booking. A timeout too.
          set({ bookingOutcomeUnknown: true });
        } else {
          await handleCreateRefusal(error);
        }
      }
      set({ isBooking: false });
    }

    /**
     * A create (or pay-rail) refusal in the member's words with its step,
     * never the server's text or code. A refusal that ends this selection goes
     * inline with Confirm hidden; a passing one is an alert that keeps
     * Confirm, because Confirm IS the retry.
     */
    async function handleCreateRefusal(error: unknown): Promise<void> {
      const refusal = refusalFor(error);
      if (!refusal || !(error instanceof ProblemError)) {
        // Any other 5xx with no problem body (a crash page) is our failure,
        // and Try again replays this attempt under its key.
        const ourFailure = error instanceof HttpStatusError && error.httpStatus >= 500;
        set({ error: refusalMessage(error), errorCta: ourFailure ? 'tryAgain' : null });
        return;
      }
      const code = normaliseRefusalCode(error.code);
      // The server cancelled that attempt: the same key can only replay it.
      if (code === 'booking_not_replayable') set({ idempotencyKey: null });
      // Declined and nothing billed: the same key would replay the decline.
      if (DECLINED_ATTEMPT_CODES.has(code)) set({ idempotencyKey: null });
      if (PRICE_MOVED_CODES.has(code)) {
        // Drop the rung and the offer BEFORE re-reading the price, so the
        // re-read cannot be refused the same way again (no loop).
        set({
          visitChoice: null,
          pendingOffer: null,
          offerWasReoffered: false,
          showChargeConsent: false,
          error: refusalMessage(error),
          errorCta: null,
        });
        await loadPreview();
        return;
      }
      if (refusalGoesInline(refusal, isKnownRefusal(code))) {
        set({ gateRefusal: { messageKey: refusal.messageKey, cta: refusal.cta } });
      } else {
        set({ error: refusalMessage(error), errorCta: refusal.cta });
      }
    }

    // --- The pay-and-save-card rail ---------------------------------------

    /** What the payment record says, for the outcome after Android closed the app. */
    function attemptContext(): BookingAttemptContext | null {
      const s = get();
      if (!s.activity) return null;
      const klass = usesClasses(s) ? s.selectedClass : null;
      const slot = usesClasses(s) ? null : s.selectedSlot;
      const startsAt = klass?.start ?? slot?.startTime ?? null;
      const endsAt = klass?.end ?? slot?.endTime ?? null;
      return {
        kind: klass ? 'class' : 'slot',
        activityId: s.activity.id,
        activityName: s.activity.name,
        venueId: s.venue?.id ?? null,
        venueName: s.venue?.name ?? null,
        venueSlug: s.venue?.slug ?? null,
        startsAt: startsAt ? toWireDate(startsAt) : null,
        endsAt: endsAt ? toWireDate(endsAt) : null,
        eventId: klass?.eventId ?? null,
        className: klass?.name ?? null,
        participants: groupBookable(s) && s.participants > 1 ? s.participants : null,
      };
    }

    /**
     * Entered from the `no_payment_method_on_file` 402: the amount-only
     * session under the booking's own key, then its page. The amount is the
     * create's 402 offer (the one just consented to), never the preview's.
     */
    async function startBookingPayment(): Promise<void> {
      const s = get();
      const klass = usesClasses(s) ? s.selectedClass : null;
      const slot = usesClasses(s) ? null : s.selectedSlot;
      const amount = s.pendingOffer?.amountIsk;
      const key = s.idempotencyKey;
      if (!s.activity || (!klass && !slot) || amount == null || !key) {
        set({ needsPaymentMethod: true });
        return;
      }
      const input: PaymentSessionInput = klass
        ? { kind: 'class', activityId: s.activity.id, eventId: klass.eventId, acceptedChargeAmountIsk: amount }
        : {
            kind: 'slot',
            activityId: s.activity.id,
            startsAt: slot!.startTime,
            endsAt: slot!.endTime,
            acceptedChargeAmountIsk: amount,
            // The session amount is the GROUP total; fulfilment replays the size.
            participants: groupBookable(s) && s.participants > 1 ? s.participants : null,
            guestAgeBands: guestAgeBandsForRequest(s),
            // The rung the session is PRICED at; fulfilment replays it.
            visitChoice: s.visitChoice,
          };
      set({ isBooking: true });
      let creation: PaymentSessionCreation;
      try {
        creation = await deps.createPaymentSession(input, key);
      } catch (error) {
        set({ isBooking: false });
        const refusal = classifySessionCreateError(error, input);
        switch (refusal.kind) {
          case 'reoffer':
            // The price drifted on the session: re-disclose and re-consent
            // (the accepted booking comes back into this rail).
            reoffer(refusal.offer);
            return;
          case 'alreadyCompleted':
            // A prior lost session already booked this: success, paid.
            set({ idempotencyKey: null, pendingOffer: null, offeredChargeIsk: null });
            markBooked(true);
            return;
          case 'notRequired': {
            // No charge applies now: book directly, keeping the party and rung.
            set({ offeredChargeIsk: null });
            const direct = buildInput(get());
            if (direct) await submit(direct);
            return;
          }
          case 'unresolved':
            // An earlier payment for this is still resolving.
            set({ payOutcome: { kind: 'needsAttention' } });
            return;
          case 'classNotSupported':
            // A server older than web 906f07f8: nothing was charged; 2.5.4's
            // "add a card", not "check your details".
            set({ needsPaymentMethod: true });
            return;
          case 'blocked':
          case 'refusal':
            await handleCreateRefusal(error);
            return;
        }
      }
      set({ isBooking: false });
      if (creation.kind === 'hasCard') {
        // A card exists now: book directly with consent under the same key,
        // through buildInput so the party and the rung are kept.
        const direct = buildInput(get());
        if (direct) await submit(withConsent(direct, amount));
        return;
      }
      await openPaymentPage(creation.url, key, amount);
    }

    async function openPaymentPage(url: string, key: string, amount: number): Promise<void> {
      const memberId = deps.memberId();
      const booking = attemptContext();
      if (!memberId || !booking) {
        set({ error: translate('error.sign_in', currentLanguage()), errorCta: null });
        return;
      }
      set({ bookingPayOpen: true, payPageNeverOpened: false });
      let result: HostedPayResult;
      try {
        result = await deps.payOnHostedPage({
          memberId,
          rail: 'booking',
          url,
          key,
          amountIsk: amount,
          booking,
          isScreenAlive: () => isScreenAlive(),
          // The page closed and the confirm starts: Confirm's spinner.
          onConfirming: () => set({ isBooking: true }),
        });
      } catch (error) {
        set({ bookingPayOpen: false, isBooking: false, error: refusalMessage(error), errorCta: null });
        return;
      }
      set({ bookingPayOpen: false, isBooking: false });
      applyPayResult(result);
    }

    /** What the page (or Check again) ended as. */
    function applyPayResult(result: HostedPayResult): void {
      switch (result.kind) {
        case 'busy':
          // Another page is open or being settled: nothing happened here.
          return;
        case 'unresolved':
          // An earlier attempt at this same booking is still unknown: no page
          // opened. "Confirming your payment", Check again under its key.
          set({ heldAttempt: result.attempt, payOutcome: { kind: 'processing' } });
          return;
        case 'settled':
          if (result.page === 'neverOpened') {
            // Nobody can have paid on a page that never opened: the attempt
            // ends unpaid, the screen unlocks, and its OK closes it.
            set({ idempotencyKey: null, payPageNeverOpened: true, payOutcome: { kind: 'notPaid' } });
            return;
          }
          applySettlement(result.settlement, result.key, result.attempt, result.presented);
      }
    }

    function applySettlement(
      settlement: PaySettlement,
      disposition: 'reuse' | 'retire',
      attempt: AttemptRef | null,
      presented: boolean,
    ): void {
      if (disposition === 'retire') set({ idempotencyKey: null });
      set({ heldAttempt: attempt });
      switch (settlement.kind) {
        case 'fulfilled':
          set({ pendingOffer: null, offeredChargeIsk: null });
          // F8's presenter already told the member (and scheduled the
          // reminders) when this screen was gone.
          if (presented) {
            set({ bookingWasPaid: true });
          } else {
            markBooked(true);
          }
          void deps.refreshCredits().catch(() => undefined);
          return;
        case 'outcome':
          if (!presented) set({ payOutcome: settlement.outcome });
          return;
        case 'sessionNotFound':
          // No session ever existed (an early back-out): nothing was charged.
          return;
        case 'failed':
          // The confirm is idempotent and the money is the server's to settle:
          // its refusal in the member's words, with no step that could start
          // a second payment.
          if (!presented) set({ error: refusalMessage(settlement.error), errorCta: null });
          return;
      }
    }

    // --- Occurrence (the class sheet) -------------------------------------

    function seedSelection(occurrence: BookingOccurrence): void {
      const snapshot = occurrence.snapshot;
      if (occurrence.handle.kind === 'ablerClass') {
        const seeded: ActivityClass = {
          eventId: occurrence.handle.eventId,
          name: occurrence.className,
          description: null,
          start: occurrence.startsAt,
          end: occurrence.endsAt ?? occurrence.startsAt,
          coaches: [],
          attendance: { current: snapshot?.attendanceCurrent ?? 0, limit: snapshot?.attendanceLimit ?? -1 },
          full: snapshot?.full ?? false,
          canBook: snapshot?.canBook ?? null,
          canBookReason: snapshot?.canBookReason ?? null,
          registrationOpensAt: snapshot?.registrationOpensAt ?? null,
        };
        set((state) => classPatch(state, seeded));
        return;
      }
      // A slot is booked by its start AND end: without the end (a Coach plan
      // handle) nothing is seeded, and only the re-check can supply it.
      const activity = get().activity;
      if (!activity || !occurrence.endsAt) {
        set((state) => slotPatch(state, null));
        return;
      }
      // The row's own registration state rides along, so a slot the row
      // showed as Full or closed is not offered if the re-check can't answer.
      let spotsLeft: number | null = null;
      if (snapshot?.full === true) spotsLeft = 0;
      else if (snapshot?.attendanceLimit != null && snapshot.attendanceLimit > 0) {
        spotsLeft = Math.max(snapshot.attendanceLimit - (snapshot.attendanceCurrent ?? 0), 0);
      }
      const seeded = makeSlot({
        activityId: activity.id,
        startTime: occurrence.startsAt,
        endTime: occurrence.endsAt,
        isAvailable: snapshot?.canBook ?? true,
        remainingCapacity: spotsLeft,
        instructor: occurrence.instructor,
        title: occurrence.className,
      });
      set((state) => slotPatch(state, seeded));
    }

    function seededOccurrenceStatus(fallbackStart: Date): OccurrenceStatus {
      const s = get();
      const now = deps.now();
      if (s.occurrence?.handle.kind === 'ablerClass' && s.selectedClass) {
        return occurrenceStatusFor(s.selectedClass.start, isClassBookable(s.selectedClass), now);
      }
      if (s.occurrence?.handle.kind === 'slot' && s.selectedSlot) {
        return occurrenceStatusFor(
          s.selectedSlot.startTime,
          s.selectedSlot.isAvailable && s.selectedSlot.remainingCapacity !== 0,
          now,
        );
      }
      return fallbackStart.getTime() <= now.getTime() ? 'started' : 'unresolved';
    }

    // --- Timetable and preview --------------------------------------------

    async function loadTimetable(): Promise<void> {
      const { activity, selectedDay } = get();
      if (!activity) return;
      const generation = ++timetableGeneration;
      // A fresh timetable invalidates the previous pick: keeping it would let
      // the member book the PREVIOUS day's slot. The patches also drop the
      // key and any refusal.
      set((state) => ({
        isLoading: true,
        error: null,
        errorCta: null,
        ...slotPatch(state, null),
        ...classPatch(state, null),
      }));
      try {
        // The server hides started sessions, but the window is day-sized:
        // anything past `now` is dropped here too, with `now` taken AFTER the
        // answer, so a session that started while it was in flight never
        // shows (the create would refuse it with booking_time_in_past).
        if (providerUsesClasses(activity.provider)) {
          // Abler: the server caps the range at 31 days; the flow shows 14.
          const end = addServerDays(selectedDay, 14) ?? selectedDay;
          const fetched = await deps.fetchClasses(activity.id, selectedDay, end);
          if (generation !== timetableGeneration) return;
          const now = deps.now().getTime();
          set({ classes: fetched.filter((klass) => klass.start.getTime() > now) });
        } else {
          // One venue day; the capacity check covers the whole party.
          const fetched = await deps.fetchAvailability(activity.id, selectedDay, selectedDay, get().participants);
          if (generation !== timetableGeneration) return;
          const now = deps.now().getTime();
          set((state) => ({
            availableSlots: fetched.slots.filter((slot) => slot.startTime.getTime() > now),
            offeredAgeBands: fetched.ageBands,
            guestAgeBands: syncedGuestBands(state.participants, state.guestAgeBands),
          }));
        }
      } catch (error) {
        if (generation !== timetableGeneration) return;
        // The booking screen's own words: a code the table does not name
        // reads as its status's sentence, never as the server's detail.
        set({ error: refusalMessage(error), errorCta: null });
      }
      set({ isLoading: false });
    }

    async function loadPreview(): Promise<void> {
      const s = get();
      const start = selectedStart(s);
      if (!s.activity || !start) return;
      const generation = ++previewGeneration;
      // The price is being read again: the next create re-offers.
      set({ isLoadingPreview: true, preview: null, gateRefusal: null, offeredChargeIsk: null });
      let preview: BookingPreview | null = null;
      let gate: GateRefusal | null = null;
      try {
        preview = await deps.fetchBookingPreview(s.activity.id, start, {
          participants: groupBookable(s) ? s.participants : 1,
          guestAgeBands: guestAgeBandsForRequest(s),
          // A class is priced at the rung the server selects.
          visitChoice: usesClasses(s) ? null : s.visitChoice,
        });
      } catch (error) {
        // Only a refusal the preview alone settles blocks here. A 429, a 5xx,
        // `invalid_*`, an unknown code, a money state or no answer stays
        // best-effort with Confirm up: the create is the authoritative gate,
        // and the 402 round trip still discloses any charge.
        if (error instanceof ProblemError) {
          gate = gateRefusalForCode(error.slug, error.details.reason ?? null, error.details.status ?? 0);
        }
      }
      if (generation !== previewGeneration) return;
      set({ preview, gateRefusal: gate, isLoadingPreview: false });
    }

    async function confirmBooking(): Promise<void> {
      const s = get();
      // One attempt at a time: a tap while one is in flight, the consent is
      // up, the page is open or a timed-out create waits sends nothing.
      if (bookingInProgress(s)) return;
      // A seeded (feed) copy of a session that can't be booked is never sent.
      if (s.occurrence && !canConfirmOccurrence(s)) return;
      const input = buildInput(s);
      if (!input) return;
      // Taken before the first await, so a tap queued behind this one finds
      // the attempt in flight.
      set({ isBooking: true, payPageNeverOpened: false });
      await submit(input);
    }

    async function refreshOccurrence(): Promise<void> {
      const { occurrence, activity } = get();
      if (!occurrence || !activity) return;
      set({ occurrenceStatus: 'checking' });
      const day = VenueTimeFormat.day(occurrence.startsAt);
      try {
        if (occurrence.handle.kind === 'ablerClass') {
          const eventId = occurrence.handle.eventId;
          const fetched = await deps.fetchClasses(activity.id, day, day);
          const fresh = fetched.find((klass) => klass.eventId === eventId);
          const now = deps.now();
          if (!fresh) {
            set((state) => ({
              ...classPatch(state, null),
              occurrenceStatus: occurrence.startsAt.getTime() <= now.getTime() ? 'started' : 'gone',
            }));
            return;
          }
          // Same eventId: the patch keeps the key.
          set((state) => ({
            ...classPatch(state, fresh),
            occurrenceStatus: occurrenceStatusFor(fresh.start, isClassBookable(fresh), now),
          }));
          return;
        }
        const fetched = await deps.fetchAvailability(activity.id, day, day, 1);
        const fresh = fetched.slots.find((slot) => Math.abs(slot.startTime.getTime() - occurrence.startsAt.getTime()) < 1000);
        const now = deps.now();
        if (!fresh) {
          set((state) => ({
            ...slotPatch(state, null),
            occurrenceStatus: occurrence.startsAt.getTime() <= now.getTime() ? 'started' : 'gone',
          }));
          return;
        }
        set((state) => ({
          ...slotPatch(state, fresh),
          occurrenceStatus: occurrenceStatusFor(fresh.startTime, fresh.isAvailable && fresh.remainingCapacity !== 0, now),
        }));
      } catch {
        // Best effort, like the preview: the seeded session stays, with the
        // row's own word on whether it was bookable, and the create is the
        // gate. A slot with no known end cannot be sent at all.
        set({ occurrenceStatus: seededOccurrenceStatus(occurrence.startsAt) });
      }
    }

    async function retryOccurrence(): Promise<void> {
      await refreshOccurrence();
      if (get().occurrenceStatus === 'ready') await loadPreview();
    }

    return {
      ...INITIAL,
      activity: options.activity ?? null,
      venue: options.venue ?? null,
      selectedDay: initialDay,
      // Opened on a day: that day's timetable, spinner first (never "no
      // classes" before the answer).
      currentStep: options.initialDay ? 1 : 0,
      isLoading: options.initialDay ? true : false,

      setActivity(activity) {
        set({ activity });
      },

      setVenue(venue) {
        set({ venue });
      },

      selectDay(day) {
        // Slot pickers can't book in the past; the date step's floor is today.
        const floor = today();
        set({ selectedDay: dayBefore(day, floor) ? floor : day });
      },

      selectSlot(slot) {
        set((state) => slotPatch(state, slot));
      },

      selectClass(klass) {
        set((state) => classPatch(state, klass));
      },

      resetParty() {
        // A fresh flow starts solo. The bands are the previous VENUE's; this
        // activity's availability names them again.
        set({ participants: 1, guestAgeBands: [], offeredAgeBands: [] });
      },

      async changeParticipants(next) {
        const clamped = Math.min(10, Math.max(1, Math.round(next)));
        if (clamped === get().participants) return;
        // The pending consent belongs to the OLD size, and so does a rung.
        set((state) => ({
          participants: clamped,
          guestAgeBands: syncedGuestBands(clamped, state.guestAgeBands),
          pendingOffer: null,
          offerWasReoffered: false,
          visitChoice: null,
        }));
        // The selection survives unless its known capacity can't seat the party.
        const kept = get().selectedSlot;
        await loadTimetable();
        if (!kept) return;
        const refreshed = get().availableSlots.find((slot) => slot.id === kept.id);
        if (
          refreshed &&
          refreshed.isAvailable &&
          (refreshed.remainingCapacity == null || refreshed.remainingCapacity >= clamped)
        ) {
          set((state) => slotPatch(state, refreshed));
          if (get().currentStep === 2) await loadPreview();
        }
      },

      async changeGuestAgeBand(index, band) {
        const bands = get().guestAgeBands;
        if (index < 0 || index >= bands.length || bands[index] === band) return;
        const next = [...bands];
        next[index] = band;
        set({ guestAgeBands: next, pendingOffer: null, offerWasReoffered: false, visitChoice: null });
        await loadPreview();
      },

      async changeVisitChoice(next) {
        if (next === selectedVisitChoice(get())) return;
        set({ visitChoice: next, pendingOffer: null, offerWasReoffered: false });
        await loadPreview();
      },

      loadTimetable,
      loadPreview,
      confirmBooking,

      async acceptCharge() {
        const s = get();
        if (s.isBooking || !s.pendingOffer) return;
        const base = buildInput(s);
        if (!base) return;
        set({ showChargeConsent: false, isBooking: true });
        await submit(withConsent(base, s.pendingOffer.amountIsk));
      },

      declineCharge() {
        set({ showChargeConsent: false, pendingOffer: null, offerWasReoffered: false });
      },

      async checkBookingAgain() {
        set({ bookingOutcomeUnknown: false });
        const input = get().lastSubmittedInput;
        if (!input || get().isBooking) return;
        await submit(input);
      },

      dismissOutcomeUnknown() {
        set({ bookingOutcomeUnknown: false });
      },

      async retryAfterRefusal() {
        set({ gateRefusal: null });
        await confirmBooking();
      },

      returnToTimetable(keepingSelection) {
        set((state) => ({
          gateRefusal: null,
          ...(keepingSelection ? {} : { ...slotPatch(state, null), ...classPatch(state, null) }),
          currentStep: 1,
        }));
      },

      async recheckAfterPlans() {
        const s = get();
        if (!rechecksAfterStep(s.gateRefusal) || s.isBooking) return;
        if (s.occurrence) {
          await retryOccurrence();
        } else if (s.currentStep === 2 && hasSelection(s)) {
          await loadPreview();
        }
      },

      async confirmBookingPayment() {
        const s = get();
        if (s.isBooking) return;
        set({ payOutcome: null, isBooking: true });
        if (s.heldAttempt) {
          const result = await deps.checkPaymentAgain(s.heldAttempt, () => isScreenAlive());
          if (result.kind !== 'busy') {
            set({ isBooking: false });
            applyPayResult(result);
            return;
          }
        }
        // No attempt held here any more: ask under the booking's own key
        // (the Done leg, five answers), as iOS's confirm does.
        const key = get().idempotencyKey;
        if (!key) {
          set({ isBooking: false, heldAttempt: null });
          return;
        }
        const settlement = await deps.settlePaymentSession({ key, leg: 'done' });
        set({ isBooking: false });
        applySettlement(settlement, keyDisposition(settlement), null, false);
      },

      dismissPayOutcome() {
        const held = get().heldAttempt;
        set({ payOutcome: null, heldAttempt: null });
        // Its record stays: a later return to the app checks again quietly.
        if (held) void deps.leaveAttempt(held).catch(() => undefined);
      },

      dismissError() {
        set({ error: null, errorCta: null });
      },

      dismissNeedsPaymentMethod() {
        set({ needsPaymentMethod: false });
      },

      dismissBooked() {
        set({ bookingComplete: false, bookingPendingConfirmation: false });
      },

      async prepare(occurrence) {
        // A sheet books one seat for the member, straight on the confirm step.
        set({
          occurrence,
          activity: occurrence.activity,
          participants: 1,
          guestAgeBands: [],
          offeredAgeBands: [],
          selectedDay: VenueTimeFormat.day(occurrence.startsAt),
          currentStep: 2,
          error: null,
          errorCta: null,
          preview: null,
          pendingOffer: null,
        });
        seedSelection(occurrence);
        if (occurrence.startsAt.getTime() <= deps.now().getTime()) {
          set({ occurrenceStatus: 'started' });
          return;
        }
        await refreshOccurrence();
        if (get().occurrenceStatus === 'ready') await loadPreview();
      },

      refreshOccurrence,
      retryOccurrence,

      tickOccurrence(now = deps.now()) {
        const s = get();
        if (s.isBooking || s.bookingComplete || s.bookingPendingConfirmation) return;
        if (s.occurrenceStatus !== 'ready' && s.occurrenceStatus !== 'notBookable') return;
        const start = occurrenceStart(s);
        if (!start || start.getTime() > now.getTime()) return;
        set({ occurrenceStatus: 'started' });
      },

      nextStep() {
        set((state) => ({ currentStep: Math.min(state.currentStep + 1, 2) as BookingStep }));
      },

      previousStep() {
        set((state) => ({ currentStep: Math.max(state.currentStep - 1, 0) as BookingStep }));
      },

      openOnTimetable(day) {
        const floor = today();
        set({ selectedDay: dayBefore(day, floor) ? floor : day, currentStep: 1, isLoading: true });
      },

      setScreenAlive(alive) {
        isScreenAlive = alive;
      },
    };
  });
}

/** The coaches of a class, for a row ("Sigrún Jónsdóttir"). */
export const coachNames = classCoachNames;
