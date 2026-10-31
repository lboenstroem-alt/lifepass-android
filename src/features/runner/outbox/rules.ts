/**
 * The workout outbox's rules: the Android port of iOS `WorkoutOutboxItem`,
 * `WorkoutOutboxStep` and `WorkoutOutboxRules`
 * (Views/Workout/FinishWorkoutSheet.swift). Pure: the outbox store
 * (./workoutOutbox.ts) carries the decision out.
 */
import { foldCode } from '../../../api';
import { asExtraBody, type WorkoutDoneBody } from '../model/performed';
import { MOVED_REASONS, type RunnerFailureKind } from '../saveRules';

export type WorkoutOutboxItemState = 'pending' | 'failed';

/** One Save this phone could not send: its body, its key and when it was made. */
export interface WorkoutOutboxItem {
  readonly id: string;
  readonly sessionId: string;
  readonly body: WorkoutDoneBody;
  readonly key: string;
  readonly createdAt: Date;
  readonly state: WorkoutOutboxItemState;
  /** Already converted once to `asExtra` ("convert the item ONCE"). */
  readonly converted: boolean;
}

/** The next step for an outbox item after one attempt. */
export type WorkoutOutboxStep =
  /** 2xx or a replay: remove (`outcome: sent`). */
  | 'sent'
  /** A converted item went through: remove (`outcome: extra`). */
  | 'sentAsExtra'
  /** Moved elsewhere: resend ONCE as an extra, same moment, new key. */
  | 'convertToExtra'
  /** Waits for the member on Plan's banner (`outcome: failed`). */
  | 'markFailed'
  /** Deleted, or a reused key: remove, with "This was changed on another device." */
  | 'dropChanged'
  /** A background path met a withdrawn consent or a minor: reconcile, which may wipe. */
  | 'reconcile'
  /** No network (or a server that is down): stop, try next time. */
  | 'stop';

/** At most five workouts wait on a phone; a sixth Save keeps its runner file instead. */
export const WORKOUT_OUTBOX_CAPACITY = 5;

/** An item older than seven days is dropped (the session has moved on). */
export const WORKOUT_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isTooOld(item: Pick<WorkoutOutboxItem, 'createdAt'>, now: Date): boolean {
  return now.getTime() - item.createdAt.getTime() > WORKOUT_OUTBOX_MAX_AGE_MS;
}

/** The step after one attempt; `failure` null is a success. */
export function outboxStep(
  failure: RunnerFailureKind | null,
  item: Pick<WorkoutOutboxItem, 'converted' | 'body'>,
  options: { readonly entitled: boolean; readonly foreground: boolean },
): WorkoutOutboxStep {
  if (failure === null) return item.converted || item.body.asExtra === true ? 'sentAsExtra' : 'sent';
  switch (failure.kind) {
    case 'offline':
    case 'cancelled':
    case 'notAuthenticated':
    case 'other':
      return 'stop';
    case 'problem': {
      const slug = foldCode(failure.slug);
      if (slug.endsWith('_deleted') || slug === 'idempotency_key_reused') return 'dropChanged';
      if (slug === 'health_consent_required') return options.entitled && options.foreground ? 'markFailed' : 'reconcile';
      if (slug === 'health_minor_blocked') return 'reconcile';
      if (slug === 'rate_limited' || (failure.status ?? 0) >= 500) return 'stop';
      const moved =
        slug === 'health_session_not_found' ||
        failure.status === 404 ||
        (slug === 'session_action_not_allowed' && MOVED_REASONS.includes(failure.reason ?? ''));
      if (moved && !item.converted && item.body.asExtra !== true) return 'convertToExtra';
      // `no_session_on_date`, `program_not_active`, a converted item that
      // fails again, a 403, a client-side 400.
      return 'markFailed';
    }
  }
}

/** The conversion itself: the same body and moment, `asExtra`, a new key. */
export function convertedItem(item: WorkoutOutboxItem, newKey: string): WorkoutOutboxItem {
  return { ...item, body: asExtraBody(item.body), key: newKey, converted: true };
}

/** iOS `WorkoutOutboxRules`, under its own name. */
export const WorkoutOutboxRules = {
  capacity: WORKOUT_OUTBOX_CAPACITY,
  maxAgeMs: WORKOUT_OUTBOX_MAX_AGE_MS,
  isTooOld,
  step: outboxStep,
  converted: convertedItem,
} as const;
