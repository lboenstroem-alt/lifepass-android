/**
 * The four Android notification channels, and the language notifications
 * speak.
 *
 * iOS has no channels: a notification there carries its own interruption
 * level (`.active`, or `.timeSensitive` for the rest timer) and thread
 * (`health`). Android files every notification under a channel the member can
 * silence on its own in system settings, and an Android 13+ phone shows no
 * permission dialog until the app has created one. So the app creates all
 * four at startup, before anything can be asked or scheduled:
 *
 * | channel      | what goes there                                         | importance |
 * |--------------|---------------------------------------------------------|------------|
 * | `health`     | workout-day notes, the weekly check-in, feedback        | default    |
 * | `rest_timer` | "Rest is over" (iOS: time sensitive)                    | high       |
 * | `bookings`   | class check-in reminders (T-30, T-10)                   | high       |
 * | `engagement` | the no-purchase ladder, stay active, visits reset       | default    |
 *
 * IMPORTANCE IS FOR EVER. Android lets an app rename a channel but never
 * change its importance once created: only the member can. The values above
 * are therefore part of the release, not a setting.
 *
 * NAMES FOLLOW THE ACCOUNT LANGUAGE (iOS writes notification content in the
 * account language, not the phone's), and are renamed when it changes. The
 * language is also kept under `health.reminders.lastLanguage`, the key iOS
 * keeps it under, for content built where the app store is not running (a
 * background job).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { currentLanguage, normaliseLang, translate, type Lang } from '../i18n';

export type ChannelId = 'health' | 'rest_timer' | 'bookings' | 'engagement';

export interface ChannelSpec {
  readonly id: ChannelId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly importance: Notifications.AndroidImportance;
}

export const NOTIFICATION_CHANNELS: Readonly<Record<ChannelId, ChannelSpec>> = {
  health: {
    id: 'health',
    nameKey: 'notif.channel.health',
    descriptionKey: 'notif.channel.health.description',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  rest_timer: {
    id: 'rest_timer',
    nameKey: 'notif.channel.rest_timer',
    descriptionKey: 'notif.channel.rest_timer.description',
    importance: Notifications.AndroidImportance.HIGH,
  },
  bookings: {
    id: 'bookings',
    nameKey: 'notif.channel.bookings',
    descriptionKey: 'notif.channel.bookings.description',
    importance: Notifications.AndroidImportance.HIGH,
  },
  engagement: {
    id: 'engagement',
    nameKey: 'notif.channel.engagement',
    descriptionKey: 'notif.channel.engagement.description',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
};

export const CHANNEL_IDS: readonly ChannelId[] = ['health', 'rest_timer', 'bookings', 'engagement'];

/** Where the language notifications are written in is kept (the iOS key). */
export const NOTIFICATION_LANGUAGE_KEY = 'health.reminders.lastLanguage';

/** The language the channels were last written in; null until they exist. */
let channelsReadyIn: Lang | null = null;
/** Channel writes run one after another, so two language changes never interleave. */
let queue: Promise<void> = Promise.resolve();

/**
 * Creates the four channels, or renames them into `language` (the account
 * language by default). Safe to call often: it does the work once per
 * language. Never throws: a phone that refuses a channel still runs the app,
 * and the next call tries again.
 */
export function ensureChannels(language: Lang = currentLanguage()): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  queue = queue.then(async () => {
    if (channelsReadyIn === language) return;
    try {
      for (const id of CHANNEL_IDS) {
        const spec = NOTIFICATION_CHANNELS[id];
        await Notifications.setNotificationChannelAsync(spec.id, {
          name: translate(spec.nameKey, language),
          description: translate(spec.descriptionKey, language),
          importance: spec.importance,
        });
      }
      channelsReadyIn = language;
    } catch {
      channelsReadyIn = null;
    }
  });
  return queue;
}

/** Records the account language for notifications built away from the app store. */
export async function rememberNotificationLanguage(language: Lang): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATION_LANGUAGE_KEY, language);
  } catch {
    // The device language is the fallback below.
  }
}

/** The language a notification is written in: the last account language, else the app's. */
export async function notificationLanguage(): Promise<Lang> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFICATION_LANGUAGE_KEY);
    if (stored) return normaliseLang(stored);
  } catch {
    // Fall through.
  }
  return currentLanguage();
}

/** Tests: forget which language the channels were made in. */
export function resetChannelsForTests(): void {
  channelsReadyIn = null;
  queue = Promise.resolve();
}
