/**
 * The request, the key and the answer for one "Describe what you ate" sheet:
 * the port of iOS `MealDescribeModel` and `MealDescribeFailure`
 * (Views/Meals/MealDescribeSheet.swift). Kept apart from the sheet so the
 * rules are unit tested, as on iOS:
 *
 * - ONE KEY PER WORDING. The Idempotency-Key is minted on the first Estimate
 *   for the cleaned words, reused by a retry of the same words (after the
 *   consent tap, or a second tap after an upstream failure), and replaced
 *   when they change. A key sent with other words would be refused as reused.
 *   A draft uses its key up; so does `health_meal_deleted` (the draft that
 *   key bought was discarded). `idempotency_key_reused` is retried once with
 *   a fresh key.
 * - THE CONSENT TAP. 409 `meal_describe_consent_required` shows the one-tap
 *   consent block. Its grant is the standing consent again under the text
 *   that names the description (2026-09-v3), with the age the standing
 *   consent was given with carried forward, one key per sheet; then the SAME
 *   words go again with the SAME estimate key.
 * - A SPENT ALLOWANCE OR A PAUSE STOPS ESTIMATE whatever the words; a refusal
 *   about the words (no food, personal data, a failed estimate) goes with
 *   the words.
 *
 * Nothing is sent while a call is out, for words too short or too long, or
 * once the allowance is spent or estimates are paused.
 *
 * THE WORDS STAY IN MEMORY: this object holds them, the POST body carries
 * them once, and nothing here writes, logs or tracks them.
 */
import { ApiError, isApiError, newIdempotencyKey, TransportError } from '../../../api';
import {
  consentSource,
  grantedConsent,
  HealthConsentVersion,
  setHealthConsent,
  type ConsentResult,
  type HealthConsent,
  type MealSlot,
} from '../../../health';
import { mealApi, mealLocale, type MealApi } from '../api/mealApi';
import { loggedAtFor } from '../math/itemMath';
import type { MealRecord } from '../types/models';

import { cleanDescribeText, capDescribeText, describeLength, DESCRIBE_MAX_LENGTH, isDescribeSendable } from './describeText';

// ---------------------------------------------------------------------------
// Failures

/** What a description estimate ended in, as the sheet shows it (iOS `MealDescribeFailure`). */
export type MealDescribeFailure =
  | 'personal'
  | 'noFood'
  | 'limit'
  | 'paused'
  | 'failed'
  | 'offline'
  | 'rateLimited'
  | 'other'
  /** 400 `invalid-meal-describe`: too few words, or too many (the web's `describe_err_short` and `_long`). */
  | 'tooShort'
  | 'tooLong';

export const MEAL_DESCRIBE_FAILURES: readonly MealDescribeFailure[] = [
  'personal',
  'noFood',
  'limit',
  'paused',
  'failed',
  'offline',
  'rateLimited',
  'other',
  'tooShort',
  'tooLong',
];

/** The line a failure shows. */
export function describeFailureCopyKey(failure: MealDescribeFailure): string {
  switch (failure) {
    case 'personal':
      return 'meal.describe.err.personal';
    case 'noFood':
      return 'meal.describe.err.no_food';
    case 'limit':
      return 'meal.describe.err.limit';
    case 'paused':
      return 'meal.describe.err.paused';
    case 'failed':
    case 'other':
      return 'meal.describe.err.failed';
    case 'offline':
      return 'meal.photo.err.offline';
    case 'rateLimited':
      return 'health.err.rate_limited';
    case 'tooShort':
      return 'meal.describe.err.short';
    case 'tooLong':
      return 'meal.describe.err.long';
  }
}

/** The values the line names: the limit, for words that are too many. */
export function describeFailureCopyParams(failure: MealDescribeFailure): Readonly<Record<string, string>> {
  return failure === 'tooLong' ? { max: String(DESCRIBE_MAX_LENGTH) } : {};
}

/** `meal_describe_result.outcome`: fixed words, never the member's. */
export function describeFailureAnalyticsOutcome(failure: MealDescribeFailure): string {
  switch (failure) {
    case 'personal':
      return 'personal_data';
    case 'noFood':
      return 'no_food';
    case 'limit':
      return 'limit';
    case 'paused':
      return 'paused';
    case 'failed':
    case 'other':
      return 'upstream';
    case 'offline':
      return 'offline';
    case 'rateLimited':
      return 'rate_limited';
    case 'tooShort':
    case 'tooLong':
      return 'invalid';
  }
}

/** Search is the way on from every failure except a lost connection, which search needs too. */
export function describeFailureOffersSearch(failure: MealDescribeFailure): boolean {
  return failure !== 'offline';
}

/** iOS `statusCode`: a problem body's own status, or the response's for an answer that was not a problem. */
function statusOf(error: ApiError): number | undefined {
  return error.status;
}

/**
 * The problem codes of OP-56, and the transport failures, as the sheet shows
 * them. Null for the refusals every health screen answers itself (the gate,
 * consent, a pending deletion, a minor). `sent` is the cleaned text of the
 * request, for the 400.
 */
export function describeFailureFor(error: ApiError, sent = ''): MealDescribeFailure | null {
  if (error.isOffline) {
    // A timeout is the estimate failing, not the phone being offline.
    if (error instanceof TransportError && error.transport === 'timeout') return 'failed';
    return 'offline';
  }
  if (error.isProblem('invalid-meal-describe')) {
    // The phone counts as the server does and the entries keep to the
    // server's 30 days, so this 400 is about the words' length as the server
    // measured it. Words past half the limit can only have met the top of it.
    return describeLength(sent) > DESCRIBE_MAX_LENGTH / 2 ? 'tooLong' : 'tooShort';
  }
  if (error.isProblem('meal_describe_personal_data')) return 'personal';
  if (error.isProblem('meal_describe_limit')) return 'limit';
  if (error.isProblem('meal_describe_paused')) return 'paused';
  if (error.isProblem('coach_upstream_error', 'health_meal_deleted')) return 'failed';
  if (error.isProblem('rate_limited')) return 'rateLimited';
  if (error.isProblem('no_active_plan_or_pass', 'health_consent_required', 'account_pending_deletion', 'health_minor_blocked')) {
    return null;
  }
  if ((statusOf(error) ?? 0) >= 500) return 'failed';
  return 'other';
}

// ---------------------------------------------------------------------------
// The model

export type MealDescribePhase =
  | { readonly kind: 'editing' }
  | { readonly kind: 'estimating' }
  /** 409 `meal_describe_consent_required`: the one-tap consent block. */
  | { readonly kind: 'needsConsent' }
  | { readonly kind: 'grantingConsent' }
  | { readonly kind: 'failed'; readonly failure: MealDescribeFailure };

export type MealDescribeOutcome =
  | { readonly kind: 'draft'; readonly meal: MealRecord }
  | { readonly kind: 'needsConsent' }
  | { readonly kind: 'failed'; readonly failure: MealDescribeFailure }
  /** 404: the server no longer has the route. The entry hides. */
  | { readonly kind: 'featureOff' }
  /** A 403, a 409 `health_consent_required` or a pending deletion: answered with the rules every health screen uses. */
  | { readonly kind: 'refused'; readonly error: ApiError };

export type MealDescribeConsentOutcome =
  | { readonly kind: 'granted'; readonly consent: HealthConsent }
  /** The account has to attest its age: only the full consent sheet has that row. */
  | { readonly kind: 'needsFullSheet' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'refused'; readonly error: ApiError };

/**
 * The consent route, as the sheet calls it: version, age attestation, key. A
 * function so the tests can answer it.
 */
export type DescribeConsentGrant = (version: string, ageAttested: boolean | null, idempotencyKey: string) => Promise<ConsentResult>;

/** `POST /profile/health-consent` from the Scan entry (`coach_intake`), as iOS sends it. */
export const liveDescribeConsentGrant: DescribeConsentGrant = (version, ageAttested, idempotencyKey) =>
  setHealthConsent(
    { optedIn: true, version, source: consentSource('scan'), ...(ageAttested ? { ageAttested: true as const } : {}) },
    idempotencyKey,
  );

export interface MealDescribeModelOptions {
  /** Defaults to the app's meal API (`mealApi()`). */
  readonly api?: MealApi;
  readonly grant?: DescribeConsentGrant;
  readonly makeKey?: () => string;
  /** The clock `loggedAt` is read from. */
  readonly now?: () => Date;
}

const EDITING: MealDescribePhase = Object.freeze({ kind: 'editing' });

export class MealDescribeModel {
  private textValue: string;
  private phaseValue: MealDescribePhase = EDITING;
  private describesLeftValue: number | null = null;
  private consentErrorKeyValue: string | null = null;

  private readonly api: () => MealApi;
  private readonly grant: DescribeConsentGrant;
  private readonly makeKey: () => string;
  private readonly now: () => Date;
  private key: string | null = null;
  private keyText: string | null = null;
  /** One consent key per sheet, like the consent sheet's: a double tap writes one ledger row. */
  private consentKey: string | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(text: string, options: MealDescribeModelOptions = {}) {
    this.textValue = capDescribeText(text);
    const api = options.api;
    this.api = api ? () => api : mealApi;
    this.grant = options.grant ?? liveDescribeConsentGrant;
    this.makeKey = options.makeKey ?? newIdempotencyKey;
    this.now = options.now ?? (() => new Date());
  }

  // ---- Observation (the sheet redraws through `useSyncExternalStore`)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Changes whenever anything the sheet draws changed. */
  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private setPhase(phase: MealDescribePhase): void {
    this.phaseValue = phase;
    this.changed();
  }

  // ---- State

  get text(): string {
    return this.textValue;
  }

  /** The words as typed, capped between whole characters by the server's count. */
  set text(value: string) {
    const capped = capDescribeText(value);
    if (capped === this.textValue) return;
    this.textValue = capped;
    this.changed();
  }

  get phase(): MealDescribePhase {
    return this.phaseValue;
  }

  /** From the last answer; null until one arrives. */
  get describesLeft(): number | null {
    return this.describesLeftValue;
  }

  /** A copy key under the consent button when the grant failed. */
  get consentErrorKey(): string | null {
    return this.consentErrorKeyValue;
  }

  get cleanedText(): string {
    return cleanDescribeText(this.textValue);
  }

  get isBusy(): boolean {
    return this.phaseValue.kind === 'estimating' || this.phaseValue.kind === 'grantingConsent';
  }

  /** Today's allowance is spent, or estimates are paused: no wording changes that. */
  get isStopped(): boolean {
    return this.phaseValue.kind === 'failed' && (this.phaseValue.failure === 'limit' || this.phaseValue.failure === 'paused');
  }

  get canEstimate(): boolean {
    return isDescribeSendable(this.textValue) && !this.isBusy && !this.isStopped;
  }

  /** The member changed the words after a refusal about the words: that refusal goes with them. */
  textChanged(): void {
    if (this.phaseValue.kind === 'failed' && !this.isStopped) this.setPhase(EDITING);
  }

  /**
   * The Idempotency-Key for these exact words: minted on the first Estimate,
   * reused by a retry of the same words, replaced when they change.
   */
  currentKey(): string {
    const words = this.cleanedText;
    if (this.key !== null && this.keyText === words) return this.key;
    const fresh = this.makeKey();
    this.key = fresh;
    this.keyText = words;
    return fresh;
  }

  private forgetKey(): void {
    this.key = null;
    this.keyText = null;
  }

  private finish(failure: MealDescribeFailure): MealDescribeOutcome {
    this.setPhase({ kind: 'failed', failure });
    return { kind: 'failed', failure };
  }

  /** OP-56 for the words on screen. `date` is `YYYY-MM-DD`; `language` the account language. */
  async estimate(slot: MealSlot, date: string, language: string): Promise<MealDescribeOutcome> {
    if (!this.canEstimate) return { kind: 'failed', failure: 'other' };
    const body = {
      text: this.cleanedText,
      slot,
      logDate: date,
      loggedAt: loggedAtFor(date, this.now()),
      locale: mealLocale(language),
    };
    this.consentErrorKeyValue = null;
    this.setPhase({ kind: 'estimating' });
    let retriedKey = false;
    for (;;) {
      const key = this.currentKey();
      try {
        const result = await this.api().describe(body, key);
        if (result.describesLeftToday !== null) this.describesLeftValue = result.describesLeftToday;
        if (!result.meal || result.noFood) {
          // No food: the server keeps no marker for the key, so the same
          // words may be tried again.
          return this.finish('noFood');
        }
        // This key bought this draft. The next words get their own.
        this.forgetKey();
        this.setPhase(EDITING);
        return { kind: 'draft', meal: result.meal };
      } catch (error) {
        if (!isApiError(error)) return this.finish('other');
        if (error.isCancellation) {
          this.setPhase(EDITING);
          return { kind: 'failed', failure: 'other' };
        }
        if (error.isProblem('idempotency_key_reused') && !retriedKey) {
          retriedKey = true;
          this.key = null;
          continue;
        }
        if (error.isProblem('meal_describe_consent_required')) {
          this.setPhase({ kind: 'needsConsent' });
          return { kind: 'needsConsent' };
        }
        if (statusOf(error) === 404) {
          this.setPhase(EDITING);
          return { kind: 'featureOff' };
        }
        if (error.isProblem('health_meal_deleted')) {
          // The draft this key bought was discarded. A new tap is a new request.
          this.forgetKey();
        }
        const failure = describeFailureFor(error, body.text);
        if (failure) return this.finish(failure);
        this.setPhase(EDITING);
        return { kind: 'refused', error };
      }
    }
  }

  /**
   * The one-tap consent: the standing consent again, under the text that
   * names the description. The age the standing consent was given with is
   * carried forward: an attestation is sent only if the member already made
   * one, and a verified kennitala never claims one.
   */
  async grantDescribeConsent(standing: HealthConsent | null): Promise<MealDescribeConsentOutcome> {
    if (this.isBusy) return { kind: 'failed' };
    this.consentErrorKeyValue = null;
    this.setPhase({ kind: 'grantingConsent' });
    const attested = standing?.ageSource === 'attestation' ? true : null;
    try {
      const key = this.consentKey ?? this.makeKey();
      this.consentKey = key;
      const result = await this.grant(HealthConsentVersion.withMealDescribe, attested, key);
      const recorded = grantedConsent(result);
      this.setPhase(EDITING);
      return {
        kind: 'granted',
        consent: {
          version: recorded?.version ?? HealthConsentVersion.withMealDescribe,
          consentedAt: recorded?.consentedAt ?? this.now(),
          ageSource: recorded?.ageSource ?? standing?.ageSource ?? null,
        },
      };
    } catch (error) {
      if (!isApiError(error)) {
        this.consentErrorKeyValue = 'common.error_body';
        this.setPhase({ kind: 'needsConsent' });
        return { kind: 'failed' };
      }
      if (error.isProblem('health_age_attestation_required')) {
        this.setPhase({ kind: 'needsConsent' });
        return { kind: 'needsFullSheet' };
      }
      if (error.isProblem('health_minor_blocked', 'account_pending_deletion', 'no_active_plan_or_pass')) {
        this.setPhase({ kind: 'needsConsent' });
        return { kind: 'refused', error };
      }
      this.consentErrorKeyValue = error.isOffline
        ? 'health.offline.action_hint'
        : error.isProblem('rate_limited')
          ? 'health.err.rate_limited'
          : 'common.error_body';
      this.setPhase({ kind: 'needsConsent' });
      return { kind: 'failed' };
    }
  }
}
