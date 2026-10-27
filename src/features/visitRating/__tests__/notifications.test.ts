/**
 * "How was your visit?" as a local notification (docs/05 "The local
 * notification"): one at `dueAt`, `visit-rating-<id>` with the ask's id in
 * its payload, on the engagement channel, in the account language; never a
 * permission dialog for it; at most one pending; nothing for an ask already
 * due; gone when its ask closes, when it lapses and at sign-out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import type { VisitRatingReservation } from '../../../api/visitRating';
import { reportCheckInFacts } from '../../../checkin/checkInFacts';
import { NOTIFICATION_LANGUAGE_KEY, resetChannelsForTests, scheduleAt } from '../../../notifications';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import {
  cancelAllVisitRatingNotifications,
  cancelVisitRatingNotification,
  removeLapsedVisitRatingNotifications,
  scheduleVisitRatingNotification,
  visitRatingNotificationContent,
  visitRatingNotificationId,
} from '../notifications';

const ID_A = '6f1c2a4e-0000-4000-8000-00000000000a';
const ID_B = '6f1c2a4e-0000-4000-8000-00000000000b';
const VENUE = '3f2b8c1e-0000-4000-8000-0000000000a1';

function reservation(id: string, dueInMinutes = 60, venueName = 'World Class Laugar'): VisitRatingReservation {
  const dueAt = new Date(Date.now() + dueInMinutes * 60_000);
  return { id, venueId: VENUE, venueName, dueAt, expiresAt: new Date(dueAt.getTime() + 3 * 24 * 60 * 60_000) };
}

const scheduledIds = () => notificationsState.scheduled().map((request) => request.identifier);

beforeEach(() => {
  resetChannelsForTests();
  notificationsState.setPermission('granted');
});

describe('scheduling', () => {
  it('one notification at dueAt, with the ask id and the route, on the engagement channel', async () => {
    const ask = reservation(ID_A);
    await expect(scheduleVisitRatingNotification(ask)).resolves.toBe(true);
    const [request] = notificationsState.scheduled();
    expect(request.identifier).toBe(`visit-rating-${ID_A}`);
    expect(request.content.title).toBe('How was your visit?');
    expect(request.content.body).toBe('Tap to rate it — World Class Laugar');
    expect(request.content.data).toEqual({ route: 'visit.rating', promptId: ID_A, expiresAt: ask.expiresAt.toISOString() });
    expect(request.trigger).toEqual({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: ask.dueAt,
      channelId: 'engagement',
    });
  });

  it('in the account language, the venue name never inflected', async () => {
    await AsyncStorage.setItem(NOTIFICATION_LANGUAGE_KEY, 'is');
    await scheduleVisitRatingNotification(reservation(ID_A, 60, 'Hress'));
    const [request] = notificationsState.scheduled();
    expect(request.content.title).toBe('Hvernig var heimsóknin?');
    expect(request.content.body).toBe('Ýttu hér til að gefa einkunn — Hress');
    expect(visitRatingNotificationContent('Salur 4', 'en').body).toBe('Tap to rate it — Salur 4');
  });

  it('keeps at most one pending: a newer ask replaces an older one', async () => {
    await scheduleVisitRatingNotification(reservation(ID_A));
    await scheduleAt('engagement.stayactive', new Date(Date.now() + 86_400_000), { title: 't', body: 'b' }, 'engagement');
    await scheduleVisitRatingNotification(reservation(ID_B, 90));
    expect(scheduledIds().sort()).toEqual(['engagement.stayactive', `visit-rating-${ID_B}`]);
    // The same ask again (a replay) is the same one notification.
    await scheduleVisitRatingNotification(reservation(ID_B, 90));
    expect(scheduledIds().filter((id) => id.startsWith('visit-rating-'))).toEqual([`visit-rating-${ID_B}`]);
  });

  it('never asks for the permission, and schedules nothing without it', async () => {
    for (const permission of ['undetermined', 'denied'] as const) {
      notificationsState.setPermission(permission);
      await expect(scheduleVisitRatingNotification(reservation(ID_A))).resolves.toBe(false);
    }
    expect(notificationsState.requestCount()).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(scheduledIds()).toEqual([]);
  });

  it('an ask already due schedules nothing (the Home card covers it)', async () => {
    await expect(scheduleVisitRatingNotification(reservation(ID_A, -5))).resolves.toBe(false);
    expect(scheduledIds()).toEqual([]);
  });

  it('never throws when the system refuses', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('no'));
    await expect(scheduleVisitRatingNotification(reservation(ID_A))).resolves.toBe(false);
  });
});

describe('cancelling', () => {
  it('its ask closed: that one goes, pending and from the shade; nothing else does', async () => {
    await scheduleVisitRatingNotification(reservation(ID_A));
    await notificationsState.fire(visitRatingNotificationId(ID_A));
    await scheduleVisitRatingNotification(reservation(ID_B));
    await scheduleAt('health.weeklycheckin', new Date(Date.now() + 3_600_000), { title: 't', body: 'b' }, 'health');
    await cancelVisitRatingNotification(ID_A);
    expect(notificationsState.presented()).toEqual([]);
    expect(scheduledIds().sort()).toEqual(['health.weeklycheckin', `visit-rating-${ID_B}`]);
    await cancelVisitRatingNotification(ID_B.toUpperCase());
    expect(scheduledIds()).toEqual(['health.weeklycheckin']);
  });

  it('sign-out: every visit rating notification goes, whatever the permission', async () => {
    await scheduleVisitRatingNotification(reservation(ID_A));
    await notificationsState.fire(visitRatingNotificationId(ID_A));
    await scheduleVisitRatingNotification(reservation(ID_B));
    notificationsState.setPermission('denied');
    await cancelAllVisitRatingNotifications();
    expect(scheduledIds()).toEqual([]);
    expect(notificationsState.presented()).toEqual([]);
  });

  it('a lapsed ask leaves the shade (and the schedule); a live one stays', async () => {
    await scheduleVisitRatingNotification(reservation(ID_A));
    await notificationsState.fire(visitRatingNotificationId(ID_A));
    await scheduleVisitRatingNotification(reservation(ID_B, 120));
    const [shown] = notificationsState.presented();
    const expiresAt = new Date(String(shown.request.content.data?.expiresAt));

    await removeLapsedVisitRatingNotifications(new Date(expiresAt.getTime() - 1));
    expect(notificationsState.presented()).toHaveLength(1);

    await removeLapsedVisitRatingNotifications(new Date(expiresAt.getTime() + 1));
    expect(notificationsState.presented()).toEqual([]);
    expect(scheduledIds()).toEqual([`visit-rating-${ID_B}`]);
  });
});

describe('a check-in that reserved an ask (register.ts)', () => {
  beforeAll(() => {
    // The feature's hooks, as the app loads them at startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../register');
  });

  beforeEach(() => resetAppStoreForTests());

  it('schedules its notification for a signed-in member', async () => {
    useAppStore.setState({ isAuthenticated: true, isLoading: false });
    reportCheckInFacts({ ratingPrompt: reservation(ID_A), lifetimeCheckIns: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(scheduledIds()).toEqual([`visit-rating-${ID_A}`]);
  });

  it('nothing without an ask, and nothing once signed out', async () => {
    useAppStore.setState({ isAuthenticated: true, isLoading: false });
    reportCheckInFacts({ ratingPrompt: null, lifetimeCheckIns: 3 });
    useAppStore.setState({ isAuthenticated: false });
    reportCheckInFacts({ ratingPrompt: reservation(ID_A), lifetimeCheckIns: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(scheduledIds()).toEqual([]);
  });
});
