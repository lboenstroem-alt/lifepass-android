/**
 * Notification taps (iOS NotificationRouter + MainTabView.consumeNotificationRoute):
 * each route maps to Plan and its action, a route arriving while signed out
 * is dropped (not replayed after sign-in), and a cold-launch tap is taken once.
 */
import * as Notifications from 'expo-notifications';

import { notificationsState, type FakeNotificationRequest } from '@test/mocks/expoNotifications';

import { setAnalyticsObserver, type AnalyticsParams } from '../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../stores/intentStore';
import {
  consumeNotificationRoute,
  destinationFor,
  handleNotificationResponse,
  NOTIFICATION_ROUTES,
  resetNotificationRouterForTests,
  routeFromData,
  startNotificationRouter,
  useNotificationRouter,
} from '../notificationRouter';

function request(identifier: string, data: Record<string, unknown>): FakeNotificationRequest {
  return {
    identifier,
    content: { title: 'x', body: 'y', data },
    trigger: null as never,
  };
}

const opened: AnalyticsParams[] = [];

beforeEach(() => {
  // Launch has not decided who is signed in yet, as at a cold start.
  resetAppStoreForTests();
  resetIntentStoreForTests();
  resetNotificationRouterForTests();
  opened.length = 0;
  setAnalyticsObserver((event, params) => {
    if (event === 'notification_opened') opened.push(params);
  });
});

afterEach(() => setAnalyticsObserver(null));

describe('reading a route', () => {
  it('reads only data.route, and reportId beside it', () => {
    expect(routeFromData({ route: 'plan.feedback', reportId: 'r-9' })).toEqual({ route: 'plan.feedback', reportId: 'r-9' });
    expect(routeFromData({ route: 'plan' })).toEqual({ route: 'plan', reportId: null });
  });

  it('a notification without a known route just opens the app', () => {
    for (const data of [undefined, null, {}, { bookingId: 'b-1' }, { route: 'account' }, { route: 7 }]) {
      expect(routeFromData(data)).toBeNull();
    }
  });
});

describe('where each route goes', () => {
  it('Plan, with the action the route asks for', () => {
    expect(NOTIFICATION_ROUTES.map((route) => [route, destinationFor({ route, reportId: 'r-1' })])).toEqual([
      ['plan', { tab: 'Plan', planAction: null }],
      ['plan.checkin', { tab: 'Plan', planAction: { kind: 'openWeeklyCheckIn' } }],
      ['runner', { tab: 'Plan', planAction: null }],
      ['plan.feedback', { tab: 'Plan', planAction: { kind: 'openFeedback', reportId: 'r-1' } }],
      ['plan.feedback_note', { tab: 'Plan', planAction: { kind: 'openFeedbackNote' } }],
    ]);
  });

  it('a feedback notification with no report opens the current one', () => {
    expect(destinationFor({ route: 'plan.feedback', reportId: null }).planAction).toEqual({
      kind: 'openFeedback',
      reportId: null,
    });
  });

  it('consuming a weekly check-in tap parks Plan and the check-in, once', () => {
    handleNotificationResponse(notificationsState.tap(request('health.weeklycheckin', { route: 'plan.checkin' })) as never);
    expect(consumeNotificationRoute(true)).toEqual({ tab: 'Plan', planAction: { kind: 'openWeeklyCheckIn' } });
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
    expect(useIntentStore.getState().takePlanAction()?.action).toEqual({ kind: 'openWeeklyCheckIn' });
    expect(consumeNotificationRoute(true)).toBeNull();
  });

  it('a route arriving while signed out is dropped, not replayed after sign-in', () => {
    handleNotificationResponse(notificationsState.tap(request('health.workoutday', { route: 'plan' })) as never);
    expect(consumeNotificationRoute(false)).toBeNull();
    expect(useNotificationRouter.getState().pending).toBeNull();
    expect(useIntentStore.getState().pendingTab).toBeNull();
    // Signed in now: nothing left to perform.
    expect(consumeNotificationRoute(true)).toBeNull();
  });

  it('a tap while the app is known to be signed out is dropped at once', () => {
    useAppStore.setState({ isLoading: false, isAuthenticated: false });
    handleNotificationResponse(notificationsState.tap(request('health.workoutday', { route: 'plan' })) as never);
    expect(useNotificationRouter.getState().pending).toBeNull();
  });

  it('a tap parked at a cold start is dropped when launch settles on signed out', async () => {
    const stop = startNotificationRouter();
    handleNotificationResponse(notificationsState.tap(request('health.workoutday', { route: 'plan' })) as never);
    expect(useNotificationRouter.getState().pending).not.toBeNull();
    useAppStore.setState({ isLoading: false, isAuthenticated: false });
    expect(useNotificationRouter.getState().pending).toBeNull();
    stop();
  });

  it('and kept when launch settles on a member', () => {
    const stop = startNotificationRouter();
    handleNotificationResponse(notificationsState.tap(request('health.workoutday', { route: 'plan' })) as never);
    useAppStore.setState({ isLoading: false, isAuthenticated: true });
    expect(useNotificationRouter.getState().pending).toEqual({ route: 'plan', reportId: null });
    stop();
  });

  it('records which kind was opened, never anything of its content', () => {
    handleNotificationResponse(
      notificationsState.tap(request('health.feedback.monthly', { route: 'plan.feedback', reportId: 'r-2' })) as never,
    );
    expect(opened).toEqual([{ kind: 'feedback_monthly' }]);
  });
});

describe('listening', () => {
  it('a cold-launch tap is taken once, and cleared so a relaunch does not replay it', async () => {
    notificationsState.launchFrom(request('health.feedback.note', { route: 'plan.feedback_note' }));
    const stop = startNotificationRouter();
    await new Promise((resolve) => setImmediate(resolve));
    expect(useNotificationRouter.getState().pending).toEqual({ route: 'plan.feedback_note', reportId: null });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
    expect(consumeNotificationRoute(true)?.planAction).toEqual({ kind: 'openFeedbackNote' });
    stop();

    // The next launch finds nothing.
    startNotificationRouter();
    await new Promise((resolve) => setImmediate(resolve));
    expect(useNotificationRouter.getState().pending).toBeNull();
    expect(opened).toHaveLength(1);
  });

  it('a tap while the app runs is parked once, even if the cold-start read reports it too', async () => {
    const stop = startNotificationRouter();
    const response = notificationsState.tap(request('health.workoutday', { route: 'runner' }));
    handleNotificationResponse(response as never);
    expect(useNotificationRouter.getState().pending).toEqual({ route: 'runner', reportId: null });
    expect(opened).toEqual([{ kind: 'resttimer' }]);
    stop();
  });

  it('a class reminder (no route) parks nothing', async () => {
    const stop = startNotificationRouter();
    notificationsState.tap(request('booking-b-1-1h', { bookingId: 'b-1' }));
    expect(useNotificationRouter.getState().pending).toBeNull();
    expect(opened).toEqual([]);
    stop();
  });
});
