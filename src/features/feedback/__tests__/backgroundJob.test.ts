/**
 * The monthly feedback's notifications wired to the app, and the background
 * refresh (iOS FeedbackBackgroundCheckTests, and the scheduleOrCancel rule of
 * `FeedbackBackgroundRefresh`):
 *
 * - the background read: who it reads for, how often, in which language, and
 *   what a refusal does (against the stub server);
 * - the WorkManager task: registered as the app leaves the screen only while
 *   the member could get something from it, cancelled otherwise; a run with
 *   no screen reads for the member the foreground recorded;
 * - the foreground: a read, a switch, a seen report or an activation is
 *   followed by one sync, which records the member and the language for the
 *   background and never "learns" while the app is on screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply } from '@test/server';
import { notificationsState } from '@test/mocks/expoNotifications';
import { AppState } from 'react-native';

import { decodeFeedbackSummary } from '../../../api/feedback';
import { installStubApiClient, stubApiClientPerTest } from '../../../api/testing';
import { runActivationHooks } from '../../../app/signOut';
import { setBackgroundModulesForTests, type BackgroundTaskModule, type TaskManagerModule } from '../../../background/native';
import {
  BACKGROUND_TASK_NAME,
  registeredBackgroundJobIds,
  resetBackgroundJobsForTests,
  runBackgroundJobs,
  syncBackgroundTask,
} from '../../../background/registry';
import { FeedbackKeys } from '../../../health/localKeys';
import { useHealthStore } from '../../../health/store';
import { NOTIFICATION_LANGUAGE_KEY } from '../../../notifications/channels';
import { fixedOffsetCalendar, readMarks } from '../../../notifications/feedbackPlanner';
import { resetFeedbackSyncForTests } from '../../../notifications/feedbackSync';
import { scheduleAt } from '../../../notifications/scheduler';
import { useAppStore } from '../../../stores/appStore';
import {
  FEEDBACK_CHECK_INTERVAL_MS,
  FEEDBACK_REFRESH_JOB_ID,
  FEEDBACK_SYNC_COALESCE_MS,
  canGetFeedbackInBackground,
  feedbackRefreshJobEligible,
  feedbackWorkSettledForTests,
  installFeedbackNotifications,
  resetFeedbackNotificationsForTests,
  runFeedbackBackgroundCheck,
  runFeedbackRefreshJob,
  syncFeedbackNotificationsForApp,
} from '../backgroundJob';
import { notifyFeedbackChanged } from '../changes';
import { useFeedbackStore } from '../feedbackStore';

import { MEMBER, freshApp, memberProfile, signIn, summaryJSON } from './feedbackFixtures';

// Activation runs every feature's register file; @expo/vector-icons loads expo-font, which needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const ICELAND = fixedOffsetCalendar(0);
const MONTHLY = 'health.feedback.monthly.2026-09';

/** Only the clock is faked: promises, storage, msw and timers run for real. */
function clockAt(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

/** Waits past the 300 ms coalescing and lets the sync it starts (or the task registration) finish. */
async function afterCoalescing(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, FEEDBACK_SYNC_COALESCE_MS + 20));
  await feedbackWorkSettledForTests();
}

/** The two native modules as the real ones behave (see src/background/__tests__/registry.test.ts). */
function fakeBackgroundModules() {
  const registered = new Map<string, { minimumInterval?: number }>();
  const backgroundTask: BackgroundTaskModule = {
    registerTaskAsync: jest.fn(async (name: string, options?: { minimumInterval?: number }) => {
      if (!registered.has(name)) registered.set(name, options ?? {});
    }),
    unregisterTaskAsync: jest.fn(async (name: string) => {
      registered.delete(name);
    }),
    BackgroundTaskResult: { Success: 1, Failed: 2 },
  };
  const taskManager: TaskManagerModule = {
    defineTask: jest.fn(),
    isTaskDefined: jest.fn(() => true),
    isTaskRegisteredAsync: jest.fn(async (name: string) => registered.has(name)),
    getTaskOptionsAsync: jest.fn(async (name: string) => registered.get(name) ?? null),
  };
  setBackgroundModulesForTests({ backgroundTask, taskManager });
  return { registered, backgroundTask };
}

/** The AppState listener the install added. */
function appStateListener(): (state: string) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('no AppState listener');
  return call[1] as (state: string) => void;
}

/** Runs `work` while React Native reports the app in `state`. */
async function whileAppIs<T>(state: string, work: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => state });
  try {
    return await work();
  } finally {
    if (original) Object.defineProperty(AppState, 'currentState', original);
    else delete (AppState as { currentState?: string }).currentState;
  }
}

/** The member recorded for the background, in a language. */
async function recordMember(language = 'en'): Promise<void> {
  await AsyncStorage.multiSet([
    [FeedbackKeys.lastProfileId, 'p-1'],
    [NOTIFICATION_LANGUAGE_KEY, language],
  ]);
}

const scheduledIds = () => notificationsState.scheduled().map((request) => request.identifier).sort();

let modules: ReturnType<typeof fakeBackgroundModules>;

beforeEach(() => {
  freshApp();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
  resetFeedbackNotificationsForTests();
  resetBackgroundJobsForTests();
  resetFeedbackSyncForTests();
  modules = fakeBackgroundModules();
  notificationsState.setPermission('granted');
});

afterEach(() => {
  jest.useRealTimers();
  resetFeedbackNotificationsForTests();
  resetBackgroundJobsForTests();
  setBackgroundModulesForTests();
});

describe('the background read (FeedbackBackgroundCheckTests)', () => {
  it('with no member recorded, nothing is read', async () => {
    expect(await runFeedbackBackgroundCheck()).toBe('no-member');
    // A signed-out or ineligible phone reads nothing.
    expect(api.requests).toEqual([]);
    expect(await runFeedbackRefreshJob()).toBe('no-data');
  });

  it("one read in the member's language at most every six hours", async () => {
    await recordMember('is');
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ latest: null, note: null, nextReport: null })));
    const now = new Date();
    expect(await runFeedbackBackgroundCheck({ now })).toBe('read');
    expect(api.requests.map((request) => request.path)).toEqual(['/health/feedback']);
    expect(api.requests[0]?.query.locale).toBe('is');
    expect(await AsyncStorage.getItem(FeedbackKeys.lastCheck('p-1'))).not.toBeNull();

    // Inside six hours: no second read.
    expect(await runFeedbackBackgroundCheck({ now: new Date(now.getTime() + 5 * 3600_000) })).toBe('throttled');
    expect(api.requests).toHaveLength(1);
    expect(await runFeedbackBackgroundCheck({ now: new Date(now.getTime() + FEEDBACK_CHECK_INTERVAL_MS + 1000) })).toBe('read');
    expect(api.requests).toHaveLength(2);
  });

  it('a refusal stops quietly and takes the feedback notifications with it; offline is a failed run', async () => {
    await recordMember();
    const later = new Date(Date.now() + 3600_000);
    await scheduleAt(MONTHLY, later, { title: 't', body: 'b' }, 'health');
    await scheduleAt('health.workoutday.2026-12-01', later, { title: 't', body: 'b' }, 'health');
    api.on('GET', '/health/feedback', Reply.problem(409, 'health_consent_required'));
    // A refusal is an answer: the task is done.
    expect(await runFeedbackBackgroundCheck()).toBe('refused');
    expect(scheduledIds()).toEqual(['health.workoutday.2026-12-01']);
    // A refusal does not count as a read.
    expect(await AsyncStorage.getItem(FeedbackKeys.lastCheck('p-1'))).toBeNull();

    api.reset();
    api.on('GET', '/health/feedback', Reply.fail());
    // Offline is a failed run, tried again at the next slot.
    expect(await runFeedbackBackgroundCheck()).toBe('failed');
    expect(await runFeedbackRefreshJob()).toBe('failed');
  });

  it('signed out, an under-18 refusal and a route that is gone are refusals too', async () => {
    await recordMember();
    api.on('GET', '/health/feedback', Reply.problem(403, 'health_minor_blocked'));
    expect(await runFeedbackBackgroundCheck()).toBe('refused');

    api.reset();
    api.on('GET', '/health/feedback', Reply.raw(404, 'Not Found', 'text/plain'));
    expect(await runFeedbackBackgroundCheck()).toBe('refused');

    api.reset();
    installStubApiClient({ token: null });
    expect(await runFeedbackBackgroundCheck()).toBe('refused');
    expect(api.requests).toEqual([]);
  });

  it('a read that finds an unread report schedules the "ready" notification, in the recorded language', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await recordMember('is');
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ note: null, nextReport: null })));
    expect(await runFeedbackBackgroundCheck({ calendar: ICELAND })).toBe('read');
    const [request] = notificationsState.scheduled();
    expect(request?.identifier).toBe(MONTHLY);
    expect(request?.content.title).toBe('Mánaðaryfirlitið þitt er tilbúið');
    expect(request?.content.data).toEqual({ route: 'plan.feedback', reportId: 'r-1' });
    // The report's own words never reach the notification.
    expect(JSON.stringify(request?.content)).not.toContain('trained');
    expect(readMarks(await AsyncStorage.getItem(FeedbackKeys.notified('p-1'))).has(MONTHLY)).toBe(true);
  });

  it('a sign-out while the read is on the way writes nothing more for the member who left', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await recordMember();
    const outcome = await runFeedbackBackgroundCheck({
      calendar: ICELAND,
      fetchSummary: async () => {
        // The wipe of a sign-out in a live process.
        await AsyncStorage.removeItem(FeedbackKeys.lastProfileId);
        return decodeFeedbackSummary(summaryJSON({ note: null, nextReport: null }), 'feedback');
      },
    });
    expect(outcome).toBe('no-member');
    expect(await AsyncStorage.getItem(FeedbackKeys.lastCheck('p-1'))).toBeNull();
    expect(await AsyncStorage.getItem(FeedbackKeys.notified('p-1'))).toBeNull();
    expect(scheduledIds()).toEqual([]);
  });

  it('a server that no longer advertises the feedback removes every feedback notification', async () => {
    await recordMember();
    await scheduleAt(MONTHLY, new Date(Date.now() + 3600_000), { title: 't', body: 'b' }, 'health');
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ features: [] })));
    expect(await runFeedbackBackgroundCheck()).toBe('read');
    expect(scheduledIds()).toEqual([]);
  });

  it('the background never asks for the permission and schedules nothing before it is answered', async () => {
    clockAt('2026-10-01T10:00:00Z');
    notificationsState.setPermission('undetermined');
    await recordMember();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ note: null, nextReport: null })));
    expect(await runFeedbackBackgroundCheck({ calendar: ICELAND })).toBe('read');
    expect(notificationsState.requestCount()).toBe(0);
    expect(scheduledIds()).toEqual([]);
  });
});

describe('the WorkManager task', () => {
  function serveSummary(settings: Record<string, unknown> = {}) {
    useFeedbackStore.setState({
      summary: decodeFeedbackSummary(
        summaryJSON({
          settings: { monthlyReport: true, midMonthNote: true, includeFoodAndWeight: true, updatedAt: null, ...settings },
        }),
        'feedback',
      ),
    });
  }

  it('is registered as the app leaves the screen while the member could get something from it, every six hours', async () => {
    installFeedbackNotifications();
    signIn();
    serveSummary();
    expect(canGetFeedbackInBackground()).toBe(true);
    appStateListener()('background');
    await afterCoalescing();
    expect(modules.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 360 });
  });

  it('is cancelled as the app leaves the screen when both switches are off', async () => {
    installFeedbackNotifications();
    signIn();
    serveSummary();
    await syncBackgroundTask();
    expect(modules.registered.has(BACKGROUND_TASK_NAME)).toBe(true);
    serveSummary({ monthlyReport: false, midMonthNote: false });
    appStateListener()('background');
    await afterCoalescing();
    expect(modules.registered.has(BACKGROUND_TASK_NAME)).toBe(false);
  });

  it('is not for a member without consent, without the feature, or signed out', () => {
    signIn({ profile: memberProfile({ consent: false }) });
    expect(canGetFeedbackInBackground()).toBe(false);
    signIn({ features: ['plan_revision'] });
    expect(canGetFeedbackInBackground()).toBe(false);
    signIn();
    // No summary read yet: the switches default on, as iOS's FeedbackSettings() does.
    expect(canGetFeedbackInBackground()).toBe(true);
    useAppStore.setState({ isAuthenticated: false, profile: null });
    expect(canGetFeedbackInBackground()).toBe(false);
  });

  it('nothing is decided while launch is still deciding who is signed in', async () => {
    installFeedbackNotifications();
    useAppStore.setState({ isLoading: true });
    appStateListener()('background');
    await afterCoalescing();
    expect(modules.backgroundTask.registerTaskAsync).not.toHaveBeenCalled();
    expect(modules.backgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it('a run with no screen reads for the member the foreground recorded, and for nobody else', async () => {
    installFeedbackNotifications();
    // A process WorkManager started: launch never ran, the store is still loading.
    expect(useAppStore.getState().isLoading).toBe(true);
    expect(await feedbackRefreshJobEligible()).toBe(false);
    expect(await runBackgroundJobs()).toBe('no-data');
    expect(api.requests).toEqual([]);

    await recordMember();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON({ latest: null, note: null, nextReport: null })));
    expect(await feedbackRefreshJobEligible()).toBe(true);
    expect(await runBackgroundJobs()).toBe('new-data');
    expect(api.requests.map((request) => request.path)).toEqual(['/health/feedback']);
  });

  it('a sign-out wipe forgets the member, the marks and the last read, and cancels the task: nothing is read for them again', async () => {
    installFeedbackNotifications();
    signIn();
    serveSummary();
    await syncBackgroundTask();
    expect(modules.registered.has(BACKGROUND_TASK_NAME)).toBe(true);
    await recordMember();
    await AsyncStorage.multiSet([
      [FeedbackKeys.notified('p-1'), '{"health.feedback.monthly.2026-09":"2026-10-01T18:00:00Z"}'],
      [FeedbackKeys.lastCheck('p-1'), '2026-10-01T10:00:00Z'],
    ]);
    await useHealthStore.getState().wipeLocal({ profileId: 'p-1', reason: 'signout' });
    expect(modules.registered.has(BACKGROUND_TASK_NAME)).toBe(false);
    expect(await AsyncStorage.multiGet([FeedbackKeys.lastProfileId, FeedbackKeys.notified('p-1'), FeedbackKeys.lastCheck('p-1')])).toEqual([
      [FeedbackKeys.lastProfileId, null],
      [FeedbackKeys.notified('p-1'), null],
      [FeedbackKeys.lastCheck('p-1'), null],
    ]);
    useAppStore.setState({ isLoading: true });
    expect(await runBackgroundJobs()).toBe('no-data');
    expect(api.requests).toEqual([]);
  });

  it('a run while the app is on screen reads nothing: the foreground does the telling', async () => {
    await recordMember();
    api.on('GET', '/health/feedback', Reply.ok(summaryJSON()));
    expect(await whileAppIs('active', runFeedbackRefreshJob)).toBe('no-data');
    expect(api.requests).toEqual([]);
    expect(await whileAppIs('background', runFeedbackRefreshJob)).toBe('new-data');
  });

  it('the job is registered once, under its id', () => {
    installFeedbackNotifications();
    installFeedbackNotifications();
    expect(registeredBackgroundJobIds()).toEqual([FEEDBACK_REFRESH_JOB_ID]);
  });
});

describe('the foreground', () => {
  it('records the member and the language for the background while eligible, and forgets the member when not', async () => {
    // An Icelandic account: the app speaks the profile's language.
    signIn({ profile: { ...memberProfile(), locale: 'is' } });
    expect(useAppStore.getState().language).toBe('is');
    await syncFeedbackNotificationsForApp(true);
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBe(MEMBER);
    expect(await AsyncStorage.getItem(NOTIFICATION_LANGUAGE_KEY)).toBe('is');

    signIn({ profile: memberProfile({ consent: false }) });
    await syncFeedbackNotificationsForApp(true);
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
  });

  it('a sign-out while the member is being recorded does not leave them recorded', async () => {
    signIn();
    const setItem = jest.mocked(AsyncStorage.setItem);
    const original = setItem.getMockImplementation();
    setItem.mockImplementation(async (key: string, value: string) => {
      await original?.(key, value);
      // The sign-out lands while the write is on the way; its wipe has already run.
      if (key === FeedbackKeys.lastProfileId) useAppStore.setState({ isAuthenticated: false, profile: null });
    });
    try {
      await syncFeedbackNotificationsForApp(true);
    } finally {
      if (original) setItem.mockImplementation(original);
    }
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBeNull();
  });

  it('does nothing without a signed-in member', async () => {
    await AsyncStorage.setItem(FeedbackKeys.lastProfileId, 'someone');
    await syncFeedbackNotificationsForApp(true);
    expect(await AsyncStorage.getItem(FeedbackKeys.lastProfileId)).toBe('someone');
  });

  it('pre-schedules the 1st after a read, but learns nothing while the app is on screen', async () => {
    clockAt('2026-10-15T12:00:00Z');
    signIn();
    useFeedbackStore.setState({
      summary: decodeFeedbackSummary(summaryJSON({ nextReport: { periodMonth: '2026-10', readyOn: '2026-11-01', expected: true } }), 'feedback'),
    });
    await syncFeedbackNotificationsForApp(true, { calendar: ICELAND });
    // The unread September report and the note are the card's to tell; October's report is pre-scheduled.
    expect(scheduledIds()).toEqual(['health.feedback.monthly.2026-10']);
  });

  it('a burst of changes becomes one sync', async () => {
    clockAt('2026-10-15T12:00:00Z');
    installFeedbackNotifications();
    signIn();
    useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(), 'feedback') });
    await afterCoalescing();
    jest.mocked(AsyncStorage.setItem).mockClear();
    notifyFeedbackChanged();
    notifyFeedbackChanged();
    notifyFeedbackChanged();
    await afterCoalescing();
    const markWrites = jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === FeedbackKeys.notified(MEMBER));
    expect(markWrites).toHaveLength(1);
    expect(scheduledIds()).toEqual(['health.feedback.monthly.2026-10']);
  });

  it('consent going away removes every feedback notification', async () => {
    clockAt('2026-10-15T12:00:00Z');
    installFeedbackNotifications();
    signIn();
    useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(), 'feedback') });
    notifyFeedbackChanged();
    await afterCoalescing();
    expect(scheduledIds()).toEqual(['health.feedback.monthly.2026-10']);
    useAppStore.setState({ profile: memberProfile({ consent: false }) });
    await afterCoalescing();
    expect(scheduledIds()).toEqual([]);
  });

  it('the feature flag going away removes every feedback notification', async () => {
    clockAt('2026-10-15T12:00:00Z');
    installFeedbackNotifications();
    signIn();
    useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(), 'feedback') });
    notifyFeedbackChanged();
    await afterCoalescing();
    expect(scheduledIds()).toEqual(['health.feedback.monthly.2026-10']);
    useAppStore.setState({ serverFeatures: ['plan_revision'] });
    await afterCoalescing();
    expect(scheduledIds()).toEqual([]);
  });

  it('every activation syncs, even when the read is inside its ten minutes', async () => {
    clockAt('2026-10-15T12:00:00Z');
    signIn();
    // A fresh summary already in memory: FEED-1's activation read is throttled and announces nothing.
    useFeedbackStore.setState({
      summary: decodeFeedbackSummary(summaryJSON(), 'feedback'),
      lastFetchedAt: new Date(),
      lastFetchedDay: '2026-10-15',
    });
    installFeedbackNotifications();
    await afterCoalescing();
    expect(scheduledIds()).toEqual([]);
    await runActivationHooks({ memberId: MEMBER, trigger: 'foreground' });
    await afterCoalescing();
    expect(scheduledIds()).toEqual(['health.feedback.monthly.2026-10']);
    expect(api.requests.filter((request) => request.path === '/health/feedback')).toEqual([]);
  });
});
