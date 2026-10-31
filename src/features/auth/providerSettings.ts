/**
 * Which "Continue with ..." buttons the sign-in and sign-up screens show: the
 * Android port of iOS `SocialProviders`, `SocialProvidersCache`,
 * `AuthService.enabledProviders()` and `SocialSignInGate`
 * (Services/AuthService.swift, 2.5.4).
 *
 * TWO SWITCHES, BOTH REQUIRED, as on iOS:
 *  1. this BUILD allows it: `EXPO_PUBLIC_SOCIAL_SIGN_IN` (YES, TRUE or 1; the
 *     twin of iOS `LP_SOCIAL_SIGN_IN` in the Secrets xcconfig). eas.json sets
 *     it for every profile, so a production build has it on; unset means off,
 *     and a build without it never even asks the server;
 *  2. the SERVER has the provider on: Supabase's public
 *     `GET {SUPABASE_URL}/auth/v1/settings` (`external.apple`,
 *     `external.google`), read with the publishable key, 10 s ceiling, once
 *     per app session. A read that failed shows NO button, and is tried again
 *     the next time a screen asks (only an answer is cached).
 *
 * ONE DELIBERATE DIFFERENCE (owner decision D1 (a)): iOS never shows Google
 * without Apple, because App Review 4.8 asks an iPhone app that offers a
 * third-party sign-in to offer Sign in with Apple beside it. Google Play has
 * no such rule, so Android shows EACH provider the server has on: Google
 * alone when Apple is off, Apple alone when Google is off.
 */
import { createAuthFetch } from '../../api/authFetch';
import { env } from '../../config/env';
import { hasFixture } from '../../dev/fixtures';

/** The external providers, as the auth server reports them and as the screens may show them. */
export interface SocialProviders {
  readonly apple: boolean;
  readonly google: boolean;
}

export const NO_SOCIAL_PROVIDERS: SocialProviders = Object.freeze({ apple: false, google: false });

export function hasAnySocialProvider(providers: SocialProviders): boolean {
  return providers.apple || providers.google;
}

/** iOS `request.timeoutInterval = 10`. */
export const AUTH_SETTINGS_TIMEOUT_MS = 10_000;

/**
 * `GET /auth/v1/settings` as GoTrue answers it:
 * `{ "external": { "apple": true, "google": false, ... }, "disable_signup": false, ... }`.
 * A missing `external` or provider is off. Throws when the body is not a JSON
 * object (an HTML error page from a gateway, say), which the read treats as
 * a failed read: iOS `SocialProviders.decodeSettings`.
 */
export function decodeAuthSettings(body: string): SocialProviders {
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('auth settings: not a JSON object');
  }
  const external = (parsed as { external?: unknown }).external;
  if (external === undefined || external === null) return NO_SOCIAL_PROVIDERS;
  if (typeof external !== 'object' || Array.isArray(external)) {
    throw new TypeError('auth settings: `external` is not an object');
  }
  const flags = external as Record<string, unknown>;
  return { apple: flags.apple === true, google: flags.google === true };
}

/**
 * What to show, from the two switches (iOS `SocialSignInGate.visible`, with
 * D1's rule above): nothing unless this build allows it and the server
 * answered; then each provider the server has on.
 */
export function visibleSocialProviders(buildEnabled: boolean, server: SocialProviders | null): SocialProviders {
  if (!buildEnabled || !server) return NO_SOCIAL_PROVIDERS;
  return { apple: server.apple, google: server.google };
}

// ---------------------------------------------------------------------------
// The read, once per app session

/** The one cached answer (iOS `SocialProvidersCache.shared`). */
let cached: SocialProviders | null = null;
/** A read on its way: the sign-in and sign-up screens asking together share it. */
let inFlight: Promise<SocialProviders | null> | null = null;
/** Bumped by a reset: an answer to a read from before it is not this session's. */
let generation = 0;

/** The cached answer, without asking (null until a read has answered). */
export function cachedSocialProviders(): SocialProviders | null {
  return cached;
}

async function readSettings(): Promise<SocialProviders | null> {
  const mine = generation;
  // The auth-server fetch carries the ceiling (and joins nothing else): a
  // read that never answers ends after 10 s, as URLSession's timeout does.
  const fetchWithCeiling = createAuthFetch({ timeoutMs: AUTH_SETTINGS_TIMEOUT_MS });
  try {
    const response = await fetchWithCeiling(`${env.supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      // Only the publishable key: the settings are public, and no member is
      // signed in on these screens.
      // (iOS also asks for `.reloadIgnoringLocalCacheData`; React Native's
      // OkHttp client keeps no HTTP cache, so every read reaches the server.)
      headers: { apikey: env.supabaseAnonKey, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const providers = decodeAuthSettings(await response.text());
    if (mine === generation) cached = providers;
    return providers;
  } catch {
    return null;
  }
}

/**
 * Which providers the Supabase project has on (iOS
 * `AuthService.enabledProviders()`): the cached answer, or one read. Null
 * when it could not be read, which hides every button.
 */
export function enabledSocialProviders(): Promise<SocialProviders | null> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    const read = readSettings().finally(() => {
      if (inFlight === read) inFlight = null;
    });
    inFlight = read;
  }
  return inFlight;
}

/**
 * What the screens show now (iOS `SocialSignInGate.load`). A build without
 * the flag shows nothing and never asks the server. The development fixture
 * switch `forceSocialButtons` (iOS DEBUG `-LPForceSocialButtons`) shows both
 * without a read, for screenshots; it is inert in a release bundle.
 */
export async function loadSocialProviders(): Promise<SocialProviders> {
  if (hasFixture('forceSocialButtons')) return { apple: true, google: true };
  const buildEnabled = env.socialSignInBuildEnabled;
  if (!buildEnabled) return NO_SOCIAL_PROVIDERS;
  return visibleSocialProviders(buildEnabled, await enabledSocialProviders());
}

/** Back to a fresh app session (tests). */
export function resetSocialProviderSettingsForTests(): void {
  generation += 1;
  cached = null;
  inFlight = null;
}
