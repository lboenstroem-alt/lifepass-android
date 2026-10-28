/**
 * React glue for a booking session (./bookingSession.ts): one store per
 * screen, read with selectors, and the refusal steps the booking screens
 * take (iOS `BookingOutcomeHandling.takeLocally` and `RefusalStepPresenter`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';

import type { RefusalCta } from '../../api/refusals';
import { useRefusalStep } from '../../navigation/refusalSteps';
import {
  createBookingSession,
  type BookingSession,
  type BookingSessionStore,
  type CreateBookingSessionOptions,
} from './bookingSession';

/**
 * A booking session for this screen: made once on mount and kept for the
 * screen's life. The screen is "alive" until it unmounts, so a payment that
 * outlives it is shown by F8's presenter instead (src/payments/presenters.ts),
 * and an attempt it still holds for Check again goes back to F8's recovery.
 */
export function useNewBookingSession(options: CreateBookingSessionOptions = {}): BookingSessionStore {
  const [store] = useState(() => createBookingSession(options));
  useEffect(() => {
    let alive = true;
    store.getState().setScreenAlive(() => alive);
    return () => {
      alive = false;
      if (store.getState().heldAttempt) store.getState().dismissPayOutcome();
    };
  }, [store]);
  return store;
}

/** Reads `selector` from a booking session and re-renders when it changes. */
export function useBooking<T>(store: BookingSessionStore, selector: (state: BookingSession) => T): T {
  return useStore(store, selector);
}

/** The steps a booking screen takes itself (iOS `BookingOutcomeHandling.offers`). */
export function bookingScreenTakes(cta: RefusalCta): boolean {
  return cta === 'chooseAnotherTime' || cta === 'editGuests' || cta === 'tryAgain';
}

export interface BookingRefusalStepOptions {
  /**
   * The class sheet's "See other times": where its Choose another time and
   * Change guests go. Without it the full flow steps back to its own
   * timetable.
   */
  readonly onOtherTimes?: () => void;
  /** The venue a "Book a time" step opens (none in the booking screens, as on iOS). */
  readonly venueSlug?: string | null;
  /** Runs before a step opens a page (a sheet closes itself first). */
  readonly beforeOpen?: () => void;
}

/**
 * A refusal's next step, from the panel's button or the alert's: the screen's
 * own (another time, change guests, try again) first, then F4's presenter
 * (Plans, Account, the Kenni or deletion sheet, My bookings, a web link). On
 * the way back from Plans, Account or Kenni the same selection is checked
 * again (`recheckAfterPlans`), so a member who just bought a plan can confirm
 * without starting over.
 */
export function useBookingRefusalSteps(
  store: BookingSessionStore,
  options: BookingRefusalStepOptions = {},
): { offers: (cta: RefusalCta) => boolean; take: (cta: RefusalCta) => void } {
  const { onOtherTimes, venueSlug, beforeOpen } = options;
  const local = useCallback(
    (cta: RefusalCta): boolean => {
      switch (cta) {
        case 'chooseAnotherTime':
        case 'editGuests':
          if (onOtherTimes) onOtherTimes();
          else store.getState().returnToTimetable(cta === 'editGuests');
          return true;
        case 'tryAgain':
          void store.getState().retryAfterRefusal();
          return true;
        default:
          return false;
      }
    },
    [onOtherTimes, store],
  );
  const { offers, take } = useRefusalStep({
    venueSlug: venueSlug ?? null,
    local,
    beforeOpen,
    onReturn: () => void store.getState().recheckAfterPlans(),
  });
  const offersStep = useCallback((cta: RefusalCta) => offers(cta, bookingScreenTakes), [offers]);
  return { offers: offersStep, take };
}
