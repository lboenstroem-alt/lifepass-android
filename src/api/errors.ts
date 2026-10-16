/* eslint lifepass/no-literal-copy: "error" */
/**
 * What a failed LifePass API call is, typed: the Android port of iOS
 * `APIError` and `ProblemDetails` (Services/API/APIError.swift).
 *
 * The API answers a refusal with an RFC 7807 problem
 * (`Content-Type: application/problem+json`):
 *
 *   {
 *     "type": "https://lifepass.is/problems/invalid-cursor",
 *     "title": "Invalid cursor",
 *     "status": 400,
 *     "detail": "Pagination cursor is invalid or malformed.",
 *     "errors": [{ "field": "cursor", "message": "Invalid cursor" }]
 *   }
 *
 * The stable code a feature branches on is the LAST PATH COMPONENT of `type`
 * (`invalid-cursor`, `luxury_cap_reached`), never the human `title`: a domain
 * refusal's title happens to equal its code, but every other problem
 * (`invalid-cursor`, `rate-limited`, `coach-free-limit`) has a sentence there,
 * which is how the old Android client misread them. Compare codes through
 * `isProblem(...)`, which folds `-` and `_`: the server spells some codes both
 * ways (`meal-scan-daily-limit` and `meal_scan_daily_limit` are one refusal).
 *
 * Five kinds, as on iOS:
 *   - ProblemError          a problem body (any JSON object the problem shape decodes)
 *   - HttpStatusError       a non-2xx whose body is not a problem (a gateway's HTML 502)
 *   - DecodingError         a 2xx whose envelope or payload did not decode
 *   - TransportError        no answer: offline, timeout, cancelled, other network failure
 *   - NotAuthenticatedError no session for a route that needs one, or a session the
 *                           server refused for good (the app goes back to sign-in)
 *
 * `message` is always in the language on screen (iOS `errorDescription`): a
 * problem reads as the app's own copy when its code is one the app knows, as
 * the server's `detail` for an English reader, and otherwise as a sentence for
 * its status. Screens that REFUSE a member (booking, scan, pay, cancel,
 * purchase gates) never show even that: they use `refusalMessage` from
 * ./errorFormatter, which never shows the server's words.
 */
import { currentLanguage, translate, type Lang } from '../i18n';

import { isKnownRefusal, PROBLEM_KEYS, resolveRefusal } from './refusals';
import { parseIsoDate } from './wire';

// ---------------------------------------------------------------------------
// Problem details

/** One `errors[]` entry. On a 5xx it carries the request id (`field: "requestId"`). */
export interface ProblemFieldError {
  readonly field?: string;
  readonly message?: string;
}

/** A guest band on a walk-in's charge offer. */
export interface ChargeConsentGuest {
  /** `adult` | `child` | `infant`. */
  readonly band: string;
  readonly count: number;
  readonly unitIsk: number;
}

/**
 * The disclosed charge carried by a `402 charge_consent_required`. The caller
 * confirms by re-POSTing the same request (same Idempotency-Key) with
 * `acceptCharge: true` and `acceptedChargeAmountIsk === amountIsk`, an
 * equality guard on the server.
 */
export interface ChargeConsentOffer {
  /** `surcharge` | `topup`. */
  readonly kind: string;
  readonly amountIsk: number;
  /** `premium` | `network` | `pool`; informational. */
  readonly lane?: string;
  /**
   * `premium_surcharge` | `boutique_surcharge` | `over_cap_topup` |
   * `guest_party` (a walk-in whose only money is guest seats: frame it as
   * "your guests", not "you owe"). Unknown future values mean "a charge applies".
   */
  readonly reason?: string;
  /** Per-seat breakdown on a direct-rail walk-in with guests. */
  readonly party?: {
    readonly ownAmountIsk: number;
    readonly guests: readonly ChargeConsentGuest[];
  };
}

/**
 * What is left of an account's free Coach messages (on the Coach's `429
 * coach-free-limit`, on answers, and on `GET /profile`'s `coach` block).
 */
export interface CoachFreeMessages {
  readonly limit: number;
  /** Never below 0. */
  readonly remaining: number;
  readonly windowDays?: number;
  /** When the next free message frees up; absent when nothing is counted. */
  readonly resetsAt?: Date;
}

/** Where the Coach's Get a membership button goes (`action: "plans"`, or a web `url`). */
export interface CoachUpgrade {
  readonly action?: string;
  readonly url?: string;
}

/** The RFC 7807 body, with the LifePass extension members the app reads. */
export interface ProblemDetails {
  readonly type?: string;
  readonly title?: string;
  /**
   * The problem's status. The server always sends it; a JSON body without one
   * (a proxy's own error page) takes the response's status instead, so it
   * reads by its status like its HTML twin would.
   */
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly ProblemFieldError[];
  /** On a `402 charge_consent_required`: the charge to disclose. */
  readonly offer?: ChargeConsentOffer;
  /**
   * The rule's case, for codes that have several (`slot_unavailable` carries
   * the provider's bookability reason: `class_full`, `event_passed`,
   * `outside_registration_window`, ...; health reuses it).
   */
  readonly reason?: string;
  /** On a `403 no_active_plan_or_pass`: `company_covered` or `pass_holder`. */
  readonly memberPricing?: string;
  /** On the Coach's `429 coach-free-limit`. Read fail-soft. */
  readonly freeMessages?: CoachFreeMessages;
  /** On the same 429. Read fail-soft. */
  readonly upgrade?: CoachUpgrade;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Thrown inside the strict decoders; never escapes this module. */
class Malformed extends Error {}

/** An optional member: absent or null is `undefined`; any other wrong type fails the decode. */
function optional<T>(body: Json, key: string, read: (value: unknown) => T): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return read(value);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Malformed();
  return value;
}

function asInt(value: unknown): number {
  if (!isInt(value)) throw new Malformed();
  return value;
}

function asFieldErrors(value: unknown): ProblemFieldError[] {
  if (!Array.isArray(value)) throw new Malformed();
  return value.map((entry) => {
    if (!isObject(entry)) throw new Malformed();
    return { field: optional(entry, 'field', asString), message: optional(entry, 'message', asString) };
  });
}

function asOffer(value: unknown): ChargeConsentOffer {
  if (!isObject(value)) throw new Malformed();
  const party = optional(value, 'party', (raw) => {
    if (!isObject(raw)) throw new Malformed();
    const guests = raw.guests;
    if (!Array.isArray(guests)) throw new Malformed();
    return {
      ownAmountIsk: asInt(raw.ownAmountIsk),
      guests: guests.map((guest) => {
        if (!isObject(guest)) throw new Malformed();
        return { band: asString(guest.band), count: asInt(guest.count), unitIsk: asInt(guest.unitIsk) };
      }),
    };
  });
  return {
    kind: asString(value.kind),
    amountIsk: asInt(value.amountIsk),
    lane: optional(value, 'lane', asString),
    reason: optional(value, 'reason', asString),
    party,
  };
}

/**
 * `freeMessages`, or `undefined` when it is missing or malformed: a count this
 * build cannot read must never cost the answer it rides on (iOS fail-soft).
 */
export function decodeCoachFreeMessages(value: unknown): CoachFreeMessages | undefined {
  if (!isObject(value) || !isInt(value.limit) || !isInt(value.remaining)) return undefined;
  const resetsAt = typeof value.resetsAt === 'string' ? (parseIsoDate(value.resetsAt) ?? undefined) : undefined;
  return {
    limit: value.limit,
    remaining: Math.max(0, value.remaining),
    windowDays: isInt(value.windowDays) ? value.windowDays : undefined,
    resetsAt,
  };
}

/** `upgrade`, or `undefined` when it is missing or malformed (fail-soft). */
export function decodeCoachUpgrade(value: unknown): CoachUpgrade | undefined {
  if (!isObject(value)) return undefined;
  const { action, url } = value;
  if (action !== undefined && action !== null && typeof action !== 'string') return undefined;
  if (url !== undefined && url !== null) {
    if (typeof url !== 'string' || !isAbsoluteUrl(url)) return undefined;
  }
  return {
    action: typeof action === 'string' ? action : undefined,
    url: typeof url === 'string' ? url : undefined,
  };
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\S+$/i.test(value.trim());
}

/**
 * A problem body, decoded the way iOS decodes one: every member optional, the
 * members that shipped first read strictly (a wrong type makes the body "not a
 * problem", so the error reads by its HTTP status), the Coach's two read
 * fail-soft. Any JSON object is a problem; an array, a string or HTML is not.
 *
 * `httpStatus` fills `status` when the body has none (see `ProblemDetails.status`).
 */
export function decodeProblemDetails(body: unknown, httpStatus?: number): ProblemDetails | null {
  if (!isObject(body)) return null;
  try {
    const status = optional(body, 'status', asInt) ?? httpStatus;
    return {
      type: optional(body, 'type', asString),
      title: optional(body, 'title', asString),
      status,
      detail: optional(body, 'detail', asString),
      instance: optional(body, 'instance', asString),
      errors: optional(body, 'errors', asFieldErrors),
      offer: optional(body, 'offer', asOffer),
      reason: optional(body, 'reason', asString),
      memberPricing: optional(body, 'memberPricing', asString),
      freeMessages: decodeCoachFreeMessages(body.freeMessages),
      upgrade: decodeCoachUpgrade(body.upgrade),
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}

/**
 * The stable code: the last path component of the problem `type`
 * (`https://lifepass.is/problems/luxury-cap-reached` gives
 * `luxury-cap-reached`), as written, or `unknown` when there is none.
 */
export function problemSlug(type: string | undefined | null): string {
  if (!type) return 'unknown';
  // Drop the fragment and query, then the scheme and authority.
  let rest = type.trim().split('#')[0].split('?')[0];
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:(\/\/[^/]*)?/i, '');
  const segments = rest.split('/').filter((segment) => segment !== '');
  const last = segments[segments.length - 1];
  if (!last) return 'unknown';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A code with hyphens folded to underscores (case kept), as iOS `normalisedCode`. */
export function foldCode(code: string): string {
  return code.replace(/-/g, '_');
}

/**
 * The words for a problem, in `lang`: its own copy (`PROBLEM_KEYS`), else the
 * refusal copy when `MemberRefusal` knows the code, else the server's `detail`
 * (then `title`) for an ENGLISH reader only (the server writes English), else
 * the sentence for its status. Port of iOS `APIError.message(for:language:)`.
 *
 * Only a known refusal code changes here; every other code reads as it did
 * before the refusal table, so a screen outside the refusal call sites keeps
 * its words for anything the table does not name.
 */
export function problemMessage(problem: ProblemDetails, lang: Lang): string {
  const slug = problemSlug(problem.type);
  const own = PROBLEM_KEYS[slug];
  if (own) return translate(own, lang);
  if (isKnownRefusal(slug)) {
    const refusal = resolveRefusal(slug, problem.reason ?? null, problem.status ?? 0);
    return translate(refusal.messageKey, lang);
  }
  const text = problem.detail ?? problem.title;
  if (lang !== 'is' && text) return text;
  return translate(statusMessageKey(problem.status ?? 0), lang);
}

/** The sentence for a status with nothing better to say (iOS buckets). */
export function statusMessageKey(status: number): string {
  if (status === 400 || status === 422) return 'error.request_invalid';
  if (status === 401) return 'error.sign_in';
  if (status === 403) return 'error.not_allowed';
  if (status === 404) return 'error.not_found';
  if (status === 409) return 'error.conflict';
  if (status === 429) return 'error.rate_limited';
  if (status >= 500) return 'error.server';
  return 'error.generic';
}

// ---------------------------------------------------------------------------
// The error classes

export type ApiErrorKind = 'problem' | 'http-status' | 'decoding' | 'transport' | 'not-authenticated';

/** What the HTTP response said about itself, for diagnostics and back-off. */
export interface ResponseMeta {
  /** `Retry-After`, in whole seconds from when the answer arrived. */
  readonly retryAfterSeconds?: number;
  /** `X-Request-Id`, or a 5xx's `errors[]` requestId: quote it to support. */
  readonly requestId?: string;
}

/**
 * The base of every API failure. `message` is the member-facing sentence in
 * the language on screen, computed when it is read (a language switch between
 * the throw and the alert still shows the new language).
 */
export abstract class ApiError extends Error {
  abstract readonly kind: ApiErrorKind;

  /** `Retry-After` in seconds, when the server sent one. The caller decides whether to wait. */
  readonly retryAfterSeconds?: number;
  /** The server's request id (a 5xx carries one), for support and logs. */
  readonly requestId?: string;

  protected constructor(name: string, meta: ResponseMeta = {}, cause?: unknown) {
    // No message here: `message` is a getter on the prototype (below), so the
    // Error constructor must not create an own property that would hide it.
    super();
    this.name = name;
    this.retryAfterSeconds = meta.retryAfterSeconds;
    this.requestId = meta.requestId;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }

  /** The member-facing sentence, in `lang`. */
  abstract messageIn(lang: Lang): string;

  /**
   * Stable machine code: the problem's `type` slug, else a synthetic one
   * (`http_502`, `decode_error`, `transport_error`, `not_authenticated`).
   */
  abstract get code(): string;

  /** The code with hyphens folded to underscores. Compare through `isProblem`. */
  get normalisedCode(): string {
    return foldCode(this.code);
  }

  /** True when this is a problem with one of `slugs`, whichever spelling the server used. */
  isProblem(...slugs: string[]): boolean {
    if (this.kind !== 'problem') return false;
    const mine = this.normalisedCode;
    return slugs.some((slug) => foldCode(slug) === mine);
  }

  /** The HTTP status, when there was a response. */
  get status(): number | undefined {
    return undefined;
  }

  /** Whether the same request might succeed later: transport, 5xx and 429. */
  get isRetryable(): boolean {
    return false;
  }

  /**
   * The member walked away (a screen dismissed mid-request): not an outage,
   * so it must never raise the offline banner or an alert.
   */
  get isCancellation(): boolean {
    return false;
  }

  /** No answer arrived (offline, a timeout, a network failure); a cancellation is not. */
  get isOffline(): boolean {
    return false;
  }

  /** The problem body, when there was one. */
  get problem(): ProblemDetails | undefined {
    return undefined;
  }

  /** `offer` on a `402 charge_consent_required`. */
  get offer(): ChargeConsentOffer | undefined {
    return this.problem?.offer;
  }

  /** The problem's machine-readable `reason`, when it sent one. */
  get reason(): string | undefined {
    return this.problem?.reason;
  }

  /** `memberPricing` on a `no_active_plan_or_pass`. */
  get memberPricing(): string | undefined {
    return this.problem?.memberPricing;
  }

  /** `freeMessages` on a `coach-free-limit`. */
  get freeMessages(): CoachFreeMessages | undefined {
    return this.problem?.freeMessages;
  }

  /** `upgrade` on a `coach-free-limit`. */
  get upgrade(): CoachUpgrade | undefined {
    return this.problem?.upgrade;
  }
}

// `message` as a prototype getter: TypeScript declares Error.message as a
// data property, so the accessor is installed here rather than in the class.
Object.defineProperty(ApiError.prototype, 'message', {
  configurable: true,
  enumerable: false,
  get(this: ApiError): string {
    return this.messageIn(currentLanguage());
  },
});

/** A structured problem from the API. */
export class ProblemError extends ApiError {
  readonly kind = 'problem' as const;
  readonly details: ProblemDetails;
  /** The response's own status (the body's `status` is `details.status`). */
  readonly httpStatus: number;

  constructor(details: ProblemDetails, httpStatus: number, meta: ResponseMeta = {}) {
    super('ProblemError', {
      retryAfterSeconds: meta.retryAfterSeconds,
      requestId: meta.requestId ?? requestIdFrom(details.errors),
    });
    this.details = details;
    this.httpStatus = httpStatus;
  }

  /** The `type` slug, e.g. `luxury_cap_reached` or `invalid-cursor`. */
  get slug(): string {
    return problemSlug(this.details.type);
  }

  get code(): string {
    return this.slug;
  }

  get status(): number | undefined {
    return this.details.status ?? this.httpStatus;
  }

  get problem(): ProblemDetails {
    return this.details;
  }

  get isRetryable(): boolean {
    const status = this.details.status ?? 0;
    return status >= 500 || status === 429;
  }

  messageIn(lang: Lang): string {
    return problemMessage(this.details, lang);
  }
}

/** A non-2xx whose body was not a problem (a gateway's HTML 502, a crash page). */
export class HttpStatusError extends ApiError {
  readonly kind = 'http-status' as const;
  readonly httpStatus: number;
  /** The first 240 characters of the body, for diagnostics only. */
  readonly snippet: string;

  constructor(httpStatus: number, snippet: string, meta: ResponseMeta = {}) {
    super('HttpStatusError', meta);
    this.httpStatus = httpStatus;
    this.snippet = snippet;
  }

  get code(): string {
    return `http_${this.httpStatus}`;
  }

  get status(): number {
    return this.httpStatus;
  }

  get isRetryable(): boolean {
    return this.httpStatus >= 500;
  }

  messageIn(lang: Lang): string {
    return translate('error.unexpected_status', lang, { code: this.httpStatus });
  }
}

/** A 2xx whose `{ ok, data }` envelope, or whose payload, did not decode. */
export class DecodingError extends ApiError {
  readonly kind = 'decoding' as const;
  /** The first 240 characters of the body, for diagnostics only. */
  readonly snippet: string;

  constructor(snippet: string, cause?: unknown) {
    super('DecodingError', {}, cause);
    this.snippet = snippet;
  }

  get code(): string {
    return 'decode_error';
  }

  messageIn(lang: Lang): string {
    return translate('error.decoding', lang);
  }
}

/**
 * Why no answer arrived. `offline`: the phone has no network. `timeout`: the
 * call's own ceiling passed. `cancelled`: the caller aborted it. `network`:
 * anything else on the way (DNS, TLS, a connection dropped with the phone
 * online).
 */
export type TransportKind = 'offline' | 'timeout' | 'cancelled' | 'network';

export class TransportError extends ApiError {
  readonly kind = 'transport' as const;
  readonly transport: TransportKind;

  constructor(transport: TransportKind, cause?: unknown) {
    super('TransportError', {}, cause);
    this.transport = transport;
  }

  get code(): string {
    return 'transport_error';
  }

  get isRetryable(): boolean {
    return true;
  }

  get isCancellation(): boolean {
    return this.transport === 'cancelled';
  }

  get isOffline(): boolean {
    return this.transport !== 'cancelled';
  }

  messageIn(lang: Lang): string {
    switch (this.transport) {
      case 'offline':
        return translate('error.offline', lang);
      case 'timeout':
        return translate('error.timeout', lang);
      case 'cancelled':
        return translate('error.cancelled', lang);
      default:
        return translate('error.network', lang);
    }
  }
}

/**
 * The route needs a signed-in member and there is no session, or the server
 * refused the session for good (it was ended locally, and the auth listener
 * takes the app back to sign-in).
 */
export class NotAuthenticatedError extends ApiError {
  readonly kind = 'not-authenticated' as const;

  constructor() {
    super('NotAuthenticatedError');
  }

  get code(): string {
    return 'not_authenticated';
  }

  messageIn(lang: Lang): string {
    return translate('error.sign_in', lang);
  }
}

/** A 5xx's request id rides in `errors` as `{ field: "requestId", message: <uuid> }`. */
function requestIdFrom(errors: readonly ProblemFieldError[] | undefined): string | undefined {
  return errors?.find((entry) => entry.field === 'requestId' && entry.message)?.message;
}

// ---------------------------------------------------------------------------
// Helpers over `unknown` (what a `catch` binds)

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when `error` is a problem with one of `slugs` (hyphens and underscores folded). */
export function isProblem(error: unknown, ...slugs: string[]): error is ProblemError {
  return error instanceof ProblemError && error.isProblem(...slugs);
}

/** A request the member walked away from. Never an alert, never the offline banner. */
export function isCancellation(error: unknown): boolean {
  return error instanceof ApiError && error.isCancellation;
}

/** No answer arrived (offline, timed out, network), cancellation excluded. */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.isOffline;
}

/** Transport, 5xx and 429: the same request might succeed later. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && error.isRetryable;
}

/** The problem body behind `error`, when it is a problem. */
export function problemOf(error: unknown): ProblemDetails | undefined {
  return error instanceof ProblemError ? error.details : undefined;
}

/**
 * An error whose message is the app's own member-facing sentence, already in
 * the language on screen (Swift's `LocalizedError`). `errorMessage()` shows
 * its message; any other non-API error reads as the generic sentence, because
 * a JavaScript error's message is usually a developer's words.
 */
export class LocalizedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'LocalizedError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}
