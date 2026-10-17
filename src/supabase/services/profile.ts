/**
 * The first Android build's profile read, kept for `useRecentCheckIn`
 * (CHECKIN-1) until it reads the app store directly. `GET /profile` is now
 * read and decoded once, by the app store (src/stores/appStore.ts with the
 * fail-soft decoder in src/api/profile.ts), so the check-in banner, the
 * member card and the language all come from the same read.
 */
import { useAppStore } from '../../stores/appStore';
import { toLegacyRecentCheckIn, type RecentCheckIn } from '../types/profile';

/**
 * Re-reads the profile (as iOS Home's `.task { await appState.loadProfile() }`
 * does) and answers its recent check-in (the staff proof), or null.
 *
 * FAIL-SOFT: a malformed check-in block is discarded by the decoder, never
 * thrown, and a failed read keeps the profile the app had, so a banner that
 * was showing stays until a read says otherwise.
 */
export async function fetchRecentCheckIn(): Promise<RecentCheckIn | null> {
  const store = useAppStore.getState();
  if (store.isAuthenticated) await store.loadProfile();
  return toLegacyRecentCheckIn(useAppStore.getState().profile?.recentCheckIn ?? null);
}
