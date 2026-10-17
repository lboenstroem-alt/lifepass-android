/**
 * The member's recent check-in (the staff proof Home re-offers), or null:
 * `recentCheckIn` on the app store's `GET /profile` (src/api/profile.ts,
 * decoded fail-soft, with the server's `memberShortName`).
 *
 * The profile is read again every time the calling screen gains focus, as
 * iOS Home does on every appear: a member who checked in and comes back to
 * Home must see the bar, and the server drops the field once its window
 * lapses, so a stale one clears on the next focus. A screen that already
 * reads the profile on focus passes `{ refreshOnFocus: false }`.
 *
 * FAIL-SOFT: a malformed check-in block is discarded by the decoder, never
 * thrown, and a failed read keeps the profile the app had, so a bar that was
 * showing stays until a read says otherwise.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

import type { RecentCheckIn } from '../../api/profile';
import { useAppStore } from '../../stores/appStore';

export function useRecentCheckIn({ refreshOnFocus = true }: { readonly refreshOnFocus?: boolean } = {}): RecentCheckIn | null {
  const checkIn = useAppStore((s) => s.profile?.recentCheckIn ?? null);

  useFocusEffect(
    useCallback(() => {
      if (!refreshOnFocus) return;
      const store = useAppStore.getState();
      if (store.isAuthenticated) void store.loadProfile();
    }, [refreshOnFocus]),
  );

  return checkIn;
}
