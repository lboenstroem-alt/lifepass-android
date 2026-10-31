/**
 * The bodies of `POST /health/programs/{id}` (iOS
 * `HealthService.ProgramUpdateBody`), built ONLY through these, so no call
 * site can send a mix.
 *
 * THE SERVER'S SCHEMA IS STRICT: a body is EITHER `status` (pause, resume,
 * end) OR `trainingDays` and/or `body` (the change-days sheet, the body
 * sheet), never both kinds (`400 invalid-program-update`). A pause that also
 * carried the days on screen would be refused outright, and the member would
 * see "Something went wrong" for a tap that should simply have worked.
 */
import type { ProgramUpdateBody } from '../../../health';

export type ProgramStatusChange = 'paused' | 'active' | 'abandoned';

/** The training-day count the server accepts (`trainingDays`: 2 to 5 items). */
export const TRAINING_DAYS_MIN = 2;
export const TRAINING_DAYS_MAX = 5;

export const ProgramUpdate = {
  /** Pause, resume (`active`) or end (`abandoned`): the status and nothing else. */
  status(status: ProgramStatusChange): ProgramUpdateBody {
    return { status };
  },
  /** New training days (ISO weekdays, 1 = Monday), sorted and without repeats, and nothing else. */
  trainingDays(days: readonly number[]): ProgramUpdateBody {
    return { trainingDays: [...new Set(days)].sort((a, b) => a - b) };
  },
} as const;

/** Which kind a body is: one of the two the server takes, or `mixed` / `empty`, which it refuses. */
export function programUpdateKind(body: ProgramUpdateBody): 'status' | 'details' | 'mixed' | 'empty' {
  const hasStatus = body.status !== undefined;
  const hasDetails = body.trainingDays !== undefined || body.body !== undefined;
  if (hasStatus && hasDetails) return 'mixed';
  if (hasStatus) return 'status';
  if (hasDetails) return 'details';
  return 'empty';
}
