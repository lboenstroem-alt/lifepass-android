/**
 * Typed wrappers over the health API: the Android port of iOS
 * Services/HealthService.swift and Services/HealthNetwork.swift.
 *
 * Thin on purpose: one function per operation of the health contract, no
 * caching, no retry, no state. Deciding what to do with a refusal belongs to
 * the health store (./store.ts `handle`) and the screens, which know whether
 * a member is watching.
 *
 * Three rules this file enforces for everyone:
 *
 * - NOTHING HEALTH-RELATED IS CACHED BY THE HTTP LAYER. iOS gives health
 *   traffic its own ephemeral URLSession with no URLCache, so a weight, a
 *   sleep score or a meal estimate can never land in the app's disk cache.
 *   On Android every member call already goes out with `Cache-Control:
 *   no-store` (src/api/client.ts, the default for authenticated calls), which
 *   OkHttp's cache honours; these wrappers never relax it.
 * - Every state-changing call takes an `Idempotency-Key` the CALLER mints,
 *   once per member action and reused only for a retry of that same action
 *   (src/api/idempotency.ts). Minting one here would make every retry a new
 *   request, and a retried weigh-in or meal would be logged twice.
 * - A cancelled request is not an error worth showing: callers check
 *   `isCancellation(e)` first.
 *
 * Patience, as iOS sets it: the Today read waits 20 seconds
 * (`HealthNetwork.defaultTimeout`: a Plan tab with an offline banner and a
 * cache to fall back on must not hang), every other health call the health
 * session's 30. `?locale=` rides on every read whose answer carries server
 * copy (session titles, remarks, food names), in the ACCOUNT language.
 *
 * The meal capture and food search operations live with the meal package,
 * the Apple Health ones nowhere (Android ships no Health Connect: owner
 * decision).
 */
import { API_TIMEOUTS, apiDelete, apiGet, apiGetRawData, apiPost, type Query } from '../api';
import type { Lang } from '../i18n';

import { arrayOf, boolean, instant, integer, object, opt, string, type Reader } from './decode';
import {
  decodeHealthDay,
  decodeMeasurement,
  decodeMealDaySummary,
  decodeMealView,
  decodeHealthMealsBlock,
  decodeNutritionTarget,
  decodeProgramAdoptResponse,
  decodeProgramDetail,
  decodeProgramSummary,
  decodeProgramUpdateResponse,
  decodeSessionActionResponse,
  decodeSessionHistoryItem,
  decodeSessionView,
  decodeWeeklyReview,
  decodeWeightTrendPoint,
  type ExtraWorkoutKind,
  type Feeling,
  type HealthConsent,
  type HealthDay,
  type HealthMealsBlock,
  type MealDaySummary,
  type MealView,
  type Measurement,
  type NutritionTarget,
  type ProgramAdoptResponse,
  type ProgramDetail,
  type ProgramSummary,
  type ProgramUpdateResponse,
  type SessionActionResponse,
  type SessionHistoryItem,
  type SessionView,
  type SkipReason,
  type TargetWithheldReason,
  type WeeklyReviewView,
  type WeightTrendPoint,
} from './models';

/** `HealthNetwork.defaultTimeout`: the Today read. */
export const HEALTH_READ_TIMEOUT_MS = API_TIMEOUTS.health;
/** The health session's own ceiling (`timeoutIntervalForRequest = 30`): every other health call. */
export const HEALTH_SESSION_TIMEOUT_MS = API_TIMEOUTS.healthSession;

/** `?locale=`: server copy comes back in the ACCOUNT language, not the phone's. */
export function localeQuery(language: Lang | string): { locale: 'is' | 'en' } {
  return { locale: language === 'is' ? 'is' : 'en' };
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

// ---------------------------------------------------------------------------
// Pages

/** A cursor page (`{ data, pagination }` inside the success envelope, docs/05 "Pagination"). */
export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number | null;
}

function pageOf<T>(read: Reader<T>): (data: unknown) => Page<T> {
  return (data) => {
    const json = object(data, 'page');
    const pagination = object(json.pagination, 'page.pagination');
    return {
      data: arrayOf(read)(json.data, 'page.data'),
      nextCursor: opt(pagination, 'nextCursor', 'page.pagination', string),
      hasMore: boolean(pagination.hasMore, 'page.pagination.hasMore'),
      limit: opt(pagination, 'limit', 'page.pagination', integer),
    };
  };
}

/** `{ ok: true }` answers: anything that is an object. */
function okAnswer(data: unknown): void {
  object(data, 'ok');
}

// ---------------------------------------------------------------------------
// OP-06 the Today read

/** `GET /health?date&locale`. One read answers the whole Plan tab; `date` omitted is the server's today. */
export function fetchHealthDay(options: { date?: string | null; language: Lang; signal?: AbortSignal }): Promise<HealthDay> {
  const query: Query = { ...localeQuery(options.language), date: options.date ?? undefined };
  return apiGet<HealthDay>('/health', query, {
    timeoutMs: HEALTH_READ_TIMEOUT_MS,
    signal: options.signal,
    decode: decodeHealthDay,
  });
}

// ---------------------------------------------------------------------------
// OP-02, OP-03 consent

export interface ConsentBody {
  readonly optedIn: boolean;
  readonly version: string | null;
  /** `coach_intake` or `account` (the route's schema also has `profile`, which is the web's). */
  readonly source: string;
  /** Sent ONLY when the age row was shown: a verified account must not claim an attestation it never made. */
  readonly ageAttested?: true;
}

/**
 * The consent route's answer. It answers FLAT (`{ optedIn, version,
 * consentedAt, ageSource, deleted? }`), not a nested `consent`; both are read,
 * fail-soft, so a date this build cannot parse never turns a grant the server
 * recorded into an error.
 */
export interface ConsentResult {
  readonly consent: HealthConsent | null;
  /** On a withdrawal: how many rows of each kind were deleted. */
  readonly deleted: Readonly<Record<string, number>> | null;
  readonly optedIn: boolean | null;
  readonly version: string | null;
  readonly consentedAt: Date | null;
  readonly ageSource: string | null;
}

function softRead<T>(read: Reader<T>, value: unknown, path: string): T | null {
  if (value === undefined || value === null) return null;
  try {
    return read(value, path);
  } catch {
    return null;
  }
}

export function decodeConsentResult(data: unknown): ConsentResult {
  const json = object(data, 'consent');
  // `deleted` is the one member read strictly, as iOS reads it.
  const deleted = opt(json, 'deleted', 'consent', (raw, path) => {
    const counts = object(raw, path);
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(counts)) out[key] = integer(value, `${path}.${key}`);
    return out;
  });
  return {
    consent: softRead(
      (raw, path) => {
        const c = object(raw, path);
        return {
          version: opt(c, 'version', path, string),
          consentedAt: opt(c, 'consentedAt', path, instant),
          ageSource: opt(c, 'ageSource', path, string),
        };
      },
      json.consent,
      'consent.consent',
    ),
    deleted,
    optedIn: softRead(boolean, json.optedIn, 'consent.optedIn'),
    version: softRead(string, json.version, 'consent.version'),
    consentedAt: softRead(instant, json.consentedAt, 'consent.consentedAt'),
    ageSource: softRead(string, json.ageSource, 'consent.ageSource'),
  };
}

/** The consent the server now holds after a grant, in whichever shape it answered. Null for a withdrawal. */
export function grantedConsent(result: ConsentResult): HealthConsent | null {
  if (result.consent) return result.consent;
  if (result.optedIn !== true) return null;
  return { version: result.version, consentedAt: result.consentedAt, ageSource: result.ageSource };
}

/**
 * `POST /profile/health-consent`. Granting and withdrawing are the same
 * route; withdrawal deletes every health row in one transaction and is open
 * to everyone, minors included.
 */
export function setHealthConsent(body: ConsentBody, idempotencyKey: string): Promise<ConsentResult> {
  return apiPost<ConsentResult>('/profile/health-consent', body, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeConsentResult,
  });
}

// ---------------------------------------------------------------------------
// OP-08, OP-09 history

export function fetchSessionHistory(options: { cursor?: string | null; limit?: number; language: Lang }): Promise<Page<SessionHistoryItem>> {
  return apiGet(
    '/health/sessions',
    { ...localeQuery(options.language), limit: options.limit ?? 20, cursor: options.cursor ?? undefined },
    { timeoutMs: HEALTH_SESSION_TIMEOUT_MS, decode: pageOf(decodeSessionHistoryItem) },
  );
}

export function fetchProgramHistory(options: { cursor?: string | null; limit?: number; language: Lang }): Promise<Page<ProgramSummary>> {
  return apiGet(
    '/health/programs',
    { ...localeQuery(options.language), limit: options.limit ?? 20, cursor: options.cursor ?? undefined },
    { timeoutMs: HEALTH_SESSION_TIMEOUT_MS, decode: pageOf(decodeProgramSummary) },
  );
}

// ---------------------------------------------------------------------------
// OP-11 to OP-16 programmes

export function adoptProgram(programId: string, replaceActive: boolean, idempotencyKey: string): Promise<ProgramAdoptResponse> {
  return apiPost(`/health/programs/${segment(programId)}/adopt`, { replaceActive }, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeProgramAdoptResponse,
  });
}

export function discardProgram(programId: string, idempotencyKey: string): Promise<void> {
  return apiPost(`/health/programs/${segment(programId)}/discard`, undefined, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: okAnswer,
  });
}

/**
 * The programme update body: `status` (`paused`, `active` or `abandoned`) OR
 * `trainingDays` and `body`, never both (the server refuses a mix). Members
 * left undefined are not sent.
 */
export interface ProgramUpdateBody {
  readonly status?: 'paused' | 'active' | 'abandoned';
  readonly trainingDays?: readonly number[];
  readonly body?: { readonly sex?: string; readonly ageBand?: string; readonly activity?: string };
}

export function updateProgram(programId: string, update: ProgramUpdateBody, idempotencyKey: string): Promise<ProgramUpdateResponse> {
  return apiPost(`/health/programs/${segment(programId)}`, update, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeProgramUpdateResponse,
  });
}

export function fetchProgram(programId: string, language: Lang): Promise<ProgramDetail> {
  return apiGet(`/health/programs/${segment(programId)}`, localeQuery(language), {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeProgramDetail(object(data, 'program').program, 'program'),
  });
}

export function fetchSession(sessionId: string, language: Lang): Promise<SessionView> {
  return apiGet(`/health/sessions/${segment(sessionId)}`, localeQuery(language), {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeSessionView(object(data, 'session').session, 'session'),
  });
}

// ---------------------------------------------------------------------------
// OP-17 to OP-22 session actions

/**
 * The discriminated union `POST /health/sessions/{id}` accepts, built through
 * `SessionAction` below so no call site can send `skip` without a reason or
 * `done` with a stray field (every route object is strict: a key an action
 * does not take is a 400). Members left undefined are not sent.
 *
 * A PERFORMED WORKOUT IS NOT SENT FROM HERE. `done` here is the Plan card's
 * "Mark done": the member says a session happened. A session run in the
 * runner posts its own set-by-set body (the runner package).
 */
export interface SessionActionBody {
  readonly action: 'done' | 'move' | 'pull' | 'undo' | 'skip' | 'feeling' | 'swap' | 'remove_extra';
  readonly minutes?: number;
  readonly feeling?: string;
  readonly clientCompletedAt?: Date;
  readonly asExtra?: boolean;
  readonly skipReason?: string;
  readonly exerciseId?: string;
  readonly toExerciseId?: string;
  readonly scope?: string;
  readonly kind?: string;
  readonly note?: string;
  readonly extraId?: string;
}

function defined<T extends object>(body: T): T {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== null)) as T;
}

export const SessionAction = {
  done(options: { minutes?: number | null; feeling?: Feeling | null; clientCompletedAt?: Date | null; asExtra?: boolean | null }): SessionActionBody {
    return defined({
      action: 'done' as const,
      minutes: options.minutes ?? undefined,
      feeling: options.feeling && options.feeling !== 'unknown' ? options.feeling : undefined,
      clientCompletedAt: options.clientCompletedAt ?? undefined,
      asExtra: options.asExtra ?? undefined,
    });
  },
  move: { action: 'move' } as SessionActionBody,
  pull: { action: 'pull' } as SessionActionBody,
  undo: { action: 'undo' } as SessionActionBody,
  skip(reason: SkipReason): SessionActionBody {
    return { action: 'skip', skipReason: reason };
  },
  feeling(value: Feeling): SessionActionBody {
    return { action: 'feeling', feeling: value };
  },
  swap(exerciseId: string, toExerciseId: string): SessionActionBody {
    return { action: 'swap', exerciseId, toExerciseId, scope: 'future' };
  },
  /**
   * A workout the member did, logged as an extra on the day's row. The plan
   * does not react to it. `clientCompletedAt` names the day: null for today,
   * noon of the card's date for a past card. A blank note is not sent.
   */
  logExtra(options: { kind: ExtraWorkoutKind; minutes: number; note?: string | null; clientCompletedAt?: Date | null }): SessionActionBody {
    const trimmed = options.note?.trim();
    return defined({
      action: 'done' as const,
      minutes: options.minutes,
      clientCompletedAt: options.clientCompletedAt ?? undefined,
      asExtra: true,
      kind: options.kind === 'unknown' ? 'other' : options.kind,
      note: trimmed ? trimmed : undefined,
    });
  },
  /** Take back one hand-logged extra, by the id the server gave it. */
  removeExtra(id: string): SessionActionBody {
    return { action: 'remove_extra', extraId: id };
  },
} as const;

export function postSessionAction(sessionId: string, body: SessionActionBody, idempotencyKey: string): Promise<SessionActionResponse> {
  return apiPost(`/health/sessions/${segment(sessionId)}`, body, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeSessionActionResponse,
  });
}

// ---------------------------------------------------------------------------
// OP-24 to OP-26, OP-42 measurements

/**
 * Exactly the three fields the measurements route accepts (its schema is
 * strict over `{ weightKg, heightCm?, source }`). The server times a weigh-in
 * by when it arrives.
 */
export interface MeasurementBody {
  readonly weightKg: number;
  readonly heightCm?: number;
  readonly source: 'self_reported' | 'weekly_prompt' | 'program_intake';
}

export function addMeasurement(body: MeasurementBody, idempotencyKey: string): Promise<Measurement> {
  return apiPost('/health/measurements', defined({ ...body }), {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeMeasurement(object(data, 'measurement').measurement, 'measurement'),
  });
}

export function fetchMeasurements(options: { cursor?: string | null; limit?: number } = {}): Promise<Page<Measurement>> {
  return apiGet(
    '/health/measurements',
    { limit: options.limit ?? 20, cursor: options.cursor ?? undefined },
    { timeoutMs: HEALTH_SESSION_TIMEOUT_MS, decode: pageOf(decodeMeasurement) },
  );
}

export function deleteMeasurement(id: string): Promise<void> {
  return apiDelete(`/health/measurements/${segment(id)}`, undefined, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: okAnswer,
  });
}

export interface WeightTrend {
  readonly points: readonly WeightTrendPoint[] | null;
  readonly weeks: number | null;
}

export function fetchWeightTrend(weeks: number): Promise<WeightTrend> {
  return apiGet('/health/measurements/trend', { weeks }, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => {
      const json = object(data, 'trend');
      return {
        points: opt(json, 'points', 'trend', arrayOf(decodeWeightTrendPoint)),
        weeks: opt(json, 'weeks', 'trend', integer),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// OP-23 weekly check-in, OP-43 reviews

// The weekly check-in's call and body live with the sheet that sends them
// (PLAN-5); its answer is `decodeCheckinResponse` in ./models.

export function fetchReviews(options: { cursor?: string | null; limit?: number; language: Lang }): Promise<Page<WeeklyReviewView>> {
  return apiGet(
    '/health/reviews',
    { ...localeQuery(options.language), limit: options.limit ?? 12, cursor: options.cursor ?? undefined },
    { timeoutMs: HEALTH_SESSION_TIMEOUT_MS, decode: pageOf(decodeWeeklyReview) },
  );
}

// ---------------------------------------------------------------------------
// OP-33, OP-36, OP-37, OP-44 meals the plan reads

export function fetchMeal(mealId: string, language: Lang): Promise<MealView> {
  return apiGet(`/health/meals/${segment(mealId)}`, localeQuery(language), {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeMealView(object(data, 'meal').meal, 'meal'),
  });
}

export function fetchMealDay(date: string, language: Lang): Promise<HealthMealsBlock> {
  return apiGet('/health/meals', { ...localeQuery(language), date }, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeHealthMealsBlock(data, 'meals'),
  });
}

export interface MealDaysResponse {
  readonly days: readonly MealDaySummary[] | null;
  /** The member's first logged day, for the "your log starts here" line. */
  readonly firstLogDate: string | null;
}

export function fetchMealDays(from: string, to: string, language: Lang): Promise<MealDaysResponse> {
  return apiGet('/health/meals/days', { ...localeQuery(language), from, to }, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => {
      const json = object(data, 'mealDays');
      return {
        days: opt(json, 'days', 'mealDays', arrayOf(decodeMealDaySummary)),
        firstLogDate: opt(json, 'firstLogDate', 'mealDays', string),
      };
    },
  });
}

export function deleteMeal(mealId: string): Promise<void> {
  return apiDelete(`/health/meals/${segment(mealId)}`, undefined, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: okAnswer,
  });
}

// ---------------------------------------------------------------------------
// OP-47 the calorie goal (the PUT lives with the body sheet)

export interface NutritionGoalView {
  /** `lose`, `maintain` or `gain`. */
  readonly goal: string | null;
  readonly sex: string | null;
  readonly ageBand: string | null;
  readonly activity: string | null;
  readonly customKcal: number | null;
  readonly target: NutritionTarget | null;
  readonly targetWithheld: TargetWithheldReason | null;
  readonly updatedAt: Date | null;
}

export const decodeNutritionGoalView: Reader<NutritionGoalView> = (value, path) => {
  const json = object(value, path);
  const reason = opt(json, 'targetWithheld', path, string);
  const known: readonly string[] = ['bmi_low_lose_weight', 'bmi_high', 'target_too_low'];
  return {
    goal: opt(json, 'goal', path, string),
    sex: opt(json, 'sex', path, string),
    ageBand: opt(json, 'ageBand', path, string),
    activity: opt(json, 'activity', path, string),
    customKcal: opt(json, 'customKcal', path, integer),
    target: opt(json, 'target', path, decodeNutritionTarget),
    targetWithheld: reason === null ? null : known.includes(reason) ? (reason as TargetWithheldReason) : 'unknown',
    updatedAt: opt(json, 'updatedAt', path, instant),
  };
};

export function fetchNutritionGoal(language: Lang): Promise<NutritionGoalView | null> {
  return apiGet('/health/nutrition-goal', localeQuery(language), {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => opt(object(data, 'goal'), 'goal', 'goal', decodeNutritionGoalView),
  });
}

// ---------------------------------------------------------------------------
// OP-28 export

/**
 * The member's data export, kept exactly as the server sent it (every key,
 * sorted): a subject-access copy must never lose a field the app does not
 * model.
 */
export function exportAccountData(): Promise<string> {
  return apiGetRawData('/account/export', undefined, { timeoutMs: HEALTH_SESSION_TIMEOUT_MS });
}
