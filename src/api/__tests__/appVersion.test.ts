/**
 * `GET /app-version?platform=android` on the wire: anonymous (no token, even
 * signed in), cacheable, and decoded tolerantly; anything that is not an
 * answer throws, for the caller to fail open.
 */
import { api, Reply } from '@test/server';

import {
  ANDROID_PACKAGE_NAME,
  decodeAppVersionPolicy,
  fetchAppVersionPolicy,
  PLAY_STORE_URL,
  playStoreUrl,
} from '../appVersion';
import { stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const ANSWER = {
  platform: 'android',
  minimumVersion: '2.5.0',
  latestVersion: '2.6.0',
  storeUrl: 'https://play.google.com/store/apps/details?id=is.lifepass.android',
};

it('asks for the Android policy without a token and without forbidding the HTTP cache', async () => {
  api.on('GET', '/app-version', Reply.ok(ANSWER));
  const policy = await fetchAppVersionPolicy();
  expect(policy).toEqual({ minimumVersion: '2.5.0', latestVersion: '2.6.0', storeUrl: ANSWER.storeUrl });

  const sent = api.sent('/app-version');
  expect(sent.method).toBe('GET');
  expect(sent.query).toEqual({ platform: 'android' });
  // Signed in (the stub session has a token), and still anonymous.
  expect(sent.headers.authorization).toBeUndefined();
  expect(sent.headers['cache-control']).toBeUndefined();
});

it('reads nulls and missing fields as "nothing set"', async () => {
  api.on('GET', '/app-version', Reply.ok({ platform: 'android', minimumVersion: null, latestVersion: null, storeUrl: ANSWER.storeUrl }));
  expect(await fetchAppVersionPolicy()).toEqual({ minimumVersion: null, latestVersion: null, storeUrl: ANSWER.storeUrl });
  expect(decodeAppVersionPolicy({})).toEqual({ minimumVersion: null, latestVersion: null, storeUrl: PLAY_STORE_URL });
  expect(decodeAppVersionPolicy({ minimumVersion: 3, latestVersion: '  ', storeUrl: 7 })).toEqual({
    minimumVersion: null,
    latestVersion: null,
    storeUrl: PLAY_STORE_URL,
  });
});

it('throws on what is not an answer: no object, or the iOS policy', () => {
  expect(() => decodeAppVersionPolicy(null)).toThrow();
  expect(() => decodeAppVersionPolicy(['2.5.0'])).toThrow();
  expect(() => decodeAppVersionPolicy({ ...ANSWER, platform: 'ios' })).toThrow();
});

it('throws on a refusal or a server error, for the caller to fail open', async () => {
  api.on('GET', '/app-version', Reply.problem(400, 'invalid-app-version-query'));
  await expect(fetchAppVersionPolicy()).rejects.toBeDefined();
  api.reset();
  api.on('GET', '/app-version', Reply.problem(503, 'temporarily_unavailable'));
  await expect(fetchAppVersionPolicy()).rejects.toBeDefined();
});

describe('the store link', () => {
  it('keeps a Google Play listing over https', () => {
    expect(playStoreUrl(ANSWER.storeUrl)).toBe(ANSWER.storeUrl);
  });

  it.each([
    'http://play.google.com/store/apps/details?id=is.lifepass.android',
    'https://evil.example/store/apps/details?id=is.lifepass.android',
    'https://play.google.com.evil.example/store/apps/details?id=x',
    'https://play.google.com/redirect?url=https://evil.example',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('replaces %p with this app’s listing', (raw) => {
    expect(playStoreUrl(raw)).toBe(PLAY_STORE_URL);
  });

  it('names this app’s package by default', () => {
    expect(PLAY_STORE_URL).toBe(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`);
  });
});
