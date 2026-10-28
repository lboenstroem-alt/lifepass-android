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
 * `NetInfo.fetch()` answers from NetInfo's last event once it has one, and
 * this module keeps a listener alive, so that answer can be stale: an event
 * missed across a background and resume would leave "disconnected" standing
 * until the next change, and every call would fail without being tried. So a
 * cached "disconnected" is confirmed by a fresh native read
 * (`NetInfo.refresh()`) before a call is refused, and the words after a
 * failure come from a fresh read too (a drop that just happened may not have
 * reached the cache).
 *
 * `knownDisconnected()` is the last state NetInfo reported, read without
 * waiting, for code that cannot await (ErrorFormatter).
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/** How long a fresh native read may take before the cached answer stands in. */
export const FRESH_READ_WAIT_MS = 2_000;

/** A fresh native read, or undefined when it failed or took too long. */
async function freshState(): Promise<NetInfoState | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      NetInfo.refresh(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), FRESH_READ_WAIT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** NetInfo's cached answer, or undefined when it failed. */
async function cachedState(): Promise<NetInfoState | undefined> {
  try {
    return await NetInfo.fetch();
  } catch {
    return undefined;
  }
}

/**
 * True only when NetInfo says the phone has no network connection at all,
 * and a fresh read agrees. Unknown is not disconnected: the call is tried.
 */
export async function deviceDisconnected(): Promise<boolean> {
  const cached = await cachedState();
  if (cached?.isConnected !== false) return false;
  const fresh = await freshState();
  return fresh?.isConnected === false;
}

/** After a failure: no connection, or a connection that does not reach the internet. */
export async function deviceOffline(): Promise<boolean> {
  const state = (await freshState()) ?? (await cachedState());
  return state?.isConnected === false || state?.isInternetReachable === false;
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
 * fails offline may come before any API call). A fresh read above reaches
 * this listener too.
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
