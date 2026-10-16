/**
 * The native fakes behave like the modules they replace, and every test
 * starts from a clean device (seeded by the previous test? never).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';

import { notificationsState } from '@test/mocks/expoNotifications';
import { secureStoreState } from '@test/mocks/expoSecureStore';

describe('SecureStore (in-memory Keystore behind the real JS checks)', () => {
  it('round-trips values, async and sync, and deletes them', async () => {
    await SecureStore.setItemAsync('lp.installation_id', 'abc');
    expect(await SecureStore.getItemAsync('lp.installation_id')).toBe('abc');
    SecureStore.setItem('lp.hmac_key', 'k');
    expect(SecureStore.getItem('lp.hmac_key')).toBe('k');
    expect(secureStoreState.keys()).toEqual(['lp.hmac_key', 'lp.installation_id']);
    await SecureStore.deleteItemAsync('lp.installation_id');
    expect(await SecureStore.getItemAsync('lp.installation_id')).toBeNull();
  });

  it('keeps a session larger than 2 KB intact (the LargeSecureStore key holds less)', async () => {
    const big = 'x'.repeat(4096);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await SecureStore.setItemAsync('session', big);
    warn.mockRestore();
    expect(await SecureStore.getItemAsync('session')).toBe(big);
  });

  it('refuses keys and values the device would refuse', async () => {
    await expect(SecureStore.setItemAsync('supabase:session', 'v')).rejects.toThrow(/Invalid key/);
    await expect(SecureStore.setItemAsync('ok', 42 as unknown as string)).rejects.toThrow(/Invalid value/);
  });

  it('separates keychain services', async () => {
    await SecureStore.setItemAsync('k', 'a', { keychainService: 'one' });
    await SecureStore.setItemAsync('k', 'b', { keychainService: 'two' });
    expect(await SecureStore.getItemAsync('k', { keychainService: 'one' })).toBe('a');
    expect(await SecureStore.getItemAsync('k')).toBeNull();
  });

  it('starts every test empty', () => {
    expect(secureStoreState.size()).toBe(0);
  });
});

describe('AsyncStorage', () => {
  it('stores values within a test', async () => {
    await AsyncStorage.setItem('account.language', 'is');
    expect(await AsyncStorage.getItem('account.language')).toBe('is');
  });

  it('is cleared between tests', async () => {
    expect(await AsyncStorage.getItem('account.language')).toBeNull();
  });
});

describe('expo-notifications (local only)', () => {
  it('asks once and remembers the answer', async () => {
    expect((await Notifications.getPermissionsAsync()).status).toBe('undetermined');
    notificationsState.answerNextRequestWith('denied');
    expect((await Notifications.requestPermissionsAsync()).granted).toBe(false);
    expect(notificationsState.requestCount()).toBe(1);
    expect((await Notifications.getPermissionsAsync()).status).toBe('denied');
  });

  it('schedules, lists, cancels and fires through the foreground handler', async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    const at = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      identifier: 'booking.reminder.abc.t10',
      content: { title: 'Yoga', body: 'In 10 minutes', data: { route: 'library' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'bookings' },
    });
    const later = await Notifications.scheduleNotificationAsync({
      content: { title: 'x' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 90 },
    });
    expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual(['booking.reminder.abc.t10', later]);
    await Notifications.cancelScheduledNotificationAsync(later);
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(1);

    const behaviour = await notificationsState.fire('booking.reminder.abc.t10');
    expect(behaviour).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
    expect(await Notifications.getPresentedNotificationsAsync()).toHaveLength(1);

    // A null trigger shows at once.
    await Notifications.scheduleNotificationAsync({ identifier: 'now', content: { title: 'y' }, trigger: null });
    expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual([]);
    expect(notificationsState.presented().map((n) => n.request.identifier)).toEqual(['booking.reminder.abc.t10', 'now']);
  });

  it('delivers a tap to listeners and to a cold start', async () => {
    const heard: string[] = [];
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      heard.push(String(r.notification.request.content.data?.route));
    });
    await Notifications.scheduleNotificationAsync({
      identifier: 'plan.checkin',
      content: { title: 'Check-in', data: { route: 'plan.checkin' } },
      trigger: null,
    });
    notificationsState.tap('plan.checkin');
    expect(heard).toEqual(['plan.checkin']);
    expect((await Notifications.getLastNotificationResponseAsync())?.actionIdentifier).toBe(
      Notifications.DEFAULT_ACTION_IDENTIFIER,
    );
    sub.remove();
  });

  it('drops a one-off date already in the past, as Android does (and returns the id)', async () => {
    const future = { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + 60_000 } as const;
    const past = { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() - 1000) } as const;
    await Notifications.scheduleNotificationAsync({ identifier: 'class.reminder.1', content: { title: 'x' }, trigger: future });
    // Rescheduling the same id into the past removes the earlier request too.
    expect(
      await Notifications.scheduleNotificationAsync({ identifier: 'class.reminder.1', content: { title: 'x' }, trigger: past }),
    ).toBe('class.reminder.1');
    expect(await Notifications.scheduleNotificationAsync({ identifier: 'late', content: { title: 'y' }, trigger: past })).toBe(
      'late',
    );
    expect(await Notifications.getAllScheduledNotificationsAsync()).toEqual([]);
    expect(notificationsState.presented()).toEqual([]);
  });

  it('shows a channel-only trigger at once, as Android does', async () => {
    await Notifications.scheduleNotificationAsync({
      identifier: 'rest.over',
      content: { title: 'x' },
      trigger: { channelId: 'rest_timer' },
    });
    expect(notificationsState.scheduled()).toEqual([]);
    expect(notificationsState.presented().map((n) => n.request.identifier)).toEqual(['rest.over']);
  });

  it('refuses a missing or shapeless trigger, as the SDK does', async () => {
    await expect(
      Notifications.scheduleNotificationAsync({
        content: { title: 'x' },
        trigger: undefined as unknown as Notifications.NotificationTriggerInput,
      }),
    ).rejects.toThrow(/explicit `null`/);
    await expect(
      Notifications.scheduleNotificationAsync({
        content: { title: 'x' },
        trigger: { seconds: 5 } as unknown as Notifications.NotificationTriggerInput,
      }),
    ).rejects.toThrow(/`type` or `channelId`/);
  });

  it('lets a test make a call fail ...', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValue(new Error('alarm manager unavailable'));
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true });
    await expect(
      Notifications.scheduleNotificationAsync({ content: { title: 'x' }, trigger: null }),
    ).rejects.toThrow(/alarm manager/);
  });

  it('... and the next test gets the fake back', async () => {
    expect((await Notifications.getPermissionsAsync()).status).toBe('undetermined');
    await expect(
      Notifications.scheduleNotificationAsync({ identifier: 'ok', content: { title: 'x' }, trigger: null }),
    ).resolves.toBe('ok');
  });

  it('keeps channels with their importance', async () => {
    await Notifications.setNotificationChannelAsync('rest_timer', {
      name: 'Rest timer',
      importance: Notifications.AndroidImportance.HIGH,
    });
    expect(notificationsState.channels()).toEqual([
      expect.objectContaining({ id: 'rest_timer', importance: Notifications.AndroidImportance.HIGH }),
    ]);
  });

  it('refuses to hand out a push token (LifePass sends no push)', async () => {
    await expect(Notifications.getExpoPushTokenAsync()).rejects.toThrow(/push token/);
    await expect(Notifications.getDevicePushTokenAsync()).rejects.toThrow(/push token/);
  });

  it('starts every test clean', async () => {
    expect(notificationsState.scheduled()).toEqual([]);
    expect((await Notifications.getPermissionsAsync()).status).toBe('undetermined');
    expect(notificationsState.handler()).toBeNull();
  });
});

describe('useLastNotificationResponse (SDK 54, three-way)', () => {
  const request = {
    identifier: 'plan.checkin',
    content: { title: 'Check-in', data: { route: 'plan.checkin' } },
    trigger: null,
  };

  it('is undefined until it knows, then null when nothing was tapped', async () => {
    const seen: unknown[] = [];
    const { result } = await renderHook(() => {
      const response = Notifications.useLastNotificationResponse();
      seen.push(response);
      return response;
    });
    expect(seen[0]).toBeUndefined();
    expect(result.current).toBeNull();
  });

  it('answers a cold start from a tapped notification with the response', async () => {
    notificationsState.launchFrom(request);
    const { result } = await renderHook(() => Notifications.useLastNotificationResponse());
    expect(result.current?.notification.request.identifier).toBe('plan.checkin');
  });

  it('can be held at "not known yet", then follows taps and clears', async () => {
    notificationsState.holdLastResponse();
    const { result } = await renderHook(() => Notifications.useLastNotificationResponse());
    expect(result.current).toBeUndefined();
    await act(async () => notificationsState.holdLastResponse(false));
    expect(result.current).toBeNull();
    await Notifications.scheduleNotificationAsync(request);
    await act(async () => {
      notificationsState.tap('plan.checkin');
    });
    expect(result.current?.notification.request.identifier).toBe('plan.checkin');
    await act(async () => Notifications.clearLastNotificationResponseAsync());
    expect(result.current).toBeNull();
  });
});

describe('other native modules load in tests', () => {
  it('NetInfo reports a connection', async () => {
    const state = await NetInfo.fetch();
    expect(state.isConnected).toBe(true);
  });

  it('Reanimated, gesture handler, bottom sheet and Mapbox import', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    expect(require('react-native-reanimated').default).toBeDefined();
    expect(require('react-native-gesture-handler').GestureHandlerRootView).toBeDefined();
    expect(require('@gorhom/bottom-sheet').BottomSheetModal).toBeDefined();
    const Mapbox = require('@rnmapbox/maps').default;
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(typeof Mapbox.setAccessToken).toBe('function');
    expect(typeof Mapbox.setTelemetryEnabled).toBe('function');
  });
});
