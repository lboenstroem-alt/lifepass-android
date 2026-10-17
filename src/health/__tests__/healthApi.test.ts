/**
 * The health API wrappers: the port of iOS HealthNetworkTests (health
 * traffic never lands in a cache, a cancellation is not an outage, a problem
 * slug matches in either spelling, a gate refusal's `memberPricing`), the
 * consent half of ProfileHealthBlockDecodeTests (the route answers flat), and
 * what each wrapper SENDS, checked against the contract.
 */
import { api, Reply } from '@test/server';

import {
  apiClient,
  isCancellation,
  isOffline,
  isProblem,
  ProblemError,
  TransportError,
} from '../../api';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../../api/testing';
import { useAppStore } from '../../stores/appStore';
import {
  addMeasurement,
  decodeConsentResult,
  fetchHealthDay,
  fetchMeasurements,
  fetchSessionHistory,
  grantedConsent,
  HEALTH_READ_TIMEOUT_MS,
  HEALTH_SESSION_TIMEOUT_MS,
  localeQuery,
  postSessionAction,
  SessionAction,
  setHealthConsent,
} from '../api';

stubApiClientPerTest();

describe('the Today read (OP-06)', () => {
  it('asks in the account language, never caches, and names a date only for another day', async () => {
    api.on('GET', '/health', replyFromContract('GET', '/health', 200, 'full'));
    const day = await fetchHealthDay({ language: 'is' });
    expect(day.date).toEqual(expect.any(String));
    const sent = expectSentToMatchContract('GET', '/health');
    expect(sent.query).toEqual({ locale: 'is' });
    expect(sent.headers['cache-control']).toBe('no-store');

    await fetchHealthDay({ date: '2026-09-20', language: 'en' });
    expect(api.sent('/health').query).toEqual({ locale: 'en', date: '2026-09-20' });
  });

  it('a Today read waits 20 seconds, every other health call the session ceiling of 30', async () => {
    expect(HEALTH_READ_TIMEOUT_MS).toBe(20_000);
    expect(HEALTH_SESSION_TIMEOUT_MS).toBe(30_000);
    const get = jest.spyOn(apiClient, 'get');
    api.on('GET', '/health', replyFromContract('GET', '/health', 200, 'minimal'));
    await fetchHealthDay({ language: 'en' });
    expect(get.mock.calls[0][2]?.timeoutMs).toBe(20_000);
    api.on('GET', '/health/sessions', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 20 } }));
    await fetchSessionHistory({ language: 'en' });
    expect(get.mock.calls[1][2]?.timeoutMs).toBe(30_000);
    get.mockRestore();
  });

  it('any language that is not Icelandic asks in English', () => {
    expect(localeQuery('is')).toEqual({ locale: 'is' });
    expect(localeQuery('en')).toEqual({ locale: 'en' });
    expect(localeQuery('de')).toEqual({ locale: 'en' });
  });
});

describe('errors a health screen meets (iOS HealthNetworkTests)', () => {
  it('a cancelled call is a member walking away, never the offline banner', async () => {
    api.on('GET', '/health', Reply.hang());
    const controller = new AbortController();
    const pending = fetchHealthDay({ language: 'en', signal: controller.signal }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const cancelled = await pending;
    expect(isCancellation(cancelled)).toBe(true);
    expect(isOffline(cancelled)).toBe(false);

    const offline = new TransportError('offline');
    expect(isCancellation(offline)).toBe(false);
    expect(isOffline(offline)).toBe(true);
  });

  it('a problem slug matches in either spelling', async () => {
    api.on('GET', '/health', Reply.problem(429, 'meal-scan-daily-limit'));
    const error = await fetchHealthDay({ language: 'en' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemError);
    expect(isProblem(error, 'meal_scan_daily_limit')).toBe(true);
    expect(isProblem(error, 'meal-scan-daily-limit')).toBe(true);
    expect(isProblem(error, 'meal_scan_paused')).toBe(false);
  });

  it("a gate refusal's memberPricing is read, and corrects the access signal", async () => {
    api.on(
      'GET',
      '/health',
      Reply.problem(403, 'no_active_plan_or_pass', { memberPricing: 'company_covered', title: 'Not entitled' }),
    );
    const error = (await fetchHealthDay({ language: 'en' }).catch((e: unknown) => e)) as ProblemError;
    expect(error.details.memberPricing).toBe('company_covered');
    useAppStore.getState().applyHealthAccessOverride(error.details.memberPricing);
    expect(useAppStore.getState().healthAccessOverride).toBe('company_inactive');
    useAppStore.getState().clearHealthAccessOverride();
  });
});

describe('the consent route (OP-02, OP-03)', () => {
  it('the flat grant answer is the consent', () => {
    const result = decodeConsentResult({
      optedIn: true,
      version: '2026-09-v1',
      consentedAt: '2026-09-16T10:00:00Z',
      ageSource: 'attestation',
    });
    const consent = grantedConsent(result)!;
    expect(consent.version).toBe('2026-09-v1');
    expect(consent.ageSource).toBe('attestation');
    expect(consent.consentedAt).toEqual(new Date('2026-09-16T10:00:00Z'));
  });

  it('the withdrawal answer is no consent, and the counts', () => {
    const result = decodeConsentResult({
      optedIn: false,
      version: '2026-09-v1',
      consentedAt: null,
      ageSource: null,
      deleted: { bodyMeasurements: 24, mealLogs: 3 },
    });
    expect(grantedConsent(result)).toBeNull();
    expect(result.deleted?.bodyMeasurements).toBe(24);
  });

  it('an unreadable grant date is not an error', () => {
    const result = decodeConsentResult({
      optedIn: true,
      version: '2026-09-v1',
      consentedAt: 'the sixteenth',
      ageSource: 'kennitala',
    });
    expect(grantedConsent(result)).not.toBeNull();
    expect(grantedConsent(result)!.consentedAt).toBeNull();
  });

  it('a nested consent wins over the flat fields', () => {
    const result = decodeConsentResult({ consent: { version: 'v-nested', consentedAt: null, ageSource: null }, optedIn: true, version: 'v-flat' });
    expect(grantedConsent(result)!.version).toBe('v-nested');
  });

  it('sends the grant with its key, and ageAttested only when given', async () => {
    api.on('POST', '/profile/health-consent', replyFromContract('POST', '/profile/health-consent', 200, 'full'));
    await setHealthConsent({ optedIn: true, version: '2026-09-v1', source: 'coach_intake' }, 'consent-key-0001');
    let sent = expectSentToMatchContract('POST', '/profile/health-consent');
    expect(sent.headers['idempotency-key']).toBe('consent-key-0001');
    expect(sent.body).toEqual({ optedIn: true, version: '2026-09-v1', source: 'coach_intake' });

    await setHealthConsent({ optedIn: true, version: '2026-09-v3', source: 'account', ageAttested: true }, 'consent-key-0002');
    sent = expectSentToMatchContract('POST', '/profile/health-consent');
    expect(sent.body).toEqual({ optedIn: true, version: '2026-09-v3', source: 'account', ageAttested: true });
  });
});

describe('session actions (OP-17 to OP-22)', () => {
  it('a done without a known feeling sends no feeling; a skip always has its reason', () => {
    expect(SessionAction.done({ minutes: 40, feeling: 'unknown' })).toEqual({ action: 'done', minutes: 40 });
    expect(SessionAction.done({ minutes: null, feeling: 'too_hard' })).toEqual({ action: 'done', feeling: 'too_hard' });
    expect(SessionAction.skip('tired')).toEqual({ action: 'skip', skipReason: 'tired' });
    expect(SessionAction.swap('a', 'b')).toEqual({ action: 'swap', exerciseId: 'a', toExerciseId: 'b', scope: 'future' });
    expect(SessionAction.removeExtra('x1')).toEqual({ action: 'remove_extra', extraId: 'x1' });
  });

  it('an extra is always an extra, an unknown kind is "other", and a blank note is not sent', () => {
    expect(SessionAction.logExtra({ kind: 'unknown', minutes: 30, note: '   ' })).toEqual({
      action: 'done',
      minutes: 30,
      asExtra: true,
      kind: 'other',
    });
    const noon = new Date('2026-09-22T12:00:00Z');
    expect(SessionAction.logExtra({ kind: 'class', minutes: 45, note: '  Spin with Anna ', clientCompletedAt: noon })).toEqual({
      action: 'done',
      minutes: 45,
      clientCompletedAt: noon,
      asExtra: true,
      kind: 'class',
      note: 'Spin with Anna',
    });
  });

  it('posts to the session with the caller key and decodes the answer', async () => {
    api.on('POST', '/health/sessions/:sessionId', replyFromContract('POST', '/health/sessions/{sessionId}', 200, 'full'));
    const answer = await postSessionAction('5b0c3f1e-7a2d-4c8e-9f10-2a3b4c5d6e7f', SessionAction.done({ minutes: 40 }), 'session-key-0001');
    expect(answer).toEqual(expect.objectContaining({ replayed: expect.anything() }));
    const sent = expectSentToMatchContract('POST', '/health/sessions/5b0c3f1e-7a2d-4c8e-9f10-2a3b4c5d6e7f');
    expect(sent.headers['idempotency-key']).toBe('session-key-0001');
    expect(sent.body).toEqual({ action: 'done', minutes: 40 });
  });
});

describe('measurements and pages', () => {
  it('a weigh-in sends exactly what the route takes', async () => {
    api.on('POST', '/health/measurements', replyFromContract('POST', '/health/measurements', 201, 'full'));
    await addMeasurement({ weightKg: 72.5, source: 'self_reported' }, 'measure-key-01');
    const sent = expectSentToMatchContract('POST', '/health/measurements');
    expect(sent.body).toEqual({ weightKg: 72.5, source: 'self_reported' });
  });

  it('a page reads its rows and its cursor', async () => {
    api.on('GET', '/health/measurements', replyFromContract('GET', '/health/measurements', 200, 'full'));
    const page = await fetchMeasurements({ cursor: 'abc' });
    expect(Array.isArray(page.data)).toBe(true);
    expect(typeof page.hasMore).toBe('boolean');
    const sent = expectSentToMatchContract('GET', '/health/measurements');
    expect(sent.query).toEqual({ limit: '20', cursor: 'abc' });
  });
});
