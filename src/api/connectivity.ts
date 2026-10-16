/**
 * What the phone knows about its own network, for telling "you are offline"
 * from "something went wrong on the way".
 *
 * iOS gets this for free: URLSession fails a request on a phone with no
 * network at once, with `URLError.notConnectedToInternet`, and every layer
 * (the API client, the Supabase SDK, ErrorFormatter) reads that code. On
 * Android a failed fetch is a bare "Network request failed" whatever the
 * cause, so NetInfo is asked instead.
 *
 * Two questions, kept apart on purpose:
 *
 *   deviceDisconnected()  BEFORE a call: only `isConnected === false`. It
 *                         decides whether a call is attempted at all, so it
 *                         must never be wrong the other way:
 *                         `isInternetReachable` is a probe Android can answer
 *                         `false` on working Wi-Fi, and a false "offline"
 *                         there would block a call that would have worked.
 *   deviceOffline()       AFTER a call failed: either signal. Nothing is
 *                         blocked by it, it only picks the words.
 *
 * `knownDisconnected()` is the last state NetInfo reported, read without
 * waiting, for code that cannot await (ErrorFormatter).
 */
import NetInfo from '@react-native-community/netinfo';

/** True only when NetInfo says the phone has no network connection at all. */
export async function deviceDisconnected(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state?.isConnected === false;
  } catch {
    return false;
  }
}

/** After a failure: no connection, or a connection that does not reach the internet. */
export async function deviceOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state?.isConnected === false || state?.isInternetReachable === false;
  } catch {
    return false;
  }
}

let lastConnected: boolean | null = null;
let watching = false;

/**
 * Records a NetInfo state. The listener's body; a test calls it as NetInfo
 * would (`noteConnectivity({ isConnected: false })`).
 */
export function noteConnectivity(state: { readonly isConnected: boolean | null } | null | undefined): void {
  lastConnected = state?.isConnected ?? null;
}

/**
 * Starts following NetInfo, once. Called when this module loads, so the state
 * is known by the time the first error is put into words (a sign-in that
 * fails offline may come before any API call).
 */
export function watchConnectivity(): void {
  if (watching) return;
  watching = true;
  try {
    NetInfo.addEventListener(noteConnectivity);
  } catch {
    watching = false;
  }
}

/** The last state NetInfo reported says no connection. Unknown is not offline. */
export function knownDisconnected(): boolean {
  return lastConnected === false;
}

watchConnectivity();
