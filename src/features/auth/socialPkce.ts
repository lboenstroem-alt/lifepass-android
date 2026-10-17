/**
 * PKCE (RFC 7636) for the Google and Apple sign-in pages.
 *
 * WHY PKCE, AS iOS. supabase-swift signs in with Google through Supabase's
 * OAuth page in PKCE mode: the page hands back a one-time CODE, and only the
 * app that holds the matching VERIFIER can turn it into a session. On Android
 * that matters more than on iOS: the page returns through the `lifepass://`
 * scheme, which another app on the phone could also register, and a code
 * caught that way is useless without the verifier, which never leaves this
 * app. The app's own Supabase client runs the implicit flow (tokens in the
 * link), so the social flow keeps its own verifier (./social.ts).
 *
 * The verifier is 32 random bytes (expo-crypto, the platform's secure random)
 * as base64url: 43 characters from the RFC's unreserved set. The challenge
 * is base64url(SHA-256(verifier)), method `S256`, which GoTrue accepts as
 * `s256` (the spelling supabase-js sends).
 */
import { sha256 } from '@noble/hashes/sha2';
import * as Crypto from 'expo-crypto';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding (RFC 4648 section 5). The phone has no Buffer. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]!;
  }
  return out;
}

/** The bytes of an ASCII string (a verifier is ASCII by construction). */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Lower-case hex SHA-256 of a string's bytes (the digest the challenge is made of). */
export function sha256Hex(text: string): string {
  return Array.from(sha256(asciiBytes(text)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A fresh code verifier: 43 characters of [A-Za-z0-9-_], never the same twice. */
export function newCodeVerifier(): string {
  return base64UrlEncode(Crypto.getRandomBytes(32));
}

/** The `S256` challenge for a verifier. */
export function codeChallenge(verifier: string): string {
  return base64UrlEncode(sha256(asciiBytes(verifier)));
}

/** The method name GoTrue is sent (supabase-js sends the same lower-case form). */
export const CODE_CHALLENGE_METHOD = 's256';
