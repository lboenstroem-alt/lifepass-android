/**
 * Body and goals' own calls: the trend as the route really answers it (iOS
 * `WeightTrendWeeks`, not the `{ points, weeks: Int }` shape the route never
 * sent), the weight history's 30-row pages and the per-row delete.
 */
import { api, Reply } from '@test/server';

import { DecodingError } from '../../../api';
import { stubApiClientPerTest } from '../../../api/testing';
import { decodeWeightTrendWeeks, deleteWeighIn, fetchMeasurementsPage, fetchWeightTrendWeeks } from '../api';

stubApiClientPerTest();

const TREND = {
  weeks: [
    { weekStartsOn: '2026-08-03', avgKg: 74.8, count: 2 },
    { weekStartsOn: '2026-08-10', avgKg: null, count: 0 },
    { weekStartsOn: '2026-08-17', avgKg: 74.1, count: 1 },
  ],
  latestAvgKg: 74.1,
  deltaKg: -0.7,
  direction: 'down',
};

describe('the trend', () => {
  it('asks for 12 weeks and reads the weekly averages, holes included', async () => {
    api.on('GET', '/health/measurements/trend', Reply.ok(TREND));
    const trend = await fetchWeightTrendWeeks();
    expect(api.sent('/health/measurements/trend').query).toEqual({ weeks: '12' });
    expect(trend).toEqual(TREND);
  });

  it('a trend with too few weeks has no direction', () => {
    expect(decodeWeightTrendWeeks({ weeks: [], latestAvgKg: null, deltaKg: null, direction: null }, 'trend')).toEqual({
      weeks: [],
      latestAvgKg: null,
      deltaKg: null,
      direction: null,
    });
  });

  it('a week without its date fails the read (Swift decodes it strictly), so the page shows its error row', async () => {
    api.on('GET', '/health/measurements/trend', Reply.ok({ ...TREND, weeks: [{ avgKg: 70, count: 1 }] }));
    await expect(fetchWeightTrendWeeks()).rejects.toBeInstanceOf(DecodingError);
  });

  it('the old `{ points, weeks: 12 }` shape is not this route (weeks is the array)', () => {
    expect(() => decodeWeightTrendWeeks({ points: [], weeks: 12 }, 'trend')).toThrow();
  });
});

describe('the weight history', () => {
  it('reads 30 at a time, the next page by the cursor the server sent', async () => {
    api.on(
      'GET',
      '/health/measurements',
      Reply.ok({
        data: [{ id: 'm-1', weightKg: 72.5, heightCm: null, source: 'weekly_prompt', measuredAt: '2026-09-17T08:00:00Z', createdAt: '2026-09-17T08:00:00Z' }],
        pagination: { nextCursor: 'c-2', hasMore: true, limit: 30 },
      }),
    );
    const first = await fetchMeasurementsPage(null);
    expect(api.sent('/health/measurements').query).toEqual({ limit: '30' });
    expect(first.nextCursor).toBe('c-2');
    expect(first.hasMore).toBe(true);
    expect(first.data[0]).toMatchObject({ id: 'm-1', weightKg: 72.5, source: 'weekly_prompt' });

    await fetchMeasurementsPage('c-2');
    expect(api.sent('/health/measurements').query).toEqual({ limit: '30', cursor: 'c-2' });
  });

  it('deletes one weigh-in by its id', async () => {
    api.on('DELETE', '/health/measurements/:id', Reply.ok({ ok: true }));
    await deleteWeighIn('m 1/2');
    expect(api.sent('/health/measurements/m%201%2F2', 'DELETE')).toBeTruthy();
  });
});
