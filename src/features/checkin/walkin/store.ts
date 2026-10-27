/* eslint lifepass/no-literal-copy: "error" */
/**
 * The walk-in flow, from a venue id to the proof: the Android port of iOS
 * `CheckInViewModel`'s walk-in half (ViewModels/CheckInViewModel.swift), as a
 * framework-free zustand store so the money paths run under Jest against the
 * stub server, as iOS's WalkInMoneyPathTests run against StubServer.
 *
 *   scan or link ─► preview ─┬─ attendable booking ─► "Mark me as present" (free) | regular visit
 *                            ├─ not allowed ───────► the blocking reason, with its step
 *                            └─ activities: one (re-preview with it) | none | several (picker)
 *                                   │
 *                                proceed ─┬─ guest seats sold: own visit first (free) or guests first (charged)
 *                                         ├─ a charge (own + guests) ─► consent BEFORE any POST
 *                                         ├─ a link ─► "Check in at <venue>?"
 *                                         └─ confirm ─► the proof
 *
 * THE MONEY RULES (each one pinned by a test):
 * - Charge before access: a disclosed charge is consented to before the first
 *   POST; declining sends nothing and the next attempt has a new key.
 * - ONE Idempotency-Key per attempt: minted at the first POST and reused by
 *   the consent re-POST, the pay-and-save-card session and its confirm, so
 *   consenting or paying can never check in (or charge) twice. Any other
 *   failure drops it; a brand-new scan never reuses it.
 * - A 402 re-offer at another amount is shown, with "The price changed",
 *   before it is charged.
 * - Guests ride every POST of the attempt, and the pay session with an
 *   explicit `walk_in` booking action; the proof after the hosted page shows
 *   the party that was paid for.
 * - A link never checks in by itself: it stops on "Check in at <venue>?" (or
 *   on the own-visit step, whose tap is then the confirmation).
 *
 * WHAT IS PRIVATE. The attempt's key, the venue and activity in flight, the
 * booking action and the guest choice live in the closure, not in the state a
 * screen renders, as they are `private` on iOS.
 *
 * ANDROID ADDITIONS, none of which changes what iOS sends:
 * - Every member action acts once: a second tap while the first is under way
 *   (`isProcessing`) does nothing, the declines and closes included (iOS
 *   relies on the sheet's or alert's dismissal for most of them; the
 *   own-visit and guest steps guard exactly as iOS does).
 * - The flow is one per app and outlives the Scan screen and the session, so
 *   every wait is fenced (see `Run`): an answer for an attempt that is no
 *   longer in hand (sign-out, or a new scan or link) writes nothing.
 * - The guest sheet, the own-visit step, the attendance sheet and the
 *   activity picker answer hardware back: nothing has been sent at those
 *   steps, so back ends the attempt, as the own-visit step's close button
 *   does. (A tap outside or a pan down closes only the two iOS lets the
 *   member swipe away: the attendance sheet and the picker.)
 * - The hosted page is F8's `payOnHostedPage` (a Custom Tab, saved before it
 *   opens, so a payment survives Android closing the app behind it); it
 *   settles the page itself (five answers after Done, one after the cancel
 *   link), so `confirmWalkInPayment` is its result here.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { isProblem, ProblemError, type ChargeConsentOffer, type RefusalCta } from '../../../api';
import type { CheckInParty } from '../../../api/profile';
import {
  ownVisitIsFree,
  type AttendableBooking,
  type GuestBandOffer,
  type WalkInActivity,
  type WalkInCoverage,
  type WalkInPreview,
} from '../../../api/walkInPreview';
import { newIdempotencyKey } from '../../../api/idempotency';
import { t } from '../../../i18n';
import { track } from '../../../lib/analytics';
import {
  checkPaymentAgain,
  classifySessionCreateError,
  createPaymentSession,
  keyDisposition,
  leaveAttempt,
  payOnHostedPage,
  readInflight,
  settlePaymentSession,
  type AttemptRef,
  type BookingPayOutcome,
  type HostedPayResult,
  type PaymentSessionCreation,
  type PaySettlement,
  type PayOnHostedPageRequest,
  type WalkInAttemptContext,
  type WalkInPaymentSession,
} from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import {
  reportCheckInFacts,
  reportCheckInProofClosed,
  type CheckInFacts,
  type ProofClosedFacts,
} from '../../../checkin/checkInFacts';

import type { ConsentContext } from './consentCopy';
import { blockingRefusal, confirmRefusal } from './refusals';
import { confirmWalkIn, walkInPreview, type BookingAction, type WalkInConfirmInput, type WalkInResult } from './service';

// ---------------------------------------------------------------------------
// State

/** The guest server ceiling: the member plus up to nine guests (`maxItems: 9`). */
export const MAX_GUESTS = 9;

/**
 * Between one step's sheet closing and the next sheet, alert or cover
 * opening (iOS waits 450 ms for SwiftUI's dismissal). The UI kit's sheet
 * slides away in about 250 ms; the beat keeps the two from overlapping.
 */
export const SHEET_DISMISS_BEAT_MS = 450;

export interface WalkInState {
  /** The venue of the attempt in hand (a scan or a link). */
  readonly scannedVenueId: string | null;
  readonly preview: WalkInPreview | null;
  readonly pickerActivities: readonly WalkInActivity[];
  readonly showActivityPicker: boolean;
  /** A request is in flight: the "Processing…" overlay. */
  readonly isProcessing: boolean;

  /** A same-day booked class here: "Mark me as present" (free) or a regular visit. */
  readonly showAttendChoice: boolean;
  readonly attendableBooking: AttendableBooking | null;

  /** The guest seats the venue sells at the door (the preview's `guestBands`). */
  readonly guestBandOffers: readonly GuestBandOffer[];
  /** Guests by band (`adult` | `child` | `infant`). */
  readonly guestCounts: Readonly<Record<string, number>>;
  readonly showGuestPicker: boolean;
  /** The member's own visit first (2.5.3): free, with what covers it. */
  readonly showOwnVisitConfirm: boolean;
  /** Between the own-visit step closing and the guest sheet opening: not idle. */
  readonly isSwitchingToGuests: boolean;

  /** The proof cover. */
  readonly showSuccess: boolean;
  readonly successVenueName: string | null;
  readonly successActivityName: string | null;
  readonly successTimestamp: Date | null;
  /** Shortened by the server; null names nobody (the pay rail never has one). */
  readonly successMemberShortName: string | null;
  readonly successParty: CheckInParty | null;
  /** What paid for the visit, for "Balance after"; null after the hosted page. */
  readonly successCoverage: WalkInCoverage | null;
  /**
   * The member's check-ins that stand, this one included, as the check-in
   * said (API 0.46.0): the Google Play rating ask's fact for the moment the
   * member LEAVES the proof (never while it is up). Null when unknown.
   */
  readonly successLifetimeCheckIns: number | null;

  /** The charge disclosed from the preview, or the 402's re-offer. */
  readonly pendingOffer: ChargeConsentOffer | null;
  readonly showChargeConsent: boolean;
  /** The preview charge's `reason` (the 402 offer's when the preview had none): picks the copy. */
  readonly pendingChargeReason: string | null;
  /** A 402 replaced the disclosed offer with a different amount. */
  readonly offerWasReoffered: boolean;
  /** iOS's safety net ("Add a payment method"); the pay rail normally makes it unreachable. */
  readonly needsPaymentMethod: boolean;

  /** The pay-and-save-card page is open (a Custom Tab over the app). */
  readonly payPageOpen: boolean;
  /** A pay-rail outcome to say (a fulfilled walk-in shows the proof instead). */
  readonly payOutcome: BookingPayOutcome | null;

  /** A refusal in the member's words, and its step (the alert's second button). */
  readonly error: string | null;
  readonly errorCTA: RefusalCta | null;
  /** The venue the refusal was about: Try again scans it again, Book a time opens its page. */
  readonly refusalVenueId: string | null;
  readonly refusalVenueSlug: string | null;

  /** "Check in at <venue>?" for an attempt that came by link. */
  readonly showLinkConfirm: boolean;
  /** This attempt came by link and the member has not tapped yet. */
  readonly linkedAttempt: boolean;
}

export interface StartWalkInOptions {
  /** The venue came from a link, not the camera: ask before checking in. */
  readonly fromLink: boolean;
}

export interface WalkInActions {
  startWalkIn(venueId: string, options?: StartWalkInOptions): Promise<void>;
  selectActivity(activity: WalkInActivity): Promise<void>;
  /** The picker's Cancel (or back): nothing was sent. */
  cancelActivityPicker(): void;
  attendBookedClass(): Promise<void>;
  walkInInsteadOfClass(): Promise<void>;
  /** The attendance sheet closed without a choice (back, or swiped away): nothing was sent. */
  dismissAttendChoice(): void;
  confirmLinkedWalkIn(): Promise<void>;
  declineLinkedWalkIn(): void;
  checkInOwnVisit(): Promise<void>;
  openGuestsFromOwnVisit(): Promise<void>;
  declineOwnVisit(): void;
  addGuest(band: string): void;
  removeGuest(band: string): void;
  confirmGuestSelection(): Promise<void>;
  skipGuests(): Promise<void>;
  /** Back on the guest sheet: nothing was sent, so the attempt ends (Android). */
  cancelGuests(): void;
  acceptWalkInCharge(): Promise<void>;
  declineWalkInCharge(): void;
  /** "Check again" on "Confirming your payment": the same key. */
  checkPaymentAgain(): Promise<void>;
  /** OK, or Cancel on "Confirming your payment". */
  dismissPayOutcome(): void;
  dismissNeedsPaymentMethod(): void;
  /** The refusal alert closed (OK, or its step taken). */
  dismissError(): void;
  /** The refusal's "Try again": the same venue from a fresh preview, under a new key. */
  retryAfterRefusal(): Promise<void>;
  /** The proof's Done (and back): the member leaves the proof (reported, see `WalkInDeps.leftProof`). */
  resetSuccess(): void;
  /**
   * The proof of a walk-in paid on the hosted page and confirmed after the
   * screen that started it was gone (Android: F8's recovery after a cold
   * start), from what the attempt saved before the page opened, and the
   * check-in count the confirm answered with (null when it said none).
   */
  showRecoveredProof(walkIn: WalkInAttemptContext, lifetimeCheckIns?: number | null): void;
  /** Everything forgotten (sign-out). */
  reset(): void;
}

export type WalkInStore = WalkInState & WalkInActions;

export const INITIAL_WALK_IN_STATE: WalkInState = Object.freeze({
  scannedVenueId: null,
  preview: null,
  pickerActivities: [],
  showActivityPicker: false,
  isProcessing: false,
  showAttendChoice: false,
  attendableBooking: null,
  guestBandOffers: [],
  guestCounts: {},
  showGuestPicker: false,
  showOwnVisitConfirm: false,
  isSwitchingToGuests: false,
  showSuccess: false,
  successVenueName: null,
  successActivityName: null,
  successTimestamp: null,
  successMemberShortName: null,
  successParty: null,
  successCoverage: null,
  successLifetimeCheckIns: null,
  pendingOffer: null,
  showChargeConsent: false,
  pendingChargeReason: null,
  offerWasReoffered: false,
  needsPaymentMethod: false,
  payPageOpen: false,
  payOutcome: null,
  error: null,
  errorCTA: null,
  refusalVenueId: null,
  refusalVenueSlug: null,
  showLinkConfirm: false,
  linkedAttempt: false,
});

// ---------------------------------------------------------------------------
// Derived values (iOS computed properties)

/** What the chosen guests add, at the guest sheet's own per-head prices (the server re-verifies). */
export function guestTotalIsk(state: Pick<WalkInState, 'guestBandOffers' | 'guestCounts'>): number {
  return state.guestBandOffers.reduce((sum, offer) => sum + offer.unitIsk * (state.guestCounts[offer.band] ?? 0), 0);
}

export function guestCountTotal(state: Pick<WalkInState, 'guestCounts'>): number {
  return Object.values(state.guestCounts).reduce((sum, count) => sum + Math.max(0, count), 0);
}

/**
 * The party the member confirmed on the guest step, as the proof draws it.
 * The pay rail needs it: its confirm answers with a payment session, not a
 * check-in, so it carries no `party`, and a solo-looking proof for a paid
 * party is exactly what reception must not be shown. Null for a solo walk-in.
 */
export function confirmedParty(state: Pick<WalkInState, 'guestBandOffers' | 'guestCounts'>): CheckInParty | null {
  if (guestCountTotal(state) <= 0) return null;
  return {
    adults: state.guestCounts.adult ?? 0,
    children: state.guestCounts.child ?? 0,
    infants: state.guestCounts.infant ?? 0,
    guestChargeIsk: guestTotalIsk(state),
  };
}

const BAND_ORDER = ['adult', 'child', 'infant'];

/** The bands the API expects: one entry per guest, or null for none (never an empty list). */
export function guestAgeBandsPayload(counts: Readonly<Record<string, number>>): string[] | null {
  const bands = Object.keys(counts).sort((a, b) => bandRank(a) - bandRank(b));
  const payload = bands.flatMap((band) => Array<string>(Math.max(0, counts[band] ?? 0)).fill(band));
  return payload.length > 0 ? payload : null;
}

function bandRank(band: string): number {
  const index = BAND_ORDER.indexOf(band);
  return index < 0 ? BAND_ORDER.length : index;
}

/** What the consent copy reads (./consentCopy). */
export function consentContext(
  state: Pick<
    WalkInState,
    'pendingOffer' | 'pendingChargeReason' | 'offerWasReoffered' | 'guestBandOffers' | 'guestCounts' | 'preview'
  >,
): ConsentContext {
  return {
    offer: state.pendingOffer,
    chargeReason: state.pendingChargeReason,
    reoffered: state.offerWasReoffered,
    guestCountTotal: guestCountTotal(state),
    guestTotalIsk: guestTotalIsk(state),
    venueName: state.preview?.venue.name ?? null,
  };
}

/**
 * Nothing of a walk-in is on screen: no spinner, sheet, alert, cover, pay
 * page or pay outcome. The Scan tab enables its person button and offers
 * "Scan another code" then.
 */
export function isWalkInIdle(state: WalkInState): boolean {
  return (
    !state.isProcessing &&
    !state.showActivityPicker &&
    !state.showGuestPicker &&
    !state.showAttendChoice &&
    !state.showOwnVisitConfirm &&
    !state.isSwitchingToGuests &&
    !state.showSuccess &&
    !state.showChargeConsent &&
    !state.showLinkConfirm &&
    state.error === null &&
    state.payOutcome === null &&
    !state.payPageOpen &&
    !state.needsPaymentMethod
  );
}

// ---------------------------------------------------------------------------
// Dependencies

/** What the flow calls; the app uses the real ones, a test may replace any. */
export interface WalkInDeps {
  preview(venueId: string, activityId?: string | null): Promise<WalkInPreview>;
  confirm(input: WalkInConfirmInput, idempotencyKey: string): Promise<WalkInResult>;
  createSession(input: WalkInPaymentSession, idempotencyKey: string): Promise<PaymentSessionCreation>;
  payOnPage(request: PayOnHostedPageRequest): Promise<HostedPayResult>;
  checkAgain(attempt: AttemptRef, isScreenAlive?: () => boolean): Promise<HostedPayResult>;
  leaveAttempt(attempt: AttemptRef): Promise<void>;
  /** A confirm by key when no attempt is held (Check again after a recovery took it). */
  settle(key: string): Promise<PaySettlement>;
  /** What an attempt F8 handed over was for (its saved record), or null. */
  attemptContext(attempt: AttemptRef): Promise<WalkInAttemptContext | null>;
  /** The signed-in member (the hosted page's record is theirs). */
  memberId(): string | null;
  /** iOS `appState.refreshCredits()`: the plan and the profile, after a check-in. */
  refreshCredits(): Promise<void>;
  /**
   * A walk-in stood (the direct POST): what its answer said, for the visit
   * rating's notification (src/checkin/checkInFacts). A walk-in paid on the
   * hosted page is reported where its confirm settles (src/payments).
   */
  checkedIn(facts: CheckInFacts): void;
  /** The member left the proof: for the Google Play rating ask's check-in moment. */
  leftProof(facts: ProofClosedFacts): void;
  /** The walk-in host is on screen (a payment outcome is the screen's to show). */
  isScreenAlive(): boolean;
  newKey(): string;
  now(): Date;
  /** `SHEET_DISMISS_BEAT_MS`; tests use 0. */
  dismissBeatMs: number;
}

let mountedHosts = 0;

/** The walk-in host counts itself in and out (`isScreenAlive`). */
export function noteHostMounted(): () => void {
  mountedHosts += 1;
  let counted = true;
  return () => {
    if (!counted) return;
    counted = false;
    mountedHosts = Math.max(0, mountedHosts - 1);
  };
}

/** True while a walk-in host is mounted. */
export function isWalkInHostMounted(): boolean {
  return mountedHosts > 0;
}

export const defaultWalkInDeps: WalkInDeps = {
  preview: (venueId, activityId) => walkInPreview(venueId, activityId),
  confirm: (input, key) => confirmWalkIn(input, key),
  createSession: (input, key) => createPaymentSession(input, key),
  payOnPage: (request) => payOnHostedPage(request),
  checkAgain: (attempt, isScreenAlive) => checkPaymentAgain(attempt, isScreenAlive),
  leaveAttempt: (attempt) => leaveAttempt(attempt),
  settle: (key) => settlePaymentSession({ key, leg: 'done' }),
  attemptContext: async (ref) => {
    const saved = (await readInflight(ref.memberId)).find((record) => record.attemptId === ref.attemptId);
    return saved?.rail === 'walk_in' ? saved.walkIn : null;
  },
  memberId: () => {
    const { userId, profile } = useAppStore.getState();
    return userId ?? profile?.id ?? null;
  },
  refreshCredits: () => useAppStore.getState().refreshCredits(),
  checkedIn: (facts) => reportCheckInFacts(facts),
  leftProof: (facts) => reportCheckInProofClosed(facts),
  isScreenAlive: () => isWalkInHostMounted(),
  newKey: () => newIdempotencyKey(),
  now: () => new Date(),
  dismissBeatMs: SHEET_DISMISS_BEAT_MS,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

// ---------------------------------------------------------------------------
// The store

/** A payment still settling, held for Check again, with what it paid for. */
interface HeldPayment {
  readonly ref: AttemptRef;
  /** The venue, activity and party of THAT payment (null when it could not be read back). */
  readonly context: WalkInAttemptContext | null;
}

/** What one attempt holds that no screen renders (iOS `private`). */
interface Attempt {
  /** One key per attempt, minted at the first POST (see the file comment). */
  walkInKey: string | null;
  pendingVenueId: string | null;
  pendingActivityId: string | null;
  /** The attendance choice, sent on every confirm of the attempt; null when no booking existed. */
  pendingBookingAction: BookingAction | null;
  /** The guest step was answered (or skipped because no seats are sold). */
  guestChoiceMade: boolean;
  pendingGuestVenueId: string | null;
  pendingGuestActivityId: string | null;
  /** One silent re-preview per attempt when the picked activity went invalid. */
  activityInvalidRefetched: boolean;
  /** What this attempt's own hosted page was for, saved as it opened. */
  pageContext: WalkInAttemptContext | null;
  /** A payment still settling (this attempt's, or an earlier one F8 handed over). */
  held: HeldPayment | null;
}

function freshAttempt(): Attempt {
  return {
    walkInKey: null,
    pendingVenueId: null,
    pendingActivityId: null,
    pendingBookingAction: null,
    guestChoiceMade: false,
    pendingGuestVenueId: null,
    pendingGuestActivityId: null,
    activityInvalidRefetched: false,
    pageContext: null,
    held: null,
  };
}

/**
 * One run of the flow: the attempt an action began in, and the session.
 *
 * THE FENCE. iOS's view model is `@State` of the Scan view, so an answer that
 * lands after sign-out writes to an object nobody sees any more. This store
 * is one per app and outlives the screen and the session, so every action
 * remembers the attempt it began in and, after each wait, goes on only while
 * that attempt is still the one in hand. Sign-out (`reset`) and a new scan or
 * link (`startWalkIn`) each begin a new one, so a late answer can never draw
 * one member's proof for the next, send a walk-in after sign-out, or write
 * into another attempt.
 */
interface Run {
  readonly attempt: Attempt;
  readonly session: number;
}

/** Each store's dependencies, so a test can swap them on the app's own store. */
const storeDeps = new WeakMap<StoreApi<WalkInStore>, WalkInDeps>();

/**
 * Replaces some of `store`'s dependencies (tests: no sheet beat, no profile
 * refresh). `configureWalkInDeps(store, defaultWalkInDeps)` puts them back.
 */
export function configureWalkInDeps(store: StoreApi<WalkInStore>, overrides: Partial<WalkInDeps>): void {
  const deps = storeDeps.get(store);
  if (deps) Object.assign(deps, overrides);
}

const NOTHING_HELD: HostedPayResult = Object.freeze({ kind: 'busy' });

export function createWalkInStore(overrides: Partial<WalkInDeps> = {}): StoreApi<WalkInStore> {
  const deps: WalkInDeps = { ...defaultWalkInDeps, ...overrides };
  let attempt = freshAttempt();
  /** Bumped at sign-out: the member an action began for is gone. */
  let session = 0;

  function currentRun(): Run {
    return { attempt, session };
  }

  /** `run`'s attempt is still the one in hand (see `Run`). */
  function live(run: Run): boolean {
    return run.attempt === attempt && run.session === session;
  }

  /** A payment F8 handed a run that has ended: let it go, its record stays for the recovery. */
  function letGo(result: HostedPayResult): void {
    if (result.kind !== 'busy' && result.attempt) void deps.leaveAttempt(result.attempt).catch(() => undefined);
  }

  const store = createStore<WalkInStore>()((set, get) => {
    // -- Refusals ----------------------------------------------------------

    /** A failed preview, confirm or pay step: its words and step, for `venueId`. */
    function showRefusal(error: unknown, venueId: string | null, chargeReason?: string | null): void {
      const refusal = confirmRefusal(error, chargeReason);
      const preview = get().preview;
      set({
        refusalVenueId: venueId,
        refusalVenueSlug: preview && venueId && preview.venue.id === venueId.toLowerCase() ? preview.venue.slug : null,
        error: refusal.message,
        errorCTA: refusal.cta,
      });
    }

    /** The blocked preview's reason, with its step. */
    function showBlocked(preview: WalkInPreview): void {
      const refusal = blockingRefusal(preview.blockingReason);
      set({
        refusalVenueId: preview.venue.id,
        refusalVenueSlug: preview.venue.slug,
        error: refusal.message,
        errorCTA: refusal.cta,
      });
    }

    // -- The proof -----------------------------------------------------------

    /** What the attempt in hand is for, as F8 saves it before a hosted page opens. */
    function walkInContext(a: Attempt, venueId: string): WalkInAttemptContext {
      const state = get();
      const activityId = a.pendingActivityId;
      return {
        venueId,
        venueName: state.preview?.venue.name ?? null,
        venueSlug: state.preview?.venue.slug ?? null,
        activityId,
        activityName: state.pickerActivities.find((activity) => activity.id === activityId)?.name ?? null,
        party: confirmedParty(state),
      };
    }

    /**
     * The proof of a payment on the pay rail, drawn from what THAT payment
     * was for (`context`), never from whatever the screen holds by the time
     * it settles: the venue, now, no name (a payment session carries none,
     * and no name is honest where the wrong one is not), the party that was
     * paid for, no balance. The activity only for a page this attempt opened:
     * iOS names none for an earlier session's payment
     * (`booking_payment_already_completed`).
     */
    function showPaidProof(
      context: WalkInAttemptContext | null,
      withActivity: boolean,
      lifetimeCheckIns: number | null = null,
    ): void {
      const state = get();
      set({
        successVenueName: context?.venueName ?? state.preview?.venue.name ?? null,
        successActivityName: withActivity ? (context?.activityName ?? null) : null,
        successTimestamp: deps.now(),
        successMemberShortName: null,
        successParty: context ? (context.party ?? null) : confirmedParty(state),
        successCoverage: null,
        successLifetimeCheckIns: lifetimeCheckIns,
        showSuccess: true,
      });
    }

    // -- Confirm -------------------------------------------------------------

    async function confirm(run: Run, venueId: string, activityId: string | null, acceptCharge = false): Promise<void> {
      const a = run.attempt;
      const key = a.walkInKey ?? deps.newKey();
      a.walkInKey = key;
      a.pendingVenueId = venueId;
      a.pendingActivityId = activityId;
      const state = get();
      let result: WalkInResult;
      try {
        result = await deps.confirm(
          {
            venueId,
            activityId,
            acceptCharge,
            acceptedChargeAmountIsk: acceptCharge ? (state.pendingOffer?.amountIsk ?? null) : null,
            bookingAction: a.pendingBookingAction,
            guestAgeBands: guestAgeBandsPayload(state.guestCounts),
          },
          key,
        );
      } catch (error) {
        if (!live(run)) return;
        await confirmFailed(run, error, venueId);
        if (live(run)) set({ isProcessing: false });
        return;
      }
      // The check-in stood for this member, whatever the screen does now: its
      // "How was your visit?" ask is theirs to be reminded of. Never after a
      // sign-out (the next member's phone must not carry it).
      if (run.session === session) {
        deps.checkedIn({ ratingPrompt: result.ratingPrompt, lifetimeCheckIns: result.lifetimeCheckIns });
      }
      if (!live(run)) {
        // Checked in, for an attempt that is no longer in hand. Its proof is
        // nobody's to see now; the same member's balance still moved.
        if (run.session === session) void deps.refreshCredits().catch(() => undefined);
        return;
      }
      track('walk_in_check_in', { venue_id: venueId });
      set({
        successVenueName: result.venue?.name ?? get().preview?.venue.name ?? null,
        successActivityName: result.activity?.name ?? null,
        successTimestamp: result.checkedInAt ?? deps.now(),
        successMemberShortName: result.memberShortName,
        successParty: result.party,
        successCoverage: result.coveredBy,
        successLifetimeCheckIns: result.lifetimeCheckIns,
        showSuccess: true,
        scannedVenueId: null,
        preview: null,
        pendingOffer: null,
      });
      a.walkInKey = null;
      await deps.refreshCredits().catch(() => undefined);
      if (live(run)) set({ isProcessing: false });
    }

    async function confirmFailed(run: Run, error: unknown, venueId: string): Promise<void> {
      const a = run.attempt;
      if (error instanceof ProblemError && error.offer) {
        // 402 charge_consent_required: the server's price is authoritative.
        // Re-consent under the SAME key, saying so when the price moved; a
        // 402 with no preview reason (a charge that appeared since) takes
        // the offer's own vocabulary, so a boutique never reads as premium.
        const offer = error.offer;
        const state = get();
        set({
          offerWasReoffered: state.pendingOffer !== null && state.pendingOffer.amountIsk !== offer.amountIsk,
          pendingOffer: offer,
          pendingChargeReason: state.pendingChargeReason ?? offer.reason ?? null,
          showChargeConsent: true,
        });
        return;
      }
      if (isProblem(error, 'no_payment_method_on_file')) {
        // No saved card: pay on the hosted page, which also saves one. The
        // key, venue and activity are kept: the session reuses the key.
        set({ isProcessing: false });
        await startWalkInPayment(run);
        return;
      }
      if (isProblem(error, 'walk_in_activity_invalid') && !a.activityInvalidRefetched) {
        // The picked activity went away mid-flow: re-preview once and offer
        // the picker again; a second failure reads as the error below.
        a.activityInvalidRefetched = true;
        a.walkInKey = null;
        try {
          const preview = await deps.preview(venueId);
          if (!live(run)) return;
          set({ preview, pickerActivities: preview.activities, showActivityPicker: preview.activities.length > 0 });
        } catch {
          // The sentence below.
        }
        if (!live(run)) return;
        if (!get().showActivityPicker) set({ error: t('checkin.err.activity_invalid'), errorCTA: null });
        return;
      }
      if (isProblem(error, 'attendable_booking_not_found')) {
        // The booked class went away between the preview and the tap. The
        // next scan previews afresh and offers the normal walk-in.
        a.walkInKey = null;
        a.pendingBookingAction = null;
        a.pendingVenueId = null;
        a.pendingActivityId = null;
        set({ attendableBooking: null, error: t('checkin.attend.gone'), errorCTA: null });
        return;
      }
      showRefusal(error, venueId, get().pendingChargeReason);
      // Any other failure ends the attempt: a later scan (perhaps of another
      // venue) must not collide with this one through the server's key.
      a.walkInKey = null;
      a.pendingVenueId = null;
      a.pendingActivityId = null;
    }

    // -- Proceed -------------------------------------------------------------

    /** After the preview: the guest step, the consent, the link question, or the confirm. */
    async function proceed(run: Run, venueId: string, activityId: string | null): Promise<void> {
      if (!live(run)) return;
      const a = run.attempt;
      const state = get();
      const bands = state.preview?.guestBands ?? null;
      if (!a.guestChoiceMade && bands && bands.length > 0 && a.pendingBookingAction !== 'attend') {
        // Asked once per attempt, before any money talk; never on the attend
        // path. A free own visit leads with itself and keeps the guest prices
        // behind "Bringing a guest?"; a charged one asks about guests first,
        // so the consent's total covers the party.
        a.pendingGuestVenueId = venueId;
        a.pendingGuestActivityId = activityId;
        const free = state.preview ? ownVisitIsFree(state.preview) : true;
        set({ guestBandOffers: bands, isProcessing: false, showOwnVisitConfirm: free, showGuestPicker: !free });
        return;
      }
      const ownCharge = state.preview?.charge ?? null;
      const total = (ownCharge?.amountIsk ?? 0) + guestTotalIsk(state);
      if (total > 0) {
        a.pendingVenueId = venueId;
        a.pendingActivityId = activityId;
        set({
          pendingOffer: {
            kind: ownCharge?.kind ?? 'surcharge',
            amountIsk: total,
            ...(ownCharge ? {} : { reason: 'guest_party' }),
          },
          pendingChargeReason: ownCharge?.reason ?? null,
          isProcessing: false,
          showChargeConsent: true,
        });
        return;
      }
      if (state.linkedAttempt) {
        a.pendingVenueId = venueId;
        a.pendingActivityId = activityId;
        set({ isProcessing: false, showLinkConfirm: true });
        return;
      }
      await confirm(run, venueId, activityId);
    }

    /** Blocked, one activity (re-previewed with it), none (venue level), or the picker. */
    async function routeByActivities(run: Run, venueId: string, preview: WalkInPreview): Promise<void> {
      if (!preview.allowed) {
        showBlocked(preview);
        set({ isProcessing: false });
        return;
      }
      if (preview.activities.length === 1) {
        // The single activity can override the venue's price: disclose its
        // own, or the consent would meet a false "price changed" 402.
        const only = preview.activities[0];
        try {
          const own = await deps.preview(venueId, only.id);
          if (live(run)) set({ preview: own });
        } catch {
          // Best effort: the venue-level preview stands and a 402 re-offers.
        }
        await proceed(run, venueId, only.id);
      } else if (preview.activities.length === 0) {
        await proceed(run, venueId, null);
      } else {
        set({ pickerActivities: preview.activities, isProcessing: false, showActivityPicker: true });
      }
    }

    // -- Pay and save the card ------------------------------------------------

    /**
     * From `402 no_payment_method_on_file`: the amount-only session under the
     * attempt's key, then the hosted page, settled by F8.
     */
    async function startWalkInPayment(run: Run): Promise<void> {
      const a = run.attempt;
      const state = get();
      const venueId = a.pendingVenueId;
      const amount = state.pendingOffer?.amountIsk;
      const key = a.walkInKey;
      if (!venueId || amount === undefined || !key) {
        set({ error: t('checkin.err.unavailable'), errorCTA: null });
        return;
      }
      set({ isProcessing: true });
      const bands = guestAgeBandsPayload(state.guestCounts);
      const input: WalkInPaymentSession = {
        kind: 'walk_in',
        activityId: a.pendingActivityId,
        venueId,
        acceptedChargeAmountIsk: amount,
        guestAgeBands: bands,
        // The mint-side guard refuses guest bands without an explicit walk-in.
        bookingAction: bands ? 'walk_in' : a.pendingBookingAction,
      };
      let creation: PaymentSessionCreation;
      try {
        creation = await deps.createSession(input, key);
      } catch (error) {
        if (!live(run)) return;
        set({ isProcessing: false });
        await sessionRefused(run, error, input, venueId);
        return;
      }
      if (!live(run)) return;
      set({ isProcessing: false });
      if (creation.kind === 'hasCard') {
        // A card exists after all: check in directly, with consent, same key.
        await confirm(run, venueId, a.pendingActivityId, true);
        return;
      }
      await payOnPage(run, creation.url, key, amount, venueId);
    }

    async function sessionRefused(run: Run, error: unknown, input: WalkInPaymentSession, venueId: string): Promise<void> {
      const a = run.attempt;
      const refusal = classifySessionCreateError(error, input);
      switch (refusal.kind) {
        case 'reoffer': {
          const pending = get().pendingOffer;
          set({
            offerWasReoffered: pending !== null && pending.amountIsk !== refusal.offer.amountIsk,
            pendingOffer: refusal.offer,
            showChargeConsent: true,
          });
          return;
        }
        case 'alreadyCompleted':
          // An earlier session already checked this in: the proof, paid. No
          // page opened for this attempt, so (as iOS) no activity is named.
          showPaidProof(walkInContext(a, venueId), false);
          a.walkInKey = null;
          set({ pendingOffer: null });
          return;
        case 'unresolved':
          set({ payOutcome: { kind: 'needsAttention' } });
          return;
        case 'notRequired':
          // No charge applies now: the free check-in, same key.
          set({ pendingOffer: null });
          await confirm(run, venueId, a.pendingActivityId);
          return;
        case 'blocked':
          // Walk-ins are off or the drop-in price is unset: a dead end.
          a.walkInKey = null;
          a.pendingVenueId = null;
          a.pendingActivityId = null;
          set({ error: t('checkin.err.pay_blocked'), errorCTA: null, pendingOffer: null });
          return;
        default:
          showRefusal(error, venueId);
      }
    }

    async function payOnPage(run: Run, url: string, key: string, amount: number, venueId: string): Promise<void> {
      const a = run.attempt;
      const memberId = deps.memberId();
      if (!memberId) {
        set({ error: t('checkin.err.unavailable'), errorCTA: null });
        return;
      }
      // What this page pays for, fixed as it opens: the proof after it is
      // drawn from this, whatever the screen holds by the time it settles.
      const context = walkInContext(a, venueId);
      a.pageContext = context;
      set({ payPageOpen: true });
      let result: HostedPayResult;
      try {
        result = await deps.payOnPage({
          memberId,
          rail: 'walk_in',
          url,
          key,
          amountIsk: amount,
          walkIn: context,
          // An attempt that has ended counts as a screen that has gone, so F8
          // says the outcome itself (to the same member only) or keeps it
          // for the recovery, instead of handing it to nobody.
          isScreenAlive: () => live(run) && deps.isScreenAlive(),
          onConfirming: () => {
            if (live(run)) set({ payPageOpen: false, isProcessing: true });
          },
        });
      } catch (error) {
        if (!live(run)) return;
        set({ payPageOpen: false, isProcessing: false, error: confirmRefusal(error).message, errorCTA: null });
        return;
      }
      if (!live(run)) {
        letGo(result);
        return;
      }
      set({ payPageOpen: false, isProcessing: false });
      if (result.kind === 'busy') {
        // The member consented and the session exists, but another payment
        // holds the rails (a booking page settling, or the recovery settling
        // an earlier one): no page opened. Say so, and end the attempt so
        // the next scan starts under a new key; "Confirm and pay" must never
        // look as if it did nothing.
        a.walkInKey = null;
        a.pendingVenueId = null;
        a.pendingActivityId = null;
        a.pageContext = null;
        set({ error: t('checkin.err.unavailable'), errorCTA: null, pendingOffer: null });
        return;
      }
      await applyPayResult(run, result, context);
    }

    /**
     * A settled or handed-over payment, for `run`. `own` is what the payment
     * settled was for (this attempt's page, or the held one's).
     */
    async function applyPayResult(run: Run, result: HostedPayResult, own: WalkInAttemptContext | null): Promise<void> {
      const a = run.attempt;
      switch (result.kind) {
        case 'busy':
          // Nothing held any more and no key to ask by: nothing happened here.
          return;
        case 'unresolved': {
          // An earlier attempt at this venue is still unknown: "Confirming
          // your payment", with Check again under ITS key. Its proof, should
          // it be paid, is ITS party and activity, read back from its record.
          const context = await deps.attemptContext(result.attempt).catch(() => null);
          if (!live(run)) {
            letGo(result);
            return;
          }
          a.held = { ref: result.attempt, context };
          set({ payOutcome: result.settlement.kind === 'outcome' ? result.settlement.outcome : { kind: 'processing' } });
          return;
        }
        case 'settled':
          a.held = result.attempt ? { ref: result.attempt, context: own } : null;
          if (result.key === 'retire') a.walkInKey = null;
          // The screen was gone and F8 said it already.
          if (result.presented) return;
          // `earlier`: no page opened; this venue's walk-in was paid a moment
          // ago. Which activity it was for is not known here, so none is
          // named, as iOS does for an earlier session's payment.
          await applySettlement(run, result.settlement, own, result.page !== 'earlier');
      }
    }

    async function applySettlement(
      run: Run,
      settlement: PaySettlement,
      context: WalkInAttemptContext | null,
      withActivity: boolean,
    ): Promise<void> {
      const a = run.attempt;
      switch (settlement.kind) {
        case 'fulfilled':
          showPaidProof(context, withActivity, settlement.confirmation.lifetimeCheckIns);
          a.walkInKey = null;
          set({ scannedVenueId: null, preview: null, pendingOffer: null });
          await deps.refreshCredits().catch(() => undefined);
          return;
        case 'outcome':
          set({ payOutcome: settlement.outcome });
          return;
        case 'sessionNotFound':
          // A genuine early back-out: nothing was charged.
          a.walkInKey = null;
          return;
        case 'failed':
          // The money is the server's to settle: the words, with no step that
          // could start a second payment.
          set({ error: confirmRefusal(settlement.error).message, errorCTA: null });
      }
    }

    // -- Actions ---------------------------------------------------------------

    return {
      ...INITIAL_WALK_IN_STATE,

      async startWalkIn(venueId, options = { fromLink: false }) {
        // A brand-new scan is a fresh attempt: never a stale key, or the
        // server's idempotency could answer with another venue's check-in.
        // Whatever the last attempt still had in flight stops here (the
        // fence), and a payment it held goes back to the recovery, which
        // speaks when it settles: Check again on this attempt must never
        // settle that one under this attempt's preview.
        const previous = attempt;
        attempt = freshAttempt();
        const run = currentRun();
        if (previous.held) void deps.leaveAttempt(previous.held.ref).catch(() => undefined);
        set({
          scannedVenueId: venueId,
          isProcessing: true,
          error: null,
          errorCTA: null,
          linkedAttempt: options.fromLink,
          showLinkConfirm: false,
          pendingOffer: null,
          pendingChargeReason: null,
          offerWasReoffered: false,
          attendableBooking: null,
          guestBandOffers: [],
          guestCounts: {},
          showGuestPicker: false,
          showOwnVisitConfirm: false,
          payOutcome: null,
        });
        try {
          const preview = await deps.preview(venueId);
          if (!live(run)) return;
          set({ preview });
          // A booked class here: stop before any walk-in runs, even at a
          // blocked or class-only venue (attendance is not a walk-in).
          if (preview.attendableBooking) {
            run.attempt.pendingVenueId = venueId;
            set({ attendableBooking: preview.attendableBooking, isProcessing: false, showAttendChoice: true });
            return;
          }
          await routeByActivities(run, venueId, preview);
        } catch (error) {
          if (!live(run)) return;
          // The preview's own refusal (an unknown venue, a throttle) in the
          // member's words; offline reads as offline.
          showRefusal(error, venueId);
          set({ isProcessing: false });
        }
      },

      async selectActivity(activity) {
        const state = get();
        const venueId = state.scannedVenueId ?? state.preview?.venue.id;
        if (!venueId || state.isProcessing) return;
        const run = currentRun();
        set({ showActivityPicker: false, isProcessing: true });
        // Re-preview WITH the activity, so the charge disclosed is its own.
        try {
          const own = await deps.preview(venueId, activity.id);
          if (live(run)) set({ preview: own });
        } catch {
          // Best effort, as above.
        }
        await proceed(run, venueId, activity.id);
      },

      cancelActivityPicker() {
        set({ showActivityPicker: false });
      },

      async attendBookedClass() {
        const state = get();
        const venueId = attempt.pendingVenueId ?? state.scannedVenueId ?? state.preview?.venue.id;
        if (!venueId || state.isProcessing) return;
        const run = currentRun();
        // Free: no consent, no picker (the class's activity rides the
        // booking), no guests.
        run.attempt.pendingBookingAction = 'attend';
        set({ showAttendChoice: false, isProcessing: true });
        await confirm(run, venueId, null);
      },

      async walkInInsteadOfClass() {
        const state = get();
        const venueId = attempt.pendingVenueId ?? state.scannedVenueId ?? state.preview?.venue.id;
        const preview = state.preview;
        if (!venueId || !preview || state.isProcessing) return;
        const run = currentRun();
        // The member declined the class: the normal walk-in, and the booking
        // stays untouched for a later scan.
        run.attempt.pendingBookingAction = 'walk_in';
        set({ showAttendChoice: false, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        if (!live(run)) return;
        await routeByActivities(run, venueId, preview);
      },

      dismissAttendChoice() {
        if (!get().showAttendChoice) return;
        attempt.pendingVenueId = null;
        set({ showAttendChoice: false });
      },

      async confirmLinkedWalkIn() {
        const venueId = attempt.pendingVenueId;
        if (!venueId || get().isProcessing) return;
        const run = currentRun();
        set({ showLinkConfirm: false, linkedAttempt: false, isProcessing: true });
        await confirm(run, venueId, run.attempt.pendingActivityId);
      },

      declineLinkedWalkIn() {
        // Once: a Cancel tapped after Check in must not end the check-in
        // under way (iOS disables an alert while it dismisses).
        const state = get();
        if (!state.showLinkConfirm || state.isProcessing) return;
        // Nothing was sent, so there is nothing to undo.
        attempt.walkInKey = null;
        attempt.pendingVenueId = null;
        attempt.pendingActivityId = null;
        set({ showLinkConfirm: false, linkedAttempt: false, scannedVenueId: null, isProcessing: false });
      },

      async checkInOwnVisit() {
        // Once per step: the sheet stays on screen while it closes, and a
        // second tap must not run the check-in, its proof and its analytics
        // twice.
        const state = get();
        const venueId = attempt.pendingGuestVenueId;
        if (!state.showOwnVisitConfirm || state.isProcessing || !venueId) return;
        const run = currentRun();
        run.attempt.pendingGuestVenueId = null;
        run.attempt.guestChoiceMade = true;
        // The tap is the member's own, so a link does not ask a second time.
        set({ showOwnVisitConfirm: false, linkedAttempt: false, guestCounts: {}, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        if (!live(run)) return;
        await proceed(run, venueId, run.attempt.pendingGuestActivityId);
      },

      async openGuestsFromOwnVisit() {
        const state = get();
        if (!state.showOwnVisitConfirm || state.isProcessing || !attempt.pendingGuestVenueId) return;
        const run = currentRun();
        set({ isSwitchingToGuests: true, showOwnVisitConfirm: false, linkedAttempt: false });
        await sleep(deps.dismissBeatMs);
        if (!live(run)) return;
        set({ isSwitchingToGuests: false, showGuestPicker: true });
      },

      declineOwnVisit() {
        // Once per step, as its two buttons: a close tapped after "Check in,
        // no charge" must not strip the check-in under way of its activity.
        const state = get();
        if (!state.showOwnVisitConfirm || state.isProcessing) return;
        // Nothing was sent; the next scan starts a fresh attempt.
        attempt.walkInKey = null;
        attempt.pendingVenueId = null;
        attempt.pendingActivityId = null;
        attempt.pendingGuestVenueId = null;
        attempt.pendingGuestActivityId = null;
        set({
          showOwnVisitConfirm: false,
          linkedAttempt: false,
          guestBandOffers: [],
          guestCounts: {},
          scannedVenueId: null,
          isProcessing: false,
        });
      },

      addGuest(band) {
        const state = get();
        // The member plus up to nine guests: the server's ceiling.
        if (guestCountTotal(state) >= MAX_GUESTS) return;
        set({ guestCounts: { ...state.guestCounts, [band]: (state.guestCounts[band] ?? 0) + 1 } });
      },

      removeGuest(band) {
        const state = get();
        set({ guestCounts: { ...state.guestCounts, [band]: Math.max(0, (state.guestCounts[band] ?? 0) - 1) } });
      },

      async confirmGuestSelection() {
        // Once per sheet: a second Continue would send the party twice, and a
        // Just me then would clear the guests the first tap is pricing.
        const state = get();
        const venueId = attempt.pendingGuestVenueId;
        if (!state.showGuestPicker || state.isProcessing || !venueId) return;
        const run = currentRun();
        run.attempt.pendingGuestVenueId = null;
        run.attempt.guestChoiceMade = true;
        set({ showGuestPicker: false, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        if (!live(run)) return;
        await proceed(run, venueId, run.attempt.pendingGuestActivityId);
      },

      async skipGuests() {
        const state = get();
        if (!state.showGuestPicker || state.isProcessing) return;
        set({ guestCounts: {} });
        await get().confirmGuestSelection();
      },

      cancelGuests() {
        const state = get();
        if (!state.showGuestPicker || state.isProcessing) return;
        attempt.walkInKey = null;
        attempt.pendingVenueId = null;
        attempt.pendingActivityId = null;
        attempt.pendingGuestVenueId = null;
        attempt.pendingGuestActivityId = null;
        set({ showGuestPicker: false, guestBandOffers: [], guestCounts: {}, scannedVenueId: null, linkedAttempt: false });
      },

      async acceptWalkInCharge() {
        const venueId = attempt.pendingVenueId;
        if (!venueId || get().isProcessing) return;
        const run = currentRun();
        set({ showChargeConsent: false, isProcessing: true });
        await confirm(run, venueId, run.attempt.pendingActivityId, true);
      },

      declineWalkInCharge() {
        // Once: a Cancel tapped after the accept must not drop the key of the
        // charged POST under way (a 402 for the card would then read as
        // "unavailable") or call the flow idle while it runs.
        const state = get();
        if (!state.showChargeConsent || state.isProcessing) return;
        attempt.walkInKey = null;
        set({
          showChargeConsent: false,
          pendingOffer: null,
          pendingChargeReason: null,
          offerWasReoffered: false,
          isProcessing: false,
        });
      },

      async checkPaymentAgain() {
        if (get().isProcessing) return;
        const run = currentRun();
        const a = run.attempt;
        const held = a.held;
        a.held = null;
        const key = a.walkInKey;
        set({ payOutcome: null, isProcessing: true });
        let result: HostedPayResult;
        let context = held ? held.context : a.pageContext;
        try {
          result = held ? await deps.checkAgain(held.ref, () => live(run) && deps.isScreenAlive()) : NOTHING_HELD;
          if (!live(run)) {
            letGo(result);
            return;
          }
          if (result.kind === 'busy' && key) {
            // No attempt held here any more (the recovery took it): ask by
            // this attempt's own key, for this attempt's own page.
            context = a.pageContext;
            const settlement = await deps.settle(key);
            if (!live(run)) return;
            result = {
              kind: 'settled',
              page: 'returned',
              leg: 'done',
              settlement,
              key: keyDisposition(settlement),
              presented: false,
              attempt: null,
            };
          }
        } catch (error) {
          if (!live(run)) return;
          set({ isProcessing: false, error: confirmRefusal(error).message, errorCTA: null });
          return;
        }
        set({ isProcessing: false });
        await applyPayResult(run, result, context);
      },

      dismissPayOutcome() {
        const held = attempt.held;
        attempt.held = null;
        // Its record stays: a later return to the app checks again quietly.
        if (held) void deps.leaveAttempt(held.ref).catch(() => undefined);
        set({ payOutcome: null });
      },

      dismissNeedsPaymentMethod() {
        set({ needsPaymentMethod: false });
      },

      dismissError() {
        set({ error: null, errorCTA: null });
      },

      async retryAfterRefusal() {
        const { refusalVenueId, linkedAttempt } = get();
        if (!refusalVenueId) return;
        // A new attempt, as a second scan would be; a link stays a link, so
        // it still stops on "Check in at <venue>?".
        await get().startWalkIn(refusalVenueId, { fromLink: linkedAttempt });
      },

      resetSuccess() {
        const { showSuccess: wasShowing, successLifetimeCheckIns } = get();
        attempt.guestChoiceMade = false;
        set({
          showSuccess: false,
          successVenueName: null,
          successActivityName: null,
          successTimestamp: null,
          successMemberShortName: null,
          successParty: null,
          successCoverage: null,
          successLifetimeCheckIns: null,
          guestBandOffers: [],
          guestCounts: {},
        });
        // Reported once the proof is down: whatever is asked of the member
        // next must never cover the screen reception reads.
        if (wasShowing) deps.leftProof({ lifetimeCheckIns: successLifetimeCheckIns });
      },

      showRecoveredProof(walkIn, lifetimeCheckIns = null) {
        // As the pay rail's own proof: no name (a payment session carries
        // none), the party that was paid for, no balance.
        set({
          successVenueName: walkIn.venueName ?? null,
          successActivityName: walkIn.activityName ?? null,
          successTimestamp: deps.now(),
          successMemberShortName: null,
          successParty: walkIn.party ?? null,
          successCoverage: null,
          successLifetimeCheckIns: lifetimeCheckIns,
          showSuccess: true,
        });
      },

      reset() {
        // Sign-out: a new session, so nothing still in flight lands (the
        // fence). F8 wipes the payment records itself; a hold is let go.
        const previous = attempt;
        attempt = freshAttempt();
        session += 1;
        if (previous.held) void deps.leaveAttempt(previous.held.ref).catch(() => undefined);
        set({ ...INITIAL_WALK_IN_STATE });
      },
    };
  });
  storeDeps.set(store, deps);
  return store;
}

// ---------------------------------------------------------------------------
// The app's one flow

/**
 * The walk-in in hand. One per app, as the flow is one per member at a door:
 * the Scan tab and a scanner pushed from a venue page share it, and only the
 * host on the screen in focus draws it (./WalkInFlowHost).
 */
export const walkInStore: StoreApi<WalkInStore> = createWalkInStore();
