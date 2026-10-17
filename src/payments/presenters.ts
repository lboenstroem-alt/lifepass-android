/**
 * Who tells the member how a payment ended when the screen that started it is
 * gone: after Android closed the app behind the page (the in-flight
 * recovery), or when the screen closed while the confirm ran.
 *
 * Each rail registers its presenter (BOOK-1 for bookings and classes, with
 * the check-in reminders; CHECKIN-2 for the walk-in's proof; PLANS-2 for the
 * welcome; ACCT-2 and ACCT-3 to refresh Account). Until one has, the default
 * below shows the same alert the rail's screen would have shown, in the same
 * words (iOS `BookingCopy` and `CheckInView` pay outcomes, `PlansView`'s
 * welcome and payment issue), and a booking that landed gets the check-in
 * reminders iOS schedules when any booking lands. Card setup and co-pay are
 * quiet, as on iOS: Account re-renders from what it reads.
 *
 * A rail's own presenter replaces the default whole: BOOK-1's must schedule
 * the reminders itself.
 *
 * WHEN AN OUTCOME IS SHOWN. iOS presents a pay outcome from the screen that
 * is waiting for it, never from app-activation work. Here the recovery runs
 * from F3's activation hook, which may fire while the launch screen, the
 * sign-in screens or a first-launch nudge are up, and on every return to the
 * foreground. So an outcome is shown only once the app's tabs are on screen
 * (the navigator is ready and not on the sign-in stack), and never while a
 * flow has a hosted page opening, open or settling (`holdPresentations`):
 * an old outcome must not wait under the new Custom Tab and greet the member
 * when they come back from an unrelated payment. Until then it waits here,
 * one per attempt: a later answer for the same attempt replaces an earlier
 * one still waiting ("Booking confirmed" over "Confirming your payment").
 * Whatever waits is dropped at sign-out, and is only ever shown to the member
 * who paid.
 */
import { refusalMessage } from '../api';
import { MerchantInfo } from '../config/merchantInfo';
import { showDialog, type DialogButton } from '../components/ui/Dialog';
import { t } from '../i18n';
import { navigationRef } from '../navigation/navigationRef';
import * as legacyNotifications from '../services/notifications';
import { useAppStore } from '../stores/appStore';

import type { PaySettlement } from './bookingPaymentSession';
import type { ConfirmedCard } from './cardSetup';
import {
  payCopyContext,
  type BookingInflight,
  type CardSetupInflight,
  type CopayInflight,
  type InflightRail,
  type PlanAttemptContext,
  type PlanInflight,
  type WalkInInflight,
} from './inflight';
import { confirmedBody, payOutcomeMessage, payOutcomeTitle, walkInConfirmRefusalMessage } from './payOutcomeCopy';
import type { PlanVerification } from './planVerification';

/** How a payment the screen could not show ended, by rail. */
export type PaymentResolution =
  | { readonly rail: 'booking'; readonly record: BookingInflight; readonly settlement: PaySettlement }
  | { readonly rail: 'walk_in'; readonly record: WalkInInflight; readonly settlement: PaySettlement }
  | { readonly rail: 'plan'; readonly record: PlanInflight; readonly verification: PlanVerification }
  | {
      readonly rail: 'card_setup';
      readonly record: CardSetupInflight;
      /** The card the pull found (null: none added); undefined when the confirm failed. */
      readonly card: ConfirmedCard | null | undefined;
    }
  | { readonly rail: 'copay'; readonly record: CopayInflight; readonly settled: boolean };

/** What a presenter can do besides showing words. */
export interface PresenterActions {
  /**
   * Check again under the same key (a booking or walk-in still `processing`):
   * asks the server again and presents what it says. A no-op for other rails.
   */
  readonly checkAgain: () => void;
}

export type PaymentOutcomePresenter = (resolution: PaymentResolution, actions: PresenterActions) => void;

const presenters = new Map<InflightRail, PaymentOutcomePresenter>();

/**
 * Replaces the default presenter for `rail` (one per rail; registering again
 * replaces it). Returns an unregister. Register from the rail's own
 * `src/features/<area>/register.ts`, so the presenter is in place before any
 * recovery runs.
 */
export function registerPaymentOutcomePresenter(rail: InflightRail, presenter: PaymentOutcomePresenter): () => void {
  presenters.set(rail, presenter);
  return () => {
    if (presenters.get(rail) === presenter) presenters.delete(rail);
  };
}

/** Shows `resolution` now, through the rail's presenter or the default one. */
function deliver(resolution: PaymentResolution, actions: PresenterActions): void {
  const presenter = presenters.get(resolution.rail) ?? defaultPresenter;
  try {
    presenter(resolution, actions);
  } catch (error) {
    if (__DEV__ && process.env.NODE_ENV !== 'test') console.warn('[payments] presenter failed', error);
  }
}

/** True while `memberId` is the member signed in (an outcome is only ever theirs). */
function stillSignedIn(memberId: string): boolean {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  return isAuthenticated && (userId ?? profile?.id ?? '').toLowerCase() === memberId.toLowerCase();
}

/** The app's tabs are on screen: the navigator is mounted and not on the sign-in stack. */
function defaultShellReady(): boolean {
  try {
    if (!navigationRef.isReady()) return false;
    const state = navigationRef.getRootState();
    const route = state?.routes?.[state.index ?? 0];
    return route !== undefined && route.name !== 'Auth';
  } catch {
    return false;
  }
}

let shellReady: () => boolean = defaultShellReady;
let holds = 0;
/** Bumped when the holds are forgotten (tests' process death), so an old release changes nothing. */
let holdGeneration = 0;

interface Waiting {
  readonly attemptId: string;
  readonly memberId: string;
  readonly resolution: PaymentResolution;
  readonly actions: PresenterActions;
}

let waiting: Waiting[] = [];
let unwatch: (() => void) | null = null;

function canPresentNow(): boolean {
  return holds === 0 && shellReady();
}

/** Listens for the navigator becoming ready or changing (sign-in done) while something waits. */
function watchShell(): void {
  if (unwatch) return;
  try {
    const offReady = navigationRef.addListener('ready', flushPresentations);
    const offState = navigationRef.addListener('state', flushPresentations);
    unwatch = () => {
      offReady();
      offState();
    };
  } catch {
    unwatch = () => undefined;
  }
}

function stopWatching(): void {
  unwatch?.();
  unwatch = null;
}

/** Shows what waited, once nothing stops it (see the file comment). */
export function flushPresentations(): void {
  if (waiting.length === 0) {
    stopWatching();
    return;
  }
  if (!canPresentNow()) return;
  const due = waiting;
  waiting = [];
  stopWatching();
  for (const item of due) {
    if (stillSignedIn(item.memberId)) deliver(item.resolution, item.actions);
  }
}

/**
 * Shows `resolution` through the rail's presenter, or the default one, as
 * soon as the member can see it (see the file comment). A later answer for
 * the same attempt replaces one still waiting.
 */
export function presentResolution(resolution: PaymentResolution, actions: PresenterActions): void {
  const memberId = resolution.record.memberId;
  if (waiting.length === 0 && canPresentNow()) {
    deliver(resolution, actions);
    return;
  }
  const attemptId = resolution.record.attemptId;
  waiting = [...waiting.filter((item) => item.attemptId !== attemptId), { attemptId, memberId, resolution, actions }];
  watchShell();
  flushPresentations();
}

/**
 * A flow is opening, showing or settling a hosted page: outcomes of other
 * payments wait until it is done. Returns the release (idempotent), which
 * shows what waited.
 */
export function holdPresentations(): () => void {
  holds += 1;
  const generation = holdGeneration;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (generation === holdGeneration) holds -= 1;
    flushPresentations();
  };
}

/** Sign-out: what waited was the member's who left; nothing of it is shown. */
export function forgetWaitingPresentations(): void {
  waiting = [];
  stopWatching();
}

/** Tests only: whether the tabs are on screen (null: the navigator decides). */
export function setShellReadyForTests(ready: (() => boolean) | null): void {
  shellReady = ready ?? defaultShellReady;
}

/** True when the default presenter has anything to say about `resolution`. */
function defaultSpeaks(resolution: PaymentResolution): boolean {
  switch (resolution.rail) {
    case 'booking':
    case 'walk_in':
      return resolution.settlement.kind !== 'sessionNotFound';
    case 'plan':
      return resolution.verification.kind !== 'cancelled' && resolution.verification.kind !== 'unverified';
    case 'card_setup':
    case 'copay':
      return false;
  }
}

/**
 * Whether `resolution` goes to a presenter at all. The default speaks only
 * when there is something to say; a rail's own presenter is also told about
 * the quiet endings (a card setup, a co-pay, a session that never existed),
 * so Account can re-read what it shows, and shows nothing for them.
 */
export function shouldPresent(resolution: PaymentResolution): boolean {
  return presenters.has(resolution.rail) || defaultSpeaks(resolution);
}

// ---------------------------------------------------------------------------
// The defaults

function ok(): DialogButton[] {
  return [{ label: t('common.ok'), role: 'cancel' }];
}

/** A pay outcome's buttons, as each iOS screen has them. */
function outcomeButtons(settlement: PaySettlement, walkIn: boolean, actions: PresenterActions): DialogButton[] {
  if (settlement.kind !== 'outcome') return ok();
  switch (settlement.outcome.kind) {
    case 'processing':
      return [
        { label: t('common.cancel'), role: 'cancel' },
        { label: t('booking.pay.check_again'), onPress: actions.checkAgain },
      ];
    case 'needsAttention':
      // The booking flow ends on Done; the door's alert has OK.
      return walkIn ? ok() : [{ label: t('common.done') }];
    default:
      return ok();
  }
}

/**
 * The check-in reminders for a booking that landed while its screen was gone.
 * iOS schedules them the moment any booking lands (`BookingConfirmComponents`
 * on `bookingComplete`, `ClassReminderService.scheduleCheckInReminder`): the
 * class's name, else the activity's, at the class's or the slot's start,
 * with the notification permission asked right there, in context. A refusal
 * or a failure never touches the booking.
 *
 * Through the legacy notification shim's `scheduleBookingReminders` until
 * BOOK-1 registers its own presenter (and with it its own reminder call),
 * and ONLY once that shim is F7's: the iOS T-30 and T-10 rungs in the
 * account's language, keyed by the start (it then exports
 * `classReminderIdentifiers`). The first build's shim sends English
 * reminders a day and an hour ahead; scheduling those would be worse than
 * none, so until F7 has merged nothing is scheduled here. The booking's own
 * id is passed (the old shim keys its reminders by it, and a cancel removes
 * them by it), not the payment's key.
 */
function iosReminderScheduler(): typeof legacyNotifications.scheduleBookingReminders | null {
  const shim = legacyNotifications as unknown as Record<string, unknown>;
  return typeof shim.classReminderIdentifiers === 'function' && typeof shim.scheduleBookingReminders === 'function'
    ? legacyNotifications.scheduleBookingReminders
    : null;
}

function scheduleCheckInReminders(record: BookingInflight, bookingId: string | null): void {
  const { booking } = record;
  const startsAt = booking.startsAt ? new Date(booking.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return;
  const name = booking.className?.trim() || booking.activityName?.trim() || '';
  try {
    const schedule = iosReminderScheduler();
    if (!schedule) return;
    void schedule({
      bookingId: bookingId ?? record.key,
      venueName: booking.venueName?.trim() ?? '',
      activityName: name,
      bookingTime: startsAt,
    }).catch(() => undefined);
  } catch {
    // Reminders are a courtesy: nothing about them may reach the member's booking.
  }
}

/**
 * How long Home re-offers a walk-in's proof: the server stops sending
 * `recentCheckIn` 15 minutes after the check-in (iOS HomeView). A check-in
 * made by this confirm, or by a sweep after the page opened, is no older
 * than the attempt.
 */
export const PROOF_ON_HOME_MS = 15 * 60 * 1000;

/** The words for a walk-in confirmed after its screen was gone. */
function walkInConfirmedMessage(record: WalkInInflight, now: number = Date.now()): string {
  const venue = record.walkIn.venueName?.trim();
  // Point to Home's "Show to staff" only while Home still shows it.
  const proofOnHome = now - Date.parse(record.startedAt) < PROOF_ON_HOME_MS;
  if (proofOnHome) {
    return venue ? t('payments.recovered.checked_in_venue', { venue }) : t('payments.recovered.checked_in');
  }
  return venue ? t('payments.recovered.paid_checked_in_venue', { venue }) : t('payments.recovered.paid_checked_in');
}

function presentPaySettlement(resolution: PaymentResolution & { rail: 'booking' | 'walk_in' }, actions: PresenterActions) {
  const { settlement, record } = resolution;
  const walkIn = resolution.rail === 'walk_in';
  switch (settlement.kind) {
    case 'sessionNotFound':
      return;
    case 'failed':
      showDialog({
        title: t(walkIn ? 'common.error_title' : 'booking.err.title'),
        message: walkIn ? walkInConfirmRefusalMessage(settlement.error) : refusalMessage(settlement.error),
        buttons: ok(),
      });
      return;
    case 'fulfilled':
      if (resolution.rail === 'walk_in') {
        showDialog({
          title: t('checkin.proof.banner_title'),
          message: walkInConfirmedMessage(resolution.record),
          buttons: ok(),
        });
      } else {
        showDialog({
          title: t('booking.confirmed_title'),
          message: confirmedBody(true, resolution.record.booking.kind === 'class'),
          buttons: [{ label: t('common.done') }],
        });
        scheduleCheckInReminders(resolution.record, settlement.confirmation.bookingId);
      }
      return;
    case 'outcome':
      showDialog({
        title: payOutcomeTitle(settlement.outcome),
        message: payOutcomeMessage(settlement.outcome, payCopyContext(record)),
        buttons: outcomeButtons(settlement, walkIn, actions),
      });
      return;
  }
}

/**
 * A plan or pass checkout's outcome in PlansView's words: the welcome (its
 * button re-reads the membership, as iOS's does), or "Payment issue" with
 * the support address when nothing could confirm it, or the status check's
 * refusal. A cancel and a quiet web-first check say nothing. Shown at once
 * (the legacy checkout screen uses it for its own answer, too).
 */
export function presentPlanOutcome(plan: PlanAttemptContext, verification: PlanVerification): void {
  switch (verification.kind) {
    case 'confirmed': {
      const name = plan.planName?.trim();
      const message = name
        ? t(plan.productSlug.startsWith('pass-') ? 'plans.success.pass' : 'plans.success.subscription', { name })
        : t('plans.success.generic');
      showDialog({
        title: t('plans.welcome_title'),
        message,
        buttons: [{ label: t('plans.welcome_cta'), onPress: () => void useAppStore.getState().loadSubscription() }],
      });
      return;
    }
    case 'timeout':
      showDialog({
        title: t('plans.payment_issue'),
        message: t('plans.confirm_timeout', { email: MerchantInfo.email }),
        buttons: ok(),
      });
      return;
    case 'failed':
      showDialog({ title: t('plans.payment_issue'), message: refusalMessage(verification.error), buttons: ok() });
      return;
    case 'cancelled':
    case 'unverified':
      return;
  }
}

/** The default presenter: the rail's own alert, in its own words. */
export const defaultPresenter: PaymentOutcomePresenter = (resolution, actions) => {
  switch (resolution.rail) {
    case 'booking':
    case 'walk_in':
      presentPaySettlement(resolution, actions);
      return;
    case 'plan':
      presentPlanOutcome(resolution.record.plan, resolution.verification);
      return;
    case 'card_setup':
    case 'copay':
      return;
  }
};

/** Tests only: what a process death forgets here (what waited, and every hold); presenters stay registered. */
export function resetPresentationQueueForTests(): void {
  forgetWaitingPresentations();
  holds = 0;
  holdGeneration += 1;
}

/** Tests only: drop every registered presenter, and what waited. */
export function resetPresentersForTests(): void {
  presenters.clear();
  resetPresentationQueueForTests();
}
