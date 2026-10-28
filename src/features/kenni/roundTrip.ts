// The in-flight record of a Kenni round trip: Android only (plan 5.6, "an
// in-flight record for process death"; iOS's ASWebAuthenticationSession
// cannot outlive the app, so iOS has nothing like it).
//
// WHY. A `lifepass://kenni-callback` link can reach the app without the tab
// that asked for it (./callbackLink.ts): Android stopped LifePass while the
// member was in the Auðkenni app, the Activity was recreated, or the redirect
// came after the tab had already said "cancelled". Such a link is completed
// only when THIS phone started a round trip for THIS member that has not been
// completed yet, recently. That is what the record says. Without it, a link
// replayed later would be completed a second time: a relaunch from Recents
// replays the Activity's launch link, in a new process with nothing in
// memory, and a second completion of a spent state turns "verified" into
// "couldn't finish".
//
// - `begin` is written just before the tab opens (awaited, so a process that
//   dies the moment the tab is up still finds it);
// - `spend` removes it as soon as a redirect is completed, whichever way it
//   arrived (the state is single use on the server);
// - sign-out removes it: the state is bound to the member who started it.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { registerSignOutCleaner } from '../../app/signOut';
import { useAppStore } from '../../stores/appStore';

export const KENNI_ROUND_TRIP_KEY = 'kenni.roundTrip';

/**
 * How long after the tab opened a redirect without its tab is still
 * completed. The server keeps a state about ten minutes; a little longer here
 * so a member who comes back just after still hears "it took too long, try
 * again" (`410 kenni_state_expired`) rather than nothing at all.
 */
export const KENNI_RESUME_WINDOW_MS = 15 * 60 * 1000;

export interface KenniRoundTripRecord {
  /** When the tab was opened (ms since the epoch). */
  readonly startedAt: number;
  /** The member who started it (the app store's `userId`). */
  readonly member: string | null;
}

/** What the model writes around the browser step (a test can stand in for it). */
export interface KenniRoundTrip {
  begin(): Promise<void>;
  spend(): Promise<void>;
}

function decodeRecord(raw: string | null): KenniRoundTripRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { startedAt, member } = value as Record<string, unknown>;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    return { startedAt, member: typeof member === 'string' ? member : null };
  } catch {
    return null;
  }
}

/** The record as stored, or null (none, unreadable). */
export async function readKenniRoundTrip(): Promise<KenniRoundTripRecord | null> {
  try {
    return decodeRecord(await AsyncStorage.getItem(KENNI_ROUND_TRIP_KEY));
  } catch {
    return null;
  }
}

async function removeRecord(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KENNI_ROUND_TRIP_KEY);
  } catch {
    // The window and the member check still bound what an old record allows.
  }
}

/** The app's record, in AsyncStorage. Never throws. */
export const kenniRoundTrip: KenniRoundTrip = {
  async begin() {
    const record: KenniRoundTripRecord = { startedAt: Date.now(), member: useAppStore.getState().userId };
    try {
      await AsyncStorage.setItem(KENNI_ROUND_TRIP_KEY, JSON.stringify(record));
    } catch {
      // Then only the tab itself can finish this round trip, as before.
    }
  },
  spend: removeRecord,
};

/**
 * Whether `record` lets the signed-in `member` complete a redirect that came
 * without its tab, at `now`.
 */
export function roundTripAllowsResume(
  record: KenniRoundTripRecord | null,
  member: string | null,
  now: number = Date.now(),
): boolean {
  if (!record || !member || record.member !== member) return false;
  const age = now - record.startedAt;
  return age >= 0 && age <= KENNI_RESUME_WINDOW_MS;
}

registerSignOutCleaner('kenni.roundTrip', () => removeRecord());
