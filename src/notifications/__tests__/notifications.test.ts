/**
 * The local notification foundation (iOS AppDelegate, HealthReminderService's
 * helpers, NOTIFICATIONS.md): nothing shows while the app is open, nothing is
 * asked before the member does something a notification would serve, four
 * channels named in the account language, and identifier families found and
 * removed by prefix.
 */
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsState } from '@test/mocks/expoNotifications';
import { Linking } from 'react-native';

import {
  CHANNEL_IDS,
  ensureChannels,
  FOREGROUND_BEHAVIOUR,
  HEALTH_NOTIFICATION_PREFIX,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LANGUAGE_KEY,
  notificationLanguage,
  openNotificationSettings,
  pendingIdentifiers,
  permissionFrom,
  permissionStatus,
  rememberNotificationLanguage,
  removeAllHealthNotifications,
  removeDelivered,
  removePending,
  requestIfUndetermined,
  resetChannelsForTests,
  resetForegroundHandlerForTests,
  scheduleAt,
  startNotifications,
} from '..';
import { translate } from '../../i18n';

const later = (minutes = 60) => new Date(Date.now() + minutes * 60_000);
const content = { title: 'Weekly check-in', body: 'How did your week go?' };

beforeEach(() => {
  resetChannelsForTests();
  resetForegroundHandlerForTests();
});

describe('the foreground', () => {
  it('shows nothing while the app is open: no banner, no list entry, no sound', async () => {
    await startNotifications();
    await scheduleAt('health.weeklycheckin', later(), content, 'health');
    const behaviour = await notificationsState.fire('health.weeklycheckin');
    expect(behaviour).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
    expect(FOREGROUND_BEHAVIOUR.shouldShowBanner).toBe(false);
  });

  it('starting up asks for nothing', async () => {
    await startNotifications();
    expect(notificationsState.requestCount()).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the channels', () => {
  it('makes all four, named in the account language, with fixed importance', async () => {
    await ensureChannels('is');
    const channels = notificationsState.channels();
    expect(channels.map((c) => c.id).sort()).toEqual([...CHANNEL_IDS].sort());
    const restTimer = channels.find((c) => c.id === 'rest_timer')!;
    expect(restTimer.name).toBe(translate('notif.channel.rest_timer', 'is'));
    expect(restTimer.importance).toBe(Notifications.AndroidImportance.HIGH);
    expect(channels.find((c) => c.id === 'health')!.importance).toBe(Notifications.AndroidImportance.DEFAULT);
    expect(NOTIFICATION_CHANNELS.bookings.importance).toBe(Notifications.AndroidImportance.HIGH);
    expect(NOTIFICATION_CHANNELS.engagement.importance).toBe(Notifications.AndroidImportance.DEFAULT);
  });

  it('renames them when the language changes, and does the work once per language', async () => {
    await ensureChannels('en');
    await ensureChannels('en');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(4);
    await ensureChannels('is');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(8);
    expect(notificationsState.channels().find((c) => c.id === 'health')!.name).toBe(translate('notif.channel.health', 'is'));
  });

  it('a phone that refuses a channel still runs the app, and the next call tries again', async () => {
    jest.mocked(Notifications.setNotificationChannelAsync).mockRejectedValueOnce(new Error('refused'));
    await expect(ensureChannels('en')).resolves.toBeUndefined();
    await ensureChannels('en');
    expect(notificationsState.channels()).toHaveLength(4);
  });

  it('keeps the language notifications are written in', async () => {
    await rememberNotificationLanguage('is');
    expect(await AsyncStorage.getItem(NOTIFICATION_LANGUAGE_KEY)).toBe('is');
    expect(await notificationLanguage()).toBe('is');
  });
});

describe('scheduling and removing by identifier', () => {
  it('schedules at a date on its channel, and never in the past', async () => {
    await expect(scheduleAt('health.workoutday.2026-10-18', later(), content, 'health')).resolves.toBe(true);
    const [request] = notificationsState.scheduled();
    expect(request.identifier).toBe('health.workoutday.2026-10-18');
    expect(request.trigger).toEqual(expect.objectContaining({ type: 'date', channelId: 'health' }));
    expect(request.content).toEqual(expect.objectContaining({ title: content.title, body: content.body }));
    await expect(scheduleAt('health.resttimer', new Date(Date.now() - 1000), content, 'rest_timer')).resolves.toBe(false);
    expect(notificationsState.scheduled()).toHaveLength(1);
  });

  it('a failure to schedule is a notification not sent, never a thrown error', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('alarm limit'));
    await expect(scheduleAt('health.resttimer', later(), content, 'rest_timer')).resolves.toBe(false);
  });

  it('removes pending and delivered by prefix or by test, and nothing else', async () => {
    await scheduleAt('health.workoutday.2026-10-18', later(), content, 'health');
    await scheduleAt('health.workoutday.2026-10-19', later(2000), content, 'health');
    await scheduleAt('health.weeklycheckin', later(), content, 'health');
    await scheduleAt('booking.reminder.t30', later(), content, 'bookings');
    expect(await pendingIdentifiers('health.workoutday.')).toHaveLength(2);

    await removePending((id) => id === 'health.weeklycheckin');
    expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual([
      'health.workoutday.2026-10-18',
      'health.workoutday.2026-10-19',
      'booking.reminder.t30',
    ]);

    await notificationsState.fire('health.workoutday.2026-10-18');
    await notificationsState.fire('booking.reminder.t30');
    await removeDelivered('health.');
    expect(notificationsState.presented().map((n) => n.request.identifier)).toEqual(['booking.reminder.t30']);
  });

  it('the wipe removes every health.* notification, pending and delivered', async () => {
    expect(HEALTH_NOTIFICATION_PREFIX).toBe('health.');
    await scheduleAt('health.resttimer', later(), content, 'rest_timer');
    await scheduleAt('health.feedback.monthly.2026-11', later(), content, 'health');
    await scheduleAt('health.workoutday.2026-10-18', later(), content, 'health');
    await scheduleAt('engagement.stayactive', later(), content, 'engagement');
    await notificationsState.fire('health.workoutday.2026-10-18');
    await removeAllHealthNotifications();
    expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual(['engagement.stayactive']);
    expect(notificationsState.presented()).toEqual([]);
  });
});

describe('the permission, asked only in context', () => {
  it('reads three states; a refusal that could be asked again is still a refusal', () => {
    expect(permissionFrom({ status: 'granted', granted: true, canAskAgain: true })).toBe('granted');
    expect(permissionFrom({ status: 'undetermined', granted: false, canAskAgain: true })).toBe('undetermined');
    expect(permissionFrom({ status: 'undetermined', granted: false, canAskAgain: false })).toBe('denied');
    expect(permissionFrom({ status: 'denied', granted: false, canAskAgain: true })).toBe('denied');
    expect(permissionFrom({ status: 'denied', granted: false, canAskAgain: false })).toBe('denied');
  });

  it('asks only when never answered, after making the channels', async () => {
    expect(await permissionStatus()).toBe('undetermined');
    notificationsState.answerNextRequestWith('granted');
    await expect(requestIfUndetermined()).resolves.toBe(true);
    expect(notificationsState.requestCount()).toBe(1);
    expect(notificationsState.channels()).toHaveLength(4);
    await expect(requestIfUndetermined()).resolves.toBe(true);
    expect(notificationsState.requestCount()).toBe(1);
  });

  it('never asks again after a refusal, so the permission is never burnt', async () => {
    notificationsState.answerNextRequestWith('denied');
    await expect(requestIfUndetermined()).resolves.toBe(false);
    await expect(requestIfUndetermined()).resolves.toBe(false);
    expect(notificationsState.requestCount()).toBe(1);
    expect(await permissionStatus()).toBe('denied');
  });

  it("opens the app's notification settings, or the app's settings", async () => {
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await openNotificationSettings();
    expect(sendIntent).toHaveBeenCalledWith('android.settings.APP_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'is.lifepass.android' },
    ]);
    expect(openSettings).not.toHaveBeenCalled();
    sendIntent.mockRejectedValueOnce(new Error('no activity'));
    await openNotificationSettings();
    expect(openSettings).toHaveBeenCalledTimes(1);
    sendIntent.mockRestore();
    openSettings.mockRestore();
  });
});
