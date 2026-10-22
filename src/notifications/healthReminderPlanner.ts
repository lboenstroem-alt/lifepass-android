/**
 * The pure reminder planner: the Android port of iOS `HealthReminderPlanner`
 * (Services/HealthReminderService.swift, `ios-ux.md` 19.2 to 19.4), unit
 * tested like HealthReminderPlannerTests.
 *
 * From the Today read, the member's reminder choices and the time, it answers
 * which health notifications the phone should have pending, for which dates,
 * at what time and with which words. Nothing here schedules, reads storage or
 * asks for anything: ./healthReminders.ts does that, and makes the pending
 * set equal to this answer.
 *
 * WHAT A LOCK SCREEN MAY SAY. A session's title and its minutes, and a fixed
 * line for a server note key. Never a number from the body, Health Connect or
 * the food log: no weight, no sleep length, no calories, no skip reason, no
 * feeling. The note's own text, with its reasons, is shown inside the app
 * only, which is why a note variant drops the title and minutes too.
 *
 * TWO CLOCKS, ON PURPOSE. A plan date (`2026-09-21`) is the plan's Iceland
 * date and is never shifted; the time is the member's WALL CLOCK on this
 * phone. So every fire time here is built from a `YYYY-MM-DD` string and the
 * member's minutes on the phone's own calendar (`new Date(y, m, d, h, min)`),
 * never from an instant moved by an offset: a sync on a phone in Tokyo plans
 * Monday's 07:00 note for 07:00 Tokyo time on Monday.
 *
 * KNOWN PLATFORM DIFFERENCE: that wall-clock time is fixed WHEN SCHEDULED.
 * iOS hands the components to a calendar trigger with no time zone, which
 * follows the phone into a new zone on its own. expo-notifications has no
 * one-off calendar trigger on Android, so ./scheduler.ts stores an instant,
 * worked out in the zone the phone was in at the last sync. Every sync works
 * it out again and a sync runs on each activation, so the first open after a
 * zone change moves every pending note to the new zone's wall clock; until
 * then a pending note fires at the old zone's local time. (F7 contract
 * request: a time-zone-change receiver that re-runs the syncs.)
 */
import type { CheckInWeekday } from '../features/body';
import { isWorkoutKind, type DailyNote, type SessionBrief, type SessionKind } from '../health';

// ---------------------------------------------------------------------------
// Identifiers and keys

/** Every workout-day note (and a rest pick) is `health.workoutday.<YYYY-MM-DD>`. */
export const WORKOUT_PREFIX = 'health.workoutday.';
/** The weekly check-in: one, at the next occurrence. */
export const CHECK_IN_IDENTIFIER = 'health.weeklycheckin';

/**
 * The planner's family: what it schedules and so what it may remove. The rest
 * timer and the monthly feedback are `health.` too, and are NOT the
 * planner's to touch.
 */
export function isPlannerIdentifier(identifier: string): boolean {
  return identifier.startsWith(WORKOUT_PREFIX) || identifier === CHECK_IN_IDENTIFIER;
}

/**
 * What the server's `note.notificationKey` becomes on a lock screen. A key
 * not listed here keeps the generic line (a newer server's key this build
 * does not know). `rest_pick` belongs to a rest day and is handled on its own.
 */
export const NOTE_VARIANT_KEYS: Readonly<Record<string, string>> = {
  lighter: 'notif.health.note.lighter',
  moved_rest: 'notif.health.note.moved_rest',
  indoor_swap: 'notif.health.note.indoor_swap',
};

/** The server note key that gives a rest day its note. */
export const REST_PICK_KEY = 'rest_pick';

/** A workout note closer than this is not scheduled (a minute: the member is opening the app anyway). */
export const MIN_LEAD_MS = 60_000;

/** Where a tap goes (`data.route`, read by src/app/notificationRouter.ts). */
export type ReminderRoute = 'plan' | 'plan.checkin';

// ---------------------------------------------------------------------------
// Types

export type PlannedReminderKind = 'workoutDay' | 'restPick' | 'weeklyCheckIn';

/** Year, month (1 to 12), day, hour and minute on the phone's calendar (iOS `DateComponents`). */
export interface FireComponents {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** One notification the phone should have pending (iOS `PlannedReminder`). */
export interface PlannedReminder {
  readonly kind: PlannedReminderKind;
  readonly identifier: string;
  readonly fire: FireComponents;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Only a session title and its minutes, never a body value. */
  readonly params: Readonly<Record<string, string>>;
  readonly route: ReminderRoute;
}

/** Tomorrow's read, taken in the evening (19.4). */
export interface TomorrowRead {
  /** Tomorrow's server date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly isRest: boolean;
  readonly notificationKey: string | null;
}

/** The member's choices the planner reads (BODY-1's `ReminderPreferences`, iOS `HealthReminderPreferences`). */
export interface PlannerPreferences {
  readonly workoutNotesOn: boolean;
  /** Minutes after midnight on the phone's own clock. */
  readonly workoutTimeMinutes: number;
  readonly checkInOn: boolean;
  /** ISO weekday: 1 Monday or 7 Sunday. */
  readonly checkInWeekday: CheckInWeekday;
  readonly checkInTimeMinutes: number;
}

export interface PlannerInput {
  /** Today's `upcoming`: the live programme's rows for today through today + 6. */
  readonly upcoming: readonly SessionBrief[];
  readonly todayNote: DailyNote | null;
  readonly tomorrow: TomorrowRead | null;
  /** `today.review.weekStartsOn`: the Monday of the latest saved weekly review. */
  readonly latestReviewWeekStartsOn: string | null;
  /** The programme is `active` (a paused one gives no workout notes). */
  readonly programActive: boolean;
  /**
   * Consent, entitlement and the permission are decided by the caller, which
   * passes false when any of them is missing.
   */
  readonly eligible: boolean;
  readonly preferences: PlannerPreferences;
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// The desired set

/**
 * The desired set (19.2 step 2): the workout notes for the planned workout
 * days ahead, a rest pick for tomorrow when the evening read found one, and
 * the weekly check-in. Empty when the member is not eligible.
 */
export function desiredReminders(input: PlannerInput): PlannedReminder[] {
  if (!input.eligible) return [];
  const { preferences, now } = input;
  const result: PlannedReminder[] = [];

  if (input.programActive && preferences.workoutNotesOn) {
    const hour = Math.floor(preferences.workoutTimeMinutes / 60);
    const minute = preferences.workoutTimeMinutes % 60;
    const scheduledDates = new Set<string>();

    for (const row of input.upcoming) {
      const date = row.scheduledFor;
      if (date === null || date === undefined) continue;
      // A row with no kind is not a workout; a row with no status is planned (iOS defaults).
      if (!isWorkoutKind(row.kind ?? 'unknown')) continue;
      if ((row.status ?? 'planned') !== 'planned') continue;
      const fire = fireComponents(date, hour, minute);
      if (!fire || !isFarEnough(fire, now)) continue;
      if (scheduledDates.has(date)) continue;
      scheduledDates.add(date);

      const noteKey = input.todayNote?.date === date ? input.todayNote.notificationKey : null;
      const variant = noteKey !== null ? (NOTE_VARIANT_KEYS[noteKey] ?? null) : null;
      result.push({
        kind: 'workoutDay',
        identifier: WORKOUT_PREFIX + date,
        fire,
        titleKey: 'notif.health.workout.title',
        bodyKey: variant ?? bodyKeyFor(row.kind ?? 'strength'),
        params: variant === null ? paramsFor(row) : {},
        route: 'plan',
      });
    }

    // A rest day gets a note only when the evening read of tomorrow came
    // back with a pick for it.
    const tomorrow = input.tomorrow;
    if (tomorrow && tomorrow.isRest && tomorrow.notificationKey === REST_PICK_KEY && !scheduledDates.has(tomorrow.date)) {
      const fire = fireComponents(tomorrow.date, hour, minute);
      if (fire && isFarEnough(fire, now)) {
        result.push({
          kind: 'restPick',
          identifier: WORKOUT_PREFIX + tomorrow.date,
          fire,
          titleKey: 'notif.health.workout.title',
          bodyKey: 'notif.health.rest_pick.body',
          params: {},
          route: 'plan',
        });
      }
    }
  }

  if (preferences.checkInOn) {
    const fire = weeklyCheckInFire(
      preferences.checkInWeekday,
      preferences.checkInTimeMinutes,
      input.latestReviewWeekStartsOn,
      now,
    );
    if (fire) {
      result.push({
        kind: 'weeklyCheckIn',
        identifier: CHECK_IN_IDENTIFIER,
        fire,
        titleKey: 'notif.health.checkin.title',
        bodyKey: 'notif.health.checkin.body',
        params: {},
        route: 'plan.checkin',
      });
    }
  }
  return result;
}

/** The body line by kind (19.3). */
export function bodyKeyFor(kind: SessionKind): string {
  switch (kind) {
    case 'class':
      return 'notif.health.class.body';
    case 'swim':
      return 'notif.health.swim.body';
    case 'hike':
    case 'walk':
      return 'notif.health.outdoor.body';
    default:
      return 'notif.health.workout.body';
  }
}

/**
 * The session's title (when it has one) and its minutes, at least 1. As on
 * iOS, a row without a title adds no `title` (the server titles every
 * planned workout).
 */
export function paramsFor(row: Pick<SessionBrief, 'title' | 'minutes'>): Record<string, string> {
  const params: Record<string, string> = {};
  if (row.title) params.title = row.title;
  params.minutes = String(Math.max(1, row.minutes ?? 0));
  return params;
}

// ---------------------------------------------------------------------------
// Dates and times

/**
 * `YYYY-MM-DD` at hh:mm on the phone's calendar, or null when the day is not
 * one. The date is the plan's Iceland date, never shifted; the time is the
 * member's wall clock. Read the way Swift's `split(separator: "-")
 * .compactMap { Int($0) }` reads it: empty and non-numeric pieces drop out,
 * and three numbers must remain.
 */
export function fireComponents(day: string, hour: number, minute: number): FireComponents | null {
  const numbers = day
    .split('-')
    .filter((piece) => /^[+-]?\d+$/.test(piece))
    .map(Number);
  if (numbers.length !== 3) return null;
  const [year, month, dayOfMonth] = numbers as [number, number, number];
  const components: FireComponents = { year, month, day: dayOfMonth, hour, minute };
  return Number.isNaN(fireDate(components).getTime()) ? null : components;
}

/**
 * The instant the components name on the phone's calendar now (iOS
 * `calendar.date(from:)`): in the phone's CURRENT zone, which is what is
 * scheduled (see the header on zone changes).
 */
export function fireDate(components: FireComponents): Date {
  return localDate(components.year, components.month, components.day, components.hour, components.minute);
}

/** At least a minute away (iOS `fireDate.timeIntervalSince(now) >= 60`). */
function isFarEnough(fire: FireComponents, now: Date): boolean {
  return fireDate(fire).getTime() - now.getTime() >= MIN_LEAD_MS;
}

/**
 * A wall-clock time on the phone's calendar. `setFullYear`, not the Date
 * constructor, which reads years 0 to 99 as 19xx. Out-of-range parts roll
 * over, as a lenient Swift calendar does.
 */
function localDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const date = new Date(2000, 0, 1, 12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function componentsOf(date: Date): FireComponents {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * The next occurrence of the member's day and time, moved to the week after
 * when the week it would ask about already has a review.
 *
 * "Next" is strictly after a minute from now (iOS `nextDate(after: now + 59 s)`),
 * so a check-in is never scheduled for the moment the member is looking.
 *
 * THE SAME MONDAY RULE AS THE SERVER. A check-in on a Monday is about the
 * week that ended the day before; one on a Sunday is about the week that is
 * ending that day. `reviewWeek` answers with that week's Monday.
 */
export function weeklyCheckInFire(
  weekday: CheckInWeekday,
  minutes: number,
  latestReviewWeekStartsOn: string | null,
  now: Date,
): FireComponents | null {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const jsWeekday = weekday === 7 ? 0 : 1; // Date#getDay: 0 Sunday, 1 Monday
  const after = new Date(now.getTime() + 59_000);
  let fire: Date | null = null;
  // Seven days ahead covers "today, but too late" landing on the same weekday next week.
  for (let offset = 0; offset <= 7 && fire === null; offset += 1) {
    const candidate = localDate(after.getFullYear(), after.getMonth() + 1, after.getDate() + offset, hour, minute);
    if (candidate.getDay() === jsWeekday && candidate.getTime() > after.getTime()) fire = candidate;
  }
  if (fire === null || Number.isNaN(fire.getTime())) return null;
  if (latestReviewWeekStartsOn !== null && reviewWeek(fire) === latestReviewWeekStartsOn) {
    fire = localDate(fire.getFullYear(), fire.getMonth() + 1, fire.getDate() + 7, hour, minute);
  }
  return componentsOf(fire);
}

/** The Monday (`YYYY-MM-DD`) of the week a check-in fired at `date` asks about. */
export function reviewWeek(date: Date): string {
  const weekday = date.getDay(); // 0 Sunday ... 6 Saturday
  // Days back to this ISO week's Monday; a Monday asks about the week before.
  const back = ((weekday + 6) % 7) + (weekday === 1 ? 7 : 0);
  // Noon: only the date is read, and noon exists on every day (a zone can skip midnight).
  const monday = localDate(date.getFullYear(), date.getMonth() + 1, date.getDate() - back, 12, 0);
  return localDayString(monday);
}

/** `YYYY-MM-DD` of a date on the phone's calendar (iOS `HealthKitNormaliser.dayString`). */
export function localDayString(date: Date): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}
