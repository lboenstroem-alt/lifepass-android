/**
 * The trails feed (./trailsFeed.ts, iOS MapViewModel `loadTrails` and
 * `trailsRetryAfter`): silent failures, a ten-minute wait kept across maps,
 * and one request at a time.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { loadTrailsFeed, resetTrailsFeed, TRAILS_RETRY_INTERVAL_MS } from '../trailsFeed';

stubApiClientPerTest({ token: null });

const WALK = {
  slug: 'glymur',
  name: 'Glymur',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-21.27, 64.38],
      [-21.25, 64.39],
    ],
  },
};

const sent = () => api.sentAll('/attractions/trails').length;

beforeEach(() => {
  resetTrailsFeed();
});

it('reads the trails, and asks again next time', async () => {
  api.on('GET', '/attractions/trails', Reply.ok({ trails: [WALK], attribution: 'ODbL' }));
  const page = await loadTrailsFeed();
  expect(page?.trails.map((t) => t.slug)).toEqual(['glymur']);
  await loadTrailsFeed();
  expect(sent()).toBe(2);
});

it('after a failure, a map opened again within ten minutes sends no request', async () => {
  let now = 1_000_000;
  const clock = () => now;
  api.on('GET', '/attractions/trails', Reply.problem(404, 'not_found'));
  expect(await loadTrailsFeed(clock)).toBeNull();
  expect(sent()).toBe(1);

  now += TRAILS_RETRY_INTERVAL_MS - 1;
  expect(await loadTrailsFeed(clock)).toBeNull();
  expect(sent()).toBe(1);

  now += 1;
  api.on('GET', '/attractions/trails', Reply.ok({ trails: [WALK], attribution: 'ODbL' }));
  expect((await loadTrailsFeed(clock))?.trails).toHaveLength(1);
  expect(sent()).toBe(2);
});

it('waits after a 503, a dropped connection and a body that does not decode alike', async () => {
  for (const reply of [Reply.problem(503, 'unavailable'), Reply.fail(), Reply.json(200, { ok: true, data: 'nope' })]) {
    resetTrailsFeed();
    api.reset();
    api.on('GET', '/attractions/trails', reply);
    expect(await loadTrailsFeed()).toBeNull();
    expect(await loadTrailsFeed()).toBeNull();
    expect(sent()).toBe(1);
  }
});

it('lets a second caller join the request already out', async () => {
  api.on('GET', '/attractions/trails', Reply.delayed(50, Reply.ok({ trails: [WALK], attribution: null })));
  const [a, b] = await Promise.all([loadTrailsFeed(), loadTrailsFeed()]);
  expect(a).toBe(b);
  expect(sent()).toBe(1);
});
