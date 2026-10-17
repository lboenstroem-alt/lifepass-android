/**
 * The account metadata a Google or Apple sign-in may add: the Android port of
 * iOS `SocialSignupMetadata` (Services/AuthService.swift, 2.5.4).
 *
 * WHY IT MATTERS, AND WHY BEFORE THE FIRST PROFILE READ. A provider sign-in
 * never passes the website's `/auth/callback`, so the LifePass API creates the
 * member's profile on their first authenticated call (`GET /profile`,
 * `server/auth/actor.ts`), ONCE, from the account metadata as it is at that
 * moment, and it has no way to set the name, language or consent afterwards.
 * So whatever the provider left out is written first (./social.ts runs it
 * before the session reaches the app).
 *
 * NEVER OVERWRITE. A verified email that already has an account signs in to
 * THAT account (Supabase's automatic identity linking). It keeps its own name
 * (the one venue staff check against), its own language, its own sign-up
 * source and, above all, its own marketing consent: only keys that are
 * missing are sent. Pure, so the rule is a unit test.
 */

/** A metadata value as it arrives in the account's `user_metadata`. */
export type MetadataValue = unknown;

/**
 * `signup_source` for an account the Android app creates (owner decision D2:
 * `android`, so the website can tell an Android sign-up from a web one, as
 * iOS sends `ios`). The email sign-up (AUTH-1) sends the same value.
 */
export const ANDROID_SIGNUP_SOURCE = 'android';

/** The languages the account may be written in (iOS: `is` or `en`, nothing else). */
const ACCOUNT_LOCALES: readonly string[] = ['is', 'en'];

/** iOS `SocialSignupMetadata.isBlank`: absent, null, or text that is only whitespace. */
export function isBlankMetadataValue(value: MetadataValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

/**
 * What to send (iOS `SocialSignupMetadata.missing`):
 * - `full_name`: the name the provider handed the app, only when the account
 *   has none. Android's web flows hand the app no name of their own (Google
 *   and Apple put it on the account themselves when they send it), so the
 *   callers pass null; kept for parity and for a future native flow;
 * - `locale`: the language the screens spoke, when the account has none, and
 *   only `is` or `en`;
 * - `signup_source`: `android`, when the account has none at all;
 * - `marketing_opt_in`: false, when the account has none at all. A provider
 *   sign-in shows no marketing question, so it is never a yes.
 * Empty when nothing is missing: the caller then sends nothing.
 */
export function missingSocialMetadata(
  metadata: Readonly<Record<string, MetadataValue>> | null | undefined,
  fullName: string | null,
  locale: string,
): Record<string, string | boolean> {
  const existing = metadata ?? {};
  const data: Record<string, string | boolean> = {};
  const name = fullName?.trim() ?? '';
  if (name && isBlankMetadataValue(existing.full_name)) data.full_name = name;
  if (isBlankMetadataValue(existing.locale) && ACCOUNT_LOCALES.includes(locale)) data.locale = locale;
  // Present at all (even null) counts, as iOS's `metadata[...] == nil` does.
  if (!Object.prototype.hasOwnProperty.call(existing, 'signup_source')) data.signup_source = ANDROID_SIGNUP_SOURCE;
  if (!Object.prototype.hasOwnProperty.call(existing, 'marketing_opt_in')) data.marketing_opt_in = false;
  return data;
}
