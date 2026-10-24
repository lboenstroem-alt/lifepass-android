/**
 * The five plan-edit operations (API 0.41.0, docs/05 OP-58 to OP-62) and
 * what each refusal means: the Android port of iOS `PlanEditService`.
 *
 *   OP-58 POST /health/programs/{id}/edits                  the member's words, one model call, nothing written
 *   OP-59 POST /health/programs/{id}/edits/{editId}/apply   the change, no model call
 *   OP-60 POST /health/programs/{id}/edits/{editId}/undo    the change taken back, all or nothing
 *   OP-61 POST /health/programs/{id}/edits/{editId}/discard Cancel (best effort; a no-op once applied)
 *   OP-62 GET  /health/programs/{id}/edits                  the plan's applied and undone changes
 *
 * Thin like ../../../health/api.ts: no cache, no retry, no state, and every
 * call that writes takes an Idempotency-Key the CALLER minted for that one
 * member action (src/api/idempotency.ts). Only OP-58 is behind the server's
 * flag; apply, undo, discard and the history work whenever the server has
 * the tables, so turning the feature off never strands a change without its
 * Undo.
 *
 * THE WORDS LEAVE THE PHONE ONCE: the OP-58 body carries them, and nothing
 * here writes, logs or tracks them.
 */
import { apiGet, apiPost, HttpStatusError, isApiError, type ApiError } from '../../../api';
import { HEALTH_SESSION_TIMEOUT_MS, localeQuery } from '../../../health/api';
import type { Lang } from '../../../i18n';

import {
  decodeApplyResponse,
  decodeDiscardResponse,
  decodeHistory,
  decodePlanEditResponse,
  decodeUndoResponse,
  type PlanEditApplyResponse,
  type PlanEditDiscardResponse,
  type PlanEditResponse,
  type PlanEditUndoResponse,
  type PlanEditView,
} from './types';

/**
 * The model gets 20 s and the route 30; the rest is the network. Past this
 * the request is given up as a failed answer (the server refunds a call it
 * could not finish).
 */
export const PLAN_EDIT_TIMEOUT_MS = 32_000;

/** The words the server takes (after the same cleaning the server does). */
export const PLAN_EDIT_MIN_LENGTH = 2;
export const PLAN_EDIT_MAX_LENGTH = 500;

/** Control characters (iOS `CharacterSet.controlCharacters`, C0 and C1). */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * The server's `cleanPlanEditText` (iOS `PlanEditText.cleaned`): NFC, every
 * control character a space, whitespace collapsed, trimmed. Sent as
 * cleaned, so the phone and the server count the same characters (and a
 * retry of the same words hashes the same). The count is JavaScript's (UTF-16
 * code units), the server's own.
 */
export function cleanPlanEditText(text: string): string {
  return text.normalize('NFC').replace(CONTROL, ' ').replace(WHITESPACE, ' ').trim();
}

/** Words the server would take: 2 to 500 characters once cleaned. */
export function isPlanEditSendable(text: string): boolean {
  const cleaned = cleanPlanEditText(text);
  return cleaned.length >= PLAN_EDIT_MIN_LENGTH && cleaned.length <= PLAN_EDIT_MAX_LENGTH;
}

/** Cleaned and cut to `limit` between whole characters (iOS `PlanEditText.capped`). */
export function capPlanEditText(text: string, limit: number = PLAN_EDIT_MAX_LENGTH): string {
  const clean = cleanPlanEditText(text);
  if (clean.length <= limit) return clean;
  let result = '';
  for (const character of clean) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result.trim();
}

/**
 * The answer to a question the Coach asked, sent together with the request
 * it asked about, so the model reads both: the server keeps no
 * conversation, and "Bench press" alone means nothing. The original is cut
 * if the two do not fit (iOS `PlanEditText.answer`).
 */
export function answerPlanEditQuestion(answer: string, original: string): string {
  const reply = cleanPlanEditText(answer);
  const first = cleanPlanEditText(original);
  if (!first) return capPlanEditText(reply);
  const room = PLAN_EDIT_MAX_LENGTH - reply.length - 1;
  if (room <= 0) return capPlanEditText(reply);
  return capPlanEditText(`${capPlanEditText(first, room)} ${reply}`);
}

/** OP-58's body (strict on the server: no other key). */
export interface PlanEditRequestBody {
  readonly message: string;
  /** The app language, for the card's server text. The reply follows the words' own language. */
  readonly locale: 'en' | 'is';
  /** The variant of a still-pending preview these words refine ("no, make it 4 sets"). */
  readonly replacesEditId?: string;
  /** The day or exercise the member asked from (Plan's "Change with Coach", the runner's "I don't have this"). */
  readonly context?: { readonly sessionId?: string; readonly exerciseId?: string };
}

/** The body as sent: keys left out rather than null, an empty context left out. */
export function planEditBody(input: {
  message: string;
  language: Lang | string;
  replacesEditId?: string | null;
  sessionId?: string | null;
  exerciseId?: string | null;
}): PlanEditRequestBody {
  const context: { sessionId?: string; exerciseId?: string } = {};
  if (input.sessionId) context.sessionId = input.sessionId;
  if (input.exerciseId) context.exerciseId = input.exerciseId;
  return {
    message: cleanPlanEditText(input.message),
    locale: localeQuery(input.language).locale,
    ...(input.replacesEditId ? { replacesEditId: input.replacesEditId } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
  };
}

function base(programId: string): string {
  return `/health/programs/${encodeURIComponent(programId)}/edits`;
}

function edit(programId: string, editId: string, action: 'apply' | 'undo' | 'discard'): string {
  return `${base(programId)}/${encodeURIComponent(editId)}/${action}`;
}

/** OP-58: the member's words to the Coach. Nothing changes until Apply. */
export function postPlanEdit(programId: string, body: PlanEditRequestBody, idempotencyKey: string): Promise<PlanEditResponse> {
  return apiPost(base(programId), body, {
    idempotencyKey,
    timeoutMs: PLAN_EDIT_TIMEOUT_MS,
    decode: decodePlanEditResponse,
  });
}

/**
 * OP-59. `confirmCustom` only when the member confirmed that the plan will
 * repeat as a cycle. `language` is the app's: the answer's summary and change
 * groups come back in it (iOS sends the same `?locale=`).
 */
export function applyPlanEdit(
  programId: string,
  editId: string,
  options: { readonly confirmCustom: boolean; readonly language: Lang | string },
  idempotencyKey: string,
): Promise<PlanEditApplyResponse> {
  return apiPost(edit(programId, editId, 'apply'), options.confirmCustom ? { confirmCustom: true } : {}, {
    query: localeQuery(options.language),
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeApplyResponse,
  });
}

/** OP-60 (no body), its answer in the app's `language`. */
export function undoPlanEdit(programId: string, editId: string, language: Lang | string, idempotencyKey: string): Promise<PlanEditUndoResponse> {
  return apiPost(edit(programId, editId, 'undo'), undefined, {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeUndoResponse,
  });
}

/** OP-61 (no body): Cancel. Idempotent, and a no-op for anything but a pending preview. */
export function discardPlanEdit(programId: string, editId: string, language: Lang | string, idempotencyKey: string): Promise<PlanEditDiscardResponse> {
  return apiPost(edit(programId, editId, 'discard'), undefined, {
    query: localeQuery(language),
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeDiscardResponse,
  });
}

/** OP-62: applied and undone changes, newest first (at most 50), in the account language. */
export function fetchPlanEdits(programId: string, language: Lang): Promise<readonly PlanEditView[]> {
  return apiGet(base(programId), localeQuery(language), {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeHistory,
  });
}

// ---------------------------------------------------------------------------
// Refusals

/**
 * Every refusal the plan-change routes give, as the Coach answers it (iOS
 * `PlanEditProblem`). One table for OP-58 to OP-61: each caller picks what
 * applies to it.
 */
export type PlanEditProblem =
  /** 409 `plan_edit_consent_required` (the v4 text): the one-tap consent, then the same words. */
  | { readonly kind: 'consentNeeded' }
  /**
   * 409 `health_consent_required`: the health consent itself is gone
   * (withdrawn on another device). Only the FULL consent sheet may take it
   * again, never the one-tap line (iOS `healthConsentGone`).
   */
  | { readonly kind: 'healthConsentGone' }
  | { readonly kind: 'personalData' }
  /** 429 `plan_edit_limit` (`daily` or `attempts`: the same words). */
  | { readonly kind: 'limit' }
  /** 503 `plan_edit_paused`: the fleet's daily ceiling. */
  | { readonly kind: 'servicePaused' }
  /** 502 `coach_upstream_error`: refunded, so Retry sends a new key. */
  | { readonly kind: 'upstream' }
  /** 409 `plan_edit_stale` or 404 `plan_edit_not_found` at Apply. */
  | { readonly kind: 'stale' }
  | { readonly kind: 'confirmRequired' }
  /** 409 `plan_edit_not_pending` with its reason (`applied`, `undone`, `discarded`, `superseded`). */
  | { readonly kind: 'notPending'; readonly reason: string | null }
  | { readonly kind: 'undoWindow' }
  | { readonly kind: 'undoChanged' }
  /** 409 `program_action_not_allowed` `not_live`. */
  | { readonly kind: 'notLive' }
  /** 409 `program_action_not_allowed` `paused`. */
  | { readonly kind: 'planPaused' }
  /** 404 `health_program_not_found`. */
  | { readonly kind: 'programGone' }
  /** The route is missing (a 404 that is no problem, or `not_found`): the server stopped offering it. */
  | { readonly kind: 'featureOff' }
  | { readonly kind: 'keyReused' }
  | { readonly kind: 'rateLimited' }
  /** No connection, or no answer in time. */
  | { readonly kind: 'offline' }
  | { readonly kind: 'pendingDeletion' }
  | { readonly kind: 'notMember' }
  | { readonly kind: 'minor' }
  | { readonly kind: 'other' };

/**
 * A 404 that is NOT a problem document: the route is not on this server (a
 * rollback, or the flag went off after the features were read).
 * `health_program_not_found` is a problem and means something else.
 */
export function isMissingRoute(error: ApiError): boolean {
  return error instanceof HttpStatusError && error.httpStatus === 404;
}

/** What a refusal means (iOS `PlanEditProblem.classify`). */
export function planEditProblem(error: ApiError): PlanEditProblem {
  if (error.isOffline) return { kind: 'offline' };
  if (isMissingRoute(error)) return { kind: 'featureOff' };
  switch (error.normalisedCode) {
    case 'plan_edit_consent_required':
      return { kind: 'consentNeeded' };
    case 'health_consent_required':
      return { kind: 'healthConsentGone' };
    case 'plan_edit_personal_data':
      return { kind: 'personalData' };
    case 'plan_edit_limit':
      return { kind: 'limit' };
    case 'plan_edit_paused':
      return { kind: 'servicePaused' };
    case 'coach_upstream_error':
      return { kind: 'upstream' };
    case 'plan_edit_stale':
    case 'plan_edit_not_found':
      return { kind: 'stale' };
    case 'plan_edit_confirm_required':
      return { kind: 'confirmRequired' };
    case 'plan_edit_not_pending':
      return { kind: 'notPending', reason: error.reason ?? null };
    case 'plan_edit_undo_unavailable':
      return { kind: error.reason === 'window_closed' ? 'undoWindow' : 'undoChanged' };
    case 'program_action_not_allowed':
      return { kind: error.reason === 'paused' ? 'planPaused' : 'notLive' };
    case 'health_program_not_found':
      return { kind: 'programGone' };
    case 'not_found':
      return { kind: 'featureOff' };
    case 'idempotency_key_reused':
      return { kind: 'keyReused' };
    case 'rate_limited':
      return { kind: 'rateLimited' };
    case 'account_pending_deletion':
      return { kind: 'pendingDeletion' };
    case 'no_active_plan_or_pass':
      return { kind: 'notMember' };
    case 'health_minor_blocked':
      return { kind: 'minor' };
    default:
      return (error.status ?? 0) >= 500 ? { kind: 'upstream' } : { kind: 'other' };
  }
}

/** `plan_edit_error.reason`: fixed words, never the member's (iOS: the problem code, or `offline`). */
export function planEditErrorReason(error: unknown): string {
  if (!isApiError(error)) return 'unknown';
  if (error.isOffline) return 'offline';
  return error.normalisedCode.replace(/[^a-z_]/g, '').slice(0, 40) || 'unknown';
}
