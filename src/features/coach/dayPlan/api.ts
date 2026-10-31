/**
 * `POST /coach` for a day plan: the intake for a first plan, or a
 * refinement of the plan on screen (iOS `CoachViewModel.runPlan` with
 * `CoachRequest`).
 *
 *   First plan:  { locale, intake }
 *   Refinement:  { locale, refine: { planId, change } }    NO intake
 *   Answer:      { ok, data: { reply, plan?, freeMessages? } }
 *
 * A refinement never carries the intake, ON PURPOSE: the server lets a
 * resent intake win over the answers inside the plan id, so resending the
 * first answers would undo every earlier change ("harder", then "something
 * else", would go back to easy). And neither ever carries a `note`: the
 * day-plan body sends nothing the member typed (owner ruling P1; the server
 * ignores a note from older builds).
 *
 * The API client sends the bearer token, unwraps the envelope and turns a
 * refusal into a typed error: `429 coach-daily-limit`, `429
 * coach-free-limit` and `503 coach-busy` arrive as problems.
 */
import { apiPost } from '../../../api';
import type { Lang } from '../../../i18n';
import { coachLocale } from '../chat/coachApi';
import { decodeCoachPlanResponse, type CoachPlanResponse } from './decode';
import type { CoachIntake, CoachRefine } from './model';

/** What a plan request carries besides the locale: exactly one of the two. */
export type CoachPlanRequest = { readonly intake: CoachIntake } | { readonly refine: CoachRefine };

/** The request body (exported for the contract and privacy tests). */
export function coachPlanBody(language: Lang | string, request: CoachPlanRequest): Record<string, unknown> {
  return 'intake' in request
    ? { locale: coachLocale(language), intake: request.intake }
    : { locale: coachLocale(language), refine: request.refine };
}

export async function postCoachPlan(language: Lang | string, request: CoachPlanRequest): Promise<CoachPlanResponse> {
  return apiPost<CoachPlanResponse>('/coach', coachPlanBody(language, request), { decode: decodeCoachPlanResponse });
}
