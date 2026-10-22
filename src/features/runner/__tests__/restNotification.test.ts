/**
 * `health.resttimer` (iOS RunnerRestAlarm, NOTIFICATIONS.md 19.1): one
 * notification at the rest's end, on the rest-timer channel, only when the
 * member already allows notifications (the runner never asks), no numbers in
 * it, a tap to the Plan tab; removed from the queue and the shade alike.
 */
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import { destinationFor, routeFromData } from '../../../app/notificationRouter';
import { removeAllHealthNotifications } from '../../../notifications';
import {
  cancelRestNotification,
  REST_NOTIFICATION_ID,
  resetRestNotificationQueueForTests,
  scheduleRestNotification,
} from '../restNotification';

function inSeconds(seconds: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + seconds * 1000);
}

beforeEach(() => {
  resetRestNotificationQueueForTests();
  notificationsState.setPermission('granted');
});

it('schedules "Rest is over" at the rest end, on the rest-timer channel, routed to the runner', async () => {
  const now = new Date();
  const endsAt = inSeconds(90, now);
  await expect(scheduleRestNotification(endsAt, 'en', now)).resolves.toBe(true);
  const [request] = notificationsState.scheduled();
  expect(notificationsState.scheduled()).toHaveLength(1);
  expect(request!.identifier).toBe(REST_NOTIFICATION_ID);
  expect(request!.content).toEqual({ title: 'Rest is over', body: 'Time for your next set.', data: { route: 'runner' } });
  expect(request!.trigger).toEqual({ type: 'date', date: endsAt, channelId: 'rest_timer' });
  // A tap goes to the Plan tab (the runner, or its Resume row).
  expect(destinationFor(routeFromData(request!.content.data)!)).toEqual({ tab: 'Plan', planAction: null });
});

it('speaks the account language', async () => {
  await scheduleRestNotification(inSeconds(60), 'is');
  expect(notificationsState.scheduled()[0]!.content).toMatchObject({
    title: 'Hvíldinni er lokið',
    body: 'Komið að næsta setti.',
  });
});

it('never asks for permission, and is silently not there without it', async () => {
  for (const status of ['undetermined', 'denied'] as const) {
    notificationsState.setPermission(status);
    await expect(scheduleRestNotification(inSeconds(90), 'en')).resolves.toBe(false);
  }
  expect(notificationsState.scheduled()).toEqual([]);
  expect(notificationsState.requestCount()).toBe(0);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

it('is not scheduled for a rest ending within half a second', async () => {
  const now = new Date();
  await expect(scheduleRestNotification(inSeconds(0.5, now), 'en', now)).resolves.toBe(false);
  await expect(scheduleRestNotification(inSeconds(-3, now), 'en', now)).resolves.toBe(false);
  await expect(scheduleRestNotification(inSeconds(0.6, now), 'en', now)).resolves.toBe(true);
});

it('a second schedule replaces the first', async () => {
  await scheduleRestNotification(inSeconds(60), 'en');
  const later = inSeconds(75);
  await scheduleRestNotification(later, 'en');
  expect(notificationsState.scheduled().map((request) => (request.trigger as { date: Date }).date)).toEqual([later]);
});

it('cancel removes it from the queue and from the shade', async () => {
  await scheduleRestNotification(inSeconds(60), 'en');
  await cancelRestNotification();
  expect(notificationsState.scheduled()).toEqual([]);

  await scheduleRestNotification(inSeconds(60), 'en');
  await notificationsState.fire(REST_NOTIFICATION_ID);
  expect(notificationsState.presented()).toHaveLength(1);
  await cancelRestNotification();
  expect(notificationsState.presented()).toEqual([]);
});

it('a cancel asked for right after a schedule runs after it (the app back within a second)', async () => {
  const scheduled = scheduleRestNotification(inSeconds(60), 'en');
  const cancelled = cancelRestNotification();
  await Promise.all([scheduled, cancelled]);
  expect(notificationsState.scheduled()).toEqual([]);
});

it('leaves every other notification alone', async () => {
  await Notifications.scheduleNotificationAsync({
    identifier: 'class-checkin-reminder-1',
    content: { title: 'x', body: 'y' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: inSeconds(600) },
  });
  await scheduleRestNotification(inSeconds(60), 'en');
  await cancelRestNotification();
  expect(notificationsState.scheduled().map((request) => request.identifier)).toEqual(['class-checkin-reminder-1']);
});

it('is one of the health notifications the local wipe removes', async () => {
  await scheduleRestNotification(inSeconds(60), 'en');
  await removeAllHealthNotifications();
  expect(notificationsState.scheduled()).toEqual([]);
});
