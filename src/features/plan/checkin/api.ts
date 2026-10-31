/**
 * OP-23 `POST /health/checkin`, the weekly check-in's one call (iOS
 * `HealthService.checkIn(body:idempotencyKey:language:)` and its
 * `HealthCheckInBody`, Views/Health/WeeklyCheckInSheet.swift).
 *
 * The body is the check-in's OWN, as on iOS: the older `CheckinBody` carried
 * a `note` the strict server schema refuses. Every field is optional and a
 * field that is not set is left out of the JSON (Swift's synthesized
 * `encodeIfPresent`), never sent as `null`:
 *
 *   - `weightKg` and/or `weekRating`, at least one (the sheet's Save waits
 *     for one);
 *   - `heightCm` OR `heightConfirmed`, never both, and only beside a weight
 *     (`checkinBodySchema`; ./rules.ts `checkInBody` builds it that way).
 *
 * The Idempotency-Key is the caller's, minted once per sheet (see
 * ../../../health/api.ts): a retry of the same Save must not log the weight
 * twice. Patience is the Today read's 20 seconds (iOS passes
 * `HealthNetwork.defaultTimeout`). The answer carries the week's review,
 * the fresh weigh-in state and the check-in state.
 */
import { API_TIMEOUTS, apiPost } from '../../../api';
import { decodeCheckinResponse, type CheckinResponse } from '../../../health';

/** The three ratings of the week, as the chips offer them (wire values). */
export const WEEK_RATINGS = ['great', 'ok', 'tough'] as const;
export type WeekRating = (typeof WEEK_RATINGS)[number];

/** The OP-23 body (iOS `HealthCheckInBody`). */
export interface HealthCheckInBody {
  readonly weekRating?: WeekRating;
  readonly weightKg?: number;
  readonly heightCm?: number;
  /** Only ever `true`: "Still 178 cm tall? Yes". */
  readonly heightConfirmed?: true;
}

export function postWeeklyCheckIn(body: HealthCheckInBody, idempotencyKey: string): Promise<CheckinResponse> {
  return apiPost('/health/checkin', body, {
    idempotencyKey,
    timeoutMs: API_TIMEOUTS.health,
    decode: decodeCheckinResponse,
  });
}
