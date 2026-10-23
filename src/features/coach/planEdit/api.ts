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

/** Control characters other than whitespace (the server strips them; tabs and newlines become spaces). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * The server's `cleanPlanEditText`: NFC, control characters stripped,
 * whitespace collapsed, trimmed. Sent as cleaned, so the phone and the
 * server count the same characters (and a retry of the same words hashes the
 * same).
 */
export function cleanPlanEditText(text: string): string {
  return text.normalize('NFC').replace(CONTROL, '').replace(WHITESPACE, ' ').trim();
}

/** Words the server would take: 2 to 500 characters once cleaned. */
export function isPlanEditSendable(text: string): boolean {
  const cleaned = cleanPlanEditText(text);
  return cleaned.length >= PLAN_EDIT_MIN_LENGTH && cleaned.length <= PLAN_EDIT_MAX_LENGTH;
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

/** OP-59. `confirmCustom` only when the member confirmed that the plan will repeat as a cycle. */
export function applyPlanEdit(
  programId: string,
  editId: string,
  options: { readonly confirmCustom: boolean },
  idempotencyKey: string,
): Promise<PlanEditApplyResponse> {
  return apiPost(edit(programId, editId, 'apply'), options.confirmCustom ? { confirmCustom: true } : {}, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeApplyResponse,
  });
}

/** OP-60 (no body). */
export function undoPlanEdit(programId: string, editId: string, idempotencyKey: string): Promise<PlanEditUndoResponse> {
  return apiPost(edit(programId, editId, 'undo'), undefined, {
    idempotencyKey,
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: decodeUndoResponse,
  });
}

/** OP-61 (no body): Cancel. Idempotent, and a no-op for anything but a pending preview. */
export function discardPlanEdit(programId: string, editId: string, idempotencyKey: string): Promise<PlanEditDiscardResponse> {
  return apiPost(edit(programId, editId, 'discard'), undefined, {
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
 * What a failed OP-58 means for the chat. `passOn` is not a failure the
 * member sees: the words go on through the Coach as if this step never ran
 * (the route has gone, or the words are not ones it takes).
 */
export type PlanEditSendFailure =
  /** 409 `plan_edit_consent_required`: the one-tap consent, then the same words with the same key. */
  | 'consent'
  /** 422 `plan_edit_personal_data`: nothing was sent, nothing spent. */
  | 'personalData'
  /** 429 `plan_edit_limit` (daily or attempts: the same words). */
  | 'limit'
  /** 503 `plan_edit_paused`. */
  | 'paused'
  /** 502 `coach_upstream_error`: the model failed (refunded). Retry with a new key. */
  | 'upstream'
  /** 409 `program_action_not_allowed` `not_live`, or the plan is gone. */
  | 'notLive'
  /** 409 `program_action_not_allowed` `paused`. */
  | 'planPaused'
  /** No connection, or no answer in time: the Coach's own offline words. */
  | 'offline'
  | 'rateLimited'
  /** A 404 that is not a problem, or 400 `invalid-plan-edit`: the words go on through the Coach. */
  | 'passOn'
  /** The gate, consent withdrawn, a pending deletion, a minor: every health screen's own rules. */
  | 'refused'
  | 'other';

/** The rules every health screen answers itself (src/health/store.ts `handle`). */
const HEALTH_GATE_PROBLEMS = ['no_active_plan_or_pass', 'health_consent_required', 'account_pending_deletion', 'health_minor_blocked'];

/**
 * A 404 that is NOT a problem document: the route is not on this server (a
 * rollback, or the flag went off after the features were read).
 * `health_program_not_found` is a problem and means something else.
 */
export function isMissingRoute(error: ApiError): boolean {
  return error instanceof HttpStatusError && error.httpStatus === 404;
}

export function planEditSendFailure(error: ApiError): PlanEditSendFailure {
  // A timeout too: the Coach says what it says for no connection.
  if (error.isOffline) return 'offline';
  if (error.isProblem('plan_edit_consent_required')) return 'consent';
  if (error.isProblem('plan_edit_personal_data')) return 'personalData';
  if (error.isProblem('plan_edit_limit')) return 'limit';
  if (error.isProblem('plan_edit_paused')) return 'paused';
  if (error.isProblem('coach_upstream_error')) return 'upstream';
  if (error.isProblem('program_action_not_allowed')) return error.reason === 'paused' ? 'planPaused' : 'notLive';
  if (error.isProblem('health_program_not_found')) return 'notLive';
  // The route is invisible (the flag went off), or the words are not ones it takes.
  if (error.isProblem('invalid-plan-edit', 'not_found')) return 'passOn';
  if (error.isProblem('rate_limited', 'rate-limited')) return 'rateLimited';
  if (error.isProblem(...HEALTH_GATE_PROBLEMS)) return 'refused';
  if (isMissingRoute(error)) return 'passOn';
  if ((error.status ?? 0) >= 500) return 'upstream';
  return 'other';
}

/** What a failed Apply means for the card. */
export type PlanEditApplyFailure =
  /** 409 `plan_edit_stale` or 404 `plan_edit_not_found`: "Your plan changed since I suggested this. Ask me again." */
  | 'stale'
  /** 409 `plan_edit_confirm_required`: the cycle dialog first. */
  | 'confirmRequired'
  /** 409 `plan_edit_not_pending` `applied`: it was applied already (another phone): the card says Changed. */
  | 'alreadyApplied'
  | 'notLive'
  | 'planPaused'
  | 'offline'
  | 'rateLimited'
  | 'refused'
  | 'other';

export function planEditApplyFailure(error: ApiError): PlanEditApplyFailure {
  if (error.isOffline) return 'offline';
  if (error.isProblem('plan_edit_confirm_required')) return 'confirmRequired';
  if (error.isProblem('plan_edit_stale', 'plan_edit_not_found')) return 'stale';
  if (error.isProblem('plan_edit_not_pending')) return error.reason === 'applied' ? 'alreadyApplied' : 'stale';
  if (error.isProblem('program_action_not_allowed')) return error.reason === 'paused' ? 'planPaused' : 'notLive';
  if (error.isProblem('health_program_not_found')) return 'notLive';
  if (error.isProblem('rate_limited', 'rate-limited')) return 'rateLimited';
  if (error.isProblem(...HEALTH_GATE_PROBLEMS)) return 'refused';
  return 'other';
}

/** What a failed Undo means for the card and the Changes list. */
export type PlanEditUndoFailure =
  /** 409 `plan_edit_undo_unavailable` `window_closed`. */
  | 'undoWindow'
  /** 409 `plan_edit_undo_unavailable` `plan_changed` or `later_edit`. */
  | 'undoChanged'
  /** 409 `plan_edit_not_pending` `undone`: it was undone already: the card says Undone. */
  | 'alreadyUndone'
  | 'offline'
  | 'rateLimited'
  | 'refused'
  | 'other';

export function planEditUndoFailure(error: ApiError): PlanEditUndoFailure {
  if (error.isOffline) return 'offline';
  if (error.isProblem('plan_edit_undo_unavailable')) return error.reason === 'window_closed' ? 'undoWindow' : 'undoChanged';
  if (error.isProblem('plan_edit_not_pending')) return error.reason === 'undone' ? 'alreadyUndone' : 'undoChanged';
  if (error.isProblem('plan_edit_not_found', 'health_program_not_found')) return 'undoChanged';
  if (error.isProblem('rate_limited', 'rate-limited')) return 'rateLimited';
  if (error.isProblem(...HEALTH_GATE_PROBLEMS)) return 'refused';
  return 'other';
}

/** The copy key a failure shows (null: the caller words it, or nothing is said). */
export function planEditFailureCopyKey(
  failure: PlanEditSendFailure | PlanEditApplyFailure | PlanEditUndoFailure,
): string | null {
  switch (failure) {
    case 'personalData':
      return 'coach.planEdit.error.personalData';
    case 'limit':
      return 'coach.planEdit.error.limit';
    case 'paused':
      return 'coach.planEdit.error.paused';
    case 'upstream':
      return 'coach.planEdit.error.upstream';
    case 'stale':
      return 'coach.planEdit.error.stale';
    case 'notLive':
      return 'coach.planEdit.error.notLive';
    case 'planPaused':
      return 'coach.planEdit.error.planPaused';
    case 'undoWindow':
      return 'coach.planEdit.error.undoWindow';
    case 'undoChanged':
      return 'coach.planEdit.error.undoChanged';
    case 'rateLimited':
      return 'health.err.rate_limited';
    case 'other':
      return 'coach.planEdit.error.upstream';
    case 'offline':
    case 'consent':
    case 'confirmRequired':
    case 'alreadyApplied':
    case 'alreadyUndone':
    case 'passOn':
    case 'refused':
      return null;
  }
}

/** `plan_edit_error.code`: fixed words, never the member's. */
export function planEditErrorCode(error: unknown): string {
  if (!isApiError(error)) return 'client';
  if (error.isOffline) return 'offline';
  return error.normalisedCode.replace(/[^a-z_]/g, '').slice(0, 40) || 'unknown';
}
