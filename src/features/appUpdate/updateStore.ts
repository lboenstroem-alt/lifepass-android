/**
 * The update check's state for this process: what the prompt shows
 * (./policy.ts), where Update goes, and when the server last answered.
 *
 * WHEN IT ASKS. At launch, signed in or not, then again whenever the app
 * comes back to the foreground: every time while it is blocked (so a minimum
 * the owner lowers again, or a mistyped one he corrects, lets members in at
 * once; the HTTP cache keeps the answer for the server's minute), otherwise
 * once the last answer is half an hour old.
 *
 * FAIL OPEN. A check that fails (offline, any non-2xx including a 429, a
 * timeout, a body the app cannot read) never blocks: a block is only ever
 * shown on a fresh answer, so a failed re-check lifts one (and the next
 * return to the foreground asks again), and before any answer the prompt is
 * `none`. A soft prompt already decided stays as it is.
 * Nothing about a block is kept across launches.
 *
 * ONCE PER NEW VERSION. The latest version the member answered the soft
 * prompt for (Update or Not now) is kept on this phone; the prompt comes back
 * only for a newer one. It is not the member's data, so sign-out leaves it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { create } from 'zustand';

import { fetchAppVersionPolicy, PLAY_STORE_URL, type AppVersionPolicy } from '../../api/appVersion';
import { decideUpdatePrompt, NO_UPDATE_PROMPT, parseAppVersion, formatAppVersion, type UpdatePrompt } from './policy';

/** The latest version the soft prompt was answered for, on this phone. */
export const DISMISSED_LATEST_VERSION_KEY = 'appUpdate.dismissedLatestVersion';

/** How long an answer stands before a return to the foreground asks again (never while blocked). */
export const RECHECK_AFTER_MS = 30 * 60_000;

interface AppUpdateState {
  readonly prompt: UpdatePrompt;
  /** Where Update goes (the server's Play link, or the default listing). */
  readonly storeUrl: string;
  /** When the server last answered (ms since epoch), null before the first answer. */
  readonly checkedAt: number | null;
}

const initialState: AppUpdateState = { prompt: NO_UPDATE_PROMPT, storeUrl: PLAY_STORE_URL, checkedAt: null };

export const useAppUpdate = create<AppUpdateState>()(() => initialState);

export interface AppUpdateDeps {
  /** This install's version (the Play versionName). */
  readonly currentVersion: () => string | null;
  readonly fetchPolicy: () => Promise<AppVersionPolicy>;
  readonly now: () => number;
}

const defaultDeps: AppUpdateDeps = {
  currentVersion: () => Application.nativeApplicationVersion ?? null,
  fetchPolicy: () => fetchAppVersionPolicy(),
  now: () => Date.now(),
};

let deps: AppUpdateDeps = defaultDeps;
let inFlight: Promise<void> | null = null;

async function readDismissed(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_LATEST_VERSION_KEY);
  } catch {
    return null;
  }
}

/** Asks the server and decides. Never throws; a call while one runs joins it. */
export function checkForUpdate(): Promise<void> {
  if (inFlight) return inFlight;
  const run = (async () => {
    let policy: AppVersionPolicy;
    try {
      policy = await deps.fetchPolicy();
    } catch {
      // Fail open: a block needs a fresh answer; anything else stays. A block
      // lifted this way also forgets when it was last asked, so the very next
      // return to the foreground asks again instead of waiting out
      // RECHECK_AFTER_MS on the blocking answer's clock (iOS 3.1.0
      // AppUpdateController.check, review follow-up 1): one brief network
      // failure must not let a below-minimum install in for half an hour.
      if (useAppUpdate.getState().prompt.kind === 'required') {
        useAppUpdate.setState({ prompt: NO_UPDATE_PROMPT, checkedAt: null });
      }
      return;
    }
    const prompt = decideUpdatePrompt({
      currentVersion: deps.currentVersion(),
      minimumVersion: policy.minimumVersion,
      latestVersion: policy.latestVersion,
      dismissedLatestVersion: await readDismissed(),
    });
    useAppUpdate.setState({ prompt, storeUrl: policy.storeUrl, checkedAt: deps.now() });
  })().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Back in the foreground: asks again while blocked, else once the last answer is stale. */
export function checkForUpdateIfStale(): Promise<void> {
  const { checkedAt, prompt } = useAppUpdate.getState();
  if (prompt.kind !== 'required' && checkedAt !== null && deps.now() - checkedAt < RECHECK_AFTER_MS) {
    return Promise.resolve();
  }
  return checkForUpdate();
}

/** The member answered the soft prompt (Update or Not now): not again for this version. */
export function dismissUpdateAvailable(): void {
  const { prompt } = useAppUpdate.getState();
  if (prompt.kind !== 'available') return;
  useAppUpdate.setState({ prompt: NO_UPDATE_PROMPT });
  const version = parseAppVersion(prompt.latestVersion);
  if (!version) return;
  AsyncStorage.setItem(DISMISSED_LATEST_VERSION_KEY, formatAppVersion(version)).catch(() => undefined);
}

/** Tests: other dependencies, and a fresh state. */
export function setAppUpdateDepsForTests(overrides: Partial<AppUpdateDeps> | null): void {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
}

export function resetAppUpdateForTests(): void {
  useAppUpdate.setState(initialState, true);
  inFlight = null;
  deps = defaultDeps;
}
