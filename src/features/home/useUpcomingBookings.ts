// The member's upcoming bookings for Home's card, re-read at every Home focus
// and pull to refresh (iOS `bookingsVM.load()` in `.task` and `.refreshable`),
// so a booking made a minute ago is there when the member comes back.
//
// A read that fails keeps what the card showed (nothing at first: "No
// upcoming bookings"). A second read asked for while one is on the way joins
// it (iOS's re-entry guard), so a focus and a pull together read once.
//
// Member data, held in the screen only: it goes with the signed-in tabs at
// sign-out, and nothing is written to the phone.
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchUpcomingBookings, type UpcomingBooking } from './upcoming';

export interface UpcomingBookingsState {
  /** Soonest first. */
  readonly bookings: readonly UpcomingBooking[];
  reload(): Promise<void>;
}

const NONE: readonly UpcomingBooking[] = Object.freeze([]);

export function useUpcomingBookings(fetcher: typeof fetchUpcomingBookings = fetchUpcomingBookings): UpcomingBookingsState {
  const [bookings, setBookings] = useState<readonly UpcomingBooking[]>(NONE);
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const attempt = (async () => {
      try {
        const next = await fetcher();
        if (mounted.current) setBookings(next);
      } catch {
        // Keep what the card shows.
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = attempt;
    return attempt;
  }, [fetcher]);

  return { bookings, reload };
}
