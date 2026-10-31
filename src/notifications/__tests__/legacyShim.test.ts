/**
 * The first build's notification module, now a shim: the launch-time ask is
 * gone (App.tsx still calls it until F4 rewrites the shell), and the legacy
 * booking screen's reminders are iOS's two class rungs.
 */
import { notificationsState } from '@test/mocks/expoNotifications';

import { translate } from '../../i18n';
import {
  cancelClassReminders,
  classReminderIdentifiers,
  requestNotificationPermission,
  scheduleBookingReminders,
} from '../../services/notifications';

it('the launch call never asks, whatever the member has answered', async () => {
  await expect(requestNotificationPermission()).resolves.toBe(false);
  expect(notificationsState.requestCount()).toBe(0);
  notificationsState.setPermission('granted');
  await expect(requestNotificationPermission()).resolves.toBe(true);
  expect(notificationsState.requestCount()).toBe(0);
});

it('the foreground handler is installed by importing it, and shows nothing', async () => {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../services/notifications');
  });
  const handler = notificationsState.handler();
  expect(handler).not.toBeNull();
  const behaviour = await handler!.handleNotification({} as never);
  expect(behaviour).toEqual(expect.objectContaining({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false }));
});

it('a booking asks in context, then schedules the T-30 and T-10 rungs keyed by the start', async () => {
  const startsAt = new Date(Date.now() + 3 * 60 * 60_000);
  await scheduleBookingReminders({ bookingId: 'b1', venueName: 'Laugar', activityName: 'Spin', bookingTime: startsAt });
  expect(notificationsState.requestCount()).toBe(1);
  const ids = classReminderIdentifiers(startsAt);
  const scheduled = notificationsState.scheduled();
  expect(scheduled.map((n) => n.identifier)).toEqual([ids.t30, ids.t10]);
  expect(scheduled[0].content.title).toBe(translate('booking.reminder.title', 'en'));
  expect(scheduled[0].content.body).toBe(translate('booking.reminder.body', 'en', { class: 'Spin' }));
  expect(scheduled[1].trigger).toEqual(expect.objectContaining({ channelId: 'bookings' }));

  await cancelClassReminders(startsAt);
  expect(notificationsState.scheduled()).toEqual([]);
});

it('a rung less than a minute away is skipped, and a refusal schedules nothing', async () => {
  notificationsState.setPermission('granted');
  const soon = new Date(Date.now() + 20 * 60_000);
  await scheduleBookingReminders({ activityName: null, bookingTime: soon });
  expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual([classReminderIdentifiers(soon).t10]);
  expect(notificationsState.scheduled()[0].content.body).toBe(
    translate('booking.reminder10.body', 'en', { class: translate('booking.reminder.fallback_class', 'en') }),
  );

  notificationsState.reset();
  notificationsState.setPermission('denied', false);
  await scheduleBookingReminders({ activityName: 'Spin', bookingTime: new Date(Date.now() + 3 * 60 * 60_000) });
  expect(notificationsState.scheduled()).toEqual([]);
});
