/**
 * `outbox.json` as text: the queue of Saves this phone still owes the server,
 * in the shape iOS's `Codable` gives `[WorkoutOutboxItem]`. Each item keeps
 * its body exactly as it will be sent (the wire's member names), its key and
 * the moment it was made.
 *
 * Strict like iOS: an item that does not decode fails the read, and the
 * health file store reads such a file as absent. Instants are written with
 * milliseconds; the whole-second form iOS writes reads too.
 */
import {
  arrayOf,
  boolean,
  double,
  HealthShapeError,
  instant,
  integer,
  object,
  opt,
  req,
  string,
  type Reader,
} from '../../../health/decode';
import { encodeRunnerJson } from '../model/codec';
import type { PerformedExerciseBody, PerformedSetBody, WorkoutDoneBody } from '../model/performed';

import type { WorkoutOutboxItem, WorkoutOutboxItemState } from './rules';

/** Only members that are present: the body goes back on the wire exactly as it was queued. */
function present<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== null && member !== undefined)) as T;
}

const decodePerformedSet: Reader<PerformedSetBody> = (value, path) => {
  const json = object(value, path);
  return present({
    reps: opt(json, 'reps', path, integer),
    seconds: opt(json, 'seconds', path, integer),
    meters: opt(json, 'meters', path, integer),
    kg: opt(json, 'kg', path, double),
    done: req(json, 'done', path, boolean),
  }) as PerformedSetBody;
};

const decodePerformedExercise: Reader<PerformedExerciseBody> = (value, path) => {
  const json = object(value, path);
  return present({
    exerciseId: req(json, 'exerciseId', path, string),
    swappedFrom: opt(json, 'swappedFrom', path, string),
    skipped: req(json, 'skipped', path, boolean),
    minutes: opt(json, 'minutes', path, integer),
    sets: req(json, 'sets', path, arrayOf(decodePerformedSet)),
  }) as PerformedExerciseBody;
};

export const decodeWorkoutDoneBody: Reader<WorkoutDoneBody> = (value, path) => {
  const json = object(value, path);
  // Only `done` is ever queued; anything else is not a body this outbox sends.
  if (req(json, 'action', path, string) !== 'done') throw new HealthShapeError(`${path}.action`);
  return present({
    action: 'done' as const,
    minutes: opt(json, 'minutes', path, integer),
    feeling: opt(json, 'feeling', path, string),
    performed: opt(json, 'performed', path, arrayOf(decodePerformedExercise)),
    clientCompletedAt: opt(json, 'clientCompletedAt', path, instant),
    asExtra: opt(json, 'asExtra', path, boolean),
  }) as WorkoutDoneBody;
};

const itemState: Reader<WorkoutOutboxItemState> = (value, path) => {
  const raw = string(value, path);
  if (raw !== 'pending' && raw !== 'failed') throw new HealthShapeError(path);
  return raw;
};

const decodeItem: Reader<WorkoutOutboxItem> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    sessionId: req(json, 'sessionId', path, string),
    body: req(json, 'body', path, decodeWorkoutDoneBody),
    key: req(json, 'key', path, string),
    createdAt: req(json, 'createdAt', path, instant),
    state: req(json, 'state', path, itemState),
    converted: req(json, 'converted', path, boolean),
  };
};

/** The file's queue. Throws on anything that is not one. */
export function decodeWorkoutOutbox(value: unknown): WorkoutOutboxItem[] {
  return arrayOf(decodeItem)(value, 'outbox');
}

export function encodeWorkoutOutbox(items: readonly WorkoutOutboxItem[]): string {
  return encodeRunnerJson(items);
}
