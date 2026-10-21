/**
 * The first build's bookings hook, kept only for the Coach heading
 * (src/screens/coach/CoachScreen.tsx) until COACH-1 rebuilds it. It reads
 * the folded legacy `Booking` (src/types/booking.ts), which is fine for a
 * heading and wrong for anything about money or holds.
 *
 * It no longer cancels. Its cancel sent a key derived from the booking id,
 * so the server replayed the first answer to every later attempt, and it
 * removed the row before the server had said anything. My bookings (LIB-1,
 * src/features/library) cancels with one key per attempt and the member's
 * refusal copy.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchBookings } from '../services/bookings';
import type { Booking } from '../../types/booking';

type BookingsState = {
  bookings: Booking[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useBookings(upcoming: boolean): BookingsState {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchBookings(upcoming)
      .then(setBookings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : null))
      .finally(() => setLoading(false));
  }, [upcoming]);

  useEffect(() => {
    load();
  }, [load]);

  return { bookings, loading, error, refetch: load };
}
