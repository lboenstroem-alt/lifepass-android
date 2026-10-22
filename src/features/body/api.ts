/**
 * The reads Body and goals and the weight history make of their own: the
 * Android port of iOS `BodyGoalsAPI` and the measurement calls of
 * Services/HealthService.swift. Everything else (the consent route, the
 * calorie goal, the export) is F7's (src/health/api.ts) and is used as is.
 *
 * THE TREND IS TYPED HERE, as on iOS. `GET /health/measurements/trend`
 * answers `{ weeks: [{ weekStartsOn, avgKg, count }], latestAvgKg, deltaKg,
 * direction }` (openapi `WeightTrendResponse`). F7's `fetchWeightTrend`
 * decodes `{ points, weeks: number }`, the shape iOS's HealthService once
 * assumed and the route has never sent: there `weeks` is the ARRAY of weekly
 * averages, so reading it as a number throws and the chart could never draw.
 * iOS Body and goals calls its own `BodyGoalsAPI.weightTrend` for exactly
 * this reason, and so does this file (contract note to F7 in the result).
 */
import { apiGet } from '../../api';
import { deleteMeasurement, fetchMeasurements, HEALTH_SESSION_TIMEOUT_MS, type Measurement, type Page } from '../../health';
import { arrayOf, double, integer, object, opt, req, string, type Reader } from '../../health/decode';

/** One ISO week's average. A week the member logged nothing in has no average: a hole, never a zero. */
export interface WeightTrendWeek {
  /** `YYYY-MM-DD`, the Monday. */
  readonly weekStartsOn: string;
  readonly avgKg: number | null;
  readonly count: number | null;
}

export interface WeightTrendWeeks {
  /** Oldest first, ending with the current week. */
  readonly weeks: readonly WeightTrendWeek[] | null;
  readonly latestAvgKg: number | null;
  readonly deltaKg: number | null;
  /** `down`, `up` or `same`; null with fewer than two weeks that have an average. */
  readonly direction: string | null;
}

const decodeWeek: Reader<WeightTrendWeek> = (value, path) => {
  const json = object(value, path);
  return {
    weekStartsOn: req(json, 'weekStartsOn', path, string),
    avgKg: opt(json, 'avgKg', path, double),
    count: opt(json, 'count', path, integer),
  };
};

/** iOS `WeightTrendWeeks`'s synthesized decoder: every member optional, strict about types. */
export const decodeWeightTrendWeeks: Reader<WeightTrendWeeks> = (value, path) => {
  const json = object(value, path);
  return {
    weeks: opt(json, 'weeks', path, arrayOf(decodeWeek)),
    latestAvgKg: opt(json, 'latestAvgKg', path, double),
    deltaKg: opt(json, 'deltaKg', path, double),
    direction: opt(json, 'direction', path, string),
  };
};

/** How many weeks the chart reads (iOS `weightTrend(weeks: 12)`). */
export const TREND_WEEKS = 12;

/** `GET /health/measurements/trend?weeks=` (iOS `BodyGoalsAPI.weightTrend`). Consent only. */
export function fetchWeightTrendWeeks(weeks: number = TREND_WEEKS): Promise<WeightTrendWeeks> {
  return apiGet('/health/measurements/trend', { weeks }, {
    timeoutMs: HEALTH_SESSION_TIMEOUT_MS,
    decode: (data) => decodeWeightTrendWeeks(data, 'trend'),
  });
}

/** Weigh-ins per page in the weight history (iOS `measurements(cursor:limit: 30)`). */
export const MEASUREMENTS_PAGE_SIZE = 30;

/** One page of the weight history, newest first; `cursor` null is the first page. */
export function fetchMeasurementsPage(cursor: string | null): Promise<Page<Measurement>> {
  return fetchMeasurements({ cursor, limit: MEASUREMENTS_PAGE_SIZE });
}

/** `DELETE /health/measurements/{id}`. The server recomputes the targets in the same transaction. */
export function deleteWeighIn(id: string): Promise<void> {
  return deleteMeasurement(id);
}
