/**
 * The class check-in reminders (iOS ClassReminderService): two rungs at T-30
 * and T-10 keyed on the start, a rung under a minute away skipped, written in
 * the account language, asked for in context, removed by start.
 */
import { notificationsState } from '@test/mocks/expoNotifications';

import { lookup } from '../../../i18n';
import {
  cancelCheckInReminder,
  checkInReminderIdentifiers,
  checkInReminderPlan,
  scheduleCheckInReminder,
} from '../classReminders';

const START = new Date('2030-03-14T10:00:00Z');
const EPOCH = Math.floor(START.getTime() / 1000);
const minutesBefore = (minutes: number) => new Date(START.getTime() - minutes * 60_000);

beforeEach(() => notificationsState.reset());

it('the identifiers are keyed on the start instant', () => {
  expect(checkInReminderIdentifiers(START)).toEqual({
    t30: `class-checkin-reminder-${EPOCH}`,
    t10: `class-checkin-reminder10-${EPOCH}`,
  });
});

it('two rungs, T-30 and T-10, on the bookings channel, in the account language', async () => {
  notificationsState.setPermission('granted');
  await scheduleCheckInReminder({ className: 'Yoga Flow', startsAt: START, language: 'is' }, minutesBefore(120));
  const scheduled = notificationsState.scheduled();
  expect(scheduled.map((n) => n.identifier)).toEqual([`class-checkin-reminder-${EPOCH}`, `class-checkin-reminder10-${EPOCH}`]);
  expect(scheduled[0].content.title).toBe(lookup('booking.reminder.title', 'is'));
  expect(scheduled[0].content.body).toBe(lookup('booking.reminder.body', 'is').replace('{class}', 'Yoga Flow'));
  expect(scheduled[1].content.title).toBe(lookup('booking.reminder10.title', 'is'));
  expect(scheduled[1].content.body).toBe(lookup('booking.reminder10.body', 'is').replace('{class}', 'Yoga Flow'));
  expect(scheduled[0].trigger).toMatchObject({ date: minutesBefore(30), channelId: 'bookings' });
  expect(scheduled[1].trigger).toMatchObject({ date: minutesBefore(10), channelId: 'bookings' });
  // No route: a tap simply opens the app.
  expect(scheduled[0].content.data).toEqual({});
});

it('a rung under a minute away is skipped; a class starting in five minutes gets none', () => {
  const plan = (now: Date) => checkInReminderPlan({ className: null, startsAt: START, language: 'en' }, now);
  expect(plan(new Date(minutesBefore(30).getTime() - 61_000)).map((r) => r.id)).toHaveLength(2);
  expect(plan(new Date(minutesBefore(30).getTime() - 59_000)).map((r) => r.id)).toEqual([`class-checkin-reminder10-${EPOCH}`]);
  expect(plan(minutesBefore(5))).toEqual([]);
});

it('without a name the class is "Your class" / "Tíminn þinn"', () => {
  for (const language of ['en', 'is'] as const) {
    const [first] = checkInReminderPlan({ className: '  ', startsAt: START, language }, minutesBefore(120));
    expect(first.body).toBe(lookup('booking.reminder.body', language).replace('{class}', lookup('booking.reminder.fallback_class', language)));
  }
  expect(lookup('booking.reminder.fallback_class', 'is')).toBe('Tíminn þinn');
});

it('the permission is asked on the first booking; a refusal is silent and schedules nothing', async () => {
  notificationsState.answerNextRequestWith('denied');
  await expect(scheduleCheckInReminder({ className: 'Spin', startsAt: START, language: 'en' }, minutesBefore(120))).resolves.toBeUndefined();
  expect(notificationsState.requestCount()).toBe(1);
  expect(notificationsState.scheduled()).toEqual([]);

  // Never asked twice: the answer stands.
  await scheduleCheckInReminder({ className: 'Spin', startsAt: START, language: 'en' }, minutesBefore(120));
  expect(notificationsState.requestCount()).toBe(1);
});

it('booking the same start again replaces the rungs; cancelling by start removes both', async () => {
  notificationsState.setPermission('granted');
  await scheduleCheckInReminder({ className: 'Spin', startsAt: START, language: 'en' }, minutesBefore(120));
  await scheduleCheckInReminder({ className: 'Spin', startsAt: START, language: 'en' }, minutesBefore(120));
  const other = new Date(START.getTime() + 86_400_000);
  await scheduleCheckInReminder({ className: 'Spin', startsAt: other, language: 'en' }, minutesBefore(120));
  expect(notificationsState.scheduled()).toHaveLength(4);

  await cancelCheckInReminder(START);
  expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual(Object.values(checkInReminderIdentifiers(other)));
});

it('the copy has no emoji and the Icelandic body keeps its placeholder', () => {
  for (const key of ['booking.reminder.title', 'booking.reminder.body', 'booking.reminder10.title', 'booking.reminder10.body']) {
    for (const language of ['en', 'is'] as const) {
      expect(lookup(key, language)).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  }
  expect(lookup('booking.reminder.body', 'is')).toContain('{class}');
});
