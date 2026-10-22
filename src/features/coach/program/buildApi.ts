/**
 * OP-10, the one call the programme wizard makes: `POST /coach` with a
 * `program` body (iOS `ProgramBuildService`, `ProgramBuildRequest`,
 * `ProgramBuildResponse`).
 *
 * - A body carrying `program` carries nothing else but `locale`: no
 *   `messages`, no `intake`, no `note`, no `refine`, or the route answers 400.
 * - 20 s: a model call sits behind this and the member is watching a typing
 *   indicator. No retry: a retry of a paid call belongs to the member's own
 *   tap (the wizard resends twice-told failures itself, once, with a new key).
 * - The caller's Idempotency-Key, kept while the answers do not change.
 * - Never cached: the answer is a plan built from a weight and a height, so
 *   the request goes out with `Cache-Control: no-store` (iOS sends it through
 *   `HealthNetwork.client`, the ephemeral, cacheless session).
 */
import { API_TIMEOUTS, apiPost } from '../../../api';
import { decodeProgramDetail, type ProgramDetail } from '../../../health';
import type { Lang } from '../../../i18n';

import type { ProgramBuildBody } from './model';

/** iOS `ProgramBuildService.timeout`. */
export const PROGRAM_BUILD_TIMEOUT_MS = API_TIMEOUTS.programBuild;

/** 201, or 200 for a replay (`CoachProgramResponse`). */
export interface ProgramBuildResponse {
  /** The model's sentence; the wizard shows the programme's own `intro` instead. */
  readonly reply: string | null;
  readonly program: ProgramDetail;
  readonly replayed: boolean | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The answer's `data`: `program` is required (it is the whole point); the rest reads soft. */
export function decodeProgramBuildResponse(data: unknown): ProgramBuildResponse {
  if (!isObject(data)) throw new TypeError('program build: data is not an object');
  return {
    reply: typeof data.reply === 'string' ? data.reply : null,
    program: decodeProgramDetail(data.program, 'program'),
    replayed: typeof data.replayed === 'boolean' ? data.replayed : null,
  };
}

/** The request body, exactly: `locale` and `program`, nothing else. */
export function programBuildRequest(program: ProgramBuildBody, language: Lang | string): {
  readonly locale: 'en' | 'is';
  readonly program: ProgramBuildBody;
} {
  return { locale: language === 'is' ? 'is' : 'en', program };
}

export function postProgramBuild(
  program: ProgramBuildBody,
  language: Lang | string,
  idempotencyKey: string,
): Promise<ProgramBuildResponse> {
  return apiPost('/coach', programBuildRequest(program, language), {
    idempotencyKey,
    timeoutMs: PROGRAM_BUILD_TIMEOUT_MS,
    cache: 'no-store',
    decode: decodeProgramBuildResponse,
  });
}
