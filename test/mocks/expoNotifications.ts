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
 *
 * Scheduling follows Android (a past one-off date is dropped, a channel-only
 * trigger shows at once), `useLastNotificationResponse` is three-way like the
 * SDK 54 hook (undefined, null, a response), and every function is a jest.fn
 * whose own behaviour comes back after each test.
 */
import type {
  NotificationChannel,
  NotificationChannelInput,
  NotificationContentInput,
  NotificationRequestInput,
  NotificationTriggerInput,
} from 'expo-notifications';
import { useLayoutEffect, useState } from 'react';

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
  /** While true, `useLastNotificationResponse` has not heard back yet (undefined). */
  lastResponseHeld: false,
  lastResponseSubscribers: new Set<() => void>(),
  badge: 0,
  nextId: 1,
};

/**
 * Every exported function is a jest.fn so a test can spy on it or make it
 * fail (`scheduleNotificationAsync.mockRejectedValueOnce(...)`). `reset()`
 * puts the fake's own behaviour back after each test: `clearMocks` only
 * clears the calls, so an override would otherwise outlive its test.
 */
type AnyFunction = (...args: any[]) => any;
const defaults = new Map<jest.Mock, AnyFunction>();
function fake<T extends AnyFunction>(implementation: T): jest.Mock<ReturnType<T>, Parameters<T>> {
  const fn = jest.fn<ReturnType<T>, Parameters<T>>(implementation);
  defaults.set(fn, implementation);
  return fn;
}

function notifyLastResponse(): void {
  state.lastResponseSubscribers.forEach((update) => update());
}

function permissionResponse() {
  return {
    status: state.status,
    granted: state.status === 'granted',
    canAskAgain: state.canAskAgain,
    expires: 'never' as const,
    android: { importance: state.status === 'granted' ? 3 : 0 },
  };
}

export const getPermissionsAsync = fake(async () => permissionResponse());

export const requestPermissionsAsync = fake(async () => {
  state.requestCount += 1;
  if (state.status === 'undetermined' || (state.status === 'denied' && state.canAskAgain)) {
    state.status = state.answer;
    // Android stops showing the dialog after the second refusal.
    if (state.answer === 'denied' && state.requestCount >= 2) state.canAskAgain = false;
  }
  return permissionResponse();
});

/**
 * The moment a schedulable trigger fires next, as expo-notifications 0.32 on
 * Android computes it: `null` for a one-off date already in the past.
 * Repeating triggers (daily, weekly, calendar, ...) always have a next date.
 */
function nextTriggerTime(trigger: Record<string, unknown>): number | null {
  if (trigger.type === 'date') {
    const date = trigger.date as Date | number | string;
    const at = date instanceof Date ? date.getTime() : new Date(date).getTime();
    return at < Date.now() ? null : at;
  }
  if (trigger.type === 'timeInterval') return Date.now() + Number(trigger.seconds) * 1000;
  return Number.POSITIVE_INFINITY;
}

/**
 * Keeps the request as the app passed it (the trigger is the INPUT shape, not
 * the native one), and files it the way Android does
 * (ExpoSchedulingDelegate.scheduleNotification):
 *
 *   - a `null` trigger, or one that names only a channel (`{ channelId }`),
 *     shows the notification at once: it goes straight to the presented list;
 *   - a one-off date before now never fires: Android drops the request (and
 *     any earlier one with the same identifier) and still returns the
 *     identifier, so it never shows up in getAllScheduledNotificationsAsync;
 *   - anything else is scheduled, replacing a request with the same identifier.
 *
 * A missing (`undefined`) or shapeless trigger throws, as the SDK does.
 */
export const scheduleNotificationAsync = fake(async (input: NotificationRequestInput) => {
  const trigger = input.trigger as unknown;
  if (trigger === undefined) {
    throw new TypeError(
      'Encountered an `undefined` notification trigger. If you want to trigger the notification immediately, pass in an explicit `null` value.',
    );
  }
  if (trigger !== null && (typeof trigger !== 'object' || !('type' in trigger || 'channelId' in trigger))) {
    throw new TypeError('The `trigger` object you provided is invalid. It needs to contain a `type` or `channelId` entry.');
  }
  const identifier = input.identifier ?? `fake-notification-${state.nextId++}`;
  const request: FakeNotificationRequest = {
    identifier,
    content: input.content as FakeNotificationRequest['content'],
    trigger: input.trigger,
  };
  const triggerObject = trigger as Record<string, unknown> | null;
  if (triggerObject === null || !('type' in triggerObject)) {
    state.presented.set(identifier, { date: Date.now(), request });
  } else if (nextTriggerTime(triggerObject) === null) {
    state.scheduled.delete(identifier);
  } else {
    state.scheduled.set(identifier, request);
  }
  return identifier;
});

export const cancelScheduledNotificationAsync = fake(async (identifier: string) => {
  state.scheduled.delete(identifier);
});

export const cancelAllScheduledNotificationsAsync = fake(async () => {
  state.scheduled.clear();
});

export const getAllScheduledNotificationsAsync = fake(async () => [...state.scheduled.values()]);

export const getNextTriggerDateAsync = fake(async (trigger: NotificationTriggerInput) => {
  const t = trigger as { type?: string; date?: Date | number } | null;
  if (t?.type === 'date' && t.date !== undefined) return new Date(t.date).getTime();
  return null;
});

export const getPresentedNotificationsAsync = fake(async () => [...state.presented.values()]);

export const dismissNotificationAsync = fake(async (identifier: string) => {
  state.presented.delete(identifier);
});

export const dismissAllNotificationsAsync = fake(async () => {
  state.presented.clear();
});

export const setNotificationChannelAsync = fake(async (id: string, input: NotificationChannelInput) => {
  const channel = { id, ...input } as unknown as NotificationChannel;
  state.channels.set(id, channel);
  return channel;
});

export const getNotificationChannelAsync = fake(async (id: string) => state.channels.get(id) ?? null);
export const getNotificationChannelsAsync = fake(async () => [...state.channels.values()]);
export const deleteNotificationChannelAsync = fake(async (id: string) => {
  state.channels.delete(id);
});

export const setNotificationChannelGroupAsync = fake(async (id: string, group: object) => ({ id, ...group }));
export const getNotificationChannelGroupsAsync = fake(async () => []);
export const getNotificationChannelGroupAsync = fake(async () => null);
export const deleteNotificationChannelGroupAsync = fake(async () => undefined);

export const setNotificationCategoryAsync = fake(async (id: string, actions: unknown[]) => ({ identifier: id, actions }));
export const getNotificationCategoriesAsync = fake(async () => []);
export const deleteNotificationCategoryAsync = fake(async () => true);

export const setNotificationHandler = fake((handler: Handler) => {
  state.handler = handler;
});

export const addNotificationResponseReceivedListener = fake((listener: Listener<FakeNotificationResponse>) => {
  state.responseListeners.add(listener);
  return { remove: () => state.responseListeners.delete(listener) };
});

export const addNotificationReceivedListener = fake((listener: Listener<FakeNotification>) => {
  state.receivedListeners.add(listener);
  return { remove: () => state.receivedListeners.delete(listener) };
});

export const addNotificationsDroppedListener = fake(() => ({ remove: () => undefined }));
export const addPushTokenListener = fake(() => ({ remove: () => undefined }));
export const removeNotificationSubscription = fake((subscription: { remove: () => void }) => subscription.remove());

export const getLastNotificationResponseAsync = fake(async () => state.lastResponse);
export const getLastNotificationResponse = fake(() => state.lastResponse);
export const clearLastNotificationResponseAsync = fake(async () => {
  state.lastResponse = null;
  notifyLastResponse();
});
export const clearLastNotificationResponse = fake(() => {
  state.lastResponse = null;
  notifyLastResponse();
});

/** The SDK's rule: a new identifier replaces the last response, the same one keeps it. */
function nextResponse(
  previous: FakeNotificationResponse | null | undefined,
  next: FakeNotificationResponse | null,
): FakeNotificationResponse | null {
  if (!next) return null;
  if (!previous) return next;
  return previous.notification.request.identifier !== next.notification.request.identifier ? next : previous;
}

/**
 * The SDK 54 hook, three-way: `undefined` until it knows (the first render,
 * or while `notificationsState.holdLastResponse()` is in force), then `null`
 * when no notification was tapped, or the response. A tap while mounted
 * updates it; clearing the last response sets it back to null.
 */
export const useLastNotificationResponse = fake((): FakeNotificationResponse | null | undefined => {
  const [response, setResponse] = useState<FakeNotificationResponse | null | undefined>(undefined);
  useLayoutEffect(() => {
    const update = () =>
      setResponse((previous) => (state.lastResponseHeld ? undefined : nextResponse(previous, state.lastResponse)));
    update();
    state.lastResponseSubscribers.add(update);
    return () => {
      state.lastResponseSubscribers.delete(update);
    };
  }, []);
  return response;
});

export const getBadgeCountAsync = fake(async () => state.badge);
export const setBadgeCountAsync = fake(async (count: number) => {
  state.badge = count;
  return true;
});

export const registerTaskAsync = fake(async () => undefined);
export const unregisterTaskAsync = fake(async () => undefined);
export const unregisterForNotificationsAsync = fake(async () => undefined);
export const setAutoServerRegistrationEnabledAsync = fake(async () => undefined);

// LifePass sends no push (owner ruling 4, as on iOS). Asking for a token is a bug.
export const getExpoPushTokenAsync = fake(async () => {
  throw new Error('LifePass must not request a push token (local notifications only)');
});
export const getDevicePushTokenAsync = fake(async () => {
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
    notifyLastResponse();
    return response;
  },
  /** A cold start from a tapped notification: only the last response is set. */
  launchFrom(request: FakeNotificationRequest, actionIdentifier = DEFAULT_ACTION_IDENTIFIER): void {
    state.lastResponse = { notification: { date: Date.now(), request }, actionIdentifier };
    notifyLastResponse();
  },
  /**
   * Holds `useLastNotificationResponse` at `undefined` ("not known yet"), so
   * a test can see what a screen does before the answer; `false` lets it
   * answer (null or the last response).
   */
  holdLastResponse(held = true): void {
    state.lastResponseHeld = held;
    notifyLastResponse();
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
    state.lastResponseHeld = false;
    state.lastResponseSubscribers.clear();
    state.badge = 0;
    state.nextId = 1;
    // Back to the fake's own behaviour: drops a test's mockImplementation,
    // mockReturnValue or mockRejectedValue, and any queued *Once values.
    defaults.forEach((implementation, fn) => {
      fn.mockReset();
      fn.mockImplementation(implementation);
    });
  },
};
