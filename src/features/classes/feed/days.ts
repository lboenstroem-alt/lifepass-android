/**
 * The feed's day math, on the venue's calendar (iOS `ClassesViewModel`'s
 * `venueCalendar`, `isoDay`, `quickDates`, `pickerRange`, `lookAheadWindow`).
 *
 * Classes are in Iceland time, which is UTC all year (no daylight saving), so
 * every "which day is it" question is asked on a UTC calendar, never the
 * phone's: a member in New York at 20:00 on Friday is already on Saturday in
 * Reykjavík, and so is the feed.
 */
import { CLASS_FEED_MAX_SPAN_DAYS } from '../../../api/classFeed';
import { addServerDays, dateFromServerDay, serverDay } from '../../../i18n/format';

/** The featured category chips: the web tab's curated subset of the server's taggable vocabulary. */
export const FEATURED_CATEGORIES = ['yoga', 'pilates', 'hiit', 'strength', 'boxing', 'cycling', 'swimming', 'dance'] as const;

/** The "Near me" radii, in km; 5 is the default. */
export const RADIUS_OPTIONS = [1, 5, 10] as const;
export const DEFAULT_RADIUS_KM = 5;

/**
 * The date picker offers the horizon the feed can actually answer for: the
 * Abler cache syncs a fortnight ahead (server span cap: 14 days).
 */
export const MAX_PICKER_DAYS = 14;

/**
 * How far past an empty day the look-ahead reads: the server's span cap, so it
 * is one window (`day + 1 ... day + 14`).
 */
export const LOOK_AHEAD_DAYS = CLASS_FEED_MAX_SPAN_DAYS;

/** The venue-local day (`YYYY-MM-DD`) of an instant. */
export function isoDay(date: Date): string {
  return serverDay(date);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` day as the instant its venue-local day starts, or null when
 * it is not one (iOS parses with a strict POSIX formatter: "not-a-day" and
 * "2026-02-31" are no day).
 */
export function startOfIsoDay(dayIso: string): Date | null {
  if (!ISO_DAY.test(dayIso)) return null;
  const noon = dateFromServerDay(dayIso);
  if (!noon || serverDay(noon) !== dayIso) return null;
  return new Date(Date.UTC(noon.getUTCFullYear(), noon.getUTCMonth(), noon.getUTCDate()));
}

/** The venue-local day `days` after `dayIso` (null when `dayIso` is no day). */
export function addDays(dayIso: string, days: number): string | null {
  if (!startOfIsoDay(dayIso)) return null;
  return addServerDays(dayIso, days);
}

/** Today, venue-local. */
export function todayIso(now: Date): string {
  return isoDay(now);
}

/**
 * The next three venue-local days (today, tomorrow, the day after) for the
 * quick chips. Derived from the ticking `now`, so they roll at midnight.
 */
export function quickDates(now: Date): readonly string[] {
  const today = todayIso(now);
  return [0, 1, 2].map((offset) => addServerDays(today, offset) ?? today);
}

/** The days the schedule picker may choose from, inclusive. */
export interface DayRange {
  readonly first: string;
  readonly last: string;
}

/**
 * Today through the feed's sync horizon (today + 13). The empty day's "next"
 * button may land on a day past it (the look-ahead reads the 14 days after
 * the selected day, so up to today + 27); the picker must still be able to
 * show that day, so the range then reaches it.
 */
export function pickerRange(now: Date, selectedDateIso: string | null): DayRange {
  const first = todayIso(now);
  let last = addServerDays(first, MAX_PICKER_DAYS - 1) ?? first;
  if (selectedDateIso && startOfIsoDay(selectedDateIso) && selectedDateIso > last) last = selectedDateIso;
  return { first, last };
}

/** True when the active day came from the full-schedule picker rather than a quick chip. */
export function customDateActive(now: Date, selectedDateIso: string | null): boolean {
  if (!selectedDateIso) return false;
  return !quickDates(now).includes(selectedDateIso);
}

/** The day of the month in the calendar circle: the custom pick when one is active, today otherwise. */
export function circleDayNumber(now: Date, selectedDateIso: string | null): number {
  if (selectedDateIso && customDateActive(now, selectedDateIso)) {
    const day = startOfIsoDay(selectedDateIso);
    if (day) return day.getUTCDate();
  }
  return now.getUTCDate();
}

/** The picker's initial day: the active selection, else today. */
export function selectedOrToday(now: Date, selectedDateIso: string | null): string {
  if (selectedDateIso && startOfIsoDay(selectedDateIso)) return selectedDateIso;
  return todayIso(now);
}

/**
 * The look-ahead window for an empty `dayIso`: the `LOOK_AHEAD_DAYS` after it,
 * venue-local and inclusive, exactly the widest span the server accepts in
 * one request. Null when `dayIso` is no day.
 */
export function lookAheadWindow(dayIso: string): { readonly start: string; readonly end: string } | null {
  const start = addDays(dayIso, 1);
  const end = addDays(dayIso, LOOK_AHEAD_DAYS);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * True when the look-ahead after `dayIso` read no further than the feed's
 * schedule reaches, so "nothing there" means "nothing in the next two weeks".
 * The Abler cache behind the feed syncs about a fortnight ahead: from today
 * the window (tomorrow ... today + 14) is that fortnight. From any later day it
 * runs past the synced days, where an empty page only says the schedule is
 * not out yet.
 */
export function lookAheadIsTheNextTwoWeeks(dayIso: string, now: Date): boolean {
  const window = lookAheadWindow(dayIso);
  const synced = addServerDays(todayIso(now), LOOK_AHEAD_DAYS);
  if (!window || !synced) return false;
  return window.end <= synced;
}
