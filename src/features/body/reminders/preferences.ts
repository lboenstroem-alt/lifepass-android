/**
 * The member's reminder choices: the Android port of iOS
 * `HealthReminderPreferences` (Services/HealthReminderService.swift) and of
 * Body and goals' `loadReminderPreferences` / `writeReminderPreferences`.
 *
 * LOCAL, PER PROFILE, NEVER SENT ANYWHERE (`ios-ux.md` 0.6). Body and goals
 * and the programme proposal card write them; the reminder planner (NOTIF-1)
 * reads them and nothing else, so they are written down ONCE, here, under
 * iOS's names (src/health/localKeys.ts `ReminderKeys`), and the health wipe
 * removes them with the rest of a member's health use.
 *
 * A MISSING KEY MEANS THE DEFAULT, everywhere: on, 07:00, on, Monday, 07:30.
 * That is not a nicety. After a withdrawal the wipe deletes every one of
 * these keys while Body and goals may still be on screen holding what the
 * member chose before; reading "missing" as "keep what you had" left a member
 * who had switched Workout day notes off, withdrawn and switched tracking back
 * on reading "off" there while every other screen (and the planner) treated
 * the same missing key as on (iOS BodyAndGoalsView `loadReminderPreferences`).
 *
 * A CHANGE RESYNCS AT ONCE, not at the next Plan read: these choices are the
 * planner's whole input (`ios-ux.md` 19.2). The planner subscribes with
 * `onReminderSyncRequested` (NOTIF-1 installs its coalesced sync there, iOS
 * `HealthReminderService.scheduleSync`); until it does, a change is stored
 * and nothing else happens, which is the truth while there is no planner.
 *
 * The values on disk are what iOS `UserDefaults` holds, written as text:
 * flags as `true` / `false`, times as minutes after midnight, the weekday as
 * the ISO number (1 Monday, 7 Sunday).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ReminderKeys } from '../../../health';
import { track } from '../../../lib/analytics';

/** What a member who never touched a reminder has (iOS `ReminderDefaults`). */
export const ReminderDefaults = {
  workoutNotesOn: true,
  /** 07:00, the default everywhere a member can meet it (Body and goals, the proposal card). */
  workoutTimeMinutes: 7 * 60,
  checkInOn: true,
  /** ISO weekday: 1 Monday or 7 Sunday. */
  checkInWeekday: 1,
  checkInTimeMinutes: 7 * 60 + 30,
} as const;

export type CheckInWeekday = 1 | 7;

export interface ReminderPreferences {
  readonly workoutNotesOn: boolean;
  /** Minutes after midnight, on the phone's own clock. */
  readonly workoutTimeMinutes: number;
  readonly checkInOn: boolean;
  readonly checkInWeekday: CheckInWeekday;
  readonly checkInTimeMinutes: number;
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  workoutNotesOn: ReminderDefaults.workoutNotesOn,
  workoutTimeMinutes: ReminderDefaults.workoutTimeMinutes,
  checkInOn: ReminderDefaults.checkInOn,
  checkInWeekday: ReminderDefaults.checkInWeekday,
  checkInTimeMinutes: ReminderDefaults.checkInTimeMinutes,
};

/** Which setting a change was, for `reminder_setting_changed.kind` (iOS's words). */
export type ReminderChangeKind = 'workoutday' | 'time' | 'weeklycheckin';

/** 06:00 to 10:00 in half hours: the workout note's times (`ios-ux.md` 10.3 card 5). */
export const MORNING_TIMES: readonly number[] = halfHours(6 * 60, 10 * 60);
/** 06:00 to 21:00 in half hours: the weekly check-in's times. */
export const DAY_TIMES: readonly number[] = halfHours(6 * 60, 21 * 60);

function halfHours(from: number, through: number): number[] {
  const out: number[] = [];
  for (let minutes = from; minutes <= through; minutes += 30) out.push(minutes);
  return out;
}

/**
 * Whether the phone refused notifications, as last seen (iOS
 * `health.reminders.<id>.denied`): Plan's adopted banner reads it. Written by
 * Body and goals each time it reads the permission, and by the proposal card
 * when its Start answered the system prompt. The same name PLAN-1's banner
 * reads (src/features/plan/shell/adoptedBanner.ts `reminderDeniedKey`). Like
 * iOS, the health wipe leaves it: it is a yes or no about notifications on
 * this phone, never a health value.
 */
export function reminderDeniedKey(profileId: string): string {
  return `health.reminders.${profileId}.denied`;
}

// ---------------------------------------------------------------------------
// Reading

/** A stored flag as `UserDefaults.bool` reads it: 'true', '1' or 'yes'; null when not stored. */
function flagOf(raw: string | null): boolean | null {
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

/** A stored whole number as `UserDefaults.integer` reads it: 0 when missing or not a number. */
function integerOf(raw: string | null): number {
  if (raw === null) return 0;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The preferences as stored, with the default for each one that is not
 * (iOS `HealthReminderPreferences.load`). A time must be after midnight and
 * a weekday Monday or Sunday, or it reads as the default too.
 */
export function preferencesFromStored(stored: {
  readonly workoutDay: string | null;
  readonly time: string | null;
  readonly weeklyCheckIn: string | null;
  readonly checkInDay: string | null;
  readonly checkInTime: string | null;
}): ReminderPreferences {
  const time = integerOf(stored.time);
  const day = integerOf(stored.checkInDay);
  const checkInTime = integerOf(stored.checkInTime);
  return {
    workoutNotesOn: flagOf(stored.workoutDay) ?? ReminderDefaults.workoutNotesOn,
    workoutTimeMinutes: time > 0 ? time : ReminderDefaults.workoutTimeMinutes,
    checkInOn: flagOf(stored.weeklyCheckIn) ?? ReminderDefaults.checkInOn,
    checkInWeekday: day === 1 || day === 7 ? day : ReminderDefaults.checkInWeekday,
    checkInTimeMinutes: checkInTime > 0 ? checkInTime : ReminderDefaults.checkInTimeMinutes,
  };
}

/** This member's choices; the defaults when storage cannot be read. */
export async function loadReminderPreferences(profileId: string): Promise<ReminderPreferences> {
  try {
    const keys = [
      ReminderKeys.workoutDay(profileId),
      ReminderKeys.time(profileId),
      ReminderKeys.weeklyCheckIn(profileId),
      ReminderKeys.checkInDay(profileId),
      ReminderKeys.checkInTime(profileId),
    ];
    const pairs = await AsyncStorage.multiGet(keys);
    const value = (key: string): string | null => pairs.find(([name]) => name === key)?.[1] ?? null;
    return preferencesFromStored({
      workoutDay: value(keys[0]!),
      time: value(keys[1]!),
      weeklyCheckIn: value(keys[2]!),
      checkInDay: value(keys[3]!),
      checkInTime: value(keys[4]!),
    });
  } catch {
    return DEFAULT_REMINDER_PREFERENCES;
  }
}

/** Whether the phone refused notifications when last seen (false when never stored). */
export async function loadNotificationsDenied(profileId: string): Promise<boolean> {
  try {
    return flagOf(await AsyncStorage.getItem(reminderDeniedKey(profileId))) ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Writing

/**
 * Writes ALL FIVE choices (iOS writes every key on every change, so a key
 * the member never touched stops reading as "missing"), reports which
 * setting changed, and asks for a resync. Called on a member's change ONLY,
 * never on a read: reading the stored values back on appear must not write
 * them again or report a setting the member never touched.
 */
export async function writeReminderPreferences(
  profileId: string,
  preferences: ReminderPreferences,
  changed: ReminderChangeKind,
): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [ReminderKeys.workoutDay(profileId), String(preferences.workoutNotesOn)],
      [ReminderKeys.time(profileId), String(preferences.workoutTimeMinutes)],
      [ReminderKeys.weeklyCheckIn(profileId), String(preferences.checkInOn)],
      [ReminderKeys.checkInDay(profileId), String(preferences.checkInWeekday)],
      [ReminderKeys.checkInTime(profileId), String(preferences.checkInTimeMinutes)],
    ]);
  } catch {
    // Not stored: the planner keeps what it had, and the rows say what the member chose.
  }
  track('reminder_setting_changed', { kind: changed });
  requestReminderSync();
}

/**
 * The proposal card's half (iOS ProgramProposalCard
 * `writeReminderPreferences(notificationsDenied:)`), written only when the
 * plan actually starts: the workout note's switch and time, and the answer to
 * the system prompt Start just raised (the only moment the app knows it,
 * and Plan's adopted banner is drawn a moment later). The check-in keys are
 * left as they are. No resync here, as on iOS: the adopt's own Plan read
 * resyncs.
 */
export async function writeWorkoutReminderChoice(
  profileId: string,
  choice: { readonly workoutNotesOn: boolean; readonly workoutTimeMinutes: number; readonly notificationsDenied: boolean },
): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [ReminderKeys.workoutDay(profileId), String(choice.workoutNotesOn)],
      [ReminderKeys.time(profileId), String(choice.workoutTimeMinutes)],
      [reminderDeniedKey(profileId), String(choice.notificationsDenied)],
    ]);
  } catch {
    // Not stored: the defaults stand.
  }
}

/** Records whether the phone refuses notifications (Plan's adopted banner reads it). */
export async function writeNotificationsDenied(profileId: string, denied: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(reminderDeniedKey(profileId), String(denied));
  } catch {
    // The banner falls back to promising nothing it cannot keep.
  }
}

// ---------------------------------------------------------------------------
// The planner's hook

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Called whenever the choices change or the permission was just answered, so
 * the planner can reschedule (NOTIF-1 installs its coalesced sync here).
 * Answers the unsubscribe.
 */
export function onReminderSyncRequested(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks every subscriber to resync. A listener that throws never stops the others. */
export function requestReminderSync(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // The planner's own problem; the next change asks again.
    }
  }
}

// ---------------------------------------------------------------------------
// Words

/**
 * "07:00": a reminder time is a WALL-CLOCK time on the member's own phone,
 * 24-hour in both languages (iOS `HealthFormat.time`). Written from the
 * minutes directly: a time built on a calendar date can land in a year with
 * another offset (iOS once drew 07:00 as "06:43" that way).
 */
export function reminderTimeLabel(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60) % 24;
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** "Mondays" / "Sundays" (`bodygoals.day.*`). */
export function checkInDayKey(weekday: CheckInWeekday): string {
  return weekday === 7 ? 'bodygoals.day.sunday' : 'bodygoals.day.monday';
}

/** Tests: no planner subscribed. */
export function resetReminderSyncListenersForTests(): void {
  listeners.clear();
}
