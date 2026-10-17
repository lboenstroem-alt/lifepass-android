/**
 * Email sign-in, sign-up, password reset and the auth links: the Android port
 * of iOS `AuthService` (Services/AuthService.swift).
 *
 * Account creation is a direct Supabase `auth.signUp` with the SAME user
 * metadata the website and iOS send (`full_name`, `marketing_opt_in`,
 * `signup_source`, `locale`, and `nationality` only when set). There is no
 * sign-up API endpoint: the `profiles` row is created server-side from this
 * metadata. The client writes NO app tables.
 *
 * WHERE THE EMAIL LINKS RETURN (D23). The confirmation and reset emails carry
 * a `redirect_to`. The decided return is the App Link
 * `https://www.lifepass.is/app/auth-callback` (a web page saying "Open
 * LifePass to continue"), with the custom scheme `lifepass://auth/callback`
 * as the fallback, and the app handles BOTH (src/app/deepLinks.ts routes
 * either to `handleAuthCallback`). Until that web page exists and the URL is
 * on Supabase's redirect allow-list (release tasks), the emails ask for the
 * custom scheme, which is already allow-listed and is what iOS asks for, so
 * the link opens the app on its own. Switching is one line:
 * `AUTH_EMAIL_REDIRECT` below.
 *
 * The first Android build sent `https://www.lifepass.is` instead, so a
 * confirmation never came back to the app; and its reset link signed the
 * member in with the OLD password (no recovery detection).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { currentLanguage, type Lang } from '../../i18n';
import { supabase } from '../lib/client';

/** The custom-scheme auth return (app.json `scheme`), as iOS `AuthService.authCallbackURL`. */
export const AUTH_CALLBACK_URL = 'lifepass://auth/callback';

/** The App Link auth return (D23); handled already, asked for once the web page is live. */
export const AUTH_APP_LINK_URL = 'https://www.lifepass.is/app/auth-callback';

/**
 * Where the confirmation and reset emails send the member back. The custom
 * scheme until the App Link's web page and allow-list entry exist (see the
 * file comment); then `AUTH_APP_LINK_URL`.
 */
export const AUTH_EMAIL_REDIRECT: string = AUTH_CALLBACK_URL;

/**
 * `signup_source` for every account this app creates (D2): iOS sends "ios",
 * the website "auth" or "plan". The website reads it to tell an app sign-up
 * from a web one; nothing on the server reads any other value.
 */
export const SIGNUP_SOURCE = 'android';

/**
 * The phone-local "a reset was requested" marker, epoch SECONDS (iOS
 * `AuthService.recoveryRequestedAtKey`, UserDefaults). A PKCE reset link
 * carries only `?code=`, so the link alone may not say it is a recovery;
 * this marker is the second signal (honoured for an hour, read once).
 */
export const RECOVERY_REQUESTED_AT_KEY = 'auth.recoveryRequestedAt';

/** How long the marker counts (iOS: under 3600 s). */
export const RECOVERY_MARKER_TTL_SECONDS = 3600;

/** The reset email's return: the same link, with `type=recovery` kept on it (iOS). */
export function recoveryRedirect(base: string = AUTH_EMAIL_REDIRECT): string {
  return `${base}?type=recovery`;
}

export interface SignUpDetails {
  readonly fullName: string;
  readonly marketingOptIn: boolean;
  /** The language the sign-up screens spoke. */
  readonly locale: Lang;
  /** Upper-case ISO alpha-2, or null/undefined when unset (then the key is left out). */
  readonly nationality?: string | null;
}

/**
 * The sign-up metadata, exactly the iOS keys: `full_name`,
 * `marketing_opt_in`, `signup_source`, `locale`, and `nationality` only when
 * set (never an empty string, as the web form does). Kennitala is NOT a
 * sign-up field: it is verified later through Kenni and is server-owned.
 */
export function signUpMetadata(details: SignUpDetails): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = {
    full_name: details.fullName,
    marketing_opt_in: details.marketingOptIn,
    signup_source: SIGNUP_SOURCE,
    locale: details.locale,
  };
  if (details.nationality) data.nationality = details.nationality;
  return data;
}

/** The result of a sign-up: no session while the email still has to be confirmed. */
export interface SignUpResult {
  readonly session: Session | null;
}

/**
 * Create an account. `email` trimmed and `password` untrimmed by the caller
 * (iOS `AuthViewModel.signUp`). `locale` defaults to the language on screen,
 * which while signed out is the phone's (iOS `LPStrings.currentLanguage`).
 * Throws the Supabase error.
 */
export async function signUp(
  email: string,
  password: string,
  fullName: string,
  nationality: string | undefined,
  marketingOptIn: boolean,
  locale: Lang = currentLanguage(),
): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: signUpMetadata({ fullName, marketingOptIn, locale, nationality }),
      emailRedirectTo: AUTH_EMAIL_REDIRECT,
    },
  });
  if (error) throw error;
  return { session: data.session ?? null };
}

/** Password sign-in. Throws the Supabase error; returns the new session. */
export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('No session returned');
  return data.session;
}

/**
 * Ask for a reset email. The marker is written FIRST and the link asks
 * Supabase to keep `type=recovery` on the return: either signal makes the
 * next auth link open the set-new-password screen (iOS).
 */
export async function resetPassword(email: string, now: () => number = Date.now): Promise<void> {
  try {
    await AsyncStorage.setItem(RECOVERY_REQUESTED_AT_KEY, String(now() / 1000));
  } catch {
    // The link's own `type=recovery` still says it is a recovery.
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirect() });
  if (error) throw error;
}

/**
 * True when a reset was requested on this phone within the hour. Reads the
 * marker ONCE: it is removed whatever it said (iOS
 * `AuthService.consumeRecoveryRequested`).
 */
export async function consumeRecoveryRequested(now: () => number = Date.now): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(RECOVERY_REQUESTED_AT_KEY);
    if (raw !== null) await AsyncStorage.removeItem(RECOVERY_REQUESTED_AT_KEY);
  } catch {
    return false;
  }
  const requestedAt = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(requestedAt) || requestedAt <= 0) return false;
  return now() / 1000 - requestedAt < RECOVERY_MARKER_TTL_SECONDS;
}

/** Set a new password for the recovery session a reset link opened (iOS `updatePassword`). */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Auth links

/**
 * The parameters of an auth link, from its query AND its fragment (the
 * implicit flow puts the tokens and `type` in the fragment, a PKCE return
 * puts `code` in the query, an error may sit in either). A fragment value
 * wins over the same name in the query.
 */
export function authLinkParams(url: string): Record<string, string> {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '';
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  return { ...parsePairs(query), ...parsePairs(fragment) };
}

function parsePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const rawKey = at < 0 ? pair : pair.slice(0, at);
    const rawValue = at < 0 ? '' : pair.slice(at + 1);
    result[decode(rawKey)] = decode(rawValue);
  }
  return result;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** An auth link that could not become a session (expired, used, tampered, offline). */
export class AuthLinkError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AuthLinkError';
  }
}

/** What an auth link exchange produced. */
export interface AuthLinkSession {
  readonly session: Session;
  /** Supabase's own word for a PKCE reset (`redirectType: 'recovery'`). */
  readonly recovery: boolean;
}

/**
 * Exchange an auth link for a live session (iOS `client.auth.session(from:)`):
 * a PKCE `code` through `exchangeCodeForSession`, implicit-flow tokens through
 * `setSession`. Throws `AuthLinkError` for a link that says it failed or
 * carries neither, and the Supabase error for a refused exchange.
 */
export async function exchangeAuthLink(url: string): Promise<AuthLinkSession> {
  const params = authLinkParams(url);
  const failure = params.error_description || params.error_code || params.error;
  if (failure) throw new AuthLinkError(failure);

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    if (!data.session) throw new AuthLinkError('no_session');
    // supabase-js returns `redirectType` (from the stored code verifier) but does not type it.
    const redirectType = (data as { redirectType?: string | null }).redirectType;
    return { session: data.session, recovery: redirectType === 'recovery' };
  }

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    if (!data.session) throw new AuthLinkError('no_session');
    return { session: data.session, recovery: false };
  }

  throw new AuthLinkError('not_an_auth_link');
}

// ---------------------------------------------------------------------------
// Kept for other packages until they move (AUTH-2 replaces the Google helper
// with its own Supabase OAuth flow; the legacy hook still calls signOut).

/**
 * Google sign-in via the Supabase-hosted OAuth flow in a system browser tab.
 * Returns the session, or null if the member closed the browser.
 * @deprecated AUTH-2 owns social sign-in (src/features/auth/social.ts).
 */
export async function signInWithGoogle(): Promise<Session | null> {
  // Where the browser comes back: `exp://<ip>:8081/--/auth/callback` in Expo
  // Go, `lifepass://auth/callback` in real builds. Built here, not at load:
  // it needs the app manifest, which tests and early imports do not have.
  const redirect = makeRedirectUri({ path: 'auth/callback' });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirect, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirect);
  if (result.type !== 'success') return null;
  return (await exchangeAuthLink(result.url)).session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}
