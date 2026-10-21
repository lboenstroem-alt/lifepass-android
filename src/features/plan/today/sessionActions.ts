/**
 * The Today card's writes (iOS `PlanTodayCard.post` and `loadAndPreview`).
 *
 * Every write is `POST /health/sessions/{id}` with a FRESH Idempotency-Key
 * per tap (a retry of the same tap would reuse it; the card has none). The
 * answer goes to the card's host (`onApplied`, iOS `onActionResult`), which
 * patches the day, the week and the upcoming rows; a refusal goes through
 * the health store's one problem table, and the two that mean "what you see
 * is stale" (changed elsewhere, or the membership gate) ask the host to read
 * the day again (`onReload`, iOS `onReload`).
 *
 * ONE ACTION AT A TIME. `useBusyAction` holds the key of the action in
 * flight: a second tap, on the same button or another, does nothing until
 * the first has answered, so a double tap never marks a session done twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, newIdempotencyKey } from '../../../api';
import {
  fetchSession,
  postSessionAction,
  useHealthStore,
  type SessionActionBody,
  type SessionActionResponse,
  type SessionView,
} from '../../../health';
import type { Lang } from '../../../i18n';
import { track, type AnalyticsEvent, type AnalyticsParams } from '../../../lib/analytics';

export interface CardActionRequest {
  readonly sessionId: string;
  readonly body: SessionActionBody;
  /** Reported once the server has taken it. */
  readonly event: AnalyticsEvent;
  readonly params?: AnalyticsParams;
  /** A toast once it is done ("Removed"). */
  readonly toastKey?: string;
}

/** How a card action ended, for tests and for the caller's own follow-up. */
export type CardActionOutcome = 'applied' | 'reloaded' | 'refused' | 'cancelled';

/** Where a card action's answer goes: the card's host (TodayCardHandlers). */
export interface CardActionSink {
  /** The server took it: patch day, week and upcoming. */
  readonly onApplied: (response: SessionActionResponse) => void;
  /** What the card shows is stale: read again. */
  readonly onReload: () => void;
}

/**
 * Sends one card action and hands its answer to `sink`. Never throws: a
 * refusal is the store's to explain (its toast), and a stale card reads again.
 */
export async function sendCardAction(request: CardActionRequest, sink: CardActionSink): Promise<CardActionOutcome> {
  try {
    const response = await postSessionAction(request.sessionId, request.body, newIdempotencyKey());
    track(request.event, request.params ?? {});
    sink.onApplied(response);
    if (request.toastKey) useHealthStore.getState().setToast(request.toastKey);
    return 'applied';
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.isCancellation) return 'cancelled';
      const outcome = useHealthStore.getState().handle(error, { foreground: true });
      if (outcome === 'changedElsewhere' || outcome === 'gate') {
        sink.onReload();
        return 'reloaded';
      }
      return 'refused';
    }
    useHealthStore.getState().setToast('health.err.changed');
    sink.onReload();
    return 'reloaded';
  }
}

/**
 * The full session for a preview (the rest day's "Do the session planned
 * for Thursday today"): null when it cannot be read, and then nothing opens,
 * as on iOS (`try?`).
 */
export async function loadSessionForPreview(sessionId: string, language: Lang): Promise<SessionView | null> {
  try {
    return await fetchSession(sessionId, language);
  } catch {
    return null;
  }
}

export interface BusyAction {
  /** The key of the action in flight, or null. */
  readonly busy: string | null;
  /** Runs `work` under `key` unless another action is in flight (then it does nothing). */
  readonly run: (key: string, work: () => Promise<unknown>) => void;
}

/** One busy key per card (iOS `busyAction`). */
export function useBusyAction(): BusyAction {
  const [busy, setBusy] = useState<string | null>(null);
  // The ref answers a tap in the same frame as the last one, before React
  // has rendered `busy`.
  const current = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback((key: string, work: () => Promise<unknown>) => {
    if (current.current !== null) return;
    current.current = key;
    setBusy(key);
    void (async () => {
      try {
        await work();
      } catch {
        // Each action handles its own failure; the lock is what matters here.
      } finally {
        current.current = null;
        if (mounted.current) setBusy(null);
      }
    })();
  }, []);
  return { busy, run };
}
