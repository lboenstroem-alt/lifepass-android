/**
 * Debug-only fixture switches: the Android twin of the iOS `-LPScreenshot*`
 * (and `-LP*`) launch arguments.
 *
 * WHY. Most screens are behind a sign-in, a membership or a server state an
 * emulator does not have. iOS stands the app up in a known state from launch
 * arguments so screenshots and device checks look at the real screen, not the
 * login page. Android has no launch arguments for a JS bundle, so the same
 * switches arrive as ONE build-time variable, read when the bundle loads:
 *
 *   EXPO_PUBLIC_FIXTURE="state=active-plan,language=is,tab=4,forceSocialButtons" npx expo start
 *
 * Each iOS argument maps to a key by dropping `-LP` and a leading
 * `Screenshot`, then lower-camel-casing what is left:
 *
 *   -LPScreenshotState active-plan  ->  state=active-plan
 *   -LPScreenshotClassPayURL <url>  ->  classPayURL=<url, percent-encoded>
 *   -LPForceSocialButtons           ->  forceSocialButtons
 *
 * A key without `=` is a flag. Values are percent-decoded, so a URL or a
 * comma can be passed encoded.
 *
 * SAFETY, as on iOS. Every read returns nothing unless `__DEV__` is true; a
 * release bundle has `__DEV__ === false`, so the minifier drops every branch
 * behind it and production can never be put in a fixture state, whatever the
 * environment says. eas.json never sets EXPO_PUBLIC_FIXTURE (CI checks), and
 * a fixture grants nothing: without a real session every server call still
 * fails, exactly as for a signed-out person.
 *
 * Each package reads only the keys for its own screens, with `fixtureArg` or
 * `hasFixture`; the key names are listed in `FIXTURE_KEYS` so a typo fails the
 * type check.
 */

/** Every iOS debug argument (LifePass 2.5.6, and the visit rating's after 3.1.0), by its Android key. */
export const FIXTURE_KEYS = [
  // App state and navigation (iOS ScreenshotFixtures).
  'state',
  'language',
  'tab',
  'notification',
  'profile',
  'profileSaved',
  'profileHint',
  'planDot',
  'exploreHint',
  // Plan, health, Coach, meals, runner.
  'plan',
  'health',
  'sheet',
  'scroll',
  'coach',
  'meal',
  'describe',
  'extra',
  'extraStub',
  'logWorkoutPrefill',
  'runnerStub',
  'runnerReset',
  'runnerKeep',
  'runnerWidth',
  'runnerScreen',
  // Apple Health on iOS: nothing on Android (no Health Connect), kept for parity of names.
  'AH',
  // Auth, Kenni, plans.
  'auth',
  'forceSocialButtons',
  'kenni',
  'unverified',
  'plansSheet',
  'selectPlan',
  // Classes and class pay.
  'classFeed',
  'classSheet',
  'classPay',
  'classPayURL',
  'classPayPrice',
  'classPayConfirm',
  'classPayTopup',
  'classPayReason',
  'classPayEarlyPage',
  // Check-in, refusals, venues, map.
  'checkIn',
  'recentCheckIn',
  'camera',
  'refusal',
  'venue',
  'venueScroll',
  'mapPins',
  'mapPinned',
  'mapLegendOpen',
  'mapZoomOut',
  'browseSeed',
  // Member feedback (API 0.46.0, the app version after 3.1.0): "How was your
  // visit?" in a known state (src/features/visitRating/fixtures.ts).
  'visitRating',
  // Debug aids.
  'debugAssistiveTech',
  'debugActivatePin',
  'debugPayCover',
  'debugMapTapFirst',
] as const;

export type FixtureKey = (typeof FIXTURE_KEYS)[number];

export type FixtureArgs = Readonly<Partial<Record<FixtureKey, string>>>;

/**
 * The Android key for an iOS launch argument (`-LPScreenshotClassPayURL` ->
 * `classPayURL`), or null for anything that is not an `-LP` argument.
 */
export function fixtureKeyForIOSArgument(argument: string): string | null {
  const match = /^-LP([A-Za-z]+)$/.exec(argument.trim());
  if (!match) return null;
  let rest = match[1]!;
  if (rest.startsWith('Screenshot') && rest.length > 'Screenshot'.length) rest = rest.slice('Screenshot'.length);
  // An all-capitals name (`AH`) keeps its case; otherwise lower the first letter.
  if (rest === rest.toUpperCase()) return rest;
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/**
 * Parses `key=value,flag,…`. Unknown keys are kept (a package may read a key
 * this list does not know yet) but `isKnownFixtureKey` can flag them.
 */
export function parseFixtureArgs(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'string') return out;
  for (const part of raw.split(',')) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    const key = (eq < 0 ? item : item.slice(0, eq)).trim();
    if (!key) continue;
    const value = eq < 0 ? '' : item.slice(eq + 1).trim();
    out[key] = safeDecode(value);
  }
  return out;
}

export function isKnownFixtureKey(key: string): key is FixtureKey {
  return (FIXTURE_KEYS as readonly string[]).includes(key);
}

let cache: { raw: string | undefined; args: Record<string, string> } | null = null;

/** The switches this development build was started with; empty in release. */
export function fixtureArgs(): FixtureArgs {
  if (!__DEV__) return {};
  const raw = process.env.EXPO_PUBLIC_FIXTURE;
  if (!cache || cache.raw !== raw) cache = { raw, args: parseFixtureArgs(raw) };
  return cache.args;
}

/** The value of one switch (`''` for a bare flag), or null when absent or in release. */
export function fixtureArg(key: FixtureKey): string | null {
  if (!__DEV__) return null;
  const value = fixtureArgs()[key];
  return value === undefined ? null : value;
}

/** Whether a switch (flag or key=value) was given. Always false in release. */
export function hasFixture(key: FixtureKey): boolean {
  return fixtureArg(key) !== null;
}

/** Whether ANY switch was given: the iOS `ScreenshotFixtures.requested != nil`. */
export function fixturesActive(): boolean {
  if (!__DEV__) return false;
  return Object.keys(fixtureArgs()).length > 0;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
