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
 *   (`isProcessing`) does nothing (iOS relies on the sheet's dismissal for
 *   most of them; the own-visit and guest steps guard exactly as iOS does).
 * - The guest sheet, the attendance sheet and the activity picker answer
 *   hardware back: nothing has been sent at those steps, so back ends the
 *   attempt, as the own-visit step's close button does.
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
  /** The proof's Done. */
  resetSuccess(): void;
  /**
   * The proof of a walk-in paid on the hosted page and confirmed after the
   * screen that started it was gone (Android: F8's recovery after a cold
   * start), from what the attempt saved before the page opened.
   */
  showRecoveredProof(walkIn: WalkInAttemptContext): void;
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
export function consentContext(state: WalkInState): ConsentContext {
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
  /** The signed-in member (the hosted page's record is theirs). */
  memberId(): string | null;
  /** iOS `appState.refreshCredits()`: the plan and the profile, after a check-in. */
  refreshCredits(): Promise<void>;
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
  memberId: () => {
    const { userId, profile } = useAppStore.getState();
    return userId ?? profile?.id ?? null;
  },
  refreshCredits: () => useAppStore.getState().refreshCredits(),
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
  /** A payment still settling, held for Check again. */
  heldAttempt: AttemptRef | null;
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
    heldAttempt: null,
  };
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

export function createWalkInStore(overrides: Partial<WalkInDeps> = {}): StoreApi<WalkInStore> {
  const deps: WalkInDeps = { ...defaultWalkInDeps, ...overrides };
  let attempt = freshAttempt();

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

    /**
     * The proof after the hosted page (or an earlier session that already
     * checked this in): the preview's venue, the picked activity, now, no
     * name (a payment session carries none, and no name is honest where the
     * wrong one is not), the party the member paid for, no balance.
     */
    function showPaidProof(): void {
      const state = get();
      const activityId = attempt.pendingActivityId;
      set({
        successVenueName: state.preview?.venue.name ?? null,
        successActivityName: state.pickerActivities.find((activity) => activity.id === activityId)?.name ?? null,
        successTimestamp: deps.now(),
        successMemberShortName: null,
        successParty: confirmedParty(state),
        successCoverage: null,
        showSuccess: true,
      });
    }

    // -- Confirm -------------------------------------------------------------

    async function confirm(venueId: string, activityId: string | null, acceptCharge = false): Promise<void> {
      const key = attempt.walkInKey ?? deps.newKey();
      attempt.walkInKey = key;
      attempt.pendingVenueId = venueId;
      attempt.pendingActivityId = activityId;
      try {
        const state = get();
        const result = await deps.confirm(
          {
            venueId,
            activityId,
            acceptCharge,
            acceptedChargeAmountIsk: acceptCharge ? (state.pendingOffer?.amountIsk ?? null) : null,
            bookingAction: attempt.pendingBookingAction,
            guestAgeBands: guestAgeBandsPayload(state.guestCounts),
          },
          key,
        );
        track('walk_in_check_in', { venue_id: venueId });
        set({
          successVenueName: result.venue?.name ?? get().preview?.venue.name ?? null,
          successActivityName: result.activity?.name ?? null,
          successTimestamp: result.checkedInAt ?? deps.now(),
          successMemberShortName: result.memberShortName,
          successParty: result.party,
          successCoverage: result.coveredBy,
          showSuccess: true,
          scannedVenueId: null,
          preview: null,
          pendingOffer: null,
        });
        attempt.walkInKey = null;
        await deps.refreshCredits().catch(() => undefined);
      } catch (error) {
        await confirmFailed(error, venueId);
      }
      set({ isProcessing: false });
    }

    async function confirmFailed(error: unknown, venueId: string): Promise<void> {
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
        await startWalkInPayment();
        return;
      }
      if (isProblem(error, 'walk_in_activity_invalid') && !attempt.activityInvalidRefetched) {
        // The picked activity went away mid-flow: re-preview once and offer
        // the picker again; a second failure reads as the error below.
        attempt.activityInvalidRefetched = true;
        attempt.walkInKey = null;
        try {
          const preview = await deps.preview(venueId);
          set({ preview, pickerActivities: preview.activities, showActivityPicker: preview.activities.length > 0 });
        } catch {
          // The sentence below.
        }
        if (!get().showActivityPicker) set({ error: t('checkin.err.activity_invalid'), errorCTA: null });
        return;
      }
      if (isProblem(error, 'attendable_booking_not_found')) {
        // The booked class went away between the preview and the tap. The
        // next scan previews afresh and offers the normal walk-in.
        attempt.walkInKey = null;
        attempt.pendingBookingAction = null;
        attempt.pendingVenueId = null;
        attempt.pendingActivityId = null;
        set({ attendableBooking: null, error: t('checkin.attend.gone'), errorCTA: null });
        return;
      }
      showRefusal(error, venueId, get().pendingChargeReason);
      // Any other failure ends the attempt: a later scan (perhaps of another
      // venue) must not collide with this one through the server's key.
      attempt.walkInKey = null;
      attempt.pendingVenueId = null;
      attempt.pendingActivityId = null;
    }

    // -- Proceed -------------------------------------------------------------

    /** After the preview: the guest step, the consent, the link question, or the confirm. */
    async function proceed(venueId: string, activityId: string | null): Promise<void> {
      const state = get();
      const bands = state.preview?.guestBands ?? null;
      if (!attempt.guestChoiceMade && bands && bands.length > 0 && attempt.pendingBookingAction !== 'attend') {
        // Asked once per attempt, before any money talk; never on the attend
        // path. A free own visit leads with itself and keeps the guest prices
        // behind "Bringing a guest?"; a charged one asks about guests first,
        // so the consent's total covers the party.
        attempt.pendingGuestVenueId = venueId;
        attempt.pendingGuestActivityId = activityId;
        const free = state.preview ? ownVisitIsFree(state.preview) : true;
        set({ guestBandOffers: bands, isProcessing: false, showOwnVisitConfirm: free, showGuestPicker: !free });
        return;
      }
      const ownCharge = state.preview?.charge ?? null;
      const total = (ownCharge?.amountIsk ?? 0) + guestTotalIsk(state);
      if (total > 0) {
        attempt.pendingVenueId = venueId;
        attempt.pendingActivityId = activityId;
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
        attempt.pendingVenueId = venueId;
        attempt.pendingActivityId = activityId;
        set({ isProcessing: false, showLinkConfirm: true });
        return;
      }
      await confirm(venueId, activityId);
    }

    /** Blocked, one activity (re-previewed with it), none (venue level), or the picker. */
    async function routeByActivities(venueId: string, preview: WalkInPreview): Promise<void> {
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
          set({ preview: await deps.preview(venueId, only.id) });
        } catch {
          // Best effort: the venue-level preview stands and a 402 re-offers.
        }
        await proceed(venueId, only.id);
      } else if (preview.activities.length === 0) {
        await proceed(venueId, null);
      } else {
        set({ pickerActivities: preview.activities, isProcessing: false, showActivityPicker: true });
      }
    }

    // -- Pay and save the card ------------------------------------------------

    /**
     * From `402 no_payment_method_on_file`: the amount-only session under the
     * attempt's key, then the hosted page, settled by F8.
     */
    async function startWalkInPayment(): Promise<void> {
      const state = get();
      const venueId = attempt.pendingVenueId;
      const amount = state.pendingOffer?.amountIsk;
      const key = attempt.walkInKey;
      if (!venueId || amount === undefined || !key) {
        set({ error: t('checkin.err.unavailable'), errorCTA: null });
        return;
      }
      set({ isProcessing: true });
      const bands = guestAgeBandsPayload(state.guestCounts);
      const input: WalkInPaymentSession = {
        kind: 'walk_in',
        activityId: attempt.pendingActivityId,
        venueId,
        acceptedChargeAmountIsk: amount,
        guestAgeBands: bands,
        // The mint-side guard refuses guest bands without an explicit walk-in.
        bookingAction: bands ? 'walk_in' : attempt.pendingBookingAction,
      };
      let creation: PaymentSessionCreation;
      try {
        creation = await deps.createSession(input, key);
      } catch (error) {
        set({ isProcessing: false });
        await sessionRefused(error, input, venueId);
        return;
      }
      set({ isProcessing: false });
      if (creation.kind === 'hasCard') {
        // A card exists after all: check in directly, with consent, same key.
        await confirm(venueId, attempt.pendingActivityId, true);
        return;
      }
      await payOnPage(creation.url, key, amount, venueId);
    }

    async function sessionRefused(error: unknown, input: WalkInPaymentSession, venueId: string): Promise<void> {
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
          // An earlier session already checked this in: the proof, paid.
          showPaidProof();
          attempt.walkInKey = null;
          set({ pendingOffer: null });
          return;
        case 'unresolved':
          set({ payOutcome: { kind: 'needsAttention' } });
          return;
        case 'notRequired':
          // No charge applies now: the free check-in, same key.
          set({ pendingOffer: null });
          await confirm(venueId, attempt.pendingActivityId);
          return;
        case 'blocked':
          // Walk-ins are off or the drop-in price is unset: a dead end.
          attempt.walkInKey = null;
          attempt.pendingVenueId = null;
          attempt.pendingActivityId = null;
          set({ error: t('checkin.err.pay_blocked'), errorCTA: null, pendingOffer: null });
          return;
        default:
          showRefusal(error, venueId);
      }
    }

    async function payOnPage(url: string, key: string, amount: number, venueId: string): Promise<void> {
      const memberId = deps.memberId();
      if (!memberId) {
        set({ error: t('checkin.err.unavailable'), errorCTA: null });
        return;
      }
      const state = get();
      const activityId = attempt.pendingActivityId;
      set({ payPageOpen: true });
      let result: HostedPayResult;
      try {
        result = await deps.payOnPage({
          memberId,
          rail: 'walk_in',
          url,
          key,
          amountIsk: amount,
          walkIn: {
            venueId,
            venueName: state.preview?.venue.name ?? null,
            venueSlug: state.preview?.venue.slug ?? null,
            activityId,
            activityName: state.pickerActivities.find((activity) => activity.id === activityId)?.name ?? null,
            party: confirmedParty(state),
          },
          isScreenAlive: () => deps.isScreenAlive(),
          onConfirming: () => set({ payPageOpen: false, isProcessing: true }),
        });
      } catch (error) {
        set({ payPageOpen: false, isProcessing: false });
        set({ error: confirmRefusal(error).message, errorCTA: null });
        return;
      }
      set({ payPageOpen: false, isProcessing: false });
      await applyPayResult(result);
    }

    async function applyPayResult(result: HostedPayResult): Promise<void> {
      switch (result.kind) {
        case 'busy':
          // Another page is open, or this payment is being settled elsewhere:
          // nothing happened here.
          return;
        case 'unresolved':
          // An earlier attempt at this venue is still unknown: "Confirming
          // your payment", with Check again under ITS key.
          attempt.heldAttempt = result.attempt;
          set({ payOutcome: result.settlement.kind === 'outcome' ? result.settlement.outcome : { kind: 'processing' } });
          return;
        case 'settled':
          attempt.heldAttempt = result.attempt;
          if (result.key === 'retire') attempt.walkInKey = null;
          // The screen was gone and F8 said it already.
          if (result.presented) return;
          await applySettlement(result.settlement);
      }
    }

    async function applySettlement(settlement: PaySettlement): Promise<void> {
      switch (settlement.kind) {
        case 'fulfilled':
          showPaidProof();
          attempt.walkInKey = null;
          set({ scannedVenueId: null, preview: null, pendingOffer: null });
          await deps.refreshCredits().catch(() => undefined);
          return;
        case 'outcome':
          set({ payOutcome: settlement.outcome });
          return;
        case 'sessionNotFound':
          // A genuine early back-out: nothing was charged.
          attempt.walkInKey = null;
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
        attempt = { ...freshAttempt(), heldAttempt: attempt.heldAttempt };
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
        });
        try {
          const preview = await deps.preview(venueId);
          set({ preview });
          // A booked class here: stop before any walk-in runs, even at a
          // blocked or class-only venue (attendance is not a walk-in).
          if (preview.attendableBooking) {
            attempt.pendingVenueId = venueId;
            set({ attendableBooking: preview.attendableBooking, isProcessing: false, showAttendChoice: true });
            return;
          }
          await routeByActivities(venueId, preview);
        } catch (error) {
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
        set({ showActivityPicker: false, isProcessing: true });
        // Re-preview WITH the activity, so the charge disclosed is its own.
        try {
          set({ preview: await deps.preview(venueId, activity.id) });
        } catch {
          // Best effort, as above.
        }
        await proceed(venueId, activity.id);
      },

      cancelActivityPicker() {
        set({ showActivityPicker: false });
      },

      async attendBookedClass() {
        const state = get();
        const venueId = attempt.pendingVenueId ?? state.scannedVenueId ?? state.preview?.venue.id;
        if (!venueId || state.isProcessing) return;
        // Free: no consent, no picker (the class's activity rides the
        // booking), no guests.
        attempt.pendingBookingAction = 'attend';
        set({ showAttendChoice: false, isProcessing: true });
        await confirm(venueId, null);
      },

      async walkInInsteadOfClass() {
        const state = get();
        const venueId = attempt.pendingVenueId ?? state.scannedVenueId ?? state.preview?.venue.id;
        const preview = state.preview;
        if (!venueId || !preview || state.isProcessing) return;
        // The member declined the class: the normal walk-in, and the booking
        // stays untouched for a later scan.
        attempt.pendingBookingAction = 'walk_in';
        set({ showAttendChoice: false, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        await routeByActivities(venueId, preview);
      },

      dismissAttendChoice() {
        if (!get().showAttendChoice) return;
        attempt.pendingVenueId = null;
        set({ showAttendChoice: false });
      },

      async confirmLinkedWalkIn() {
        const venueId = attempt.pendingVenueId;
        if (!venueId || get().isProcessing) return;
        set({ showLinkConfirm: false, linkedAttempt: false, isProcessing: true });
        await confirm(venueId, attempt.pendingActivityId);
      },

      declineLinkedWalkIn() {
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
        attempt.pendingGuestVenueId = null;
        attempt.guestChoiceMade = true;
        // The tap is the member's own, so a link does not ask a second time.
        set({ showOwnVisitConfirm: false, linkedAttempt: false, guestCounts: {}, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        await proceed(venueId, attempt.pendingGuestActivityId);
      },

      async openGuestsFromOwnVisit() {
        const state = get();
        if (!state.showOwnVisitConfirm || state.isProcessing || !attempt.pendingGuestVenueId) return;
        set({ isSwitchingToGuests: true, showOwnVisitConfirm: false, linkedAttempt: false });
        await sleep(deps.dismissBeatMs);
        set({ isSwitchingToGuests: false, showGuestPicker: true });
      },

      declineOwnVisit() {
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
        attempt.pendingGuestVenueId = null;
        attempt.guestChoiceMade = true;
        set({ showGuestPicker: false, isProcessing: true });
        await sleep(deps.dismissBeatMs);
        await proceed(venueId, attempt.pendingGuestActivityId);
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
        set({ showChargeConsent: false, isProcessing: true });
        await confirm(venueId, attempt.pendingActivityId, true);
      },

      declineWalkInCharge() {
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
        const held = attempt.heldAttempt;
        attempt.heldAttempt = null;
        const key = attempt.walkInKey;
        set({ payOutcome: null, isProcessing: true });
        let result: HostedPayResult;
        try {
          result = held ? await deps.checkAgain(held, () => deps.isScreenAlive()) : { kind: 'busy' };
          if (result.kind === 'busy' && key) {
            // No attempt held here any more (the recovery took it): ask by key.
            const settlement = await deps.settle(key);
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
          set({ isProcessing: false, error: confirmRefusal(error).message, errorCTA: null });
          return;
        }
        set({ isProcessing: false });
        await applyPayResult(result);
      },

      dismissPayOutcome() {
        const held = attempt.heldAttempt;
        attempt.heldAttempt = null;
        // Its record stays: a later return to the app checks again quietly.
        if (held) void deps.leaveAttempt(held).catch(() => undefined);
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
        attempt.guestChoiceMade = false;
        set({
          showSuccess: false,
          successVenueName: null,
          successActivityName: null,
          successTimestamp: null,
          successMemberShortName: null,
          successParty: null,
          successCoverage: null,
          guestBandOffers: [],
          guestCounts: {},
        });
      },

      showRecoveredProof(walkIn) {
        // As the pay rail's own proof: no name (a payment session carries
        // none), the party that was paid for, no balance.
        set({
          successVenueName: walkIn.venueName ?? null,
          successActivityName: walkIn.activityName ?? null,
          successTimestamp: deps.now(),
          successMemberShortName: null,
          successParty: walkIn.party ?? null,
          successCoverage: null,
          showSuccess: true,
        });
      },

      reset() {
        attempt = freshAttempt();
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
 * newest mounted host draws it (./WalkInFlowHost).
 */
export const walkInStore: StoreApi<WalkInStore> = createWalkInStore();
