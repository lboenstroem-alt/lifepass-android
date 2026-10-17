/**
 * When a parked Plan action can be answered, and when a parked scroll lands:
 * the rules of iOS `PlanView.canAnswer` and `deliverScroll`, as pure
 * functions.
 *
 * WHY ACTIONS WAIT. A tapped weekly check-in notification produces a COLD
 * LAUNCH (the app is not running when a notification is tapped hours after
 * the last use), and on a cold launch Plan appears before the profile and
 * before the Today read: whether the check-in is due is unknown, and so is
 * the member's access. Answering then always fell through to the "already
 * checked in" branch, so the one launch a notification actually produces was
 * the one launch where the sheet never opened. An action now waits for the
 * read that decides it, and is dropped after five minutes
 * (`PLAN_ACTION_WINDOW_MS`, src/stores/intentStore.ts): long enough for a
 * cold launch to sign in and read the day on a bad connection, short enough
 * that it is still the tap the member made.
 */
import type { HealthAccess, HealthLoadState } from '../../../health';
import { PLAN_ACTION_WINDOW_MS, type PlanAction } from '../../../stores/intentStore';

import type { PlanSectionAnchor } from './sectionRule';

/** What the screen knows right now, for `canAnswerPlanAction`. */
export interface PlanActionContext {
  readonly access: HealthAccess;
  /**
   * The profile has been read, so `access` is an answer. Android resolves a
   * missing profile to `not_member` rather than iOS's `unknown`, so the
   * absence of a profile is asked for directly.
   */
  readonly accessKnown: boolean;
  readonly hasConsent: boolean;
  readonly hasProfile: boolean;
  readonly loadState: HealthLoadState;
  /** The session id today's read (or its cache) holds. */
  readonly todaySessionId: string | null;
}

/** True once the action is older than the window (iOS `> parkedActionWindow`). */
export function isParkedActionExpired(parkedAt: number, now: number = Date.now()): boolean {
  return now - parkedAt > PLAN_ACTION_WINDOW_MS;
}

/**
 * Whether this action can be answered with what is loaded right now.
 *
 * Only the weekly check-in, a workout start and the feedback actions have an
 * answer that depends on a read; every other action either presents
 * something of its own or asks for a route, and waiting would only delay it.
 */
export function canAnswerPlanAction(action: PlanAction, parkedAt: number, context: PlanActionContext): boolean {
  switch (action.kind) {
    case 'startWorkout': {
      // Today's session may already be in memory (a cold launch reads the
      // cache inside the load); otherwise wait for the read to answer.
      if (context.todaySessionId === action.sessionId) return true;
      switch (context.loadState.kind) {
        case 'loaded':
          return context.loadState.at.getTime() >= parkedAt;
        case 'failed':
          return true;
        case 'idle':
        case 'loading':
          return false;
      }
      return false;
    }
    case 'openWeeklyCheckIn': {
      // No profile yet: `access` is the absence of an answer, and the sheet
      // is gated on entitlement.
      if (!context.accessKnown) return false;
      // A member with no consent, or a minor, gets no Today read at all, so
      // there is nothing left to wait for: the gate or the under-18 card IS
      // the answer, and the fallback scroll lands on whatever is there.
      if (!context.hasConsent || context.access === 'minor') return true;
      return context.loadState.kind === 'loaded' || context.loadState.kind === 'failed';
    }
    case 'openFeedback':
    case 'openFeedbackNote':
      // Whether the feature and the consent are there comes with the
      // profile; a cold launch waits for it rather than dropping the tap.
      return context.hasProfile;
    default:
      return true;
  }
}

/** What a parked scroll does now (iOS `deliverScroll`). */
export type ScrollDecision = 'scroll' | 'wait' | 'drop';

export interface ScrollContext {
  /** The review card (or its prompt) is drawn for the day on screen. */
  readonly hasReviewSection: boolean;
  /** The feedback card has something to draw. */
  readonly showsFeedbackSection: boolean;
  readonly healthLoadState: HealthLoadState['kind'];
  /** The feedback read's state ('idle' when the feature is not there). */
  readonly feedbackLoadState: 'idle' | 'loading' | 'loaded' | 'failed';
}

/**
 * THE TARGET IS KEPT UNTIL IT EXISTS. A parked action is consumed before the
 * read has returned, so on a cold launch from the notification the review
 * card is not on screen yet and a scroll would be a silent no-op: the member
 * would land at the top of the page with nothing to show for the tap. So the
 * request survives, and the read landing tries it again. A finished read
 * with nothing to show gives up rather than holding it for the session.
 */
export function scrollDecision(target: PlanSectionAnchor, context: ScrollContext): ScrollDecision {
  if (target === 'feedback' && !context.showsFeedbackSection) {
    return context.feedbackLoadState === 'loaded' || context.feedbackLoadState === 'failed' ? 'drop' : 'wait';
  }
  if (target === 'review' && !context.hasReviewSection) {
    return context.healthLoadState === 'loaded' ? 'drop' : 'wait';
  }
  return 'scroll';
}
