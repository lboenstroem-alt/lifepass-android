/**
 * What every row of the Today card reads: the translator, the gates (read
 * only, offline), the one busy key, the layout at large text, and where the
 * card's taps go. iOS passes these to `PlanTodayCard` as properties and
 * closures; the rows here read them from one context instead of threading a
 * dozen props through each.
 */
import { createContext, useContext } from 'react';

import type { HealthDay, SessionView } from '../../../health';
import type { Lang, Params } from '../../../i18n';

import type { CardActionRequest } from './sessionActions';

/** Where the card's taps go (iOS `PlanTodayCard`'s closures, wired by the Today section). */
export interface TodayCardActions {
  /** Start, Resume or Do it now: the runner on this session. */
  readonly onPresentRunner: (session: SessionView) => void;
  /** Resume the workout `runner.json` holds for ANOTHER session. */
  readonly onResumeSavedRunner: () => void;
  /** The weekly check-in sheet (PLAN-5). */
  readonly onPresentCheckIn: () => void;
  /** Book a class: class discovery on the session's category and date. */
  readonly onOpenClasses: (session: SessionView) => void;
  /** View booking: Profile's bookings. */
  readonly onOpenBookings: () => void;
  readonly onOpenPoolPicker: () => void;
  readonly onOpenSight: (slug: string) => void;
  readonly onOpenVenue: (slug: string) => void;
  /** Start the next block: the Coach's programme wizard. */
  readonly onStartNextBlock: () => void;
  readonly onResumePlan: () => void;
  readonly onOpenNoteWhy: () => void;
  /** No energy today, or Skip it on a missed row (`skipMode`). */
  readonly onOpenNoEnergy: (session: SessionView, skipMode: boolean) => void;
  readonly onOpenPreview: (session: SessionView, entry: string) => void;
  /** The rest day's "Do the session planned for {day} today": read the session, then preview it. */
  readonly onLoadAndPreview: (sessionId: string, entry: string) => void;
  readonly onOpenLogWorkout: (session: SessionView) => void;
}

export interface TodayCardContextValue {
  readonly day: HealthDay;
  readonly t: (key: string, params?: Params) => string;
  readonly language: Lang;
  readonly isToday: boolean;
  readonly isFuture: boolean;
  readonly isPaused: boolean;
  /** Not entitled: the card hides every write. */
  readonly readOnly: boolean;
  readonly isOffline: boolean;
  /** The action in flight (its busy key), or null. */
  readonly busy: string | null;
  /** Runs `work` under `key` unless another action is in flight. */
  readonly runBusy: (key: string, work: () => Promise<unknown>) => void;
  /** Sends a session action under `busyKey` (one at a time). */
  readonly post: (busyKey: string, request: CardActionRequest) => void;
  /** Accessibility text sizes: action rows become columns. */
  readonly actionsStack: boolean;
  /** The workout outbox holds a Save for the session on this card. */
  readonly outboxPending: boolean;
  readonly actions: TodayCardActions;
}

const TodayCardContext = createContext<TodayCardContextValue | null>(null);

export const TodayCardProvider = TodayCardContext.Provider;

export function useTodayCard(): TodayCardContextValue {
  const value = useContext(TodayCardContext);
  if (!value) throw new Error('useTodayCard outside the Today card');
  return value;
}
