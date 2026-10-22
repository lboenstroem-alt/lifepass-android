/**
 * The monthly feedback's local notifications (`SPEC` 8.1, 13.3): when, how
 * often, and what a lock screen may say. A port of iOS
 * FeedbackNotificationPlannerTests (FeedbackNotificationPlannerTests.swift),
 * same cases, same vectors; `calendar(secondsFromGMT)` is the phone.
 */
import {
  decodeFeedbackNote,
  decodeFeedbackReportSummary,
  feedbackSettings,
  feedbackSummary,
  type FeedbackNextReport,
  type FeedbackNote,
  type FeedbackReportSummary,
  type FeedbackSettings,
  type FeedbackSummary,
} from '../../api/feedback';
import { FEEDBACK_NOTIFICATION_PREFIX } from '../../features/feedback/feedbackStore';
import { translate, type Lang } from '../../i18n';
import { HEALTH_NOTIFICATION_PREFIX } from '../cleanup';
import {
  FEEDBACK_PREFIX,
  cappedMarks,
  deliveredToRemove,
  desiredFeedbackNotifications,
  deviceCalendar,
  feedbackPermission,
  fixedOffsetCalendar,
  isoInstant,
  learnedFire,
  parseIsoInstant,
  planFeedbackNotifications,
  preScheduledFire,
  readMarks,
  writeMarks,
  type FeedbackNotificationPermission,
  type PhoneCalendar,
  type PlannedFeedbackNotification,
} from '../feedbackPlanner';
import { feedbackNotificationContent } from '../feedbackSync';

function calendar(secondsFromGMT = 0): PhoneCalendar {
  return fixedOffsetCalendar(secondsFromGMT);
}

function date(iso: string): Date {
  const parsed = parseIsoInstant(iso);
  if (!parsed) throw new Error(`not an instant: ${iso}`);
  return parsed;
}

function settings(options: { monthly?: boolean; note?: boolean } = {}): FeedbackSettings {
  return feedbackSettings({
    monthlyReport: options.monthly ?? true,
    midMonthNote: options.note ?? true,
    includeFoodAndWeight: true,
  });
}

function latest(month = '2026-09', options: { seen?: boolean; current?: boolean } = {}): FeedbackReportSummary {
  return decodeFeedbackReportSummary(
    {
      id: `r-${month}`,
      kind: 'monthly',
      periodMonth: month,
      title: 'September 2026',
      createdAt: '2026-10-01T06:12:00Z',
      seenAt: options.seen ? '2026-10-01T19:00:00Z' : null,
      current: options.current ?? true,
      highlights: [],
    },
    'latest',
  );
}

function note(options: { month?: string; expiresOn?: string; seen?: boolean } = {}): FeedbackNote {
  const month = options.month ?? '2026-10';
  return decodeFeedbackNote(
    {
      id: `n-${month}`,
      periodMonth: month,
      createdAt: '2026-10-12T06:11:00Z',
      seenAt: options.seen ? '2026-10-12T19:00:00Z' : null,
      expiresOn: options.expiresOn ?? '2026-10-22',
      title: 'A note for you',
      message: { key: 'note.sleep_short', text: 'Short nights.', action: null },
    },
    'note',
  );
}

function next(month: string, readyOn: string, expected: boolean): FeedbackNextReport {
  return { periodMonth: month, readyOn, expected };
}

function desired(
  summary: FeedbackSummary,
  options: {
    appActive?: boolean;
    marks?: Record<string, Date>;
    pending?: string[];
    now: Date;
    calendar?: PhoneCalendar;
  },
): PlannedFeedbackNotification[] {
  return desiredFeedbackNotifications({
    summary,
    appActive: options.appActive ?? false,
    marks: new Map(Object.entries(options.marks ?? {})),
    pending: new Set(options.pending ?? []),
    now: options.now,
    calendar: options.calendar ?? calendar(),
  });
}

const ids = (planned: PlannedFeedbackNotification[]) => planned.map((item) => item.identifier);

describe('pre-scheduled', () => {
  it('the current month is pre-scheduled when the server expects it', () => {
    const summary = feedbackSummary({ settings: settings(), nextReport: next('2026-10', '2026-11-01', true) });
    const planned = desired(summary, { appActive: true, now: date('2026-10-15T12:00:00Z') });
    expect(planned).toHaveLength(1);
    expect(planned[0]?.identifier).toBe('health.feedback.monthly.2026-10');
    // 18:00 on the day it is written.
    expect(planned[0]?.fireDate).toEqual(date('2026-11-01T18:00:00Z'));
    expect(planned[0]?.data).toEqual({ route: 'plan.feedback', periodMonth: '2026-10' });
    expect(planned[0]?.kind).toBe('monthly');
  });

  it('nothing is pre-scheduled when the server does not expect a report', () => {
    const summary = feedbackSummary({ settings: settings(), nextReport: next('2026-10', '2026-11-01', false) });
    expect(desired(summary, { now: date('2026-10-15T12:00:00Z') })).toEqual([]);
  });

  /** Far east of Iceland, 18:00 on the 1st comes before the job has run: the notification moves to 18:00 the next day. */
  it('a phone thirteen hours ahead hears the next day', () => {
    const tonga = calendar(13 * 3600);
    // 18:00 on 2 November in UTC+13.
    expect(preScheduledFire('2026-11-01', tonga)).toEqual(date('2026-11-02T05:00:00Z'));
    expect(preScheduledFire('2026-11-01', calendar())).toEqual(date('2026-11-01T18:00:00Z'));
    // UTC+11: 18:00 local is 07:00Z exactly, which is not earlier: kept.
    expect(preScheduledFire('2026-11-01', calendar(11 * 3600))).toEqual(date('2026-11-01T07:00:00Z'));
  });
});

describe('learned in the background', () => {
  it('a report learned before half past five is today at six', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const planned = desired(summary, { now: date('2026-10-01T16:00:00Z') });
    expect(ids(planned)).toEqual(['health.feedback.monthly.2026-09']);
    expect(planned[0]?.fireDate).toEqual(date('2026-10-01T18:00:00Z'));
    expect(planned[0]?.data.reportId).toBe('r-2026-09');
  });

  it('a report learned after half past five is tomorrow at six', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const planned = desired(summary, { now: date('2026-10-01T17:45:00Z') });
    expect(planned[0]?.fireDate).toEqual(date('2026-10-02T18:00:00Z'));
  });

  it('nothing is learned while the app is on screen', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest(), note: note() });
    expect(desired(summary, { appActive: true, now: date('2026-10-12T10:00:00Z') })).toEqual([]);
  });

  it('a report that is seen is not scheduled', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest('2026-09', { seen: true }) });
    const id = 'health.feedback.monthly.2026-09';
    expect(desired(summary, { now: date('2026-10-01T10:00:00Z') })).toEqual([]);
    // And a pending one for it is not in the desired set, so the sync removes it.
    expect(
      desired(summary, { marks: { [id]: date('2026-10-01T18:00:00Z') }, pending: [id], now: date('2026-10-01T10:00:00Z') }),
    ).toEqual([]);
  });

  it('turning a switch off removes its notifications', () => {
    const summary = feedbackSummary({
      settings: settings({ monthly: false, note: false }),
      latest: latest(),
      note: note(),
      nextReport: next('2026-10', '2026-11-01', true),
    });
    expect(desired(summary, { now: date('2026-10-12T10:00:00Z') })).toEqual([]);
  });

  it('a note never fires after its last day', () => {
    const lastDay = feedbackSummary({ settings: settings(), note: note({ expiresOn: '2026-10-12' }) });
    // Today at 18:00 is still its last day.
    expect(ids(desired(lastDay, { now: date('2026-10-12T10:00:00Z') }))).toEqual(['health.feedback.note.2026-10']);
    // Tomorrow is too late.
    expect(desired(lastDay, { now: date('2026-10-12T17:45:00Z') })).toEqual([]);
    const planned = desired(lastDay, { now: date('2026-10-12T10:00:00Z') })[0];
    expect(planned?.data).toEqual({ route: 'plan.feedback_note', reportId: 'n-2026-10' });
    expect(planned?.kind).toBe('note');
  });

  it('a monthly is never later than six days after the 1st', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest('2026-09') });
    // The 7th is the last day.
    expect(desired(summary, { now: date('2026-10-07T10:00:00Z') })[0]?.fireDate).toEqual(date('2026-10-07T18:00:00Z'));
    // The 8th is too late.
    expect(desired(summary, { now: date('2026-10-07T17:45:00Z') })).toEqual([]);
  });
});

describe('once, and not too often', () => {
  it('a notification already delivered is not scheduled again', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const id = 'health.feedback.monthly.2026-09';
    // The pre-scheduled one fired at 18:00 on the 1st; the report is read in the background on the 2nd.
    expect(desired(summary, { marks: { [id]: date('2026-10-01T18:00:00Z') }, now: date('2026-10-02T09:00:00Z') })).toEqual([]);
  });

  it('a pending pre-scheduled one is kept as it is', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const id = 'health.feedback.monthly.2026-09';
    const fire = date('2026-10-01T18:00:00Z');
    const planned = desired(summary, { appActive: true, marks: { [id]: fire }, pending: [id], now: date('2026-10-01T09:00:00Z') });
    // Kept while the member has not opened the report.
    expect(ids(planned)).toEqual([id]);
    expect(planned[0]?.isAlreadyPending).toBe(true);
    expect(planned[0]?.fireDate).toEqual(fire);
  });

  /**
   * From 00:00 Iceland on the 1st the summary already speaks of the new month
   * (`nextReport` is October, `latest` is August and no longer current) until
   * the 06:10 job writes September's report. A sync in those hours keeps the
   * pre-scheduled one for September.
   */
  it('the pre-scheduled one survives the 1st before the report is written', () => {
    const summary = feedbackSummary({
      settings: settings(),
      latest: latest('2026-08', { current: false }),
      nextReport: next('2026-10', '2026-11-01', true),
    });
    const september = 'health.feedback.monthly.2026-09';
    const october = 'health.feedback.monthly.2026-10';
    const fire = date('2026-10-01T18:00:00Z');
    for (const appActive of [false, true]) {
      const planned = desired(summary, { appActive, marks: { [september]: fire }, pending: [september], now: date('2026-10-01T03:00:00Z') });
      expect(ids(planned)).toEqual([september, october]);
      // Kept as it is, not re-added.
      expect(planned[0]?.isAlreadyPending).toBe(true);
      expect(planned[0]?.fireDate).toEqual(fire);
      expect(planned[planned.length - 1]?.fireDate).toEqual(date('2026-11-01T18:00:00Z'));
    }
    // All day on the 2nd too, for a member a capped run has not reached (the Tonga case: pre-scheduled for 18:00 on the 2nd).
    const secondDay = date('2026-10-02T18:00:00Z');
    expect(
      ids(desired(summary, { marks: { [september]: secondDay }, pending: [september], now: date('2026-10-02T09:00:00Z') })),
    ).toEqual([september, october]);
    // Also when the summary has no `nextReport` for the new month yet.
    const noNext = feedbackSummary({ settings: settings(), latest: latest('2026-08', { current: false }) });
    expect(ids(desired(noNext, { marks: { [september]: fire }, pending: [september], now: date('2026-10-01T03:00:00Z') }))).toEqual([
      september,
    ]);
  });

  it('the pre-scheduled one still goes when it no longer applies', () => {
    const september = 'health.feedback.monthly.2026-09';
    const fire = date('2026-10-01T18:00:00Z');
    const now = date('2026-10-01T10:00:00Z');
    const nextReport = next('2026-10', '2026-11-01', false);
    // Opened on another device once written.
    const seen = feedbackSummary({ settings: settings(), latest: latest('2026-09', { seen: true }), nextReport });
    expect(desired(seen, { marks: { [september]: fire }, pending: [september], now })).toEqual([]);
    // The report switch turned off.
    const off = feedbackSummary({ settings: settings({ monthly: false }), latest: latest('2026-08', { current: false }) });
    expect(desired(off, { marks: { [september]: fire }, pending: [september], now })).toEqual([]);
    // A pending one this phone has no mark for is not one it can vouch for.
    const noMark = feedbackSummary({ settings: settings(), latest: latest('2026-08', { current: false }), nextReport });
    expect(desired(noMark, { pending: [september], now })).toEqual([]);
    // A pre-scheduled one for the month still running goes when the server
    // stops expecting its report: that is step 2's call, not this.
    const october = 'health.feedback.monthly.2026-10';
    const midMonth = feedbackSummary({ settings: settings(), latest: latest('2026-09'), nextReport });
    expect(
      desired(midMonth, { marks: { [october]: date('2026-11-01T18:00:00Z') }, pending: [october], now: date('2026-10-15T10:00:00Z') }),
    ).toEqual([]);
  });

  it('a note is dropped when a monthly fires within a day', () => {
    const summary = feedbackSummary({
      settings: settings(),
      latest: latest('2026-09'),
      note: note({ month: '2026-10', expiresOn: '2026-10-10' }),
    });
    const planned = desired(summary, { now: date('2026-10-02T10:00:00Z') });
    // One feedback notification a day, and the report wins.
    expect(planned.map((item) => item.kind)).toEqual(['monthly']);
  });

  it('a note is dropped within a day of one already delivered', () => {
    const summary = feedbackSummary({ settings: settings(), note: note() });
    // Delivered at 19:00 UTC yesterday (18:00 on a phone an hour west).
    const delivered = { 'health.feedback.monthly.2026-09': date('2026-10-11T19:00:00Z') };
    // 18:00 today is 23 hours after it.
    expect(desired(summary, { marks: delivered, now: date('2026-10-12T10:00:00Z') })).toEqual([]);
    // Tomorrow is well clear.
    expect(desired(summary, { marks: delivered, now: date('2026-10-12T17:45:00Z') }).map((item) => item.kind)).toEqual(['note']);
    // Exactly 24 hours apart is allowed.
    const exactlyADay = { 'health.feedback.monthly.2026-09': date('2026-10-11T18:00:00Z') };
    expect(desired(summary, { marks: exactlyADay, now: date('2026-10-12T10:00:00Z') }).map((item) => item.kind)).toEqual(['note']);
  });
});

describe('permission and eligibility', () => {
  it('denied removes everything and not determined touches nothing', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const now = date('2026-10-01T10:00:00Z');
    const decision = (permission: FeedbackNotificationPermission, eligible = true) =>
      planFeedbackNotifications({
        summary,
        eligible,
        permission,
        appActive: false,
        marks: new Map(),
        pending: new Set(),
        now,
        calendar: calendar(),
      });
    expect(decision('denied')).toEqual({ kind: 'removeAll' });
    expect(decision('notDetermined')).toEqual({ kind: 'leaveAlone' });
    // Flag off or consent gone.
    expect(decision('allowed', false)).toEqual({ kind: 'removeAll' });
    const allowed = decision('allowed');
    // An allowed, eligible member gets the plan.
    expect(allowed.kind).toBe('schedule');
    if (allowed.kind === 'schedule') expect(allowed.notifications).toHaveLength(1);
    // Android's three states (iOS: authorized, provisional and ephemeral are all "allowed").
    expect(feedbackPermission('granted')).toBe('allowed');
    expect(feedbackPermission('denied')).toBe('denied');
    expect(feedbackPermission('undetermined')).toBe('notDetermined');
  });

  it('an eligible member with nothing read yet is left alone', () => {
    const decision = planFeedbackNotifications({
      summary: null,
      eligible: true,
      permission: 'allowed',
      appActive: true,
      marks: new Map(),
      pending: new Set(['health.feedback.monthly.2026-10']),
      now: date('2026-10-15T10:00:00Z'),
      calendar: calendar(),
    });
    expect(decision).toEqual({ kind: 'leaveAlone' });
  });
});

describe('what a lock screen says', () => {
  it('every identifier is a health.feedback one', () => {
    const summary = feedbackSummary({
      settings: settings(),
      latest: latest(),
      note: note({ expiresOn: '2026-10-30' }),
      nextReport: next('2026-10', '2026-11-01', true),
    });
    const planned = [
      ...desired(summary, { now: date('2026-10-20T10:00:00Z') }),
      ...desired(feedbackSummary({ settings: settings(), note: note({ expiresOn: '2026-10-30' }) }), { now: date('2026-10-20T10:00:00Z') }),
    ];
    expect(planned.length).toBeGreaterThan(0);
    for (const item of planned) {
      expect(item.identifier.startsWith('health.feedback.')).toBe(true);
      // The wipe removes every health.* request.
      expect(item.identifier.startsWith(HEALTH_NOTIFICATION_PREFIX)).toBe(true);
    }
    // The prefix the feedback store removes on a refusal is this one.
    expect(FEEDBACK_PREFIX).toBe(FEEDBACK_NOTIFICATION_PREFIX);
  });

  /** No number, no topic, no line of the report: the words only say that something is ready, in both languages. */
  it('the content carries no digit and no health detail', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest() });
    const item = desired(summary, { now: date('2026-10-01T10:00:00Z') })[0];
    expect(item).toBeDefined();
    if (!item) return;
    for (const language of ['en', 'is'] as Lang[]) {
      for (const key of [
        'notif.feedback.monthly.title',
        'notif.feedback.monthly.body',
        'notif.feedback.note.title',
        'notif.feedback.note.body',
      ]) {
        const text = translate(key, language);
        // The key exists in this language.
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/\d/);
        for (const word of ['sleep', 'weight', 'kcal', 'svefn', 'þyngd', 'hitaeining']) {
          expect(text.toLowerCase()).not.toContain(word);
        }
      }
      const content = feedbackNotificationContent(item, language);
      expect(content.title).not.toMatch(/\d/);
      expect(content.body).not.toMatch(/\d/);
      expect(content.title).toBe(translate('notif.feedback.monthly.title', language));
      expect(content.data?.route).toBe('plan.feedback');
      expect(item.identifier).toBe('health.feedback.monthly.2026-09');
    }
    // The data carries a route and an id, nothing else.
    expect(Object.keys(feedbackNotificationContent(item, 'en').data ?? {}).sort()).toEqual(['reportId', 'route']);
  });
});

describe('the lock screen after a read', () => {
  it('a seen report and a gone note leave the lock screen', () => {
    const summary = feedbackSummary({ settings: settings(), latest: latest('2026-09', { seen: true }), note: null });
    const delivered = ['health.feedback.monthly.2026-09', 'health.feedback.note.2026-09', 'health.workoutday.2026-10-01'];
    expect(new Set(deliveredToRemove(summary, delivered))).toEqual(
      new Set(['health.feedback.monthly.2026-09', 'health.feedback.note.2026-09']),
    );
    const unseen = feedbackSummary({ settings: settings(), latest: latest(), note: note() });
    // An unread report and an unseen note keep theirs.
    expect(deliveredToRemove(unseen, ['health.feedback.monthly.2026-09', 'health.feedback.note.2026-10'])).toEqual([]);
  });

  it('with no summary every delivered feedback notification goes, and nothing else', () => {
    expect(deliveredToRemove(null, ['health.feedback.monthly.2026-09', 'health.workoutday.2026-10-01'])).toEqual([
      'health.feedback.monthly.2026-09',
    ]);
  });

  it('the report switch off takes a delivered monthly out of the shade', () => {
    const summary = feedbackSummary({ settings: settings({ monthly: false }), latest: latest() });
    expect(deliveredToRemove(summary, ['health.feedback.monthly.2026-09'])).toEqual(['health.feedback.monthly.2026-09']);
  });

  it('the marks are capped at twenty-four', () => {
    const marks = new Map<string, Date>();
    for (let index = 0; index < 30; index += 1) marks.set(`health.feedback.monthly.${index}`, new Date(index * 1000));
    const capped = cappedMarks(marks);
    expect(capped.size).toBe(24);
    // The oldest go first.
    expect(capped.has('health.feedback.monthly.0')).toBe(false);
    expect(capped.has('health.feedback.monthly.29')).toBe(true);
    const round = readMarks(writeMarks(new Map([['a', date('2026-10-01T18:00:00Z')]])));
    expect([...round]).toEqual([['a', date('2026-10-01T18:00:00Z')]]);
  });

  it('the marks are written as iOS writes them, and anything unreadable is left out', () => {
    expect(writeMarks(new Map([['a', date('2026-10-01T18:00:00Z')]]))).toBe('{"a":"2026-10-01T18:00:00Z"}');
    expect(isoInstant(new Date(Date.UTC(2026, 9, 1, 18, 0, 0, 0)))).toBe('2026-10-01T18:00:00Z');
    const read = readMarks('{"a":"2026-10-01T18:00:00Z","b":"yesterday","c":12,"d":"2026-10-01T18:00:00.000Z"}');
    expect([...read.keys()]).toEqual(['a', 'd']);
    expect(readMarks('not json').size).toBe(0);
    expect(readMarks('[1,2]').size).toBe(0);
    expect(readMarks(null).size).toBe(0);
  });
});

describe('the phone calendar', () => {
  it("learns on the phone's own clock: half past five is half past five where the member is", () => {
    // 16:00 UTC is 17:00 on a phone an hour east: before the cutoff, so 18:00 there (17:00 UTC).
    expect(learnedFire(date('2026-10-01T16:00:00Z'), calendar(3600))).toEqual(date('2026-10-01T17:00:00Z'));
    // 16:45 UTC is 17:45 there: tomorrow at 18:00 there.
    expect(learnedFire(date('2026-10-01T16:45:00Z'), calendar(3600))).toEqual(date('2026-10-02T17:00:00Z'));
    // A phone five hours west: 18:00 there is 23:00 UTC.
    expect(learnedFire(date('2026-10-01T12:00:00Z'), calendar(-5 * 3600))).toEqual(date('2026-10-01T23:00:00Z'));
  });

  it("the device calendar is the phone's zone", () => {
    const now = new Date(2026, 9, 1, 12, 0, 0);
    const fire = learnedFire(now, deviceCalendar);
    expect(fire).toEqual(new Date(2026, 9, 1, 18, 0, 0));
    expect(preScheduledFire('2026-11-01', deviceCalendar)?.getHours()).toBe(18);
    expect(deviceCalendar.addingDays(new Date(2026, 9, 31, 18, 0, 0), 1)).toEqual(new Date(2026, 10, 1, 18, 0, 0));
  });

  it('a day that is not a day schedules nothing', () => {
    expect(preScheduledFire('2026-11', calendar())).toBeNull();
    expect(preScheduledFire('soon', calendar())).toBeNull();
    const summary = feedbackSummary({ settings: settings(), nextReport: next('2026-10', 'soon', true) });
    expect(desired(summary, { now: date('2026-10-15T12:00:00Z') })).toEqual([]);
  });
});
