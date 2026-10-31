/**
 * The update prompt's decision, pure: what this install shows, given its own
 * version, the server's answer (src/api/appVersion.ts) and the latest version
 * the member already waved away.
 *
 *   required    this version is below the owner's minimum: the app is
 *               blocked behind an Update button (UpdateRequiredCover).
 *   available   a newer version is on Google Play and the member has not
 *               been told about THIS one yet: "A new version is available",
 *               Update or Not now, once per new version.
 *   none        anything else, and every case where something is unknown or
 *               unreadable: the check FAILS OPEN, so a bad setting, a version
 *               string the app cannot read or a failed request never stops
 *               anybody using the app.
 *
 * VERSIONS are read the way the server reads them (monorepo
 * apps/web/src/server/app-version.ts): "3", "3.1" and "3.1.0" are versions
 * ("3.1" is "3.1.0"), compared number by number, so 3.10.0 is newer than
 * 3.9.0; anything else ("v3", "3.1.0-beta", a build number) is not a version.
 */

/** [major, minor, patch]. */
export type AppVersion = readonly [number, number, number];

const VERSION_PATTERN = /^(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?$/;

/** A version, or null when the text is not one. */
export function parseAppVersion(raw: string | null | undefined): AppVersion | null {
  if (typeof raw !== 'string') return null;
  const match = VERSION_PATTERN.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** "3.1" as "3.1.0": one spelling per version, for remembering which one was waved away. */
export function formatAppVersion(version: AppVersion): string {
  return version.join('.');
}

/** Negative when `a` is older than `b`, 0 when the same, positive when newer. */
export function compareAppVersions(a: AppVersion, b: AppVersion): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export type UpdatePrompt =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly latestVersion: string }
  | { readonly kind: 'required' };

export const NO_UPDATE_PROMPT: UpdatePrompt = { kind: 'none' };

export interface UpdatePromptInput {
  /** This install's version (the Play versionName), null when unknown. */
  readonly currentVersion: string | null;
  readonly minimumVersion: string | null;
  readonly latestVersion: string | null;
  /** The latest version the member already answered the soft prompt for. */
  readonly dismissedLatestVersion: string | null;
}

export function decideUpdatePrompt(input: UpdatePromptInput): UpdatePrompt {
  const current = parseAppVersion(input.currentVersion);
  // An install that cannot say what it is never blocks nor nags.
  if (!current) return NO_UPDATE_PROMPT;

  const minimum = parseAppVersion(input.minimumVersion);
  if (minimum && compareAppVersions(current, minimum) < 0) return { kind: 'required' };

  const latest = parseAppVersion(input.latestVersion);
  if (!latest || compareAppVersions(current, latest) >= 0) return NO_UPDATE_PROMPT;
  const dismissed = parseAppVersion(input.dismissedLatestVersion);
  // Once per new version: a newer one than the member waved away asks again.
  if (dismissed && compareAppVersions(dismissed, latest) >= 0) return NO_UPDATE_PROMPT;
  return { kind: 'available', latestVersion: formatAppVersion(latest) };
}

// ---------------------------------------------------------------------------
// When "A new version is available" may go up (iOS `AppUpdatePrompts`)

/**
 * How long the screen has to stay free before the soft prompt goes up (iOS
 * `softAlertSettle`). A sheet armed with the launch (the Kenni nudge) comes a
 * beat after the tabs appear, and a check-in that has just ended may hand
 * straight on to the next screen; the prompt must not take their place.
 */
export const SOFT_PROMPT_SETTLE_MS = 1_000;

export interface SoftPromptMoment {
  /** The launch screen is still up. */
  readonly launching: boolean;
  /** The app is in the foreground. */
  readonly appActive: boolean;
  /** A sheet is armed to open over the app: the Kenni nudge, or a new password after a reset link. */
  readonly sheetPending: boolean;
  /**
   * A check-in is on its way (intent store `isCheckInUnderway`: a door link
   * parked, a walk-in in the scanner in front, the Scan camera live).
   */
  readonly checkInUnderway: boolean;
}

/**
 * Whether nothing is on screen, or about to be, that the soft prompt would
 * cover (iOS `softAlertMayShow`). A member at the door comes first: a
 * walk-in's sheet is shown only after its preview request returns, so
 * without `checkInUnderway` the prompt could take the screen in between and
 * cover them.
 *
 * iOS also waits while any sheet, cover or alert is presented
 * (`AppWindows.isPresenting`), because a second presentation fails or knocks
 * the first one out there. Android has no app-wide "something is presented"
 * reading, and every React Native Modal is a window of its own that opens on
 * top of the ones already up, so the prompt never stops a sheet from showing.
 */
export function softPromptMayShow(moment: SoftPromptMoment): boolean {
  return !moment.launching && moment.appActive && !moment.sheetPending && !moment.checkInUnderway;
}
