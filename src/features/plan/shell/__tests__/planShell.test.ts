/**
 * The Plan shell's controller (iOS PlanView's load sequence, parked actions,
 * week moves, action answers, outbox decisions and the bookings hint),
 * driven against the stub server with the real health store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeSessionActionResponse, useHealthStore } from '../../../../health';
import * as healthLocalStore from '../../../../health/localStore';
import { addServerDays } from '../../../../i18n/format';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from '../../../../navigation/navPrefs';
import { planVisitsKey, profileOpenedKey } from '../../../../navigation/profile';
import { ServerFeature, useAppStore } from '../../../../stores/appStore';
import { PLAN_ACTION_WINDOW_MS, useIntentStore } from '../../../../stores/intentStore';
import {
  dayJSON,
  freshPlan,
  MEMBER,
  memberProfile,
  recordAnalytics,
  settle,
  signIn,
  TODAY,
} from '../../__tests__/planFixtures';
import { installPlanFeedback, installPlanOutbox, installWeeklyCheckInOpener, type PlanFeedbackBridge } from '../bridges';
import {
  applySessionAction,
  attachPlanNavigator,
  consumePendingPlanAction,
  countPlanVisit,
  discardOutboxItem,
  dismissBookingsHint,
  movePlanWeek,
  openPlanMealCapture,
  planDidAppear,
  planReturnedFromSheet,
  reloadPlan,
  reloadPlanOnNextFocus,
  saveOutboxItemAsExtra,
  selectPlanDate,
  setProgramStatus,
  usePlanShell,
} from '../planShell';

stubApiClientPerTest();

const mockOpenRunner = jest.fn();
let mockPendingWorkout = false;
jest.mock('../../../runner', () => ({
  openRunner: (...args: unknown[]) => mockOpenRunner(...args),
  hasPendingWorkout: async () => mockPendingWorkout,
  resumableWorkout: async () => null,
}));

const health = () => useHealthStore.getState();
const shell = () => usePlanShell.getState();

interface Navigation {
  readonly calls: { name: string; params?: object }[];
  readonly pops: number[];
}

function navigation(): Navigation {
  const calls: { name: string; params?: object }[] = [];
  const pops: number[] = [];
  attachPlanNavigator({
    navigate: (name, params) => calls.push({ name, params }),
    popToTop: () => pops.push(calls.length),
  });
  return { calls, pops };
}

function feedbackBridge(overrides: Partial<PlanFeedbackBridge> = {}): PlanFeedbackBridge & { refreshes: boolean[] } {
  const refreshes: boolean[] = [];
  return {
    refreshes,
    isAvailable: () => true,
    refresh: async (force) => {
      refreshes.push(force);
    },
    loadState: () => 'loaded',
    latestCurrentReportId: () => null,
    hasCardContent: () => true,
    subscribe: () => () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  freshPlan();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('the load sequence (3.3)', () => {
  it('reads nothing for a member without consent, or a minor', async () => {
    signIn(memberProfile({ consent: false }));
    await reloadPlan({ force: true });
    signIn(memberProfile({ access: 'minor' }));
    await reloadPlan({ force: true });
    expect(api.sentAll('/health')).toHaveLength(0);
  });

  it('reads for a lapsed member whose consent stands: their history is read only, not gone', async () => {
    signIn(memberProfile({ access: 'not_member' }));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await reloadPlan();
    expect(api.sentAll('/health')).toHaveLength(1);
  });

  it('flushes the workout outbox, then the meal outbox, then reads the day', async () => {
    signIn();
    const order: string[] = [];
    installPlanOutbox('meal', { flush: async () => void order.push('meal'), failedItems: () => [], discard: async () => undefined });
    installPlanOutbox('workout', { flush: async () => void order.push('workout'), failedItems: () => [], discard: async () => undefined });
    api.on('GET', '/health', () => {
      order.push('read');
      return Reply.ok(dayJSON());
    });
    await reloadPlan();
    expect(order).toEqual(['workout', 'meal', 'read']);
  });

  it('reads the selected date when the strip moved off today', async () => {
    signIn();
    const yesterday = addServerDays(TODAY, -1)!;
    api.on('GET', '/health', (request) => Reply.ok(dayJSON(request.query.date ?? TODAY)));
    health().setSelectedDate(yesterday);
    await reloadPlan({ force: true });
    expect(api.sent('/health').query).toEqual({ date: yesterday, locale: 'en' });
    expect(health().days[yesterday]).toBeDefined();
  });

  it('re-reads inside the freshness window when the account language changed', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await reloadPlan();
    await reloadPlan();
    expect(api.sentAll('/health')).toHaveLength(1);
    signIn(memberProfile({ locale: 'is' }));
    await reloadPlan();
    expect(api.sentAll('/health')).toHaveLength(2);
    expect(api.sentAll('/health')[1]!.query.locale).toBe('is');
  });

  it('refreshes the monthly feedback after the read, only where the server has it', async () => {
    signIn();
    // Every Today read says what the server supports; one without the key empties the list.
    api.on('GET', '/health', Reply.ok(dayJSON()));
    const bridge = feedbackBridge();
    installPlanFeedback(bridge);
    await reloadPlan({ force: true });
    expect(bridge.refreshes).toEqual([]);
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { features: [ServerFeature.feedback] })));
    await reloadPlan({ force: true });
    await reloadPlan();
    expect(bridge.refreshes).toEqual([true, false]);
  });

  it("keeps the adopt suppression over a failed read and lifts it once a read lands", async () => {
    signIn();
    usePlanShell.setState({ adoptedProposalId: 'p-new' });
    api.on('GET', '/health', Reply.problem(503, 'unavailable'));
    await reloadPlan({ force: true });
    expect(shell().adoptedProposalId).toBe('p-new');
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await reloadPlan({ force: true });
    expect(shell().adoptedProposalId).toBeNull();
  });
});

describe('the week strip', () => {
  beforeEach(async () => {
    signIn();
    api.on('GET', '/health', (request) => Reply.ok(dayJSON(request.query.date ?? TODAY)));
    await reloadPlan();
  });

  it('selects a day, reads it when it is not in memory, and says which way it went', async () => {
    const events = recordAnalytics();
    const past = addServerDays(TODAY, -2)!;
    selectPlanDate(past);
    await settle();
    expect(health().selectedDate).toBe(past);
    expect(api.sentAll('/health').at(-1)!.query.date).toBe(past);
    expect(events).toContainEqual({ event: 'plan_week_day_selected', params: { relative: 'past' } });

    // Back to today: remembered, so no read.
    const reads = api.sentAll('/health').length;
    selectPlanDate(TODAY);
    await settle();
    expect(api.sentAll('/health')).toHaveLength(reads);
    // The same day again does nothing at all.
    selectPlanDate(TODAY);
    expect(events.filter((e) => e.event === 'plan_week_day_selected')).toHaveLength(2);
  });

  it("moves a week to the Monday seven days away", async () => {
    movePlanWeek(-1, { weekStartsOn: '2026-10-12' });
    await settle();
    expect(health().selectedDate).toBe('2026-10-05');
    movePlanWeek(1, { weekStartsOn: '2026-10-05' });
    expect(health().selectedDate).toBe('2026-10-12');
    movePlanWeek(1, { weekStartsOn: null });
    expect(health().selectedDate).toBe('2026-10-12');
  });
});

describe('an action answer', () => {
  beforeEach(async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { week: { weekStartsOn: '2026-10-12', done: 1, planned: 3 } })));
    await reloadPlan();
  });

  it("patches today's session and week from an answer about this week", () => {
    const reads = api.sentAll('/health').length;
    applySessionAction(
      decodeSessionActionResponse({
        session: { id: `s-${TODAY}`, scheduledFor: TODAY, kind: 'strength', status: 'done' },
        week: { weekStartsOn: '2026-10-12', done: 2, planned: 3 },
      }),
    );
    expect(health().today?.day?.session?.status).toBe('done');
    expect(health().today?.week?.done).toBe(2);
    expect(api.sentAll('/health')).toHaveLength(reads);
  });

  it("re-reads instead of putting last week under this week's strip", async () => {
    const reads = api.sentAll('/health').length;
    applySessionAction(
      decodeSessionActionResponse({
        session: { id: 's-old', scheduledFor: '2026-10-04', kind: 'strength', status: 'done' },
        week: { weekStartsOn: '2026-09-28', done: 3, planned: 3 },
      }),
    );
    expect(health().today?.week?.weekStartsOn).toBe('2026-10-12');
    expect(health().today?.day?.session?.status).toBe('planned');
    await settle();
    expect(api.sentAll('/health').length).toBe(reads + 1);
  });
});

describe('pause, resume and end', () => {
  it('posts the status alone with its own key, then reads again', async () => {
    signIn();
    const events = recordAnalytics();
    api.on('POST', '/health/programs/:id', Reply.ok({ program: null }));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await setProgramStatus('paused', 'p-1');
    const sent = api.sent('/health/programs/p-1', 'POST');
    expect(sent.body).toEqual({ status: 'paused' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(events.map((e) => e.event)).toContain('program_paused');
    expect(api.sentAll('/health')).toHaveLength(1);
  });

  it('says the plan changed elsewhere when the server refuses it', async () => {
    signIn();
    api.on('POST', '/health/programs/:id', Reply.problem(409, 'program_action_not_allowed'));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await setProgramStatus('active', 'p-1');
    expect(health().toastKey).toBe('health.err.changed');
  });
});

describe('the outbox banner (3.5)', () => {
  it('lists failed items, saves a workout as an extra and discards after the confirm', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    const events = recordAnalytics();
    let failed = [{ id: 'w-1', kind: 'workout' as const }];
    const reposted: string[] = [];
    installPlanOutbox('workout', {
      flush: async () => undefined,
      failedItems: () => failed,
      saveAsExtra: async (item) => {
        reposted.push(item.id);
        failed = [];
      },
      discard: async () => {
        failed = [];
      },
    });
    let meals = [{ id: 'm-1', kind: 'meal' as const }];
    installPlanOutbox('meal', {
      flush: async () => undefined,
      failedItems: () => meals,
      discard: async () => {
        meals = [];
      },
    });
    await reloadPlan();
    expect(shell().failedOutboxItems).toEqual([
      { id: 'w-1', kind: 'workout' },
      { id: 'm-1', kind: 'meal' },
    ]);
    await saveOutboxItemAsExtra({ id: 'w-1', kind: 'workout' });
    expect(reposted).toEqual(['w-1']);
    expect(shell().failedOutboxItems).toEqual([{ id: 'm-1', kind: 'meal' }]);
    await discardOutboxItem({ id: 'm-1', kind: 'meal' });
    expect(shell().failedOutboxItems).toEqual([]);
    expect(events).toContainEqual({ event: 'outbox_item_discarded', params: { kind: 'meal' } });
  });
});

describe('parked actions (0.3)', () => {
  it('waits for the read before answering a weekly check-in notification, then opens the sheet', async () => {
    const opened: string[] = [];
    installWeeklyCheckInOpener((entry) => opened.push(entry));
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    // A cold launch: no profile yet.
    consumePendingPlanAction();
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();
    expect(shell().parked?.action.kind).toBe('openWeeklyCheckIn');
    signIn();
    consumePendingPlanAction();
    expect(opened).toEqual([]);
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true, weekStartsOn: '2026-10-12' } })));
    await reloadPlan();
    consumePendingPlanAction();
    expect(opened).toEqual(['notification']);
    expect(shell().parked).toBeNull();
  });

  it('lands on the review card when the check-in is done, or the member is not entitled', async () => {
    const opened: string[] = [];
    installWeeklyCheckInOpener((entry) => opened.push(entry));
    signIn(memberProfile({ access: 'past_due' }));
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: true } })));
    await reloadPlan();
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    consumePendingPlanAction();
    expect(opened).toEqual([]);
    expect(shell().scrollTarget).toBe('review');
  });

  it('drops an action nobody could answer within five minutes', () => {
    signIn();
    const now = Date.now();
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' }, now);
    consumePendingPlanAction(now);
    expect(shell().parked).not.toBeNull();
    consumePendingPlanAction(now + PLAN_ACTION_WINDOW_MS + 1);
    expect(shell().parked).toBeNull();
    expect(shell().scrollTarget).toBeNull();
  });

  it("starts today's planned session only, and only for an entitled member", async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await reloadPlan();
    mockPendingWorkout = false;
    useIntentStore.getState().parkPlanAction({ kind: 'startWorkout', sessionId: 'someone-else' });
    consumePendingPlanAction();
    await settle();
    expect(mockOpenRunner).not.toHaveBeenCalled();
    useIntentStore.getState().parkPlanAction({ kind: 'startWorkout', sessionId: `s-${TODAY}` });
    consumePendingPlanAction();
    await settle();
    expect(mockOpenRunner).toHaveBeenCalledWith(expect.objectContaining({ id: `s-${TODAY}` }), 'today');

    // A lapsed member's cached day still names the session: no runner.
    mockOpenRunner.mockClear();
    signIn(memberProfile({ access: 'not_member' }));
    useIntentStore.getState().parkPlanAction({ kind: 'startWorkout', sessionId: `s-${TODAY}` });
    consumePendingPlanAction();
    await settle();
    expect(mockOpenRunner).not.toHaveBeenCalled();
  });

  it('says a workout saved on this phone is done rather than run it twice', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await reloadPlan();
    mockPendingWorkout = true;
    try {
      useIntentStore.getState().parkPlanAction({ kind: 'startWorkout', sessionId: `s-${TODAY}` });
      consumePendingPlanAction();
      await settle();
      expect(mockOpenRunner).not.toHaveBeenCalled();
      expect(health().toastKey).toBe('health.saved_offline');
    } finally {
      mockPendingWorkout = false;
    }
  });

  it('pushes the routes it names onto the Plan stack', async () => {
    signIn();
    const nav = navigation();
    useIntentStore.getState().parkPlanAction({ kind: 'openDiary', date: '2026-10-15' });
    consumePendingPlanAction();
    useIntentStore.getState().parkPlanAction({ kind: 'openPastPlans' });
    consumePendingPlanAction();
    useIntentStore.getState().parkPlanAction({ kind: 'openDraft', mealId: 'm-9' });
    consumePendingPlanAction();
    expect(nav.calls).toEqual([
      { name: 'Diary', params: { date: '2026-10-15' } },
      { name: 'WorkoutHistory', params: { segment: 'pastPlans' } },
      { name: 'MealEditor', params: { mode: 'stored', mealId: 'm-9' } },
    ]);
  });

  it('opens the proposal only beside a live plan', async () => {
    signIn();
    const nav = navigation();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { proposal: { id: 'p-2', status: 'proposed', week1: [] } })));
    await reloadPlan();
    useIntentStore.getState().parkPlanAction({ kind: 'openProposal' });
    consumePendingPlanAction();
    expect(nav.calls).toEqual([{ name: 'ProgramOverview', params: { programId: 'p-2', mode: 'proposal' } }]);
  });

  it('shows the adopted banner, hides the adopted proposal and reads with force', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: null, proposal: { id: 'p-2', status: 'proposed' } })));
    await reloadPlan();
    let release: () => void = () => undefined;
    api.on('GET', '/health', () => new Promise((resolve) => (release = () => resolve(Reply.ok(dayJSON())))));
    useIntentStore.getState().parkPlanAction({ kind: 'showAdoptedBanner', startsOn: '2026-10-19' });
    consumePendingPlanAction();
    expect(shell().adoptedBanner).toEqual({ startsOn: '2026-10-19' });
    expect(shell().adoptedProposalId).toBe('p-2');
    await settle();
    release();
    await settle();
    expect(shell().adoptedProposalId).toBeNull();
    expect(api.sentAll('/health')).toHaveLength(2);
  });

  it('opens the report a feedback notification names, or the current one, or says it is on its way', async () => {
    signIn();
    useAppStore.setState({ serverFeatures: [ServerFeature.feedback] });
    const events = recordAnalytics();
    const nav = navigation();
    let latest: string | null = null;
    const bridge = feedbackBridge({ latestCurrentReportId: () => latest });
    installPlanFeedback(bridge);

    useIntentStore.getState().parkPlanAction({ kind: 'openFeedback', reportId: 'r-1' });
    consumePendingPlanAction();
    await settle();
    expect(nav.calls).toEqual([{ name: 'FeedbackReport', params: { reportId: 'r-1' } }]);
    expect(nav.pops).toEqual([0]);

    latest = 'r-2';
    useIntentStore.getState().parkPlanAction({ kind: 'openFeedback', reportId: null });
    consumePendingPlanAction();
    await settle();
    expect(nav.calls.at(-1)).toEqual({ name: 'FeedbackReport', params: { reportId: 'r-2' } });

    latest = null;
    useIntentStore.getState().parkPlanAction({ kind: 'openFeedback', reportId: null });
    consumePendingPlanAction();
    await settle();
    expect(shell().scrollTarget).toBe('feedback');
    expect(health().toastKey).toBe('feedback.detail.pending');
    expect(events.filter((e) => e.event === 'feedback_opened')).toHaveLength(2);
  });

  it('ignores feedback taps where the feature is not there', async () => {
    signIn();
    const nav = navigation();
    installPlanFeedback(feedbackBridge());
    useIntentStore.getState().parkPlanAction({ kind: 'openFeedbackNote' });
    consumePendingPlanAction();
    await settle();
    expect(nav.calls).toEqual([]);
    expect(shell().scrollTarget).toBeNull();
  });
});

describe('appearances', () => {
  it('clears the adopted banner of the last appearance, puts the strip back on today and reads', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    const events = recordAnalytics();
    usePlanShell.setState({ adoptedBanner: { startsOn: null }, adoptedBannerShown: true });
    health().setSelectedDate(addServerDays(TODAY, -3)!);
    planDidAppear();
    expect(shell().adoptedBanner).toBeNull();
    expect(health().selectedDate).toBe(TODAY);
    await settle();
    expect(api.sentAll('/health')).toHaveLength(1);
    expect(events.find((e) => e.event === 'plan_viewed')).toBeDefined();
  });

  it('back from a sheet keeps the day, and reads with force only when asked', async () => {
    signIn();
    api.on('GET', '/health', (request) => Reply.ok(dayJSON(request.query.date ?? TODAY)));
    await reloadPlan();
    const past = addServerDays(TODAY, -1)!;
    selectPlanDate(past);
    await settle();
    const reads = api.sentAll('/health').length;
    planReturnedFromSheet();
    await settle();
    expect(health().selectedDate).toBe(past);
    expect(api.sentAll('/health')).toHaveLength(reads);
    reloadPlanOnNextFocus();
    planReturnedFromSheet();
    await settle();
    expect(api.sentAll('/health')).toHaveLength(reads + 1);
    expect(api.sentAll('/health').at(-1)!.query.date).toBe(past);
  });
});

describe('Log a meal (the intro card)', () => {
  it('opens the meal page for an entitled member with consent, never on a future date', () => {
    signIn();
    const nav = navigation();
    openPlanMealCapture('search', addServerDays(TODAY, 2)!);
    expect(nav.calls).toEqual([{ name: 'MealCapture', params: { origin: 'plan', mode: 'search', date: TODAY } }]);
    expect(shell().reloadOnNextFocus).toBe(true);
  });

  it('asks for consent first, and shows the membership gate to a member who is not entitled', () => {
    signIn(memberProfile({ consent: false }));
    const nav = navigation();
    openPlanMealCapture('search', TODAY);
    expect(nav.calls).toEqual([]);
    expect(shell().localConsent).not.toBeNull();
    shell().localConsent!.onGranted();
    expect(nav.calls).toHaveLength(1);

    signIn(memberProfile({ access: 'pass_only' }));
    openPlanMealCapture('search', TODAY);
    expect(shell().localMealGate).toBe('pass_only');
  });
});

describe('"Looking for your bookings?" (R19)', () => {
  beforeEach(async () => {
    signIn();
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
  });

  it('shows for three appearances, then never again', async () => {
    for (let visit = 1; visit <= 3; visit += 1) {
      await countPlanVisit();
      expect(shell().bookingsHintFor).toBe(MEMBER);
    }
    await countPlanVisit();
    expect(shell().bookingsHintFor).toBeNull();
    expect(await AsyncStorage.getItem(planVisitsKey(MEMBER))).toBe('4');
  });

  it('never shows on a fresh install or once the member found Profile', async () => {
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'false');
    await countPlanVisit();
    expect(shell().bookingsHintFor).toBeNull();
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    await AsyncStorage.setItem(profileOpenedKey(MEMBER), 'true');
    await countPlanVisit();
    expect(shell().bookingsHintFor).toBeNull();
  });

  it('the x ends it for good', async () => {
    const events = recordAnalytics();
    await countPlanVisit();
    dismissBookingsHint();
    expect(shell().bookingsHintFor).toBeNull();
    await settle();
    expect(await AsyncStorage.getItem(planVisitsKey(MEMBER))).toBe('99');
    await countPlanVisit();
    expect(shell().bookingsHintFor).toBeNull();
    expect(events.map((e) => e.event)).toContain('profile_hint_dismissed');
  });
});
