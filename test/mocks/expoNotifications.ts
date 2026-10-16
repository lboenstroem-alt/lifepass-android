/**
 * A stateful fake of `expo-notifications` for unit tests.
 *
 * LifePass uses LOCAL notifications only (no push: no FCM, no token ever
 * leaves the phone, as on iOS). Reminders, the rest timer and the monthly
 * feedback notice are all "schedule at a date, cancel by id prefix, route on
 * tap", so tests need to see what is scheduled and to tap it. This fake
 * keeps scheduled and presented notifications, channels, the permission
 * state and the listeners, and exposes `notificationsState` to drive them.
 *
 * The push-token calls throw: the app must never ask for one.
 *
 *   import { notificationsState } from '@test/mocks/expoNotifications';
 *   notificationsState.setPermission('granted');
 *   await scheduleClassReminders(booking);
 *   expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual([...]);
 *   notificationsState.tap('plan.checkin');
 */
import type {
  NotificationChannel,
  NotificationChannelInput,
  NotificationContentInput,
  NotificationRequestInput,
  NotificationTriggerInput,
} from 'expo-notifications';

// The enums are plain JS in the package; reuse them so values never drift.
const channelTypes = jest.requireActual('expo-notifications/build/NotificationChannelManager.types');
const notificationTypes = jest.requireActual('expo-notifications/build/Notifications.types');
const permissionTypes = jest.requireActual('expo-notifications/build/NotificationPermissions.types');

export const AndroidImportance = channelTypes.AndroidImportance;
export const AndroidNotificationVisibility = channelTypes.AndroidNotificationVisibility;
export const AndroidAudioContentType = channelTypes.AndroidAudioContentType;
export const AndroidAudioUsage = channelTypes.AndroidAudioUsage;
export const SchedulableTriggerInputTypes = notificationTypes.SchedulableTriggerInputTypes;
export const AndroidNotificationPriority = notificationTypes.AndroidNotificationPriority;
export const IosAuthorizationStatus = permissionTypes.IosAuthorizationStatus;
export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' } as const;
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

type Status = 'granted' | 'denied' | 'undetermined';

export interface FakeNotificationRequest {
  identifier: string;
  content: NotificationContentInput & { data?: Record<string, unknown> };
  trigger: NotificationTriggerInput;
}

export interface FakeNotification {
  date: number;
  request: FakeNotificationRequest;
}

export interface FakeNotificationResponse {
  notification: FakeNotification;
  actionIdentifier: string;
  userText?: string;
}

type Listener<T> = (event: T) => void;
type Handler = {
  handleNotification: (notification: FakeNotification) => Promise<Record<string, unknown>>;
  handleSuccess?: (id: string) => void;
  handleError?: (id: string, error: Error) => void;
} | null;

const state = {
  scheduled: new Map<string, FakeNotificationRequest>(),
  presented: new Map<string, FakeNotification>(),
  channels: new Map<string, NotificationChannel>(),
  status: 'undetermined' as Status,
  canAskAgain: true,
  /** What the system dialog answers when the app asks. */
  answer: 'granted' as Exclude<Status, 'undetermined'>,
  requestCount: 0,
  handler: null as Handler,
  responseListeners: new Set<Listener<FakeNotificationResponse>>(),
  receivedListeners: new Set<Listener<FakeNotification>>(),
  lastResponse: null as FakeNotificationResponse | null,
  badge: 0,
  nextId: 1,
};

function permissionResponse() {
  return {
    status: state.status,
    granted: state.status === 'granted',
    canAskAgain: state.canAskAgain,
    expires: 'never' as const,
    android: { importance: state.status === 'granted' ? 3 : 0 },
  };
}

export const getPermissionsAsync = jest.fn(async () => permissionResponse());

export const requestPermissionsAsync = jest.fn(async () => {
  state.requestCount += 1;
  if (state.status === 'undetermined' || (state.status === 'denied' && state.canAskAgain)) {
    state.status = state.answer;
    // Android stops showing the dialog after the second refusal.
    if (state.answer === 'denied' && state.requestCount >= 2) state.canAskAgain = false;
  }
  return permissionResponse();
});

export const scheduleNotificationAsync = jest.fn(async (input: NotificationRequestInput) => {
  const identifier = input.identifier ?? `fake-notification-${state.nextId++}`;
  state.scheduled.set(identifier, {
    identifier,
    content: input.content as FakeNotificationRequest['content'],
    trigger: input.trigger ?? null,
  });
  return identifier;
});

export const cancelScheduledNotificationAsync = jest.fn(async (identifier: string) => {
  state.scheduled.delete(identifier);
});

export const cancelAllScheduledNotificationsAsync = jest.fn(async () => {
  state.scheduled.clear();
});

export const getAllScheduledNotificationsAsync = jest.fn(async () => [...state.scheduled.values()]);

export const getNextTriggerDateAsync = jest.fn(async (trigger: NotificationTriggerInput) => {
  const t = trigger as { type?: string; date?: Date | number } | null;
  if (t?.type === 'date' && t.date !== undefined) return new Date(t.date).getTime();
  return null;
});

export const getPresentedNotificationsAsync = jest.fn(async () => [...state.presented.values()]);

export const dismissNotificationAsync = jest.fn(async (identifier: string) => {
  state.presented.delete(identifier);
});

export const dismissAllNotificationsAsync = jest.fn(async () => {
  state.presented.clear();
});

export const setNotificationChannelAsync = jest.fn(async (id: string, input: NotificationChannelInput) => {
  const channel = { id, ...input } as unknown as NotificationChannel;
  state.channels.set(id, channel);
  return channel;
});

export const getNotificationChannelAsync = jest.fn(async (id: string) => state.channels.get(id) ?? null);
export const getNotificationChannelsAsync = jest.fn(async () => [...state.channels.values()]);
export const deleteNotificationChannelAsync = jest.fn(async (id: string) => {
  state.channels.delete(id);
});

export const setNotificationChannelGroupAsync = jest.fn(async (id: string, group: object) => ({ id, ...group }));
export const getNotificationChannelGroupsAsync = jest.fn(async () => []);
export const getNotificationChannelGroupAsync = jest.fn(async () => null);
export const deleteNotificationChannelGroupAsync = jest.fn(async () => undefined);

export const setNotificationCategoryAsync = jest.fn(async (id: string, actions: unknown[]) => ({ identifier: id, actions }));
export const getNotificationCategoriesAsync = jest.fn(async () => []);
export const deleteNotificationCategoryAsync = jest.fn(async () => true);

export const setNotificationHandler = jest.fn((handler: Handler) => {
  state.handler = handler;
});

export const addNotificationResponseReceivedListener = jest.fn((listener: Listener<FakeNotificationResponse>) => {
  state.responseListeners.add(listener);
  return { remove: () => state.responseListeners.delete(listener) };
});

export const addNotificationReceivedListener = jest.fn((listener: Listener<FakeNotification>) => {
  state.receivedListeners.add(listener);
  return { remove: () => state.receivedListeners.delete(listener) };
});

export const addNotificationsDroppedListener = jest.fn(() => ({ remove: () => undefined }));
export const addPushTokenListener = jest.fn(() => ({ remove: () => undefined }));
export const removeNotificationSubscription = jest.fn((subscription: { remove: () => void }) => subscription.remove());

export const getLastNotificationResponseAsync = jest.fn(async () => state.lastResponse);
export const getLastNotificationResponse = jest.fn(() => state.lastResponse);
export const clearLastNotificationResponseAsync = jest.fn(async () => {
  state.lastResponse = null;
});
export const clearLastNotificationResponse = jest.fn(() => {
  state.lastResponse = null;
});
export const useLastNotificationResponse = jest.fn(() => state.lastResponse);

export const getBadgeCountAsync = jest.fn(async () => state.badge);
export const setBadgeCountAsync = jest.fn(async (count: number) => {
  state.badge = count;
  return true;
});

export const registerTaskAsync = jest.fn(async () => undefined);
export const unregisterTaskAsync = jest.fn(async () => undefined);
export const unregisterForNotificationsAsync = jest.fn(async () => undefined);
export const setAutoServerRegistrationEnabledAsync = jest.fn(async () => undefined);

// LifePass sends no push (owner ruling 4, as on iOS). Asking for a token is a bug.
export const getExpoPushTokenAsync = jest.fn(async () => {
  throw new Error('LifePass must not request a push token (local notifications only)');
});
export const getDevicePushTokenAsync = jest.fn(async () => {
  throw new Error('LifePass must not request a push token (local notifications only)');
});

function findRequest(identifierOrRequest: string | FakeNotificationRequest): FakeNotificationRequest {
  if (typeof identifierOrRequest !== 'string') return identifierOrRequest;
  const request = state.scheduled.get(identifierOrRequest) ?? state.presented.get(identifierOrRequest)?.request;
  if (!request) throw new Error(`no scheduled or presented notification "${identifierOrRequest}"`);
  return request;
}

/** Test controls for the fake. Reset after every test by `jest.setup.ts`. */
export const notificationsState = {
  /** Scheduled requests, in the order they were scheduled. */
  scheduled(): FakeNotificationRequest[] {
    return [...state.scheduled.values()];
  },
  presented(): FakeNotification[] {
    return [...state.presented.values()];
  },
  channels(): NotificationChannel[] {
    return [...state.channels.values()];
  },
  /** How many times the app asked for permission. */
  requestCount(): number {
    return state.requestCount;
  },
  /** Sets the current permission (and whether Android would still ask). */
  setPermission(status: Status, canAskAgain = status !== 'denied'): void {
    state.status = status;
    state.canAskAgain = canAskAgain;
  },
  /** What the member answers when the app asks next. */
  answerNextRequestWith(answer: 'granted' | 'denied'): void {
    state.answer = answer;
  },
  /**
   * A scheduled notification fires while the app runs: the foreground
   * handler decides how it shows, and received listeners hear it. Returns
   * the handler's behaviour (`{ shouldShowBanner, ... }`) or null.
   */
  async fire(identifierOrRequest: string | FakeNotificationRequest): Promise<Record<string, unknown> | null> {
    const request = findRequest(identifierOrRequest);
    state.scheduled.delete(request.identifier);
    const notification: FakeNotification = { date: Date.now(), request };
    state.presented.set(request.identifier, notification);
    state.receivedListeners.forEach((listener) => listener(notification));
    if (!state.handler) return null;
    const behaviour = await state.handler.handleNotification(notification);
    state.handler.handleSuccess?.(request.identifier);
    return behaviour;
  },
  /**
   * The member taps a notification (scheduled or presented). Response
   * listeners hear it and it becomes the "last response" a cold start reads.
   */
  tap(identifierOrRequest: string | FakeNotificationRequest, actionIdentifier = DEFAULT_ACTION_IDENTIFIER): FakeNotificationResponse {
    const request = findRequest(identifierOrRequest);
    state.scheduled.delete(request.identifier);
    state.presented.delete(request.identifier);
    const response: FakeNotificationResponse = {
      notification: { date: Date.now(), request },
      actionIdentifier,
    };
    state.lastResponse = response;
    state.responseListeners.forEach((listener) => listener(response));
    return response;
  },
  /** A cold start from a tapped notification: only the last response is set. */
  launchFrom(request: FakeNotificationRequest, actionIdentifier = DEFAULT_ACTION_IDENTIFIER): void {
    state.lastResponse = { notification: { date: Date.now(), request }, actionIdentifier };
  },
  /** The foreground handler the app registered, or null. */
  handler(): Handler {
    return state.handler;
  },
  reset(): void {
    state.scheduled.clear();
    state.presented.clear();
    state.channels.clear();
    state.status = 'undetermined';
    state.canAskAgain = true;
    state.answer = 'granted';
    state.requestCount = 0;
    state.handler = null;
    state.responseListeners.clear();
    state.receivedListeners.clear();
    state.lastResponse = null;
    state.badge = 0;
    state.nextId = 1;
  },
};
