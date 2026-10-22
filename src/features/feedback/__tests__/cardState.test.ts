/**
 * What the Plan card draws (iOS FeedbackCardStateTests, `SPEC` 9.2, 13.3),
 * the owner's one-time offer to include food and weight for a member without
 * a plan, and which action a line may offer (`SPEC` 9.6).
 */
import {
  decodeFeedbackNote,
  decodeFeedbackReportSummary,
  feedbackSettings,
  feedbackSummary,
  type FeedbackAction,
  type FeedbackSettings,
  type FeedbackSummary,
} from '../../../api/feedback';
import type { HealthAccess } from '../../../api/profile';
import { lookup } from '../../../i18n';
import { feedbackActionLabelKey, isCardEmpty, resolveFeedbackAction, resolveFeedbackCardState } from '../cardState';

const now = new Date('2026-10-12T12:00:00Z');

function latest({
  current = true,
  seenAt = null,
  createdAt = '2026-10-01T06:12:00Z',
}: { current?: boolean; seenAt?: string | null; createdAt?: string } = {}) {
  return decodeFeedbackReportSummary(
    {
      id: 'r-1',
      kind: 'monthly',
      periodMonth: '2026-09',
      title: 'September 2026',
      createdAt,
      seenAt,
      current,
      highlights: ['One.', 'Two.', 'Three.'],
    },
    'latest',
  );
}

const note = decodeFeedbackNote(
  {
    id: 'n-1',
    periodMonth: '2026-10',
    expiresOn: '2026-10-22',
    message: { key: 'note.sleep_short', text: 'Short nights.', action: null },
  },
  'note',
);

function state(
  summary: FeedbackSummary | null,
  {
    introDismissed = false,
    offerDismissed = false,
    foodOffPending = false,
    hasLivePlan = true,
  }: { introDismissed?: boolean; offerDismissed?: boolean; foodOffPending?: boolean; hasLivePlan?: boolean } = {},
) {
  return resolveFeedbackCardState({
    summary,
    introDismissed,
    foodOfferDismissed: offerDismissed,
    foodOffPending,
    hasLivePlan,
    now,
  });
}

const planSettings = feedbackSettings({ includeFoodAndWeight: true, includeFoodAndWeightSource: 'plan' });
const noPlanSettings = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'no_plan' });
const next = { periodMonth: '2026-10', readyOn: '2026-11-01', expected: true };

describe('combinations', () => {
  it('nothing before the summary has loaded', () => {
    expect(isCardEmpty(state(null))).toBe(true);
    expect(isCardEmpty(state(feedbackSummary({ settings: null })))).toBe(true);
  });

  it('the note and the month together', () => {
    const result = state(feedbackSummary({ settings: planSettings, latest: latest(), note }));
    expect(result.note?.id).toBe('n-1');
    expect(result.monthly).toBe('full');
    expect(result.showsIntro).toBe(false);
    expect(result.showsFoodOffer).toBe(false);
  });

  it('the note alone: an older report is not on the card, and the member has met the feature', () => {
    const result = state(
      feedbackSummary({ settings: planSettings, latest: latest({ current: false, seenAt: '2026-09-02T10:00:00Z' }), note }),
    );
    expect(result.note).not.toBeNull();
    expect(result.monthly).toBeNull();
    expect(result.showsIntro).toBe(false);
  });

  it('a note with nothing to say is not drawn', () => {
    const empty = decodeFeedbackNote({ id: 'n-2', message: { key: 'k', text: '  ', action: null } }, 'note');
    expect(state(feedbackSummary({ settings: planSettings, note: empty, latest: latest() })).note).toBeNull();
  });

  it('an unread report is the full card whatever its age', () => {
    const old = latest({ createdAt: '2026-09-01T06:00:00Z' });
    expect(state(feedbackSummary({ settings: planSettings, latest: old })).monthly).toBe('full');
  });

  it('a read report shrinks to a row after seven days', () => {
    const recent = latest({ seenAt: '2026-10-06T10:00:00Z', createdAt: '2026-10-06T06:12:00Z' });
    expect(state(feedbackSummary({ settings: planSettings, latest: recent })).monthly).toBe('full');
    const weekOld = latest({ seenAt: '2026-10-01T19:00:00Z', createdAt: '2026-10-01T06:12:00Z' });
    expect(state(feedbackSummary({ settings: planSettings, latest: weekOld })).monthly).toBe('compact');
  });

  it('the intro only without a report, with the monthly switch on, and not dismissed', () => {
    const fresh = state(feedbackSummary({ settings: planSettings, nextReport: next }));
    expect(fresh.showsIntro).toBe(true);
    expect(fresh.firstReportDay).toBe('2026-11-01');

    expect(state(feedbackSummary({ settings: planSettings, nextReport: next }), { introDismissed: true }).showsIntro).toBe(false);
    const monthlyOff: FeedbackSettings = { ...planSettings, monthlyReport: false };
    expect(state(feedbackSummary({ settings: monthlyOff })).showsIntro).toBe(false);
    expect(state(feedbackSummary({ settings: planSettings, latest: latest() })).showsIntro).toBe(false);

    const notExpected = state(
      feedbackSummary({ settings: planSettings, nextReport: { periodMonth: '2026-10', readyOn: '2026-11-01', expected: false } }),
    );
    expect(notExpected.showsIntro).toBe(true);
    expect(notExpected.firstReportDay).toBeNull();
  });
});

describe('the food and weight offer (owner decision)', () => {
  it('a member without a plan is offered food and weight once instead of the intro', () => {
    const offered = state(feedbackSummary({ settings: noPlanSettings, foodAndWeightOffer: true }), { hasLivePlan: false });
    expect(offered.showsFoodOffer).toBe(true);
    expect(offered.showsIntro).toBe(false);
    expect(isCardEmpty(offered)).toBe(false);
  });

  it('the offer is gone once closed or answered', () => {
    const summary = feedbackSummary({ settings: noPlanSettings, foodAndWeightOffer: true });
    const closed = state(summary, { introDismissed: true, offerDismissed: true, hasLivePlan: false });
    expect(closed.showsFoodOffer).toBe(false);
    expect(closed.showsIntro).toBe(false);
    const answered = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'member', updatedAt: now });
    expect(state(feedbackSummary({ settings: answered, foodAndWeightOffer: false }), { hasLivePlan: false }).showsFoodOffer).toBe(
      false,
    );
  });

  it('the offer never follows a safety answer, not even while its request is on its way', () => {
    const summary = feedbackSummary({ settings: noPlanSettings, foodAndWeightOffer: true });
    expect(state(summary, { foodOffPending: true, hasLivePlan: false }).showsFoodOffer).toBe(false);
    const afterSafety = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'member', updatedAt: now });
    // Even a stale summary that still says "offer" is overruled by the settings the safety hook wrote.
    expect(state(feedbackSummary({ settings: afterSafety, foodAndWeightOffer: true }), { hasLivePlan: false }).showsFoodOffer).toBe(
      false,
    );
  });

  it('the intro leaves out food and weight while they are off, in both languages', () => {
    const withFood = state(feedbackSummary({ settings: planSettings, nextReport: next }));
    expect(withFood.showsIntro).toBe(true);
    expect(withFood.introBodyKey).toBe('feedback.intro.body');

    const afterSafety = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'member', updatedAt: now });
    const safe = state(feedbackSummary({ settings: afterSafety, nextReport: next, foodAndWeightOffer: false }));
    expect(safe.showsIntro).toBe(true);
    expect(safe.showsFoodOffer).toBe(false);
    expect(safe.introBodyKey).toBe('feedback.intro.body_no_food');

    const pending = state(feedbackSummary({ settings: planSettings, nextReport: next }), { foodOffPending: true });
    expect(pending.introBodyKey).toBe('feedback.intro.body_no_food');

    const declined = feedbackSettings({ includeFoodAndWeight: false, includeFoodAndWeightSource: 'member', updatedAt: now });
    expect(state(feedbackSummary({ settings: declined, nextReport: next }), { hasLivePlan: false }).introBodyKey).toBe(
      'feedback.intro.body_no_food',
    );

    for (const language of ['en', 'is'] as const) {
      const text = lookup('feedback.intro.body_no_food', language).toLowerCase();
      expect(text).not.toBe('feedback.intro.body_no_food');
      for (const word of ['food', 'weight', 'mat', 'þyngd', 'matur']) expect(text).not.toContain(word);
      expect(lookup('feedback.intro.body', language).toLowerCase()).toContain(language === 'en' ? 'weight' : 'þyngd');
    }
  });

  it('a member with food and weight on is never offered', () => {
    expect(state(feedbackSummary({ settings: planSettings, foodAndWeightOffer: true })).showsFoodOffer).toBe(false);
  });

  it('without the server flag the offer is worked out from the settings', () => {
    const legacy = feedbackSettings({ includeFoodAndWeight: false });
    expect(state(feedbackSummary({ settings: legacy }), { hasLivePlan: false }).showsFoodOffer).toBe(true);
    expect(state(feedbackSummary({ settings: legacy }), { hasLivePlan: true }).showsFoodOffer).toBe(false);
    const chosen = feedbackSettings({ includeFoodAndWeight: false, updatedAt: now });
    expect(state(feedbackSummary({ settings: chosen }), { hasLivePlan: false }).showsFoodOffer).toBe(false);
  });

  it('no offer when both kinds of feedback are off', () => {
    const off = feedbackSettings({
      monthlyReport: false,
      midMonthNote: false,
      includeFoodAndWeight: false,
      includeFoodAndWeightSource: 'no_plan',
    });
    expect(state(feedbackSummary({ settings: off, foodAndWeightOffer: true }), { hasLivePlan: false }).showsFoodOffer).toBe(false);
  });

  it('the first report day stands with the offer, and goes once a report exists', () => {
    const offered = state(feedbackSummary({ settings: noPlanSettings, foodAndWeightOffer: true, nextReport: next }), {
      hasLivePlan: false,
    });
    expect(offered.firstReportDay).toBe('2026-11-01');
    expect(state(feedbackSummary({ settings: planSettings, latest: latest(), nextReport: next })).firstReportDay).toBeNull();
  });
});

describe('which action a line may offer (SPEC 9.6)', () => {
  function resolve(
    action: FeedbackAction | null,
    { revision = true, live = true, access = 'entitled' }: { revision?: boolean; live?: boolean; access?: HealthAccess } = {},
  ) {
    return resolveFeedbackAction(action, { supportsPlanRevision: revision, hasLiveProgram: live, access });
  }

  it('actions follow the membership, the plan and the server', () => {
    expect(resolve('adjust_plan')).toBe('adjust_plan');
    expect(resolve('adjust_plan', { revision: false })).toBe('change_days');
    expect(resolve('adjust_plan', { live: false })).toBeNull();
    expect(resolve('adjust_plan', { access: 'past_due' })).toBeNull();
    expect(resolve('change_days')).toBe('change_days');
    expect(resolve('change_days', { live: false })).toBeNull();
    expect(resolve('log_meal', { live: false })).toBe('log_meal');
    expect(resolve('log_meal', { access: 'not_member' })).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve('unknown')).toBeNull();
  });

  it('labels the house way', () => {
    expect(feedbackActionLabelKey('adjust_plan')).toBe('coach.chip.adjust_plan');
    expect(feedbackActionLabelKey('change_days')).toBe('feedback.action.change_days');
    expect(feedbackActionLabelKey('log_meal')).toBe('feedback.action.log_meal');
  });
});
