/**
 * The chat's class cards (API 0.36.0), as pure functions: the Android port of
 * iOS `CoachClassCardState` and `CoachClassCardText`
 * (Views/CoachClassCardsView.swift), so what a card offers and says is tested
 * without drawing anything (the cards are drawn by
 * src/screens/coach/ClassCardsMessage.tsx).
 *
 * Book is offered only for an open class (or one the server gave no state)
 * that has not started; a full class, one whose registration opens later,
 * one that has started since the answer came, or a state this build does not
 * know show that state instead. Every time is in Iceland time, like every
 * class time in the app, whatever zone the phone is in.
 */
import type { Lang, Params } from '../../../i18n';
import { addServerDays, classShortDay, serverDay, todayServerDay, venueTime } from '../../../i18n/format';
import type { CoachPlanClass } from '../../classes/sheet';

type Translate = (key: string, params?: Params) => string;

/** What a card offers (iOS `CoachClassCardState`). */
export type ClassCardState =
  | 'bookable'
  | 'full'
  | 'opensLater'
  | 'started'
  /** A state a later server added: no Book, and no words this build has. */
  | 'unavailable';

/**
 * Whether the card offers Book on its own word: open, or no status at all (a
 * server that sends none). Full, opens later, or a state this build does not
 * know show their state instead (iOS `CoachPlanClass.offersBook`).
 */
export function classCardOffersBook(session: Pick<CoachPlanClass, 'status'>): boolean {
  return session.status == null || session.status === 'open';
}

/** What the card offers at `now`: a class that has begun is never offered. */
export function classCardState(session: Pick<CoachPlanClass, 'startsAt' | 'status'>, now: Date): ClassCardState {
  if (session.startsAt.getTime() <= now.getTime()) return 'started';
  switch (session.status ?? null) {
    case null:
    case 'open':
      return 'bookable';
    case 'full':
      return 'full';
    case 'opens_later':
      return 'opensLater';
    default:
      return 'unavailable';
  }
}

/**
 * "12:10–13:10" today; "Tomorrow · 07:30", "Tue 13 Oct · 10:00–11:00" /
 * "þri. 13. okt. · 10:00–11:00" on another day.
 */
export function classCardWhenLine(
  session: Pick<CoachPlanClass, 'startsAt' | 'endsAt'>,
  now: Date,
  language: Lang,
  t: Translate,
): string {
  let times = venueTime(session.startsAt);
  if (session.endsAt) times += `–${venueTime(session.endsAt)}`;
  const day = serverDay(session.startsAt);
  const today = todayServerDay(now);
  if (day === today) return times;
  const label = day === addServerDays(today, 1) ? t('library.tomorrow') : classShortDay(session.startsAt, language);
  return `${label} · ${times}`;
}

/**
 * "Included in your plan · 18 left". Spots only while the class can be
 * booked: a full one says Full on its label, and the count of a class that
 * opens later is not news yet.
 */
export function classCardMetaLine(
  session: Pick<CoachPlanClass, 'priceLabel' | 'spotsLeft'>,
  state: ClassCardState,
  t: Translate,
): string | null {
  const parts: string[] = [];
  if (session.priceLabel) parts.push(session.priceLabel);
  const spots = session.spotsLeft ?? null;
  if (state === 'bookable' && spots !== null && spots > 0) {
    parts.push(t('classes.chip_left', { count: String(spots) }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The label in place of Book; null while the card offers Book. */
export function classCardStateLabel(state: ClassCardState, t: Translate): string | null {
  switch (state) {
    case 'bookable':
      return null;
    case 'full':
      return t('classes.chip_full');
    case 'opensLater':
      return t('coach.classes.opens_later');
    case 'started':
      return t('coach.classes.started');
    case 'unavailable':
      return t('classes.chip_unavailable');
  }
}
