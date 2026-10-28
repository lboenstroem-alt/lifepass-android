/**
 * The monthly feedback's local notifications: WHEN, and how often (iOS
 * `FeedbackNotificationPlanner` in Services/FeedbackNotificationService.swift,
 * `SPEC` 8.1). Pure: no notification centre, no storage, no clock of its own.
 * ./feedbackSync.ts turns its answer into scheduled and removed requests.
 *
 * THERE IS NO SERVER PUSH IN LIFEPASS. The report is written on the server and
 * fetched by the app; this file turns what the app learned (a summary read in
 * the foreground, or by the background refresh) into at most two pending
 * local notifications:
 *
 * - `health.feedback.monthly.<YYYY-MM>`: "Your monthly feedback is ready",
 *   pre-scheduled for 18:00 on the 1st when the server says the current
 *   month's report is expected, or scheduled when a background read finds an
 *   unseen report;
 * - `health.feedback.note.<YYYY-MM>`: "A note from LifePass", when a
 *   background read finds an unseen mid-month note.
 *
 * WHAT A LOCK SCREEN MAY SAY: that something is ready, and nothing about what.
 * No topic, no number, no line of the report. The words stay in the app.
 *
 * The `health.` prefix is on purpose: the local health wipe
 * (./cleanup.ts `removeAllHealthNotifications`) removes every `health.*`
 * request on a sign-out, a withdrawal and a wipe.
 *
 * TIME. Two clocks meet here. The server's calendar is Iceland's, which is UTC
 * all year (`serverDay`): the report is written at 06:10 UTC on the 1st, and a
 * note's last day is an Iceland day. The member hears it at 18:00 on THEIR
 * phone's clock, which can be anywhere (`PhoneCalendar`). Tests pass a fixed
 * offset calendar, as iOS tests pass `Calendar(secondsFromGMT:)`.
 */
import {
  FeedbackMonth,
  feedbackSettings,
  type FeedbackSummary,
} from '../api/feedback';
import type { NotificationRoute } from '../app/notificationRouter';
import { serverDay } from '../i18n/format';

import type { NotificationPermission } from './permissions';

// ---------------------------------------------------------------------------
// The phone's calendar

/** Wall-clock fields of an instant on a calendar (month 1 to 12). */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * The few calendar operations the planner needs (Swift's `Calendar`), so the
 * same rules run on the phone's own zone and on a fixed zone in tests.
 */
export interface PhoneCalendar {
  /** `date`'s wall-clock fields on this calendar. */
  fields(date: Date): WallClock;
  /** The instant of a wall-clock time on this calendar; null when it is not one. */
  date(year: number, month: number, day: number, hour: number, minute: number, second?: number): Date | null;
  /** `date` moved by whole calendar days, keeping its wall-clock time. */
  addingDays(date: Date, days: number): Date;
}

function validOrNull(date: Date): Date | null {
  return Number.isFinite(date.getTime()) ? date : null;
}

/** The phone's own calendar and time zone (Swift `Calendar.current`). */
export const deviceCalendar: PhoneCalendar = {
  fields(date) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  },
  date(year, month, day, hour, minute, second = 0) {
    const date = new Date(2000, 0, 1, 0, 0, 0, 0);
    // setFullYear, not the constructor: the constructor reads years 0 to 99 as 19xx.
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, second, 0);
    return validOrNull(date);
  },
  addingDays(date, days) {
    // A calendar day, not 24 hours: 18:00 stays 18:00 across a clock change.
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  },
};

/** A calendar at a fixed offset from UTC, with no daylight saving (tests; Iceland is `fixedOffsetCalendar(0)`). */
export function fixedOffsetCalendar(secondsFromGMT: number): PhoneCalendar {
  const offsetMs = secondsFromGMT * 1000;
  return {
    fields(date) {
      const shifted = new Date(date.getTime() + offsetMs);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
      };
    },
    date(year, month, day, hour, minute, second = 0) {
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      date.setUTCHours(hour, minute, second, 0);
      return validOrNull(new Date(date.getTime() - offsetMs));
    },
    addingDays(date, days) {
      return new Date(date.getTime() + days * 86_400_000);
    },
  };
}

// ---------------------------------------------------------------------------
// What the planner answers

export type FeedbackNotificationKind = 'monthly' | 'note';

/** One notification the phone should have pending. */
export interface PlannedFeedbackNotification {
  readonly kind: FeedbackNotificationKind;
  readonly identifier: string;
  readonly fireDate: Date;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** `route`, and `reportId` (learned) or `periodMonth` (pre-scheduled). Ids only, never a line of a report. */
  readonly data: Readonly<Record<string, string>>;
  /** Already pending with this fire date: kept as it is, not re-added. */
  readonly isAlreadyPending: boolean;
}

/**
 * The notification permission, as the planner needs it (iOS
 * `FeedbackNotificationPermission`): `allowed` schedules, `denied` removes
 * everything, `notDetermined` touches nothing (this is never the place to ask).
 */
export type FeedbackNotificationPermission = 'allowed' | 'denied' | 'notDetermined';

/**
 * The app's three-state permission (./permissions.ts) in the planner's words.
 * iOS counts `.authorized`, `.provisional` and `.ephemeral` as allowed;
 * Android has only "granted".
 */
export function feedbackPermission(permission: NotificationPermission): FeedbackNotificationPermission {
  switch (permission) {
    case 'granted':
      return 'allowed';
    case 'denied':
      return 'denied';
    case 'undetermined':
      return 'notDetermined';
  }
}

/** What to do with the pending feedback notifications. */
export type FeedbackNotificationDecision =
  /** Permission denied, the feature is off, or the member is not eligible: nothing `health.feedback.*` stays pending. */
  | { readonly kind: 'removeAll' }
  /** Permission not asked yet (or nothing read yet): nothing is changed. */
  | { readonly kind: 'leaveAlone' }
  /** The exact set that should be pending. */
  | { readonly kind: 'schedule'; readonly notifications: readonly PlannedFeedbackNotification[] };

/** Fire dates this phone recorded, by identifier. */
export type FeedbackMarks = ReadonlyMap<string, Date>;

// ---------------------------------------------------------------------------
// The rules

/** Every feedback notification's identifier starts with this. */
export const FEEDBACK_PREFIX = 'health.feedback.';
export const FEEDBACK_MONTHLY_PREFIX = 'health.feedback.monthly.';
export const FEEDBACK_NOTE_PREFIX = 'health.feedback.note.';

export const FEEDBACK_MONTHLY_TITLE_KEY = 'notif.feedback.monthly.title';
export const FEEDBACK_MONTHLY_BODY_KEY = 'notif.feedback.monthly.body';
export const FEEDBACK_NOTE_TITLE_KEY = 'notif.feedback.note.title';
export const FEEDBACK_NOTE_BODY_KEY = 'notif.feedback.note.body';

/** The tap routes (src/app/notificationRouter.ts, iOS `NotificationRouter.Route`). */
export const FEEDBACK_MONTHLY_ROUTE: NotificationRoute = 'plan.feedback';
export const FEEDBACK_NOTE_ROUTE: NotificationRoute = 'plan.feedback_note';

/** 18:00, the house engagement time (iOS NOTIFICATIONS.md). */
export const FIRE_HOUR = 18;
/** A report learned after 17:30 waits for tomorrow's 18:00. */
export const LEARNED_CUTOFF_MINUTES = 17 * 60 + 30;
/** The report job runs at 06:10 UTC; 07:00 UTC is safely after it. */
export const READY_HOUR_UTC = 7;
/** At most one feedback notification in any 24 hours. */
export const FEEDBACK_SPACING_MS = 24 * 3600 * 1000;
/** A monthly report's notification is not worth sending after this many days past the 1st. */
export const MONTHLY_LAST_DAY = 6;
/** How many fire dates are kept (the newest). */
export const MARKS_LIMIT = 24;

export function monthlyIdentifier(periodMonth: string): string {
  return FEEDBACK_MONTHLY_PREFIX + periodMonth;
}

export function noteIdentifier(periodMonth: string): string {
  return FEEDBACK_NOTE_PREFIX + periodMonth;
}

/**
 * The desired set (iOS `FeedbackNotificationPlanner.plan`).
 *
 * - `marks`: the fire dates this phone recorded for identifiers it scheduled.
 *   An identifier counts as NOTIFIED when its recorded fire date has passed,
 *   and a notified report is never scheduled again.
 * - `appActive`: the app is on screen, so the Plan card is doing the telling.
 *   No "learned" notification is added (a pre-scheduled one still is, and one
 *   already pending stays).
 */
export function planFeedbackNotifications(input: {
  readonly summary: FeedbackSummary | null;
  readonly eligible: boolean;
  readonly permission: FeedbackNotificationPermission;
  readonly appActive: boolean;
  readonly marks: FeedbackMarks;
  readonly pending: ReadonlySet<string>;
  readonly now: Date;
  readonly calendar: PhoneCalendar;
}): FeedbackNotificationDecision {
  switch (input.permission) {
    case 'denied':
      return { kind: 'removeAll' };
    case 'notDetermined':
      return { kind: 'leaveAlone' };
    case 'allowed':
      break;
  }
  if (!input.eligible) return { kind: 'removeAll' };
  if (!input.summary) return { kind: 'leaveAlone' };
  return { kind: 'schedule', notifications: desiredFeedbackNotifications({ ...input, summary: input.summary }) };
}

/** The set that should be pending for an allowed, eligible member (iOS `desired`). */
export function desiredFeedbackNotifications(input: {
  readonly summary: FeedbackSummary;
  readonly appActive: boolean;
  readonly marks: FeedbackMarks;
  readonly pending: ReadonlySet<string>;
  readonly now: Date;
  readonly calendar: PhoneCalendar;
}): PlannedFeedbackNotification[] {
  const { summary, appActive, marks, pending, now, calendar } = input;
  const settings = summary.settings ?? feedbackSettings();
  const nowMs = now.getTime();

  const fired = (id: string): boolean => {
    const fire = marks.get(id);
    return fire !== undefined && fire.getTime() <= nowMs;
  };
  const keptPending = (id: string): Date | null => {
    const fire = marks.get(id);
    if (!pending.has(id) || fire === undefined || fire.getTime() <= nowMs) return null;
    return fire;
  };
  const listed = (list: readonly PlannedFeedbackNotification[], id: string): boolean =>
    list.some((item) => item.identifier === id);

  const monthlies: PlannedFeedbackNotification[] = [];

  // 1. The report the server has written and the member has not opened.
  const latest = summary.latest;
  if (settings.monthlyReport && latest && latest.current && latest.seenAt === null && latest.periodMonth !== null) {
    const month = latest.periodMonth;
    const id = monthlyIdentifier(month);
    const kept = keptPending(id);
    if (fired(id)) {
      // Already on the lock screen once (pre-scheduled or learned).
    } else if (kept) {
      monthlies.push(monthly(id, kept, { periodMonth: month }, true));
    } else if (!appActive) {
      const fire = learnedFire(now, calendar);
      const readyOn = FeedbackMonth.readyOn(month);
      const lastDay = readyOn !== null ? FeedbackMonth.day(readyOn, MONTHLY_LAST_DAY) : null;
      const deadline = lastDay !== null ? endOfDay(lastDay, calendar) : null;
      if (fire && deadline && fire.getTime() <= deadline.getTime()) {
        monthlies.push(monthly(id, fire, { reportId: latest.id }, false));
      }
    }
  }

  // 1b. Last month's pre-scheduled one, still waiting to fire, before the
  //     server has its report. From 00:00 Iceland on the 1st the summary
  //     already speaks of the new month (`nextReport` is next month, `latest`
  //     is the older report with `current === false`) until the 06:10 job
  //     writes the report, or all day for a member a capped run reaches on
  //     day 2. A sync in that window (a foreground open, an overnight
  //     background run) must not cancel the notification the pre-schedule
  //     exists for.
  if (settings.monthlyReport) {
    const today = serverDay(now);
    for (const id of [...pending].sort()) {
      if (!id.startsWith(FEEDBACK_MONTHLY_PREFIX)) continue;
      const month = id.slice(FEEDBACK_MONTHLY_PREFIX.length);
      if (listed(monthlies, id)) continue;
      const fire = keptPending(id);
      if (!fire) continue;
      if (month === summary.nextReport?.periodMonth) continue;
      const readyOn = FeedbackMonth.readyOn(month);
      if (readyOn === null || readyOn > today) continue;
      if (latest && latest.periodMonth !== null) {
        // Opened already, or a newer report has taken its place.
        if (latest.periodMonth === month && latest.seenAt !== null) continue;
        if (latest.periodMonth > month) continue;
      }
      monthlies.push(monthly(id, fire, { periodMonth: month }, true));
    }
  }

  // 2. The current month's report, pre-scheduled for the 1st.
  const next = summary.nextReport;
  if (settings.monthlyReport && next && next.expected && next.periodMonth !== null && next.readyOn !== null) {
    const fire = preScheduledFire(next.readyOn, calendar);
    if (fire && fire.getTime() > nowMs) {
      const id = monthlyIdentifier(next.periodMonth);
      if (!fired(id) && !listed(monthlies, id)) {
        const samePending = pending.has(id) && marks.get(id)?.getTime() === fire.getTime();
        monthlies.push(monthly(id, fire, { periodMonth: next.periodMonth }, samePending));
      }
    }
  }

  // Two monthlies never land within a day of each other (they are a month
  // apart by construction; this is the guard, not the rule).
  const accepted: PlannedFeedbackNotification[] = [];
  for (const candidate of monthlies) {
    if (candidate.isAlreadyPending || !clashes(candidate, accepted, marks, true)) accepted.push(candidate);
  }

  // 3. The mid-month note, learned in the background, never after the day it
  //    stops being offered, and never within a day of a monthly.
  const note = summary.note;
  if (settings.midMonthNote && note && note.seenAt === null && note.periodMonth !== null) {
    const id = noteIdentifier(note.periodMonth);
    const data = { route: FEEDBACK_NOTE_ROUTE, reportId: note.id };
    let candidate: PlannedFeedbackNotification | null = null;
    const kept = keptPending(id);
    if (fired(id)) {
      candidate = null;
    } else if (kept) {
      candidate = noteItem(id, kept, data, true);
    } else if (!appActive) {
      const fire = learnedFire(now, calendar);
      if (fire && noteFireIsInTime(fire, note.expiresOn)) candidate = noteItem(id, fire, data, false);
    }
    if (candidate) {
      const fire = candidate.fireDate.getTime();
      const monthlyNearby = accepted.some((item) => Math.abs(item.fireDate.getTime() - fire) < FEEDBACK_SPACING_MS);
      const anyNearby = !candidate.isAlreadyPending && clashes(candidate, accepted, marks, false);
      if (!monthlyNearby && !anyNearby) accepted.push(candidate);
    }
  }
  return accepted;
}

function monthly(
  identifier: string,
  fireDate: Date,
  info: Readonly<Record<string, string>>,
  isAlreadyPending: boolean,
): PlannedFeedbackNotification {
  return {
    kind: 'monthly',
    identifier,
    fireDate,
    titleKey: FEEDBACK_MONTHLY_TITLE_KEY,
    bodyKey: FEEDBACK_MONTHLY_BODY_KEY,
    data: { ...info, route: FEEDBACK_MONTHLY_ROUTE },
    isAlreadyPending,
  };
}

function noteItem(
  identifier: string,
  fireDate: Date,
  data: Readonly<Record<string, string>>,
  isAlreadyPending: boolean,
): PlannedFeedbackNotification {
  return {
    kind: 'note',
    identifier,
    fireDate,
    titleKey: FEEDBACK_NOTE_TITLE_KEY,
    bodyKey: FEEDBACK_NOTE_BODY_KEY,
    data,
    isAlreadyPending,
  };
}

/** Another feedback notification (planned, pending or delivered in the last day) within 24 hours of this one. */
function clashes(
  candidate: PlannedFeedbackNotification,
  accepted: readonly PlannedFeedbackNotification[],
  marks: FeedbackMarks,
  ignoringNotes: boolean,
): boolean {
  const fire = candidate.fireDate.getTime();
  if (accepted.some((item) => Math.abs(item.fireDate.getTime() - fire) < FEEDBACK_SPACING_MS)) return true;
  for (const [id, marked] of marks) {
    if (id === candidate.identifier) continue;
    if (ignoringNotes && id.startsWith(FEEDBACK_NOTE_PREFIX)) continue;
    if (Math.abs(marked.getTime() - fire) < FEEDBACK_SPACING_MS) return true;
  }
  return false;
}

/** `"2026-11-01"` to `[2026, 11, 1]`, Swift's `split(separator: "-").compactMap { Int($0) }`; null unless three numbers. */
function dayParts(day: string): [number, number, number] | null {
  const parts = day
    .split('-')
    .filter((part) => part.length > 0 && /^[+-]?\d+$/.test(part))
    .map(Number);
  return parts.length === 3 ? (parts as [number, number, number]) : null;
}

/**
 * 18:00 on the phone's calendar on `readyOn`, or on the day after when that is
 * earlier than 07:00 UTC on `readyOn` (a phone far east of Iceland reaches
 * 18:00 before the job has run).
 */
export function preScheduledFire(readyOn: string, calendar: PhoneCalendar): Date | null {
  const parts = dayParts(readyOn);
  if (!parts) return null;
  const [year, month, day] = parts;
  const fire = calendar.date(year, month, day, FIRE_HOUR, 0);
  const ready = fixedOffsetCalendar(0).date(year, month, day, READY_HOUR_UTC, 0);
  if (!fire || !ready) return null;
  return fire.getTime() < ready.getTime() ? calendar.addingDays(fire, 1) : fire;
}

/**
 * Learned now: today at 18:00 if it is before 17:30, else tomorrow at 18:00.
 * Never between 21:00 and 09:00, by construction.
 */
export function learnedFire(now: Date, calendar: PhoneCalendar): Date | null {
  const fields = calendar.fields(now);
  const minutes = fields.hour * 60 + fields.minute;
  const today = calendar.date(fields.year, fields.month, fields.day, FIRE_HOUR, 0);
  if (!today) return null;
  return minutes < LEARNED_CUTOFF_MINUTES ? today : calendar.addingDays(today, 1);
}

/** 23:59:59 on the phone's calendar on a "YYYY-MM-DD" day. */
function endOfDay(day: string, calendar: PhoneCalendar): Date | null {
  const parts = dayParts(day);
  if (!parts) return null;
  return calendar.date(parts[0], parts[1], parts[2], 23, 59, 59);
}

/** A note's notification fires on or before its last Iceland day. */
export function noteFireIsInTime(fire: Date, expiresOn: string | null): boolean {
  if (expiresOn === null) return false;
  return serverDay(fire) <= expiresOn;
}

/**
 * Identifiers whose DELIVERED notification should leave the shade: a report
 * the member has opened (or every monthly, once the report switch is off),
 * and a note that is seen or no longer offered.
 */
export function deliveredToRemove(summary: FeedbackSummary | null, delivered: readonly string[]): string[] {
  if (!summary) return delivered.filter((id) => id.startsWith(FEEDBACK_PREFIX));
  const settings = summary.settings ?? feedbackSettings();
  const note = summary.note;
  const openNote =
    note && settings.midMonthNote && note.seenAt === null && note.periodMonth !== null ? noteIdentifier(note.periodMonth) : null;
  const latest = summary.latest;
  const seenMonthly =
    latest && latest.periodMonth !== null && latest.seenAt !== null ? monthlyIdentifier(latest.periodMonth) : null;
  const remove: string[] = [];
  for (const id of delivered) {
    if (id.startsWith(FEEDBACK_NOTE_PREFIX) && id !== openNote) remove.push(id);
    if (id.startsWith(FEEDBACK_MONTHLY_PREFIX) && (!settings.monthlyReport || id === seenMonthly)) remove.push(id);
  }
  return remove;
}

/** Keep the newest `limit` marks by fire date. */
export function cappedMarks(marks: FeedbackMarks, limit = MARKS_LIMIT): Map<string, Date> {
  if (marks.size <= limit) return new Map(marks);
  const kept = [...marks].sort((a, b) => b[1].getTime() - a[1].getTime()).slice(0, limit);
  return new Map(kept);
}

// ---------------------------------------------------------------------------
// Marks on disk: `{ identifier: "2026-10-01T18:00:00Z" }`, as iOS keeps them

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** iOS `ISO8601DateFormatter` output: whole seconds, `Z`. */
export function isoInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** An ISO instant, or null for anything else. */
export function parseIsoInstant(text: unknown): Date | null {
  if (typeof text !== 'string' || !ISO_INSTANT.test(text)) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** The stored marks (a JSON object of ISO strings); anything unreadable is left out. */
export function readMarks(raw: string | null | undefined): Map<string, Date> {
  const marks = new Map<string, Date>();
  if (!raw) return marks;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return marks;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return marks;
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const date = parseIsoInstant(value);
    if (date) marks.set(id, date);
  }
  return marks;
}

export function writeMarks(marks: FeedbackMarks): string {
  const out: Record<string, string> = {};
  for (const [id, date] of marks) out[id] = isoInstant(date);
  return JSON.stringify(out);
}
