/**
 * What Home's Today row says, as a pure function (iOS `HomeTodayRow.state`,
 * Views/Home/HomeTodayRow.swift, `ios-ux.md` 2.4).
 *
 * WHY A ROW AND NOT A CARD. Plan owns today's workout with all of its states;
 * a second copy on Home would be two state machines to keep in step and two
 * screens that disagree while one of them is mid-request. So the row renders
 * from the `health` block of `GET /profile`, which Home already loads (no
 * extra read), says one thing, and hands off to Plan. When there is nothing
 * to say it renders nothing at all.
 *
 * The first matching state wins, top to bottom:
 *   hidden unless entitled, with consent, a live (active or paused)
 *   programme and a session today;
 *   1. moved away: "Today's plan changed. See Plan.";
 *   2. planned, but done on THIS phone (the workout outbox holds it, or the
 *      Plan read in memory says done): "Done today. Nice work.";
 *   3. done: the same;
 *   4. skipped: changed;
 *   5. rest: "Rest day. A soak or a walk?";
 *   6. missed or unknown: hidden;
 *   7. a workout: "<title>, <duration>", with Start only for what the runner
 *      runs (strength, cardio, mobility);
 *   8. a class: the title, or "Booked: {activity}, {time}", hidden when the
 *      booking is the one Home's upcoming card already shows;
 *   9. rest or unknown kind: hidden.
 */
import type { ProfileProgramSummary } from '../../../api/profile';
import type { HealthAccess, SessionKind, SessionView } from '../../../health';
import { isLiveStatus } from '../../../health';
import type { Lang } from '../../../i18n';
import { duration, localTime } from '../../../i18n/format';

import type { Translate } from './copy';
import { runnerRuns } from './rules';

export type HomeTodayRowState =
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'plain' | 'startable';
      /** One line: the session, or what happened to it. */
      readonly title: string;
      /** The tile's figure. */
      readonly glyph: SessionKind;
      /** `home_today_tapped.kind`: the session's kind, never a member value. */
      readonly analyticsKind: SessionKind;
      /** The tile says done (a tick) instead of the figure. */
      readonly isDone: boolean;
      /** Start's session; null on a plain row. */
      readonly startSessionId: string | null;
    };

export interface HomeTodayRowInput {
  readonly access: HealthAccess;
  readonly hasConsent: boolean;
  readonly program: ProfileProgramSummary | null | undefined;
  /** The workout outbox holds a Save for this session id (RUN-1). */
  readonly outboxPending: (sessionId: string) => boolean;
  /** Today's session in the Plan read this phone holds, newer than the profile after a Save. */
  readonly localTodaySession: Pick<SessionView, 'id' | 'status'> | null | undefined;
  /** The booking Home's upcoming card already shows. */
  readonly upcomingBookingId: string | null;
  readonly t: Translate;
  readonly language: Lang;
}

const HIDDEN: HomeTodayRowState = { kind: 'hidden' };

export function homeTodayRowState(input: HomeTodayRowInput): HomeTodayRowState {
  const { program, t, language } = input;
  const session = program?.today;
  if (input.access !== 'entitled' || !input.hasConsent || !program || !isLiveStatus(program.status) || !session) {
    return HIDDEN;
  }

  // The profile block is older than this phone's own knowledge: a workout
  // saved here (waiting to sync, or answered since) is done, and Start would
  // run it a second time.
  const doneOnThisPhone = (): boolean => {
    if (input.outboxPending(session.sessionId)) return true;
    const local = input.localTodaySession;
    if (local && local.id === session.sessionId) return local.status === 'done';
    return false;
  };

  const kind: SessionKind = session.kind ?? 'unknown';
  const title = session.title ?? '';
  const minutes = session.minutes ?? 0;
  const status = session.status ?? 'unknown';
  const isDone = status === 'done' || doneOnThisPhone();
  const plain = (text: string, glyph: SessionKind): HomeTodayRowState => ({
    kind: 'plain',
    title: text,
    glyph,
    analyticsKind: glyph,
    isDone,
    startSessionId: null,
  });

  // A session that moved off today outranks whatever now sits here: the
  // member's day changed and the row must not pretend otherwise.
  if (session.movedAway === true) return plain(t('home.today.changed'), kind);

  if (status === 'planned' && doneOnThisPhone()) return plain(t('home.today.done'), 'rest');

  switch (status) {
    case 'done':
      return plain(t('home.today.done'), 'rest');
    case 'skipped':
      return plain(t('home.today.changed'), kind);
    case 'rest':
      return plain(t('home.today.rest'), 'rest');
    case 'missed':
    case 'unknown':
      return HIDDEN;
    case 'planned':
      break;
  }

  switch (kind) {
    case 'strength':
    case 'cardio':
    case 'mobility':
    case 'swim':
    case 'hike':
    case 'walk': {
      const label = minutes > 0 ? `${title}, ${duration(minutes, language)}` : title;
      // Start only for what the runner runs (one rule, shared with Plan).
      if (!runnerRuns(kind)) return plain(label, kind);
      return { kind: 'startable', title: label, glyph: kind, analyticsKind: kind, isDone, startSessionId: session.sessionId };
    }
    case 'class': {
      if (session.hasBooking !== true) return plain(title, kind);
      // The upcoming card above is already showing this booking.
      if (session.bookingId !== null && session.bookingId === input.upcomingBookingId) return HIDDEN;
      const time = session.bookingStartsAt ? localTime(session.bookingStartsAt) : '';
      return plain(t('plan.class.booked_short', { activity: session.bookingTitle ?? title, time }), kind);
    }
    case 'rest':
    case 'unknown':
    default:
      return HIDDEN;
  }
}

/** "Today · week 2 of 4" (a programme with no counter reads week 1 of 4). */
export function homeTodayKicker(program: Pick<ProfileProgramSummary, 'weekNo' | 'weeks'> | null | undefined, t: Translate): string {
  return t('home.today.kicker', { week: `${program?.weekNo ?? 1}`, weeks: `${program?.weeks ?? 4}` });
}
