/**
 * Auth links this phone has already tried, so the same link is never
 * exchanged twice. Android only: iOS hands a link to the app once.
 *
 * WHY. When an email link cold-starts the app, that link becomes the
 * Activity's own intent. If Android later kills the process in the
 * background, reopening LifePass from Recents recreates the Activity with
 * that SAME intent, and React Native reports it again as the launch link.
 * F4's router skips a repeat only within one process (src/app/deepLinks.ts
 * `lastLaunchUrl`). Run again, the old link would:
 * - put back the session it carried, whose refresh token has since been
 *   rotated. Supabase treats a rotated refresh token coming back as token
 *   reuse and may revoke the whole session, which signs the member out.
 * - raise set-new-password a second time for a reset the member finished.
 * - or fail and leave a "couldn't confirm your email" banner the member
 *   never asked about.
 *
 * So each link is claimed once, before its exchange, and a claimed link is
 * ignored afterwards. Only a SHA-256 of the link is stored (the link holds
 * tokens; its hash says nothing). A spent link stays spent whoever signs in
 * next, so the list belongs to the phone and survives sign-out. It keeps the
 * last few links; only the link that started the app is ever replayed.
 *
 * Storage that fails never blocks a link: a member who taps a fresh link
 * must get in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const SPENT_AUTH_LINKS_KEY = 'auth.spentLinks';

/** How many claimed links are remembered, newest first. */
export const SPENT_AUTH_LINKS_KEPT = 20;

/** The stored form of a link: its SHA-256, hex. */
export function authLinkFingerprint(url: string): string {
  return bytesToHex(sha256(utf8ToBytes(url)));
}

async function readSpent(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(SPENT_AUTH_LINKS_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * True when `url` has not been tried on this phone, and records it as tried.
 * False for a link claimed before (a replay): leave it alone.
 */
export async function claimAuthLink(url: string): Promise<boolean> {
  const fingerprint = authLinkFingerprint(url);
  let spent: string[];
  try {
    spent = await readSpent();
  } catch {
    return true;
  }
  if (spent.includes(fingerprint)) return false;
  try {
    await AsyncStorage.setItem(
      SPENT_AUTH_LINKS_KEY,
      JSON.stringify([fingerprint, ...spent].slice(0, SPENT_AUTH_LINKS_KEPT)),
    );
  } catch {
    // Not remembered: a replay after a process death would be tried again,
    // which is what happened before this list existed. The link still runs.
  }
  return true;
}
