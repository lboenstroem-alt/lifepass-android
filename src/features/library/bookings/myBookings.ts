/* eslint lifepass/no-literal-copy: "error" */
/**
 * My bookings' state: the Android port of iOS `MyBookingsViewModel`
 * (ViewModels/MyBookingsViewModel.swift). One store per Profile screen, as
 * iOS gives each LibraryView its own view model: the lists, the load, and the
 * cancel with its refusal.
 *
 * THE LOAD reads both halves of `GET /bookings` at once: Upcoming soonest
 * first, Past newest first (the server's order is not relied on). It is
 * guarded against re-entry: a focus and a pull to refresh that land together
 * send one pair of reads, and the second caller simply returns. A failure
 * shows the "Error" alert with the error's own sentence (never a refusal
 * row: nothing was refused).
 *
 * The reload after a cancel's answer is the exception to that guard: it must
 * read the list as the server holds it NOW. A load already running (a pull
 * started while the cancel was in flight; Android keeps the list, and so the
 * X, on screen during a pull) may have read the booking before the cancel
 * landed, so the cancel waits for that load to finish and then reads again.
 * Simply returning, as iOS does, would leave a cancelled booking on screen as
 * "Confirmed" with a live X until the next focus or pull.
 *
 * THE CANCEL (2.5.5):
 *   - one at a time. While one is in flight every cancel button is disabled
 *     and a second cancel (a double tap, another card) is dropped, so a
 *     double tap sends ONE request;
 *   - one Idempotency-Key per booking until the server has answered that
 *     cancel for good. A timeout, no connection or a 5xx leaves the outcome
 *     open (the cancel may have landed, or may still be landing at the
 *     venue), so the key stays and a retry REPLAYS the same cancel, never a
 *     second one. A refusal the server meant (a problem with a status under
 *     500) or a success ends the attempt, so a later cancel of that booking
 *     is a new one with a new key;
 *   - on success the class's two check-in reminders (T-30, T-10) are removed:
 *     a "time for your class" nudge for a cancelled class would send the
 *     member to the door, and to a walk-in fee, for nothing. Then the list
 *     reloads;
 *   - on a refusal the member reads the CANCEL-context copy
 *     (`refusalMessage(error, 'cancel')`, src/api/refusals.ts): a provider
 *     that could not confirm reads "We couldn't confirm the cancellation with
 *     the venue", never the deadline sentence. When the server answered (a
 *     refusal row exists) the list reloads first, so the alert sits over the
 *     list as it now stands; a failed reload never replaces the refusal. The
 *     row's next step comes with it (Refresh, Try again, Contact support);
 *     "Try again" is the same cancel, under the same key when it is still
 *     open.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  ActionKeys,
  errorMessage,
  isCancellation,
  ProblemError,
  refusalFor,
  refusalMessage,
  type RefusalCta,
} from '../../../api';
import { cancelBooking, fetchBookings, type BookingRange, type MemberBooking } from '../../../api/bookingsList';
import { cancelCheckInReminder } from '../../bookings';

export interface MyBookingsState {
  /** Soonest first. */
  readonly upcoming: readonly MemberBooking[];
  /** Newest first. */
  readonly past: readonly MemberBooking[];
  readonly isLoading: boolean;
  /** The "Error" alert's sentence; null when there is none. */
  readonly error: string | null;
  /** A cancel refusal's next step, shown as the alert's second button. Cleared with `error`. */
  readonly errorCta: RefusalCta | null;
  /** The booking whose cancel is in flight: every cancel button waits for its answer. */
  readonly cancellingBookingId: string | null;
  /** The booking the last refusal was about, for "Try again". */
  readonly lastCancelRefused: MemberBooking | null;

  /** Reads both lists; returns at once when a load is already running. */
  load(): Promise<void>;
  /** Cancels `booking` (see the file comment). Dropped while another cancel is in flight. */
  cancelBooking(booking: MemberBooking): Promise<void>;
  /** The alert's "Try again": the last refused cancel again. */
  retryCancel(): Promise<void>;
  /** The alert closed. */
  dismissError(): void;
}

export type MyBookingsStore = StoreApi<MyBookingsState>;

export interface MyBookingsDeps {
  readonly fetch: (range: BookingRange) => Promise<MemberBooking[]>;
  readonly cancel: (bookingId: string, idempotencyKey: string) => Promise<void>;
  /** Removes a class's check-in reminders, keyed on its start. */
  readonly cancelReminder: (startsAt: Date) => Promise<void> | void;
  /** The per-booking keys; injectable so a test can read them. */
  readonly keys: ActionKeys;
}

const defaultDeps = (): MyBookingsDeps => ({
  fetch: (range) => fetchBookings(range),
  cancel: cancelBooking,
  cancelReminder: cancelCheckInReminder,
  keys: new ActionKeys(),
});

/**
 * True when the server's answer to a cancel is final: a refusal it meant
 * (a problem whose status is under 500). A timeout, no connection, a 5xx or
 * a problem with no status leaves the outcome open, so the key stays for the
 * retry (iOS `MyBookingsViewModel.endsTheAttempt`).
 */
export function endsTheAttempt(error: unknown): boolean {
  if (!(error instanceof ProblemError)) return false;
  const status = error.details.status;
  return status !== undefined && status < 500;
}

/** `list` ordered by start, ties in the server's order. */
export function sortByStart(list: readonly MemberBooking[], direction: 'ascending' | 'descending'): MemberBooking[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return list
    .map((booking, index) => ({ booking, index }))
    .sort((a, b) => sign * (a.booking.startsAt.getTime() - b.booking.startsAt.getTime()) || a.index - b.index)
    .map(({ booking }) => booking);
}

export function createMyBookingsStore(overrides: Partial<MyBookingsDeps> = {}): MyBookingsStore {
  const deps: MyBookingsDeps = { ...defaultDeps(), ...overrides };

  return createStore<MyBookingsState>()((set, get) => {
    /** The load in flight, so a cancel's reload can wait it out (see THE LOAD). */
    let running: Promise<void> | null = null;

    const read = async (): Promise<void> => {
      set({ isLoading: true });
      try {
        const [upcoming, past] = await Promise.allSettled([deps.fetch('upcoming'), deps.fetch('past')]);
        // As iOS assigns them in turn: a failed Upcoming leaves both lists
        // as they were; a failed Past still takes the new Upcoming.
        if (upcoming.status === 'rejected') throw upcoming.reason;
        set({ upcoming: sortByStart(upcoming.value, 'ascending') });
        if (past.status === 'rejected') throw past.reason;
        set({ past: sortByStart(past.value, 'descending') });
      } catch (error) {
        // A read the app called off (a sign-out on the way) is never an alert.
        if (!isCancellation(error)) set({ error: errorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    };

    const load = async (): Promise<void> => {
      if (running) return;
      const run = read();
      running = run;
      try {
        await run;
      } finally {
        if (running === run) running = null;
      }
    };

    /** A load whose reads start after now: waits out one already running, then reads again. */
    const reloadFresh = async (): Promise<void> => {
      while (running) await running;
      await load();
    };

    const cancel = async (booking: MemberBooking): Promise<void> => {
      if (get().cancellingBookingId !== null) return;
      set({ cancellingBookingId: booking.id });
      try {
        const key = deps.keys.keyFor(booking.id);
        try {
          await deps.cancel(booking.id, key);
        } catch (error) {
          if (endsTheAttempt(error)) deps.keys.settle(booking.id);
          set({ lastCancelRefused: booking });
          if (isCancellation(error)) return;
          const refusal = refusalFor(error, 'cancel');
          const message = refusalMessage(error, 'cancel');
          // The server answered: show the list as it now stands, then the
          // refusal (a failed reload never replaces it).
          if (refusal) await reloadFresh();
          set({ error: message, errorCta: refusal?.cta ?? null });
          return;
        }
        deps.keys.settle(booking.id);
        try {
          await deps.cancelReminder(booking.startsAt);
        } catch {
          // A reminder that could not be removed never turns a cancel into a failure.
        }
        await reloadFresh();
      } finally {
        set({ cancellingBookingId: null });
      }
    };

    return {
      upcoming: [],
      past: [],
      isLoading: false,
      error: null,
      errorCta: null,
      cancellingBookingId: null,
      lastCancelRefused: null,

      load,
      cancelBooking: cancel,

      async retryCancel() {
        const booking = get().lastCancelRefused;
        if (booking) await cancel(booking);
      },

      dismissError() {
        set({ error: null, errorCta: null });
      },
    };
  });
}
