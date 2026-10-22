/**
 * The feedback notification sync against the notification fake: the pending
 * set ends up equal to the planner's, on the `health` channel, in the
 * member's language, with the fire dates kept as marks; denied removes
 * everything, not determined touches nothing; the shade is tidied after a
 * read (iOS `FeedbackNotificationService.sync`).
 *
 * Only the clock is faked (the fake drops a one-off date before "now", as
 * Android does), so the iOS vectors keep their dates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notificationsState } from '@test/mocks/expoNotifications';

import {
  decodeFeedbackNote,
  decodeFeedbackReportSummary,
  feedbackSettings,
  feedbackSummary,
  type FeedbackSummary,
} from '../../api/feedback';
import { routeFromData } from '../../app/notificationRouter';
import { FeedbackKeys } from '../../health/localKeys';
import { translate } from '../../i18n';
import { fixedOffsetCalendar, readMarks, writeMarks } from '../feedbackPlanner';
import {
  FEEDBACK_CHANNEL,
  removeAllFeedbackNotifications,
  resetFeedbackSyncForTests,
  syncFeedbackNotifications,
  type FeedbackSyncInput,
} from '../feedbackSync';
import { scheduleAt } from '../scheduler';

const ICELAND = fixedOffsetCalendar(0);
const MONTHLY = 'health.feedback.monthly.2026-09';
const OCTOBER = 'health.feedback.monthly.2026-10';
const NOTE = 'health.feedback.note.2026-10';

const at = (iso: string) => new Date(iso);

/** Only the clock is faked: promises, storage and the fake's timers run for real. */
function clockAt(iso: string): void {
  jest.useFakeTimers({
    now: at(iso),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

function latest(options: { seen?: boolean; month?: string } = {}) {
  const month = options.month ?? '2026-09';
  return decodeFeedbackReportSummary(
    {
      id: `r-${month}`,
      kind: 'monthly',
      periodMonth: month,
      title: 'September 2026',
      createdAt: '2026-10-01T06:12:00Z',
      seenAt: options.seen ? '2026-10-01T19:00:00Z' : null,
      current: true,
      highlights: ['You trained 11 times.'],
    },
    'latest',
  );
}

function note(options: { seen?: boolean } = {}) {
  return decodeFeedbackNote(
    {
      id: 'n-2026-10',
      periodMonth: '2026-10',
      createdAt: '2026-10-12T06:11:00Z',
      seenAt: options.seen ? '2026-10-12T19:00:00Z' : null,
      expiresOn: '2026-10-22',
      title: 'A note for you',
      message: { key: 'note.sleep_short', text: 'Your nights have been short.', action: null },
    },
    'note',
  );
}

function summary(values: Partial<FeedbackSummary> = {}): FeedbackSummary {
  return feedbackSummary({ settings: feedbackSettings({ includeFoodAndWeight: true }), ...values });
}

function input(values: Partial<FeedbackSyncInput> = {}): FeedbackSyncInput {
  return {
    summary: summary({ latest: latest() }),
    eligible: true,
    profileId: 'p-1',
    language: 'en',
    appActive: false,
    calendar: ICELAND,
    ...values,
  };
}

async function storedMarks(): Promise<Map<string, Date>> {
  return readMarks(await AsyncStorage.getItem(FeedbackKeys.notified('p-1')));
}

const scheduledIds = () => notificationsState.scheduled().map((request) => request.identifier).sort();
const presentedIds = () => notificationsState.presented().map((notification) => notification.request.identifier).sort();

/** A notification that is on screen already (delivered), as the fake shows one. */
async function deliver(identifier: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({ identifier, content: { title: 't', body: 'b' }, trigger: null });
}

beforeEach(() => {
  resetFeedbackSyncForTests();
  notificationsState.setPermission('granted');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('scheduling', () => {
  it('a report learned in the background is scheduled for 18:00 on the health channel, and its fire date is kept', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    const [request] = notificationsState.scheduled();
    expect(request?.identifier).toBe(MONTHLY);
    expect(request?.trigger).toMatchObject({ type: 'date', channelId: FEEDBACK_CHANNEL });
    expect(new Date((request?.trigger as { date: Date }).date)).toEqual(at('2026-10-01T18:00:00Z'));
    expect(request?.content.title).toBe(translate('notif.feedback.monthly.title', 'en'));
    expect(request?.content.body).toBe(translate('notif.feedback.monthly.body', 'en'));
    // A tap opens the report it names.
    expect(routeFromData(request?.content.data)).toEqual({ route: 'plan.feedback', reportId: 'r-2026-09' });
    expect(await AsyncStorage.getItem(FeedbackKeys.notified('p-1'))).toBe(`{"${MONTHLY}":"2026-10-01T18:00:00Z"}`);
  });

  it('is idempotent: a second sync keeps the one request and schedules nothing new', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await syncFeedbackNotifications(input());
    await syncFeedbackNotifications(input({ appActive: true }));
    expect(scheduledIds()).toEqual([MONTHLY]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('writes in the language it is handed', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input({ language: 'is' }));
    const [request] = notificationsState.scheduled();
    expect(request?.content.title).toBe('Mánaðaryfirlitið þitt er tilbúið');
    expect(request?.content.body).toBe(translate('notif.feedback.monthly.body', 'is'));
  });

  it('the pre-scheduled one for the 1st, from the foreground, carries the month', async () => {
    clockAt('2026-10-15T12:00:00Z');
    const nextReport = { periodMonth: '2026-10', readyOn: '2026-11-01', expected: true };
    await syncFeedbackNotifications(input({ summary: summary({ latest: latest({ seen: true }), nextReport }), appActive: true }));
    const [request] = notificationsState.scheduled();
    expect(request?.identifier).toBe(OCTOBER);
    expect(request?.content.data).toEqual({ route: 'plan.feedback', periodMonth: '2026-10' });
    expect(routeFromData(request?.content.data)).toEqual({ route: 'plan.feedback', reportId: null });
  });

  it('several syncs at once never schedule twice', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await Promise.all([syncFeedbackNotifications(input()), syncFeedbackNotifications(input()), syncFeedbackNotifications(input())]);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduledIds()).toEqual([MONTHLY]);
  });

  it('a request the phone refuses gets no mark', async () => {
    clockAt('2026-10-01T10:00:00Z');
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error('refused'));
    await syncFeedbackNotifications(input());
    expect(scheduledIds()).toEqual([]);
    expect((await storedMarks()).size).toBe(0);
  });
});

describe('removing', () => {
  it('a report opened elsewhere takes its pending one away, and the mark of a notice never shown goes with it', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    expect(scheduledIds()).toEqual([MONTHLY]);
    await syncFeedbackNotifications(input({ summary: summary({ latest: latest({ seen: true }) }) }));
    expect(scheduledIds()).toEqual([]);
    expect((await storedMarks()).has(MONTHLY)).toBe(false);
  });

  it('a mark whose time has passed stays: that one was told', async () => {
    clockAt('2026-10-02T09:00:00Z');
    await AsyncStorage.setItem(FeedbackKeys.notified('p-1'), writeMarks(new Map([[MONTHLY, at('2026-10-01T18:00:00Z')]])));
    await syncFeedbackNotifications(input());
    // Not scheduled again ...
    expect(scheduledIds()).toEqual([]);
    // ... and still remembered.
    expect((await storedMarks()).get(MONTHLY)).toEqual(at('2026-10-01T18:00:00Z'));
  });

  it('denied removes every feedback notification, pending and delivered, and nothing else', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    await deliver(NOTE);
    await deliver('health.workoutday.2026-10-01');
    await scheduleAt('engagement.stayactive', at('2026-10-05T18:00:00Z'), { title: 't', body: 'b' }, 'engagement');
    notificationsState.setPermission('denied');
    await syncFeedbackNotifications(input());
    expect(scheduledIds()).toEqual(['engagement.stayactive']);
    expect(presentedIds()).toEqual(['health.workoutday.2026-10-01']);
  });

  it('not determined touches nothing and asks nothing', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    notificationsState.setPermission('undetermined');
    await syncFeedbackNotifications(input({ summary: summary({ latest: latest({ seen: true }) }) }));
    expect(scheduledIds()).toEqual([MONTHLY]);
    expect(notificationsState.requestCount()).toBe(0);
    // And nothing is scheduled for a member who has never answered.
    await removeAllFeedbackNotifications();
    await syncFeedbackNotifications(input());
    expect(scheduledIds()).toEqual([]);
  });

  it('a member no longer eligible (the feature gone, consent withdrawn) loses every feedback notification', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    await deliver(NOTE);
    await syncFeedbackNotifications(input({ eligible: false }));
    expect(scheduledIds()).toEqual([]);
    expect(presentedIds()).toEqual([]);
  });

  it('after a read, a seen report and a gone note leave the shade; an unread one stays', async () => {
    clockAt('2026-10-12T10:00:00Z');
    await deliver(MONTHLY);
    await deliver(NOTE);
    await syncFeedbackNotifications(input({ summary: summary({ latest: latest(), note: note() }), appActive: true }));
    expect(presentedIds()).toEqual([MONTHLY, NOTE]);
    await syncFeedbackNotifications(input({ summary: summary({ latest: latest({ seen: true }), note: null }), appActive: true }));
    expect(presentedIds()).toEqual([]);
  });

  it('the marks written are capped at twenty-four, newest kept', async () => {
    clockAt('2026-10-01T10:00:00Z');
    const old = new Map<string, Date>();
    for (let index = 0; index < 30; index += 1) old.set(`health.feedback.note.old-${index}`, new Date(Date.UTC(2024, 0, 1 + index)));
    await AsyncStorage.setItem(FeedbackKeys.notified('p-1'), writeMarks(old));
    await syncFeedbackNotifications(input());
    const marks = await storedMarks();
    expect(marks.size).toBe(24);
    expect(marks.has(MONTHLY)).toBe(true);
    expect(marks.has('health.feedback.note.old-0')).toBe(false);
    expect(marks.has('health.feedback.note.old-29')).toBe(true);
  });

  it('removeAll takes pending and delivered feedback notifications only', async () => {
    clockAt('2026-10-01T10:00:00Z');
    await syncFeedbackNotifications(input());
    await deliver(NOTE);
    await deliver('health.workoutday.2026-10-01');
    await removeAllFeedbackNotifications();
    expect(scheduledIds()).toEqual([]);
    expect(presentedIds()).toEqual(['health.workoutday.2026-10-01']);
  });
});
