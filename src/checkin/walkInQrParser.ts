// Parses a scanned / deep-linked LifePass check-in payload into a venue id.
//
// Faithful port of lifepass-ios Services/WalkInQRParser.swift (itself a port
// of the web canonical parser apps/web/src/components/customer/walk-in-qr-parser.ts)
// so the Android in-app scanner AND the `/scan` App Link accept EXACTLY what
// the printed posters use. See the monorepo docs/08_QR_CODE.md for the contract.
//
// Accepted forms:
//   - Canonical URL:  https://lifepass.is/scan?v=<uuid>   (the printed form)
//   - Legacy JSON:    {"type":"venue_checkin","id":"<uuid>"}
//   - Fragment JSON:  https://lifepass.is/scan#%7B...%7D   (LifePass scanners)
//   - Bare UUID:      <uuid>                                (manual fallback)
//
// The venue id must be an RFC 4122 v1 to v5 UUID (the all-zero UUID and
// version-less strings are rejected). Business decisions (eligibility,
// pricing, caps) are never trusted from the QR: only the venue id is
// extracted and everything else defers to the API.
//
// The id comes back LOWER CASE, as every other id in the app is kept
// (src/api/wire `wireId`): iOS compares UUID values, so its case never
// matters there; here strings are compared.
import { env } from '../config/env';

// RFC 4122 v1-v5 (version nibble 1-5, variant nibble 8/9/a/b).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mirrors WalkInQRParser.prodHosts.
const PROD_HOSTS: ReadonlySet<string> = new Set(['lifepass.is', 'www.lifepass.is', 'app.lifepass.is', 'staging.lifepass.is']);

/** A URL is only ever read when it starts with a web scheme (iOS `^https?://`). */
const WEB_URL_RE = /^https?:\/\//i;

export function isVenueUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * The configured API's host name, trusted as well (iOS `APIConfig.baseURL.host`,
 * the web's `selfHost()`): covers a preview or staging-pointed build.
 */
function apiHostName(): string | null {
  try {
    return new URL(env.apiBaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedHost(hostName: string): boolean {
  const lower = hostName.toLowerCase();
  if (PROD_HOSTS.has(lower)) return true;
  if (apiHostName() === lower) return true;
  // A development build pointed at a laptop (iOS `#if DEBUG`).
  if (__DEV__ && (lower === 'localhost' || lower === '127.0.0.1')) return true;
  return false;
}

/** Why a payload was refused (the iOS `Reason` raw values). */
export type WalkInQrFailure = 'empty' | 'wrong_type' | 'untrusted_host' | 'invalid_uuid' | 'invalid_payload';

/** Where the venue id was found (iOS `Source`). */
export type WalkInQrSource = 'urlQuery' | 'urlFragment' | 'json' | 'uuid';

export type WalkInQrResult =
  | { readonly ok: true; readonly venueId: string; readonly source: WalkInQrSource }
  | { readonly ok: false; readonly reason: WalkInQrFailure };

function failure(reason: WalkInQrFailure): WalkInQrResult {
  return { ok: false, reason };
}

function success(venueId: string, source: WalkInQrSource): WalkInQrResult {
  return { ok: true, venueId: venueId.toLowerCase(), source };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A JSON object (never an array, a number or null), or null (iOS `jsonObject(from:)`). */
function jsonObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function venueIdFromJson(payload: Record<string, unknown>, source: WalkInQrSource): WalkInQrResult {
  // booking_checkin and any other type are not customer walk-in codes.
  if (typeof payload.type === 'string' && payload.type !== 'venue_checkin') return failure('wrong_type');
  const id = payload.id;
  if (typeof id !== 'string') return failure('invalid_payload');
  if (!isVenueUuid(id)) return failure('invalid_uuid');
  return success(id, source);
}

/** A URL's host name and parts, or null when it is not a URL with a host (iOS `URLComponents(string:)?.host`). */
function urlParts(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

function tryUrl(input: string): WalkInQrResult | null {
  const url = urlParts(input);
  if (!url) return null;
  if (!isTrustedHost(url.hostname)) return failure('untrusted_host');

  const v = url.searchParams.get('v');
  if (v) {
    if (!isVenueUuid(v)) return failure('invalid_uuid');
    return success(v, 'urlQuery');
  }

  // The fragment may carry the legacy JSON form, e.g. `#%7B...%7D`.
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (fragment) {
    const payload = jsonObject(safeDecode(fragment));
    if (payload) return venueIdFromJson(payload, 'urlFragment');
  }

  return failure('invalid_payload');
}

/** Extract a venue id from a raw scanned payload (iOS `WalkInQRParser.parse`). */
export function parseWalkInQr(input: string): WalkInQrResult {
  const trimmed = input.trim();
  if (!trimmed) return failure('empty');

  if (WEB_URL_RE.test(trimmed)) {
    const urlResult = tryUrl(trimmed);
    if (urlResult) return urlResult;
  }

  if (trimmed.startsWith('{')) {
    const payload = jsonObject(trimmed);
    return payload ? venueIdFromJson(payload, 'json') : failure('invalid_payload');
  }

  if (isVenueUuid(trimmed)) return success(trimmed, 'uuid');

  return failure('invalid_payload');
}

/**
 * True when a payload is SHAPED like a LifePass code, whether or not it
 * parsed: a URL on one of our own hosts, or one of our two JSON envelopes
 * (iOS `isLifePassShaped`).
 *
 * The camera-first Scan tab needs this to tell two silences apart. A menu
 * URL, a Wi-Fi sticker or a parking code is somebody else's QR and must pass
 * without a word. A damaged or mis-printed LifePass poster (a `.../scan?v=`
 * with a garbled id, a `.../scan` that lost its parameter, a broken JSON
 * envelope) is a code the member aimed at expecting it to work, and saying
 * nothing leaves them at the door with no idea why. Nothing here parses or
 * trusts a payload: it only asks whose code it looks like.
 *
 * JSON IS NOT OURS BY ITSELF. A Wi-Fi sticker, a restaurant order code and an
 * event ticket are all JSON objects, and the always-on viewfinder meets them
 * on the table in front of the member; treating every `{` as ours would alert
 * and lock the scanner on all of them. Only our own two envelope types count.
 * This is a substring test, not a decode, so a truncated
 * `{"type":"venue_checkin"` (a half-read poster, which IS ours) still counts.
 */
export function isLifePassShaped(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    return trimmed.includes('venue_checkin') || trimmed.includes('booking_checkin');
  }
  if (!WEB_URL_RE.test(trimmed)) return false;
  const url = urlParts(trimmed);
  return url !== null && isTrustedHost(url.hostname);
}

/** Convenience: the venue id, or null when the payload isn't a valid code. */
export function venueIdFromScan(input: string): string | null {
  const r = parseWalkInQr(input);
  return r.ok ? r.venueId : null;
}
