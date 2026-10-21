/**
 * Continue with Google and Continue with Apple: the Android port of iOS
 * `AuthService.signInWithGoogle` / `completeSocialSignIn` and
 * `AuthViewModel.finishSocialSignIn` (2.5.4), plan section 5.3 and owner
 * decision D1 (a).
 *
 * BOTH PROVIDERS ARE SUPABASE'S OWN OAUTH PAGE, in a Chrome Custom Tab. iOS
 * opens Google that way (ASWebAuthenticationSession) and Apple natively; an
 * Android phone has no native Apple sheet, so Apple goes through the same web
 * page, on the Services ID the website already uses, and an account made on
 * an iPhone with Apple (often a Hide My Email address with no password) signs
 * in to the same member. No Google SDK, no Android OAuth client, no SHA-1.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER:
 *  1. A fresh PKCE verifier and attempt id are saved (./socialPkce). The
 *     verifier must survive Android dropping the process behind the tab.
 *  2. The page opens on `/auth/v1/authorize` (Google also gets
 *     `prompt=select_account`, so a phone with two Google accounts can pick).
 *  3. The page comes back on `lifepass://auth/callback/social?attempt=..&code=..`.
 *     Closing the tab or Android back is SILENT, as closing iOS's web sheet
 *     is; so is "Cancel" on Apple's page, the twin of iOS's native Apple
 *     sheet's Cancel. Anything else is `auth.social_failed`, including
 *     "Cancel" on Google's own consent page: iOS gets that back as an error
 *     in the callback link and shows the failure too (`isCancellation` only
 *     knows the sheets' own cancels).
 *  4. The code is exchanged for the member's tokens, OUTSIDE the app's
 *     Supabase client, so no part of the app knows a session exists yet.
 *  5. The metadata the account is missing (./socialMetadata) is written with
 *     those tokens, retried once after 0.8 s. The LifePass API creates the
 *     profile ONCE, from the metadata as it is at the first `GET /profile`, so
 *     this must land before anything can read the profile. A write that fails
 *     twice is not a reason to refuse the sign-in (iOS signs in anyway).
 *  6. Only now does the session reach the app's client (`setSession`), whose
 *     SIGNED_IN starts the app store's sign-in, and the app store's
 *     `handleSignIn` runs (claims, the profile read, the Kenni nudge for a
 *     fresh account), as after a password sign-in. The root navigator gates
 *     on the app store, so Main mounts only after this point.
 *  iOS writes the metadata after its SDK stored the session, because nothing
 *  there listens to the SDK's SIGNED_IN. Here the app store does (an auth
 *  link signs in that way), so the session is handed over last.
 *
 * WHY ITS OWN RETURN LINK. On iOS the web-auth session catches its own
 * callback; it never reaches `.onOpenURL`, so the email-link handler never
 * sees it. On Android every `lifepass://` link also reaches the app's
 * deep-link router (src/app/deepLinks.ts), even while the page is open. The
 * social page therefore returns on a path of its own, `/social`, still under
 * the `lifepass://auth/callback**` entry of Supabase's redirect allow-list
 * (docs/01, "Redirect URLs"), and the router hands that path to
 * `completeSocialReturn`, never to the email-link handler (whose failure
 * banner, "We couldn't confirm your email", would otherwise follow every
 * Google or Apple sign-in). The attempt id in the link binds its one-time
 * code to the verifier this phone saved, so a stray or forged link is
 * ignored without a request.
 *
 * PROCESS DEATH. If Android drops the app while the tab is open, the return
 * link starts it afresh, on whatever a signed-out start shows (the onboarding
 * splash). The router reads that launch link at the start and hands it to
 * `completeSocialReturn`, which finishes the attempt from the saved verifier
 * there and then; the member lands in the app signed in without visiting Log
 * in. A failure no screen was waiting for is kept (`unreportedFailure`) for
 * the next Log in or Sign up screen to show. The verifier is removed at the
 * first use, so the same link replayed from Recents does nothing. The
 * buttons' own `resumeSocialSignIn()` stays as a fallback.
 */
import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { create } from 'zustand';

import { createAuthFetch } from '../../api/authFetch';
import { env } from '../../config/env';
import { currentLanguage } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../supabase/lib/client';
import { missingSocialMetadata } from './socialMetadata';
import { base64UrlEncode, CODE_CHALLENGE_METHOD, codeChallenge, newCodeVerifier } from './socialPkce';

export type SocialProvider = 'google' | 'apple';

/**
 * How a sign-in ended:
 * - `signedIn`: the member is in;
 * - `cancelled`: they closed the page or said no on it (nothing is shown);
 * - `failed`: anything else (`auth.social_failed` is shown);
 * - `busy`: another sign-in is already running (nothing happens);
 * - `ignored`: the link was not a return this phone is waiting for.
 */
export type SocialSignInOutcome = 'signedIn' | 'cancelled' | 'failed' | 'busy' | 'ignored';

/** The page's return link, before its query (`attempt`, then the code GoTrue adds). */
export const SOCIAL_RETURN_URL = 'lifepass://auth/callback/social';

/**
 * The Custom Tab's options: in the app's own task (as F8's hosted pages,
 * src/payments/hostedPage.ts), so a member who leaves for another app on the
 * way (Google's 2-Step Verification, a password manager) and comes back
 * through Recents lands on the page again, and the return link closes it.
 */
export const SOCIAL_PAGE_OPTIONS: WebBrowser.AuthSessionOpenOptions = Object.freeze({ createTask: false });

/** How long a saved attempt may wait for its return (Supabase's auth codes live minutes, not hours). */
export const SOCIAL_ATTEMPT_MAX_AGE_MS = 10 * 60 * 1000;

/** Where the attempt in flight is kept (Keystore-encrypted, like the session itself). */
export const SOCIAL_PENDING_KEY = 'auth.socialPending';

/**
 * The errors Apple's page returns when the member presses its Cancel: the
 * twin of iOS's native Apple sheet's Cancel (`ASAuthorizationError.canceled`),
 * which iOS keeps silent. Google has none: iOS shows `auth.social_failed`
 * for a Cancel on Google's consent page (file comment, step 3).
 */
const APPLE_CANCEL_ERRORS: ReadonlySet<string> = new Set(['user_cancelled_authorize', 'access_denied']);

// ---------------------------------------------------------------------------
// Timing (tests run without waits)

export interface SocialTiming {
  /** iOS `Task.sleep(nanoseconds: 800_000_000)` before the one metadata retry. */
  readonly metadataRetryDelayMs: number;
  /**
   * How long to wait for the return link after the tab reported a close
   * without one: the Android polyfill also resolves when the app comes back
   * to the foreground, which can beat the link's own event (F8's
   * `lateReturnGraceMs`).
   */
  readonly lateReturnGraceMs: number;
}

export const SOCIAL_TIMING_DEFAULTS: SocialTiming = Object.freeze({ metadataRetryDelayMs: 800, lateReturnGraceMs: 300 });
let timing: SocialTiming = SOCIAL_TIMING_DEFAULTS;

/** Tests: shorter waits (null restores the defaults). */
export function setSocialTimingForTests(next: Partial<SocialTiming> | null): void {
  timing = next ? { ...SOCIAL_TIMING_DEFAULTS, ...next } : SOCIAL_TIMING_DEFAULTS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// The state the buttons read

interface SocialSignInState {
  /** A sign-in is running: the buttons are disabled and dimmed (iOS `isLoading`). */
  readonly busy: boolean;
  /**
   * A sign-in that no button was waiting for failed: one the router finished
   * from a return link (after a process death, say). The next Log in or Sign
   * up screen in front takes it (`takeUnreportedSocialFailure`) and shows
   * `auth.social_failed` once.
   */
  readonly unreportedFailure: boolean;
}

export const useSocialSignInStore = create<SocialSignInState>(() => ({ busy: false, unreportedFailure: false }));

/** Takes the failure no button has shown yet: true once, then false until the next one. */
export function takeUnreportedSocialFailure(): boolean {
  if (!useSocialSignInStore.getState().unreportedFailure) return false;
  useSocialSignInStore.setState({ unreportedFailure: false });
  return true;
}

/**
 * Whether a Google or Apple sign-in is running, for the email form beside
 * the buttons (CONTRACT for AUTH-1's Log in and Sign up). iOS keeps ONE
 * `isLoading` for the whole screen: while the provider's page is open, the
 * email Sign in / Create account button is disabled too, so the two sign-ins
 * never race each other to `handleSignIn`. The other direction is
 * `SocialSignInButtons`' `disabled` prop.
 */
export function useSocialSignInBusy(): boolean {
  return useSocialSignInStore((state) => state.busy);
}

// ---------------------------------------------------------------------------
// The links

/** The return link for one attempt (the `redirect_to` the page is given). */
export function socialReturnUrl(attempt: string): string {
  return `${SOCIAL_RETURN_URL}?attempt=${encodeURIComponent(attempt)}`;
}

/** The provider's sign-in page for an attempt (supabase-js `_getUrlForProvider`, PKCE). */
export function socialAuthorizeUrl(provider: SocialProvider, challenge: string, attempt: string): string {
  const params = [
    `provider=${encodeURIComponent(provider)}`,
    `redirect_to=${encodeURIComponent(socialReturnUrl(attempt))}`,
    `code_challenge=${encodeURIComponent(challenge)}`,
    `code_challenge_method=${CODE_CHALLENGE_METHOD}`,
  ];
  // iOS passes `prompt=select_account` to Google only; GoTrue hands extra
  // query items on to the provider.
  if (provider === 'google') params.push('prompt=select_account');
  return `${env.supabaseUrl}/auth/v1/authorize?${params.join('&')}`;
}

/** Whether a link is the social page's return (any attempt, any outcome). */
export function isSocialReturnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.slice(0, SOCIAL_RETURN_URL.length).toLowerCase() !== SOCIAL_RETURN_URL) return false;
  const next = trimmed.charAt(SOCIAL_RETURN_URL.length);
  return next === '' || next === '?' || next === '#' || next === '/';
}

function readParams(part: string, into: Map<string, string>): void {
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    const raw = at < 0 ? '' : pair.slice(at + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      // Keep it as it came.
    }
    // The query wins over the fragment (GoTrue may repeat an error in both).
    if (!into.has(key)) into.set(key, value);
  }
}

/** What a return link says. */
export type SocialReturn =
  | { readonly kind: 'code'; readonly attempt: string | null; readonly code: string }
  | {
      readonly kind: 'error';
      readonly attempt: string | null;
      /** `error`, else `error_code`, as sent. */
      readonly error: string;
      /** Both of them, lower case, for telling a Cancel apart (`isProviderCancel`). */
      readonly codes: readonly string[];
    };

/**
 * Reads a return link: the attempt it belongs to, and either the one-time
 * code or the error the provider (or GoTrue) sent instead. Null for any
 * other link.
 */
export function parseSocialReturn(url: string | null | undefined): SocialReturn | null {
  if (!isSocialReturnUrl(url)) return null;
  const text = url!.trim();
  const hashAt = text.indexOf('#');
  const beforeHash = hashAt < 0 ? text : text.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : text.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const params = new Map<string, string>();
  if (queryAt >= 0) readParams(beforeHash.slice(queryAt + 1), params);
  readParams(fragment, params);
  const attempt = params.get('attempt') || null;
  const error = params.get('error') || params.get('error_code') || '';
  if (error) {
    const codes = [params.get('error'), params.get('error_code')]
      .filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());
    return { kind: 'error', attempt, error, codes };
  }
  const code = params.get('code');
  if (code) return { kind: 'code', attempt, code };
  return { kind: 'error', attempt, error: 'no_code', codes: ['no_code'] };
}

/**
 * Whether an error return is the member pressing Cancel on the provider's
 * page, which says nothing: only Apple's (see `APPLE_CANCEL_ERRORS`).
 */
export function isProviderCancel(provider: SocialProvider, parsed: SocialReturn): boolean {
  if (parsed.kind !== 'error' || provider !== 'apple') return false;
  return parsed.codes.some((code) => APPLE_CANCEL_ERRORS.has(code));
}

// ---------------------------------------------------------------------------
// The attempt this phone is waiting for

export interface PendingSocialAttempt {
  readonly attempt: string;
  readonly provider: SocialProvider;
  readonly verifier: string;
  /** Epoch ms. */
  readonly startedAt: number;
}

async function savePending(pending: PendingSocialAttempt): Promise<void> {
  try {
    await SecureStore.setItemAsync(SOCIAL_PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without it only the process-death path is lost: the attempt in memory still finishes.
  }
}

/** The saved attempt, or null (none, unreadable, or not the shape this build writes). */
export async function loadPendingSocialAttempt(): Promise<PendingSocialAttempt | null> {
  try {
    const raw = await SecureStore.getItemAsync(SOCIAL_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingSocialAttempt>;
    if (
      typeof value.attempt !== 'string' ||
      typeof value.verifier !== 'string' ||
      typeof value.startedAt !== 'number' ||
      (value.provider !== 'google' && value.provider !== 'apple')
    ) {
      return null;
    }
    return value as PendingSocialAttempt;
  } catch {
    return null;
  }
}

async function clearPending(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SOCIAL_PENDING_KEY);
  } catch {
    // A verifier left behind expires with its attempt (SOCIAL_ATTEMPT_MAX_AGE_MS).
  }
}

// ---------------------------------------------------------------------------
// The auth server, outside the app's Supabase client

interface ProviderTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly user: { readonly id: string; readonly user_metadata?: Record<string, unknown> | null };
}

/** A request the auth server refused or answered with something unusable. */
export class SocialAuthServerError extends Error {
  constructor(
    readonly step: 'exchange' | 'metadata',
    readonly status: number | null,
  ) {
    super(`social sign-in: ${step} failed${status === null ? '' : ` (${status})`}`);
    this.name = 'SocialAuthServerError';
  }
}

function authServer(): typeof fetch {
  // F2's auth-server fetch: a ceiling on every request (60 s, the URLSession
  // default supabase-swift rides).
  return createAuthFetch();
}

function isTokens(value: unknown): value is ProviderTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<ProviderTokens>;
  return (
    typeof tokens.access_token === 'string' &&
    tokens.access_token.length > 0 &&
    typeof tokens.refresh_token === 'string' &&
    tokens.refresh_token.length > 0 &&
    !!tokens.user &&
    typeof tokens.user.id === 'string' &&
    tokens.user.id.length > 0
  );
}

/** `POST /auth/v1/token?grant_type=pkce`: the one-time code and our verifier for the member's tokens. */
async function exchangeCode(code: string, verifier: string): Promise<ProviderTokens> {
  const response = await authServer()(`${env.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey: env.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!response.ok) throw new SocialAuthServerError('exchange', response.status);
  const body: unknown = await response.json().catch(() => null);
  if (!isTokens(body)) throw new SocialAuthServerError('exchange', response.status);
  return body;
}

/** `PUT /auth/v1/user` `{ data }`, as the member (supabase `updateUser({ data })`). */
async function writeMetadata(accessToken: string, data: Record<string, string | boolean>): Promise<void> {
  const response = await authServer()(`${env.supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw new SocialAuthServerError('metadata', response.status);
}

/**
 * iOS `writeSocialMetadata`: the missing keys, with one retry after a short
 * pause. True when the account's metadata is complete (also when nothing was
 * missing).
 */
async function completeMetadata(tokens: ProviderTokens): Promise<boolean> {
  const data = missingSocialMetadata(tokens.user.user_metadata, null, currentLanguage());
  if (Object.keys(data).length === 0) return true;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await writeMetadata(tokens.access_token, data);
      return true;
    } catch {
      if (attempt === 1) await sleep(timing.metadataRetryDelayMs);
    }
  }
  return false;
}

/** The tokens into the app's Supabase client: stored like any session, SIGNED_IN fires. */
async function handOverSession(tokens: ProviderTokens): Promise<Session> {
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error || !data.session) throw error ?? new Error('social sign-in: no session');
  return data.session;
}

/**
 * A member is already signed in on this phone. iOS cannot get here: one
 * `isLoading` per screen keeps the email sign-in and a provider one from
 * both running. Here the email form's own sign-in could finish while the
 * provider's page is open (until the screens pass their busy state both
 * ways), and a second account must never be swapped in under the first.
 */
function someoneSignedIn(): boolean {
  return useAppStore.getState().isAuthenticated;
}

/** Steps 4 to 6 for a return link of `pending`. Never throws. */
async function finishAttempt(url: string, pending: PendingSocialAttempt): Promise<SocialSignInOutcome> {
  // A code is good once, and so is its verifier: whatever happens next, this
  // attempt is over (and a replay of the same link finds nothing).
  await clearPending();
  const parsed = parseSocialReturn(url);
  if (!parsed || parsed.attempt !== pending.attempt) return 'failed';
  if (parsed.kind === 'error') return isProviderCancel(pending.provider, parsed) ? 'cancelled' : 'failed';
  // Signed in another way meanwhile: this attempt is dropped, silently.
  if (someoneSignedIn()) return 'cancelled';
  let tokens: ProviderTokens;
  try {
    tokens = await exchangeCode(parsed.code, pending.verifier);
  } catch {
    return 'failed';
  }
  // A write that failed twice still signs in: the profile is then created
  // without what was missing, which is what iOS accepts too.
  await completeMetadata(tokens);
  if (someoneSignedIn()) return 'cancelled';
  let session: Session;
  try {
    session = await handOverSession(tokens);
  } catch {
    return 'failed';
  }
  try {
    await useAppStore.getState().handleSignIn(session.user.id, { session });
  } catch {
    // The session is stored: the app store's own SIGNED_IN listener runs the sign-in.
  }
  return 'signedIn';
}

// ---------------------------------------------------------------------------
// The page in flight, in this process

interface OpenPage {
  readonly attempt: string;
  returnUrl: string | null;
  arrived: (() => void) | null;
}

let openPage: OpenPage | null = null;

/** A return link for the page open in this process: it takes it. False when none is open for it. */
function noteReturn(url: string): boolean {
  const page = openPage;
  if (!page || !isSocialReturnUrl(url)) return false;
  if (parseSocialReturn(url)?.attempt !== page.attempt) return false;
  if (page.returnUrl === null) {
    page.returnUrl = url;
    page.arrived?.();
  }
  return true;
}

async function awaitLateReturn(page: OpenPage, ms: number): Promise<void> {
  if (page.returnUrl !== null || ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    page.arrived = resolve;
    timer = setTimeout(resolve, ms);
  });
  if (timer !== undefined) clearTimeout(timer);
  page.arrived = null;
}

function newAttemptId(): string {
  return base64UrlEncode(Crypto.getRandomBytes(16));
}

/**
 * Continue with `provider`: the whole flow (file comment). Resolves once the
 * member is signed in, or the attempt is over. Never throws.
 */
export async function signInWithSocialProvider(provider: SocialProvider): Promise<SocialSignInOutcome> {
  if (useSocialSignInStore.getState().busy) return 'busy';
  useSocialSignInStore.setState({ busy: true });
  try {
    let pending: PendingSocialAttempt;
    try {
      pending = { attempt: newAttemptId(), provider, verifier: newCodeVerifier(), startedAt: Date.now() };
    } catch {
      // The platform's secure random was not there: no attempt can be made safely.
      return 'failed';
    }
    // Saved BEFORE the page opens: the process can be gone by the time it returns.
    await savePending(pending);

    const page: OpenPage = { attempt: pending.attempt, returnUrl: null, arrived: null };
    openPage = page;
    // The polyfill listens for the link itself but also resolves when the app
    // comes back to the foreground, which can beat the link: listen here too.
    const subscription = Linking.addEventListener('url', (event: { url: string }) => {
      noteReturn(event.url);
    });
    try {
      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await WebBrowser.openAuthSessionAsync(
          socialAuthorizeUrl(provider, codeChallenge(pending.verifier), pending.attempt),
          SOCIAL_RETURN_URL,
          SOCIAL_PAGE_OPTIONS,
        );
      } catch {
        // No browser, or another page already open: the page never came up.
        await clearPending();
        return 'failed';
      }
      if (result.type === 'success' && typeof result.url === 'string') noteReturn(result.url);
      else {
        await awaitLateReturn(page, timing.lateReturnGraceMs);
        // Android destroyed the app's screen behind the page but kept the
        // process ("Don't keep activities", memory pressure): the return then
        // started a NEW screen, and React Native hands such a link only to
        // `getInitialURL`, never to the `url` event. The attempt id keeps an
        // older launch link from being taken for this one.
        if (page.returnUrl === null) {
          const launch = await Linking.getInitialURL().catch(() => null);
          if (launch) noteReturn(launch);
        }
      }
    } finally {
      subscription.remove();
      if (openPage === page) openPage = null;
    }

    if (page.returnUrl === null) {
      // Closed with the X or Android back: a cancel, which says nothing.
      await clearPending();
      return 'cancelled';
    }
    return await finishAttempt(page.returnUrl, pending);
  } finally {
    useSocialSignInStore.setState({ busy: false });
  }
}

/**
 * Completions of saved attempts running now, by attempt id: the same link
 * arriving twice at once (the router's launch link and a screen's resume) is
 * finished once. A settled one is removed; its verifier is gone by then, so
 * a later call for the same link is ignored.
 */
const completions = new Map<string, Promise<SocialSignInOutcome>>();

/**
 * A social return link that reached the app some other way than the open
 * page: through the deep-link router (src/app/deepLinks.ts hands every
 * `isSocialReturnUrl` link here and nowhere else), including the link that
 * started the app after Android dropped the process behind the page.
 *
 * - A page open in this process takes its own return, and this does nothing.
 * - Otherwise the attempt is finished from the saved verifier, when the link
 *   belongs to it and it is not older than `SOCIAL_ATTEMPT_MAX_AGE_MS`. No
 *   button is waiting for it, so a failure is kept for the next sign-in
 *   screen (`unreportedFailure`), reported once.
 * - Anything else (no saved attempt, another attempt's link, a replay) is
 *   ignored without a request.
 * Never throws.
 */
export function completeSocialReturn(url: string): Promise<SocialSignInOutcome> {
  if (!isSocialReturnUrl(url)) return Promise.resolve('ignored');
  if (noteReturn(url) || openPage) return Promise.resolve('ignored');
  const attempt = parseSocialReturn(url)?.attempt;
  if (!attempt) return Promise.resolve('ignored');
  const running = completions.get(attempt);
  if (running) return running;
  const completion = (async (): Promise<SocialSignInOutcome> => {
    const pending = await loadPendingSocialAttempt();
    if (!pending || pending.attempt !== attempt) return 'ignored';
    if (Date.now() - pending.startedAt > SOCIAL_ATTEMPT_MAX_AGE_MS) {
      await clearPending();
      return 'ignored';
    }
    if (useSocialSignInStore.getState().busy) return 'busy';
    useSocialSignInStore.setState({ busy: true });
    try {
      return await finishAttempt(url, pending);
    } finally {
      useSocialSignInStore.setState({ busy: false });
    }
  })()
    .catch((): SocialSignInOutcome => 'failed')
    .then((outcome) => {
      if (completions.get(attempt) === completion) completions.delete(attempt);
      if (outcome === 'failed') useSocialSignInStore.setState({ unreportedFailure: true });
      return outcome;
    });
  completions.set(attempt, completion);
  return completion;
}

/**
 * The fallback for the router's launch-link path: the sign-in screens call
 * this when they appear, and if the app was started by the social page's
 * return link and that attempt is still waiting, it finishes now (a failure
 * reaches the screen through `unreportedFailure`, as the router's does).
 * Never throws.
 */
export async function resumeSocialSignIn(): Promise<SocialSignInOutcome> {
  let url: string | null = null;
  try {
    url = await Linking.getInitialURL();
  } catch {
    return 'ignored';
  }
  if (!url || !isSocialReturnUrl(url)) return 'ignored';
  // The launch link stays the same for the life of the process: a sign-in
  // screen appearing again later (after a sign-out, say) must not report that
  // old attempt again.
  if (url === resumedLaunchUrl) return 'ignored';
  resumedLaunchUrl = url;
  return completeSocialReturn(url);
}

/** The launch link `resumeSocialSignIn` already acted on in this process. */
let resumedLaunchUrl: string | null = null;

/** Back to a fresh process (tests). The saved attempt is storage's: tests clear it themselves. */
export function resetSocialSignInForTests(): void {
  openPage = null;
  completions.clear();
  resumedLaunchUrl = null;
  timing = SOCIAL_TIMING_DEFAULTS;
  useSocialSignInStore.setState({ busy: false, unreportedFailure: false });
}
