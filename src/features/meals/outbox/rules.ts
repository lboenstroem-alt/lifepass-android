/**
 * The meal outbox's decisions as pure functions, so they are tested without
 * a network: the port of iOS `MealOutboxRules` (Services/MealOutbox.swift).
 *
 * A logged meal is never lost, never logged twice, and a background flush
 * never asks the member anything.
 */
import { ApiError } from '../../../api';
import type { MealCreateBody } from '../types/models';

/** One meal saved while offline, waiting for the server. */
export interface MealOutboxItem {
  readonly id: string;
  readonly body: MealCreateBody;
  /**
   * Minted when the member tapped Save; every retry sends the same one, so
   * the server's replay rule answers a meal that did arrive with the meal,
   * not with a second copy.
   */
  readonly key: string;
  readonly createdAt: Date;
  readonly state: MealOutboxState;
}

export type MealOutboxState = 'pending' | 'failed';

/** What to do after an attempt. */
export type MealOutboxStep =
  /** 201, or a 200 replay: it arrived. */
  | 'sent'
  /** The server will never take it (deleted, reused key, not found, invalid): drop it and say something changed. */
  | 'drop'
  /** Refused for a reason the member has to decide about: Plan's banner offers Discard. */
  | 'markFailed'
  /** Consent may be gone: the reconcile decides, silently. */
  | 'reconcile'
  /** No network, a server error or a rate limit: keep it and stop. */
  | 'stop';

/** At most ten meals wait; an enqueue past that fails and the caller keeps the tray. */
export const MEAL_OUTBOX_CAPACITY = 10;

/** A queued meal older than a week is dropped ("changed on another device"). */
export const MEAL_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isTooOld(item: Pick<MealOutboxItem, 'createdAt'>, now: Date): boolean {
  return now.getTime() - item.createdAt.getTime() > MEAL_OUTBOX_MAX_AGE_MS;
}

/**
 * What to do after an attempt. `failure` is null on success.
 *
 * `foreground` and `entitled` decide only the consent case: a member who
 * just acted (Plan's pull, Retry) and holds a membership sees the meal
 * marked failed for them to decide; anywhere else the refusal goes to the
 * health store's reconcile, which never presents a sheet.
 */
export function mealOutboxStep(failure: ApiError | null, options: { readonly foreground: boolean; readonly entitled: boolean }): MealOutboxStep {
  if (!failure) return 'sent';
  switch (failure.kind) {
    case 'transport':
    case 'not-authenticated':
      return 'stop';
    case 'http-status': {
      // Not the API's own refusal (that is always problem+json) but a page
      // from something in front of it: an HTML 401/403/404 from the edge,
      // deployment protection, a firewall challenge, a misrouted deploy.
      // Nothing there says the meal is wrong, so it is NEVER dropped: kept
      // for later on a server error, a rate limit or no HTTP answer at all,
      // and otherwise shown as failed for the member to retry or discard.
      const code = failure.status ?? 0;
      if (code === 0 || code >= 500 || code === 429) return 'stop';
      return 'markFailed';
    }
    case 'decoding':
      // It was stored; only the answer could not be read.
      return 'sent';
    case 'problem': {
      if (failure.isProblem('health_meal_deleted', 'idempotency_key_reused', 'invalid-meal')) return 'drop';
      if (failure.normalisedCode.endsWith('_not_found')) return 'drop';
      if (failure.isProblem('health_consent_required')) {
        return options.foreground && options.entitled ? 'markFailed' : 'reconcile';
      }
      if (failure.isProblem('no_active_plan_or_pass', 'account_pending_deletion', 'health_minor_blocked')) {
        return 'markFailed';
      }
      // The body's own status, as iOS reads it (`details.status ?? 0`).
      const status = failure.status ?? 0;
      if (status >= 500 || status === 429) return 'stop';
      if (status === 400) return 'drop';
      return 'markFailed';
    }
  }
}

/** True for a value the outbox can reason about (anything else ends the flush). */
export function isOutboxFailure(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
