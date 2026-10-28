/**
 * The target weight on its own, and the plan revision Adjust my plan sends:
 * the Android port of iOS Services/TargetWeightService.swift (`SPEC` 6.0).
 *
 * Through the API client with `Cache-Control: no-store`, like every other
 * health call: a target weight is health data and never lands in the HTTP
 * layer's disk cache (src/health/api.ts says why).
 *
 * NOTHING HERE IS CALLED AGAINST A SERVER THAT DID NOT ADVERTISE IT. The
 * callers check the server's `features` first (`selectSupportsTargetWeight`,
 * `selectSupportsPlanRevision` in src/stores/appStore.ts). The one read that
 * is safe on any server is the calorie goal envelope
 * (`fetchNutritionGoalEnvelope` in src/health/api.ts): an older server
 * answers without `targetWeight` and `features`, which decodes as null and
 * hides the UI.
 *
 * TRI-STATE BODIES. JSON has three answers where Swift has `Double??`:
 * a key left out ("leave the stored target alone"), an explicit `null`
 * ("clear it") and a number ("set it"). `JSON.stringify` drops `undefined`
 * and keeps `null` (src/api/wire.ts `encodeBody`), so the builders below take
 * `undefined` for "leave out" and `null` for "clear" and never conflate them.
 */
import { decodeNutritionGoalView, HEALTH_READ_TIMEOUT_MS, localeQuery, type NutritionGoalView } from '../health/api';
import { object, soft, type Reader } from '../health/decode';
import {
  decodeFeatureList,
  decodeProgramDetail,
  decodeTargetWeightView,
  type ProgramDetail,
  type TargetWeightView,
} from '../health/models';
import type { Lang } from '../i18n';

import { apiPost, apiPut } from './client';
import { HttpStatusError } from './errors';

// ---------------------------------------------------------------------------
// The server's grid

/**
 * A weight in whole tenths of a kilo, as the server compares them. Swift's
 * `(kg * 10).rounded()` rounds half away from zero; `Math.round` would round
 * -0.5 towards zero, so the sign is taken apart first.
 */
export function targetTenths(kg: number): number {
  const scaled = kg * 10;
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/** A typed or stored value on the server's 0.1 kg grid (iOS `TargetWeightRules.rounded`). */
export function roundTargetKg(kg: number): number {
  return targetTenths(kg) / 10;
}

// ---------------------------------------------------------------------------
// PUT /health/target-weight

/**
 * `{ "targetWeightKg": number | null }`. The key is ALWAYS sent: the schema
 * makes it required and nullable, and null is how a target is removed. A
 * number travels on the 0.1 kg grid.
 */
export function targetWeightBody(targetWeightKg: number | null): {
  readonly targetWeightKg: number | null;
} {
  return {
    targetWeightKg: targetWeightKg === null ? null : roundTargetKg(targetWeightKg),
  };
}

/** The answer: the target and the calorie goal after the change, and the feature list. All fail soft. */
export interface TargetWeightResponse {
  readonly targetWeight: TargetWeightView | null;
  readonly goal: NutritionGoalView | null;
  /** Null when the server sent none, which the caller passes on as "no features". */
  readonly features: readonly string[] | null;
}

export const decodeTargetWeightResponse: Reader<TargetWeightResponse> = (value, path) => {
  const json = object(value, path);
  return {
    targetWeight: soft(json, 'targetWeight', path, decodeTargetWeightView),
    goal: soft(json, 'goal', path, decodeNutritionGoalView),
    features: decodeFeatureList(json.features),
  };
};

/**
 * `PUT /health/target-weight?locale`. `null` removes the target. Naturally
 * idempotent on the server, which still requires the key: the caller mints
 * one per sheet and reuses it for a retry.
 */
export function setTargetWeight(
  targetWeightKg: number | null,
  idempotencyKey: string,
  language: Lang,
): Promise<TargetWeightResponse> {
  return apiPut('/health/target-weight', targetWeightBody(targetWeightKg), {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: HEALTH_READ_TIMEOUT_MS,
    decode: (data) => decodeTargetWeightResponse(data, 'targetWeight'),
  });
}

/**
 * A 404 that is NOT a problem document: the route itself does not exist on
 * this server, so the feature list the app holds is stale (a server rolled
 * back after it was read). `health_program_not_found` is a problem document
 * and means something else entirely.
 */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof HttpStatusError && error.httpStatus === 404;
}

// ---------------------------------------------------------------------------
// POST /health/programs/{programId}/revise (Adjust my plan)

/**
 * What a revision changes. Only what changes is sent. `targetWeightKg` is
 * tri-state like the calorie goal's: `undefined` leaves the key out (adoption
 * leaves the standing target alone), `null` sends null (adoption clears it),
 * a number sends it (adoption sets it).
 */
export interface ProgramRevisionInput {
  readonly goal?: string;
  readonly daysPerWeek?: number;
  readonly trainingDays?: readonly number[];
  readonly weeks?: number;
  readonly targetWeightKg?: number | null;
}

/** The revision body, keys in iOS's order, with the target on the 0.1 kg grid. */
export function programRevisionBody(input: ProgramRevisionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.goal !== undefined) body.goal = input.goal;
  if (input.daysPerWeek !== undefined) body.daysPerWeek = input.daysPerWeek;
  if (input.trainingDays !== undefined) body.trainingDays = [...input.trainingDays];
  if (input.weeks !== undefined) body.weeks = input.weeks;
  if (input.targetWeightKg !== undefined) {
    body.targetWeightKg = input.targetWeightKg === null ? null : roundTargetKg(input.targetWeightKg);
  }
  return body;
}

export interface ProgramRevisionResponse {
  readonly program: ProgramDetail;
  readonly replayed: boolean | null;
  /**
   * How many changes made in chat the running plan carries (applied, not
   * undone; API 0.41.0): switching to this revision replaces them, so the
   * Coach says so first. Null from an older server.
   */
  readonly chatEdits: number | null;
}

export const decodeProgramRevisionResponse: Reader<ProgramRevisionResponse> = (value, path) => {
  const json = object(value, path);
  const chatEdits = json.chatEdits;
  return {
    program: decodeProgramDetail(json.program, `${path}.program`),
    replayed: typeof json.replayed === 'boolean' ? json.replayed : null,
    chatEdits: typeof chatEdits === 'number' && Number.isInteger(chatEdits) && chatEdits >= 0 ? chatEdits : null,
  };
};

/**
 * A revision of the running plan: no model call, no Coach question, its own
 * cap of 6 in 30 days. Answers with a proposal the member switches to.
 */
export function reviseProgram(
  programId: string,
  input: ProgramRevisionInput,
  idempotencyKey: string,
  language: Lang,
): Promise<ProgramRevisionResponse> {
  return apiPost(`/health/programs/${encodeURIComponent(programId)}/revise`, programRevisionBody(input), {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: HEALTH_READ_TIMEOUT_MS,
    decode: (data) => decodeProgramRevisionResponse(data, 'revision'),
  });
}
