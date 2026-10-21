/**
 * Parked Plan actions (iOS `PlanView.canAnswer` / `deliverParkedAction`):
 * each waits for the read that can answer it and is dropped after five
 * minutes; a parked scroll waits for its section and gives up once a
 * finished read has nothing to show.
 */
import type { HealthLoadState } from '../../../../health';
import { PLAN_ACTION_WINDOW_MS, type PlanAction } from '../../../../stores/intentStore';
import { canAnswerPlanAction, isParkedActionExpired, scrollDecision, type PlanActionContext } from '../parkedActions';
import { PLAN_SECTION_ANCHORS, planBodyAnchors } from '../sectionRule';

const PARKED_AT = Date.UTC(2026, 9, 17, 8, 0, 0);

function context(overrides: Partial<PlanActionContext> = {}): PlanActionContext {
  return {
    access: 'entitled',
    accessKnown: true,
    hasConsent: true,
    hasProfile: true,
    loadState: { kind: 'idle' },
    todaySessionId: null,
    ...overrides,
  };
}

const loadedAt = (ms: number): HealthLoadState => ({ kind: 'loaded', at: new Date(ms) });

describe('the five-minute window', () => {
  it('keeps an action for five minutes and drops it after', () => {
    expect(isParkedActionExpired(PARKED_AT, PARKED_AT)).toBe(false);
    expect(isParkedActionExpired(PARKED_AT, PARKED_AT + PLAN_ACTION_WINDOW_MS)).toBe(false);
    expect(isParkedActionExpired(PARKED_AT, PARKED_AT + PLAN_ACTION_WINDOW_MS + 1)).toBe(true);
    expect(PLAN_ACTION_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

describe('startWorkout', () => {
  const action: PlanAction = { kind: 'startWorkout', sessionId: 's-1' };

  it("answers at once when today's session is already in memory", () => {
    expect(canAnswerPlanAction(action, PARKED_AT, context({ todaySessionId: 's-1' }))).toBe(true);
  });

  it('otherwise waits for a read that landed after the tap, or a failure', () => {
    expect(canAnswerPlanAction(action, PARKED_AT, context())).toBe(false);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: { kind: 'loading' } }))).toBe(false);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: loadedAt(PARKED_AT - 1) }))).toBe(false);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: loadedAt(PARKED_AT) }))).toBe(true);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: { kind: 'failed', code: 'offline' } }))).toBe(true);
  });
});

describe('openWeeklyCheckIn', () => {
  const action: PlanAction = { kind: 'openWeeklyCheckIn' };

  it('waits for the profile, since access gates the sheet', () => {
    expect(canAnswerPlanAction(action, PARKED_AT, context({ accessKnown: false, loadState: loadedAt(PARKED_AT) }))).toBe(false);
  });

  it('waits for the read once access and consent are known', () => {
    expect(canAnswerPlanAction(action, PARKED_AT, context())).toBe(false);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: { kind: 'loading' } }))).toBe(false);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: loadedAt(PARKED_AT - 10_000) }))).toBe(true);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ loadState: { kind: 'failed', code: 'x' } }))).toBe(true);
  });

  it('answers at once for a member with no read to wait for (no consent, a minor)', () => {
    expect(canAnswerPlanAction(action, PARKED_AT, context({ hasConsent: false }))).toBe(true);
    expect(canAnswerPlanAction(action, PARKED_AT, context({ access: 'minor' }))).toBe(true);
  });
});

describe('the feedback actions and the routes', () => {
  it('feedback waits for the profile', () => {
    for (const action of [{ kind: 'openFeedback', reportId: null }, { kind: 'openFeedbackNote' }] as PlanAction[]) {
      expect(canAnswerPlanAction(action, PARKED_AT, context({ hasProfile: false }))).toBe(false);
      expect(canAnswerPlanAction(action, PARKED_AT, context())).toBe(true);
    }
  });

  it('a route never waits', () => {
    const routes: PlanAction[] = [
      { kind: 'openDiary', date: '2026-10-17' },
      { kind: 'showAdoptedBanner', startsOn: '2026-10-19' },
      { kind: 'openProposal' },
      { kind: 'openPastPlans' },
      { kind: 'openDraft', mealId: 'm-1' },
    ];
    for (const action of routes) {
      expect(canAnswerPlanAction(action, PARKED_AT, context({ hasProfile: false, accessKnown: false }))).toBe(true);
    }
  });
});

describe('a parked scroll', () => {
  const base = {
    hasReviewSection: false,
    showsFeedbackSection: false,
    healthLoadState: 'idle',
    feedbackLoadState: 'idle',
    bodyAnchors: PLAN_SECTION_ANCHORS,
  } as const;

  it('scrolls once its section is there', () => {
    expect(scrollDecision('review', { ...base, hasReviewSection: true })).toBe('scroll');
    expect(scrollDecision('feedback', { ...base, showsFeedbackSection: true })).toBe('scroll');
    expect(scrollDecision('history', base)).toBe('scroll');
  });

  it('the review waits for the read, and gives up when a finished read has none', () => {
    expect(scrollDecision('review', base)).toBe('wait');
    expect(scrollDecision('review', { ...base, healthLoadState: 'loading' })).toBe('wait');
    expect(scrollDecision('review', { ...base, healthLoadState: 'failed' })).toBe('wait');
    expect(scrollDecision('review', { ...base, healthLoadState: 'loaded' })).toBe('drop');
  });

  it("the feedback waits for the feedback's own read", () => {
    expect(scrollDecision('feedback', { ...base, healthLoadState: 'loaded' })).toBe('wait');
    expect(scrollDecision('feedback', { ...base, feedbackLoadState: 'loading' })).toBe('wait');
    expect(scrollDecision('feedback', { ...base, feedbackLoadState: 'loaded' })).toBe('drop');
    expect(scrollDecision('feedback', { ...base, feedbackLoadState: 'failed' })).toBe('drop');
  });

  it('gives up on a section the body on screen has no place for, and waits under the skeleton', () => {
    // A feedback notification for a lapsed member whose consent stands: the
    // gate draws no feedback card, so the request must not outlive the tap.
    const gate = planBodyAnchors('gate', true);
    expect(scrollDecision('feedback', { ...base, showsFeedbackSection: true, bodyAnchors: gate })).toBe('drop');
    expect(scrollDecision('review', { ...base, hasReviewSection: true, bodyAnchors: gate })).toBe('scroll');
    expect(scrollDecision('review', { ...base, hasReviewSection: true, bodyAnchors: planBodyAnchors('gate', false) })).toBe('drop');
    expect(scrollDecision('review', { ...base, hasReviewSection: true, bodyAnchors: planBodyAnchors('error', true) })).toBe('drop');
    expect(scrollDecision('feedback', { ...base, showsFeedbackSection: true, bodyAnchors: planBodyAnchors('minor', true) })).toBe('drop');
    expect(scrollDecision('feedback', { ...base, showsFeedbackSection: true, bodyAnchors: planBodyAnchors('intro', true) })).toBe('scroll');
    expect(scrollDecision('feedback', { ...base, showsFeedbackSection: true, bodyAnchors: planBodyAnchors('loading', true) })).toBe('wait');
  });
});
