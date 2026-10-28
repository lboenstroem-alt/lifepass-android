/**
 * `PUT /health/nutrition-goal` (OP-48), with the nulls the contract asks for:
 * the Android port of iOS `HealthNutritionGoalBody` and
 * `HealthService.setNutritionGoal` (Views/Health/BodySheet.swift).
 *
 * The read (`GET /health/nutrition-goal`, the envelope with the standing
 * target weight and the feature list) is F7's `fetchNutritionGoalEnvelope`
 * in src/health/api.ts; the write answers with the same envelope.
 *
 * THIS EXISTS BECAUSE A MISSING KEY AND A NULL ARE DIFFERENT ANSWERS.
 * `nutritionGoalBodySchema` is a strict object whose `goal` is a REQUIRED key
 * that may carry null, which is how "clear my goal" is said on the wire. A
 * body that dropped the key when the goal is null sent `{}`, the server
 * answered 400 `invalid-nutrition-goal`, and Remove goal could never remove
 * anything (the iOS bug this shape fixed). `customKcal` is nullable for the
 * same reason: null is how a member's own daily number is un-set when they
 * switch "Use my own number" off. And `targetWeightKg` has the same three
 * states: left out leaves the stored target alone (the server never clears
 * one implicitly), null clears it, a number sets it.
 */
import { HEALTH_READ_TIMEOUT_MS, decodeNutritionGoalEnvelope, type NutritionGoalEnvelope } from '../health/api';

import { apiPut } from './client';
import { roundTargetKg } from './targetWeight';

export interface NutritionGoalInput {
  /** `lose`, `maintain` or `gain`; null clears the goal. ALWAYS sent. */
  readonly goal: string | null;
  /** Sent only when there is one (`female`, `male`, `unspecified`). */
  readonly sex?: string | null;
  /** Sent only when there is one; the caller leaves it out for a verified kennitala. */
  readonly ageBand?: string | null;
  /** Sent only when there is one. */
  readonly activity?: string | null;
  /**
   * Three states: `undefined` leaves the key out (nothing to say about the
   * number), `null` sends an explicit null (clear the member's own number),
   * a number sends it.
   */
  readonly customKcal?: number | null;
  /**
   * The same three states for the target weight. Only ever set on a server
   * that advertises `target_weight`: the schema is strict, so an older one
   * answers the key with 400.
   */
  readonly targetWeightKg?: number | null;
}

/** The wire body, keys in iOS's order (`goal`, `sex`, `ageBand`, `activity`, `customKcal`, `targetWeightKg`). */
export function nutritionGoalBody(input: NutritionGoalInput): Record<string, unknown> {
  const body: Record<string, unknown> = { goal: input.goal ?? null };
  if (input.sex != null) body.sex = input.sex;
  if (input.ageBand != null) body.ageBand = input.ageBand;
  if (input.activity != null) body.activity = input.activity;
  if (input.customKcal !== undefined) body.customKcal = input.customKcal;
  if (input.targetWeightKg !== undefined) {
    body.targetWeightKg = input.targetWeightKg === null ? null : roundTargetKg(input.targetWeightKg);
  }
  return body;
}

/**
 * Set, change or clear the calorie goal. Answers with the whole envelope:
 * the goal, and on a newer server the target weight and the feature list
 * (the caller passes the features to the app store's `noteServerFeatures`).
 *
 * No `?locale=`: iOS sends none on this write (the goal's answer carries no
 * server copy), and the same request goes out here.
 */
export function setNutritionGoal(input: NutritionGoalInput, idempotencyKey: string): Promise<NutritionGoalEnvelope> {
  return apiPut('/health/nutrition-goal', nutritionGoalBody(input), {
    idempotencyKey,
    timeoutMs: HEALTH_READ_TIMEOUT_MS,
    decode: (data) => decodeNutritionGoalEnvelope(data, 'nutritionGoal'),
  });
}
