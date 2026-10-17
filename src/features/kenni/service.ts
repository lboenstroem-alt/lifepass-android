/**
 * Kenni (kenni.is) identity verification over the v1 API: the Android port of
 * iOS `KenniService` (Services/KenniService.swift).
 *
 *   1. `POST /auth/kenni/start { platform: "native" }` answers
 *      `{ alreadyVerified: true }`, or `{ alreadyVerified: false,
 *      authorizationUrl }`. The native platform makes the authorization URL
 *      carry the `lifepass://kenni-callback` redirect the app captures; the
 *      redirect is baked in server side (and allow-listed there), so the app
 *      never builds it.
 *   2. The sheet opens `authorizationUrl` in a Custom Tab (./webAuth.ts) and
 *      captures `lifepass://kenni-callback?code=...&state=...`.
 *   3. `POST /auth/kenni/complete { code, state }` stamps the verification on
 *      the profile (and claims any pending company invitation); the app then
 *      re-reads `GET /profile`.
 *
 * The decoders read what iOS's `Decodable` structs read: `alreadyVerified` is
 * required on start (a body without it cannot start anything), and complete's
 * two flags are optional booleans (`kennitalaVerified ?? verified ?? false`).
 * A wrong type is a `DecodingError`, as a Swift decode failure is.
 */
import { apiPost } from '../../api';

export type KenniStart =
  | { readonly kind: 'alreadyVerified' }
  | { readonly kind: 'authorization'; readonly url: string };

/**
 * Start answered without a usable authorization URL (iOS
 * `KenniError.noAuthorizationURL`): the eID check could not be started.
 */
export class KenniNoAuthorizationUrlError extends Error {
  constructor() {
    super('Kenni start returned no authorization URL');
    this.name = 'KenniNoAuthorizationUrlError';
  }
}

/** What the sheet's model calls; swappable so a test can stand in for it. */
export interface KenniService {
  startVerification(): Promise<KenniStart>;
  /** True when the kennitala is now verified. */
  completeVerification(code: string, state: string): Promise<boolean>;
}

type Json = Record<string, unknown>;

function asObject(data: unknown): Json {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new TypeError('not an object');
  return data as Json;
}

function optionalBoolean(body: Json, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new TypeError(`${key} is not a boolean`);
  return value;
}

interface StartResponse {
  readonly alreadyVerified: boolean;
  readonly authorizationUrl?: string;
}

/** `POST /auth/kenni/start`'s data (exported for the tests). */
export function decodeStartResponse(data: unknown): StartResponse {
  const body = asObject(data);
  const alreadyVerified = optionalBoolean(body, 'alreadyVerified');
  if (alreadyVerified === undefined) throw new TypeError('alreadyVerified is missing');
  const url = body.authorizationUrl;
  if (url !== undefined && url !== null && typeof url !== 'string') throw new TypeError('authorizationUrl is not a string');
  return { alreadyVerified, authorizationUrl: typeof url === 'string' ? url : undefined };
}

interface CompleteResponse {
  readonly verified?: boolean;
  readonly kennitalaVerified?: boolean;
}

/** `POST /auth/kenni/complete`'s data (exported for the tests). */
export function decodeCompleteResponse(data: unknown): CompleteResponse {
  const body = asObject(data);
  return { verified: optionalBoolean(body, 'verified'), kennitalaVerified: optionalBoolean(body, 'kennitalaVerified') };
}

/** An absolute URL the browser can open (iOS `URL(string:)` on a string that must not be empty). */
function usableUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

export const kenniService: KenniService = {
  async startVerification() {
    const response = await apiPost('/auth/kenni/start', { platform: 'native' }, { decode: decodeStartResponse });
    if (response.alreadyVerified) return { kind: 'alreadyVerified' };
    const url = usableUrl(response.authorizationUrl);
    if (!url) throw new KenniNoAuthorizationUrlError();
    return { kind: 'authorization', url };
  },

  async completeVerification(code, state) {
    const response = await apiPost('/auth/kenni/complete', { code, state }, { decode: decodeCompleteResponse });
    return response.kennitalaVerified ?? response.verified ?? false;
  },
};
