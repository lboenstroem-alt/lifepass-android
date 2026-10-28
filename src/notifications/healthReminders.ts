/**
 * The health reminders on the phone: the Android port of iOS
 * `HealthReminderService` (Services/HealthReminderService.swift, `ios-ux.md`
 * 19.2, NOTIFICATIONS.md). It makes the pending workout-day notes and the
 * weekly check-in equal to what the planner (./healthReminderPlanner.ts)
 * wants, and nothing else.
 *
 * EVERYTHING HERE IS LOCAL (owner ruling 4). There is no push: every note is
 * a date trigger scheduled on this phone from what it already knows (the
 * Today read, the member's choices in Body and goals), on the `health`
 * channel, under the `health.` prefix the local wipe clears.
 *
 * IDEMPOTENT AND CHEAP. A sync may run after every read: it removes what is
 * no longer wanted and adds the rest (the same identifier replaces the
 * content in place). A burst of changes (a read, then an action, then a
 * consent change) is coalesced into one sync 400 ms later, and syncs never
 * overlap: one running and at most one waiting.
 *
 * WHEN IT RUNS (iOS `ContentView`): each activation of a signed-in member,
 * every change to the Today read, to the consent or to the health access,
 * and every change in Body and goals or answer to the permission prompt
 * there (`onReminderSyncRequested`).
 *
 * NEVER ALONGSIDE A TODAY READ. iOS `activateHealth` awaits the Today read
 * and only then syncs. Here F7's activation hook (`health.activate`) starts
 * that read in parallel with this module's, so a sync that comes due while
 * a read is in flight (`loadState` 'loading') stops before planning, and the
 * read settling, landed or failed, asks for the sync again (the health store
 * subscription below). So the plan comes from what the read brought, and
 * the evening read of tomorrow is strictly after today's ("serial, after
 * today's" on iOS).
 *
 * WHAT IT NEVER DOES:
 * - Ask for the permission. Not asked yet means stop; this is never the place
 *   to ask (19.7). Refused means nothing of the planner's stays pending.
 * - Plan without today's read. A day read for another Iceland date (a
 *   cached yesterday) is not today: what is pending stays until a read says
 *   otherwise.
 * - Put a number from the body, Health Connect or the food log on a lock
 *   screen (the planner's rule).
 *
 * Not ported: iOS `applyWakeNote`, which swaps today's pending note for its
 * variant after an Apple Health background wake. Android has no Health
 * Connect sync (owner decision), so there is no wake to do it from; the next
 * foreground's Today read brings the variant instead.
 */
import { AppState } from 'react-native';

import { registerActivationHook, registerSignOutCleaner } from '../app/signOut';
import { requestedFixtureState } from '../dev/fixtureSession';
import { loadReminderPreferences, onReminderSyncRequested } from '../features/body';
import { fetchHealthDay, useHealthStore } from '../health';
import { translate, type Lang } from '../i18n';
import { addServerDays, todayServerDay } from '../i18n/format';
import { selectHasHealthConsent, useAppStore } from '../stores/appStore';

import {
  desiredReminders,
  fireDate,
  isPlannerIdentifier,
  WORKOUT_PREFIX,
  type PlannedReminder,
  type TomorrowRead,
} from './healthReminderPlanner';
import { permissionStatus } from './permissions';
import { removeDelivered, removePending, scheduleAt, type LocalNotificationContent } from './scheduler';

/** A burst of changes becomes one sync this long after the last of them (iOS `scheduleSync`). */
export const HEALTH_REMINDER_SYNC_DELAY_MS = 400;
/** From this local time on, a sync reads tomorrow once (19.4): 20:30. */
export const EVENING_READ_FROM_MINUTES = 20 * 60 + 30;
/** How long the evening read of tomorrow is kept: an hour, in memory only. */
export const TOMORROW_READ_KEPT_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The notification a planned reminder becomes (19.3)

export interface HealthReminderNotification {
  readonly identifier: string;
  /** The member's wall-clock time on the plan date, on this phone's calendar. */
  readonly date: Date;
  readonly content: LocalNotificationContent;
  /** iOS groups them in the `health` thread; Android files them on the `health` channel. */
  readonly channel: 'health';
}

/**
 * The words in `language` (the ACCOUNT language, as iOS writes them), the
 * title and minutes filled in, and the route a tap follows.
 */
export function notificationFor(reminder: PlannedReminder, language: Lang): HealthReminderNotification {
  return {
    identifier: reminder.identifier,
    date: fireDate(reminder.fire),
    content: {
      title: translate(reminder.titleKey, language),
      body: translate(reminder.bodyKey, language, reminder.params),
      data: { route: reminder.route },
    },
    channel: 'health',
  };
}

// ---------------------------------------------------------------------------
// The evening read of tomorrow (19.4)

interface TomorrowCache {
  /** Whose read it is: another member signing in within the hour never plans from it. */
  readonly profileId: string;
  readonly date: string;
  readonly fetchedAt: number;
  readonly read: TomorrowRead;
}

let tomorrowCache: TomorrowCache | null = null;

/**
 * On a sync at or after 20:30 local, tomorrow is read once (kept for an
 * hour), so tomorrow's rest pick is scheduled tonight. Only while the app is
 * in the foreground. A read that fails plans nothing for tomorrow's rest day.
 */
async function eveningReadOfTomorrow(
  profileId: string,
  language: Lang,
  serverToday: string,
  now: Date,
): Promise<TomorrowRead | null> {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < EVENING_READ_FROM_MINUTES) return null;
  const tomorrow = addServerDays(serverToday, 1);
  if (tomorrow === null) return null;
  const cached = tomorrowCache;
  if (
    cached !== null &&
    cached.profileId === profileId &&
    cached.date === tomorrow &&
    now.getTime() - cached.fetchedAt < TOMORROW_READ_KEPT_MS
  ) {
    return cached.read;
  }
  if (AppState.currentState === 'background') return null;
  try {
    const day = await fetchHealthDay({ date: tomorrow, language });
    const session = day.day?.session ?? null;
    const read: TomorrowRead = {
      date: tomorrow,
      isRest: session?.kind === 'rest' || session?.status === 'rest',
      notificationKey: day.note?.notificationKey ?? null,
    };
    tomorrowCache = { profileId, date: tomorrow, fetchedAt: now.getTime(), read };
    return read;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The sync (19.2)

/** The same member is still signed in (an answer for one member never schedules for the next). */
function stillSignedIn(profileId: string): boolean {
  const app = useAppStore.getState();
  return app.isAuthenticated && app.profile?.id === profileId;
}

/**
 * Brings the pending health reminders in line with the planner, once. Never
 * throws. Use `scheduleHealthReminderSync` (coalesced) or
 * `runHealthReminderSync` (serial) rather than this directly.
 */
export async function syncHealthReminders(): Promise<void> {
  // A development fixture run is not a member's phone (iOS DEBUG `suppressesSystemPrompts`).
  if (requestedFixtureState() !== null) return;
  const app = useAppStore.getState();
  const profileId = app.profile?.id ?? null;
  if (!app.isAuthenticated || profileId === null) return;
  const language = app.language;

  // 1. The permission. Refused: nothing of the planner's stays pending. Not
  //    asked yet: stop, this is never the place to ask (19.7).
  const permission = await permissionStatus();
  if (permission === 'denied') {
    await removePending(isPlannerIdentifier);
    return;
  }
  if (permission !== 'granted') return;

  // 2. Who may have them at all: consent, and an active membership.
  const current = useAppStore.getState();
  if (!stillSignedIn(profileId)) return;
  const eligible = selectHasHealthConsent(current) && current.healthAccess === 'entitled';
  if (!eligible) {
    await removePending(isPlannerIdentifier);
    return;
  }

  // A Today read in flight: what it brings is what to plan from, and
  // tomorrow is read after it, never alongside. Its settling syncs again.
  const health = useHealthStore.getState();
  if (health.loadState.kind === 'loading') return;

  // Without today's read there is no upcoming list to plan from; what is
  // pending stays until a read says otherwise.
  const now = new Date();
  const serverToday = todayServerDay(now);
  const day = health.today;
  if (day === null || day.date !== serverToday) return;
  const programActive = day.program?.status === 'active';

  // 3. The evening read of tomorrow, after today's (no Today read is in
  //    flight, checked just above with nothing awaited since).
  const tomorrow = programActive ? await eveningReadOfTomorrow(profileId, language, serverToday, now) : null;
  const preferences = await loadReminderPreferences(profileId);

  const desired = desiredReminders({
    upcoming: day.upcoming ?? [],
    todayNote: day.note,
    tomorrow,
    latestReviewWeekStartsOn: day.review?.weekStartsOn ?? null,
    programActive,
    eligible: true,
    preferences,
    now,
  });

  // The member may have left while the reads ran: what was planned for them
  // is not scheduled after the sign-out's wipe.
  if (!stillSignedIn(profileId)) return;

  // 4. Remove what is no longer wanted, then add (the same identifier
  //    replaces the content in place).
  const wanted = new Set(desired.map((reminder) => reminder.identifier));
  await removePending((identifier) => isPlannerIdentifier(identifier) && !wanted.has(identifier));
  for (const reminder of desired) {
    if (!stillSignedIn(profileId)) break;
    const notification = notificationFor(reminder, language);
    await scheduleAt(notification.identifier, notification.date, notification.content, notification.channel, now);
  }
  // A sign-out while these were being added may have wiped before the last
  // of them landed: nothing planned for the member who left stays behind.
  if (!stillSignedIn(profileId)) {
    await removePending(isPlannerIdentifier);
    return;
  }

  // 5. A delivered note for today whose session is done, skipped or moved
  //    away leaves the shade.
  const status = day.day?.session?.status ?? null;
  if (status === 'done' || status === 'skipped' || (day.day?.movedAway ?? null) !== null) {
    const todayNote = WORKOUT_PREFIX + serverToday;
    await removeDelivered((identifier) => identifier === todayNote);
  }
}

// ---------------------------------------------------------------------------
// Coalescing

let timer: ReturnType<typeof setTimeout> | null = null;
/** Every sync runs after the one before it. */
let chain: Promise<void> = Promise.resolve();
/** The sync waiting its turn, which every further request joins. */
let waiting: Promise<void> | null = null;

/**
 * A sync now, after the one in progress. Requests while one is waiting join
 * it, so a burst gives one more sync, not one each.
 */
export function runHealthReminderSync(): Promise<void> {
  if (waiting !== null) return waiting;
  const next = chain
    .then(() => {
      waiting = null;
      return syncHealthReminders();
    })
    .catch(() => undefined);
  waiting = next;
  chain = next;
  return next;
}

/** A sync 400 ms after the last of a burst of changes (iOS `HealthReminderService.scheduleSync`). */
export function scheduleHealthReminderSync(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runHealthReminderSync();
  }, HEALTH_REMINDER_SYNC_DELAY_MS);
}

/** At a sign-out: no coalesced sync left to run, and tomorrow's read forgotten. */
function forgetMember(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  tomorrowCache = null;
}

// ---------------------------------------------------------------------------
// Installation

let installed = false;

/**
 * Wires the sync to everything that changes its answer (once; loaded with
 * the notification layer's session hooks, ./reminderStartup.ts).
 */
export function installHealthReminders(): void {
  if (installed) return;
  installed = true;

  // Body and goals: a changed choice, or the permission just answered there.
  onReminderSyncRequested(() => scheduleHealthReminderSync());

  // Each activation (the first profile read of a sign-in, every return to
  // the foreground). F7's activation hook reads Today for a member with a
  // live plan at the same moment; if that read is still in flight when this
  // sync comes due, the sync stops and the read settling runs it (below).
  registerActivationHook('notifications.health-reminders', () => scheduleHealthReminderSync());

  registerSignOutCleaner('notifications.health-reminders', () => forgetMember());

  // Every read and every action answer rewrites today's day; the reminders
  // follow it. A read that settles without changing it (it failed) syncs
  // too: a sync that came due while it was in flight stopped for it, and
  // iOS syncs after the activation read whatever its outcome.
  useHealthStore.subscribe((state, previous) => {
    const readSettled = previous.loadState.kind === 'loading' && state.loadState.kind !== 'loading';
    if (state.today !== previous.today || readSettled) scheduleHealthReminderSync();
  });

  // A consent or membership change (a grant, a withdrawal, a lapse, a sign-in).
  useAppStore.subscribe((state, previous) => {
    if (
      selectHasHealthConsent(state) !== selectHasHealthConsent(previous) ||
      state.healthAccess !== previous.healthAccess
    ) {
      scheduleHealthReminderSync();
    }
  });
}

/** Tests: no coalesced sync pending, nothing kept, no sync waiting. The wiring stays installed. */
export function resetHealthRemindersForTests(): void {
  forgetMember();
  chain = Promise.resolve();
  waiting = null;
}
