/**
 * The background refresh in a process WorkManager started with no screen:
 * launch never ran, the app store is still "loading", and the one read rides
 * on the Supabase session the phone stored, restored by the app's own API
 * client (refreshed first when it has expired). With no session stored, the
 * read is refused before anything is sent, and the feedback notifications go.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply, supabase as authHost } from '@test/server';
import { notificationsState } from '@test/mocks/expoNotifications';

import { setBackgroundModulesForTests } from '../../../background/native';
import { resetBackgroundJobsForTests, runBackgroundJobs } from '../../../background/registry';
import { FeedbackKeys } from '../../../health/localKeys';
import { NOTIFICATION_LANGUAGE_KEY } from '../../../notifications/channels';
import { scheduleAt } from '../../../notifications/scheduler';
import { useAppStore } from '../../../stores/appStore';
import { MEMBER_A, freshStorePerTest, sessionJSON, settle, storeSession } from '../../../stores/__tests__/storeHarness';
import { installFeedbackNotifications, resetFeedbackNotificationsForTests } from '../backgroundJob';

import { summaryJSON } from './feedbackFixtures';

freshStorePerTest();

beforeEach(async () => {
  resetFeedbackNotificationsForTests();
  resetBackgroundJobsForTests();
  // No native background module in Jest: only the job itself runs here.
  setBackgroundModulesForTests({ backgroundTask: null, taskManager: null });
  installFeedbackNotifications();
  await AsyncStorage.multiSet([
    [FeedbackKeys.lastProfileId, MEMBER_A],
    [NOTIFICATION_LANGUAGE_KEY, 'en'],
  ]);
  api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ latest: null, note: null, nextReport: null })));
});

afterEach(() => {
  resetFeedbackNotificationsForTests();
  resetBackgroundJobsForTests();
  setBackgroundModulesForTests();
});

it('reads with the session the phone stored, without launching the app', async () => {
  await storeSession(MEMBER_A);
  expect(useAppStore.getState().isLoading).toBe(true);
  expect(await runBackgroundJobs()).toBe('new-data');
  const read = api.sent('/health/feedback', 'GET');
  expect(read.headers.authorization).toMatch(/^Bearer ey/);
  expect(read.query.locale).toBe('en');
  // Nothing about the member was loaded into the app.
  expect(useAppStore.getState().isAuthenticated).toBe(false);
  expect(api.requests.map((request) => request.path)).toEqual(['/health/feedback']);
});

it('an expired session is refreshed first, then read with the new token', async () => {
  await storeSession(MEMBER_A, -60);
  const fresh = sessionJSON(MEMBER_A, 7200, 'refresh-2');
  authHost.on('POST', '/auth/v1/token', () => Reply.json(200, fresh));
  expect(await runBackgroundJobs()).toBe('new-data');
  expect(api.sent('/health/feedback', 'GET').headers.authorization).toBe(`Bearer ${fresh.access_token}`);
  await settle();
});

it('with no session stored, nothing is sent and the feedback notifications go', async () => {
  notificationsState.setPermission('granted');
  await scheduleAt('health.feedback.monthly.2026-12', new Date(Date.now() + 3600_000), { title: 't', body: 'b' }, 'health');
  expect(await runBackgroundJobs()).toBe('no-data');
  expect(api.requests).toEqual([]);
  expect(notificationsState.scheduled()).toEqual([]);
});
