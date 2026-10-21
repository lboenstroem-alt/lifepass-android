/**
 * The feedback's screens as a member meets them: the Plan card's parts, the
 * report (its states, its sections, the marks it sends, the actions only
 * where they may go), the past months, and the history sheet Body and goals
 * opens (iOS FeedbackCard, FeedbackReportView, FeedbackHistoryView).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { decodeFeedbackNote, decodeFeedbackReportSummary, decodeFeedbackSummary } from '../../../api/feedback';
import { stubApiClientPerTest } from '../../../api/testing';
import { useHealthStore } from '../../../health/store';
import { translate } from '../../../i18n';
import { EMPTY_CARD_STATE, type FeedbackCardState } from '../cardState';
import FeedbackCard, { type FeedbackCardProps } from '../FeedbackCard';
import FeedbackHistoryScreen from '../FeedbackHistoryScreen';
import FeedbackHistorySheet from '../FeedbackHistorySheet';
import FeedbackHistoryView from '../FeedbackHistoryView';
import FeedbackReportScreen from '../FeedbackReportScreen';
import FeedbackReportView from '../FeedbackReportView';
import { useFeedbackStore } from '../feedbackStore';

import { freshApp, memberProfile, recordAnalytics, reportJSON, settle, signIn, summaryJSON } from './feedbackFixtures';

// @expo/vector-icons loads expo-font, which needs expo-asset (installed under expo/).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

beforeEach(() => {
  freshApp();
  useFeedbackStore.getState().wipe();
  useFeedbackStore.setState({ staleFeatures: null });
});

// ---------------------------------------------------------------------------
// The card

const latest = (extra: Record<string, unknown> = {}) =>
  decodeFeedbackReportSummary(
    {
      id: 'r-1',
      kind: 'monthly',
      periodMonth: '2026-09',
      title: 'September 2026',
      createdAt: '2026-10-01T06:12:00Z',
      seenAt: null,
      current: true,
      highlights: ['You trained 11 times.', 'Your nights were steady.'],
      ...extra,
    },
    'latest',
  );

const note = (action: string | null = null) =>
  decodeFeedbackNote(
    { id: 'n-1', seenAt: null, message: { key: 'note.sleep_short', text: 'Your nights have been short.', action } },
    'note',
  );

describe('the card', () => {
  let calls: string[];
  function props(state: Partial<FeedbackCardState>, extra: Partial<FeedbackCardProps> = {}): FeedbackCardProps {
    return {
      state: { ...EMPTY_CARD_STATE, ...state },
      resolveAction: (action) => (action === 'log_meal' ? 'log_meal' : null),
      onOpenReport: (id) => calls.push(`open:${id}`),
      onOpenHistory: () => calls.push('history'),
      onChooseSettings: () => calls.push('settings'),
      onAction: (action) => calls.push(`action:${action}`),
      onDismissNote: (id) => calls.push(`hide:${id}`),
      onNoteSeen: (id) => calls.push(`seen:${id}`),
      onIntroClosed: () => calls.push('introClosed'),
      onIncludeFood: () => calls.push('include'),
      onDeclineFood: () => calls.push('decline'),
      ...extra,
    };
  }
  beforeEach(() => {
    calls = [];
  });

  it('draws the note and the month; the note is seen when shown', async () => {
    await render(<FeedbackCard {...props({ note: note(), latest: latest(), monthly: 'full' })} />);
    expect(screen.getByText(en('feedback.note.kicker').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText('Your nights have been short.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    expect(screen.getByText(en('feedback.card.new'))).toBeOnTheScreen();
    expect(screen.getAllByTestId('feedback.card.highlight')).toHaveLength(2);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.note.dismiss') }));
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.card.open') }));
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.card.history') }));
    expect(calls).toEqual(['seen:n-1', 'hide:n-1', 'open:r-1', 'history']);
  });

  it("draws a line's action only when the rule allows it", async () => {
    await render(<FeedbackCard {...props({ note: note('log_meal') })} />);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.action.log_meal') }));
    expect(calls).toContain('action:log_meal');
    await render(<FeedbackCard {...props({ note: note('adjust_plan') })} />);
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
  });

  it('a read report older than a week is one row', async () => {
    await render(<FeedbackCard {...props({ latest: latest({ seenAt: '2026-10-01T19:00:00Z' }), monthly: 'compact' })} />);
    expect(screen.queryByText(en('feedback.card.open'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: `September 2026, ${en('feedback.card.row_sub')}` }));
    expect(calls).toEqual(['open:r-1']);
  });

  it('the intro: its body, the first day, and both ways out', async () => {
    const events = recordAnalytics();
    await render(
      <FeedbackCard {...props({ showsIntro: true, introBodyKey: 'feedback.intro.body_no_food', firstReportDay: '2026-11-01' })} />,
    );
    expect(screen.getByRole('header', { name: en('feedback.intro.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('feedback.intro.body_no_food'))).toBeOnTheScreen();
    expect(screen.getByText(en('feedback.intro.first', { date: '1 November' }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.intro.choose') }));
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.intro.ok') }));
    expect(calls).toEqual(['introClosed', 'settings', 'introClosed']);
    expect(events.map((e) => e.params)).toEqual([{ choice: 'choose' }, { choice: 'ok' }]);
  });

  it('the food and weight offer stands in for the intro, untracked', async () => {
    const events = recordAnalytics();
    await render(<FeedbackCard {...props({ showsFoodOffer: true, showsIntro: true })} />);
    expect(screen.getByRole('header', { name: en('feedback.offer.title') })).toBeOnTheScreen();
    expect(screen.queryByText(en('feedback.intro.title'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.offer.on') }));
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.offer.not_now') }));
    expect(calls).toEqual(['include', 'decline']);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The report

describe('the report', () => {
  const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

  it('lays out the month, marks it seen and offers what may be done', async () => {
    signIn();
    useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(), 'f') });
    api.on('GET', '/health/feedback/reports/:id', Reply.delayed(30, Reply.ok(reportJSON({ id: ID }))));
    api.on('POST', '/health/feedback/reports/:id', Reply.ok({ id: ID, seenAt: '2026-10-12T18:00:00.000Z', dismissedAt: null }));
    const taps: string[] = [];
    await render(
      <FeedbackReportView
        reportId={ID}
        resolveAction={(action) => (action === 'adjust_plan' ? 'adjust_plan' : null)}
        onAction={(action) => taps.push(action)}
        onOpenSettings={() => taps.push('settings')}
        onOpenHistory={() => taps.push('history')}
      />,
    );
    expect(screen.getByLabelText(en('a11y.loading'))).toBeOnTheScreen();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    await act(settle);
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    expect(screen.getByText('Food and weight are left out of this report.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Workouts' })).toBeOnTheScreen();
    expect(screen.getByLabelText(en('feedback.a11y.metric', { label: 'Planned workouts done', value: '11 of 13' }))).toBeOnTheScreen();
    expect(screen.getByText('Workouts were hard to fit in.')).toBeOnTheScreen();
    expect(screen.getByText('Wear your watch to bed.')).toBeOnTheScreen();
    expect(screen.getByText('Written by LifePass rules, never by AI.')).toBeOnTheScreen();
    expect(api.sent(`/health/feedback/reports/${ID}`, 'GET').query).toEqual({ locale: 'en' });
    expect(api.sent(`/health/feedback/reports/${ID}`, 'POST').body).toEqual({ action: 'seen' });

    await fireEvent.press(screen.getByRole('button', { name: en('coach.chip.adjust_plan') }));
    await fireEvent.press(screen.getAllByRole('button', { name: en('feedback.detail.settings') })[0]!);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.detail.history') }));
    expect(taps).toEqual(['adjust_plan', 'settings', 'history']);
  });

  it('without a resolver (Body and goals), draws no action and no links', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON({ id: ID, seenAt: '2026-10-02T10:00:00.000Z' })));
    await render(<FeedbackReportView reportId={ID} />);
    await act(settle);
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('feedback.detail.settings') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('feedback.detail.history') })).toBeNull();
    // Already seen: no mark.
    expect(api.sentAll(`/health/feedback/reports/${ID}`, 'POST')).toHaveLength(0);
  });

  it('a note: its own title, its text and no past months', async () => {
    signIn();
    api.on(
      'GET',
      '/health/feedback/reports/:id',
      Reply.ok(
        reportJSON({
          id: 'n-1',
          kind: 'note',
          title: 'A note for you',
          sections: [],
          leftOutLine: null,
          note: { key: 'note.logging_paused', text: 'No meals logged this past week.', action: 'log_meal' },
        }),
      ),
    );
    await render(<FeedbackReportView reportId="n-1" resolveAction={(a) => (a === 'log_meal' ? 'log_meal' : null)} onOpenHistory={() => undefined} />);
    await act(settle);
    // The top bar sets its title in capitals.
    expect(screen.getByText(en('feedback.detail.note_title').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText('No meals logged this past week.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('feedback.action.log_meal') })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('feedback.detail.history') })).toBeNull();
    // A note is marked from its card, not here.
    expect(api.sentAll('/health/feedback/reports/n-1', 'POST')).toHaveLength(0);
  });

  it.each([
    ['a report that is gone', Reply.problem(404, 'health_feedback_report_not_found')],
    ['a route that is missing', Reply.raw(404, '<html>Not found</html>')],
    ['a note with nothing left to show', Reply.ok(reportJSON({ kind: 'note', note: null, sections: [] }))],
  ])('%s is no longer available', async (_name, reply) => {
    signIn();
    api.on('GET', '/health/feedback/reports/:id', reply);
    await render(<FeedbackReportView reportId="r-1" />);
    await act(settle);
    expect(screen.getByText(en('feedback.detail.not_found'))).toBeOnTheScreen();
  });

  it('is not available without the feature or the consent, and asks nothing', async () => {
    signIn({ features: ['plan_revision'] });
    await render(<FeedbackReportView reportId="r-1" />);
    await act(settle);
    expect(screen.getByText(en('feedback.detail.not_found'))).toBeOnTheScreen();
    signIn({ profile: memberProfile({ consent: false }) });
    await render(<FeedbackReportView reportId="r-1" />);
    await act(settle);
    expect(api.requests).toHaveLength(0);
  });

  it('a failure offers Try again', async () => {
    signIn();
    api.once('GET', '/health/feedback/reports/:id', Reply.problem(500, 'internal_error'));
    await render(<FeedbackReportView reportId="r-1" />);
    await act(settle);
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON()));
    await fireEvent.press(screen.getByRole('button', { name: en('health.retry') }));
    await act(settle);
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
  });

  it("a month opens that month's report: the summary's, else the history's", async () => {
    signIn();
    useFeedbackStore.setState({ summary: decodeFeedbackSummary(summaryJSON(), 'f') });
    api.on('GET', '/health/feedback/reports/:id', (request) => Reply.ok(reportJSON({ id: request.params.id })));
    await render(<FeedbackReportView periodMonth="2026-09" />);
    await act(settle);
    expect(api.sentAll('/health/feedback/reports/r-1', 'GET')).toHaveLength(1);

    api.on('GET', '/health/feedback/reports', Reply.ok({ data: [{ id: 'r-8', periodMonth: '2026-08' }], pagination: { nextCursor: null, hasMore: false } }));
    await render(<FeedbackReportView periodMonth="2026-08" />);
    await act(settle);
    expect(api.sentAll('/health/feedback/reports/r-8', 'GET')).toHaveLength(1);

    await render(<FeedbackReportView periodMonth="2026-01" />);
    await act(settle);
    expect(screen.getByText(en('feedback.detail.not_found'))).toBeOnTheScreen();
  });
});

// ---------------------------------------------------------------------------
// Past months

describe('past months', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: 'monthly',
    periodMonth: '2026-09',
    title: `Month ${id}`,
    createdAt: '2026-10-01T06:12:00.000Z',
    seenAt: '2026-10-02T06:12:00.000Z',
    current: false,
    highlights: [`First line of ${id}.`, 'Second line.'],
    ...extra,
  });

  it('is empty with the first-report copy', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false } }));
    await render(<FeedbackHistoryView onOpen={() => undefined} />);
    await act(settle);
    expect(screen.getByText(en('feedback.history.empty'))).toBeOnTheScreen();
  });

  it('lists the months, opens one, and shows more', async () => {
    signIn();
    const events = recordAnalytics();
    const opened: string[] = [];
    api.on('GET', '/health/feedback/reports', (request) =>
      request.query.cursor === 'c-2'
        ? Reply.ok({ data: [row('r-2'), row('r-3')], pagination: { nextCursor: null, hasMore: false } })
        : Reply.ok({ data: [row('r-1', { seenAt: null }), row('r-2')], pagination: { nextCursor: 'c-2', hasMore: true } }),
    );
    await render(<FeedbackHistoryView onOpen={(id) => opened.push(id)} />);
    await act(settle);
    expect(screen.getByText(en('feedback.history.title').toUpperCase())).toBeOnTheScreen();
    expect(screen.getAllByTestId('feedback.history.row')).toHaveLength(2);
    expect(screen.getAllByText(en('feedback.card.new'))).toHaveLength(1);
    expect(screen.getByText('First line of r-1.')).toBeOnTheScreen();
    expect(screen.queryByText('Second line.')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: `Month r-1, ${en('feedback.card.new')}, First line of r-1.` }));
    expect(opened).toEqual(['r-1']);
    expect(events).toEqual([{ event: 'feedback_opened', params: { entry: 'history' } }]);

    await fireEvent.press(screen.getByRole('button', { name: en('feedback.history.more') }));
    await act(settle);
    expect(screen.getAllByTestId('feedback.history.row')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: en('feedback.history.more') })).toBeNull();
    expect(api.sentAll('/health/feedback/reports').map((r) => r.query.cursor ?? null)).toEqual([null, 'c-2']);
  });

  it('a failure with nothing to show offers Try again', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports', Reply.problem(500, 'internal_error'));
    await render(<FeedbackHistoryView onOpen={() => undefined} />);
    await act(settle);
    expect(screen.getByRole('button', { name: en('health.retry') })).toBeOnTheScreen();
  });
});

describe("Body and goals' history sheet", () => {
  it('opens a report inside the sheet, without actions, and goes back', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports', Reply.ok({ data: [{ id: 'r-1', title: 'September 2026' }], pagination: {} }));
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON({ seenAt: '2026-10-02T10:00:00.000Z' })));
    let closed = 0;
    await render(<FeedbackHistorySheet visible onClose={() => (closed += 1)} />);
    await act(settle);
    await fireEvent.press(screen.getByRole('button', { name: `September 2026, ${en('feedback.card.new')}` }));
    await act(settle);
    expect(screen.getByRole('header', { name: 'September 2026' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('feedback.detail.settings') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
    await act(settle);
    expect(screen.getByText(en('feedback.history.title').toUpperCase())).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
    expect(closed).toBe(1);
  });
});


describe('the routes', () => {
  function fakeNavigation() {
    const calls: { kind: string; name?: string; params?: object }[] = [];
    const navigation = {
      navigate: (name: string, params?: object) => calls.push({ kind: 'navigate', name, params }),
      push: (name: string, params?: object) => calls.push({ kind: 'push', name, params }),
      goBack: () => calls.push({ kind: 'back' }),
    };
    return { calls, navigation };
  }

  it("the report's links go to Body and goals and the past months, and the tap is reported", async () => {
    signIn();
    withLivePlan();
    // Every answer's features are the app's from then on: this one still revises plans.
    api.on(
      'GET',
      '/health/feedback/reports/:id',
      Reply.ok({ ...reportJSON({ seenAt: '2026-10-02T10:00:00.000Z' }), features: ['health_feedback', 'plan_revision'] }),
    );
    const { calls, navigation } = fakeNavigation();
    const events = recordAnalytics();
    const props = { route: { key: 'k', name: 'FeedbackReport', params: { reportId: 'r-1' } }, navigation } as unknown as Parameters<
      typeof FeedbackReportScreen
    >[0];
    await render(<FeedbackReportScreen {...props} />);
    await act(settle);
    await fireEvent.press(screen.getAllByRole('button', { name: en('feedback.detail.settings') })[0]!);
    await fireEvent.press(screen.getByRole('button', { name: en('feedback.detail.history') }));
    await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
    expect(calls).toEqual([
      { kind: 'navigate', name: 'BodyAndGoals', params: { anchor: 'feedback' } },
      { kind: 'push', name: 'FeedbackHistory', params: undefined },
      { kind: 'back' },
    ]);
    // The member's membership and plan decide the line's action: Adjust my plan.
    await fireEvent.press(screen.getByRole('button', { name: en('coach.chip.adjust_plan') }));
    expect(events).toContainEqual({ event: 'feedback_action_tapped', params: { action: 'adjust_plan' } });
  });

  it('a server that no longer revises plans offers Change training days instead', async () => {
    signIn();
    withLivePlan();
    api.on('GET', '/health/feedback/reports/:id', Reply.ok(reportJSON({ seenAt: '2026-10-02T10:00:00.000Z' })));
    const { navigation } = fakeNavigation();
    const props = { route: { key: 'k', name: 'FeedbackReport', params: { reportId: 'r-1' } }, navigation } as unknown as Parameters<
      typeof FeedbackReportScreen
    >[0];
    await render(<FeedbackReportScreen {...props} />);
    await act(settle);
    expect(screen.getByRole('button', { name: en('feedback.action.change_days') })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('coach.chip.adjust_plan') })).toBeNull();
  });

  it('a past month opens its report on the stack', async () => {
    signIn();
    api.on('GET', '/health/feedback/reports', Reply.ok({ data: [{ id: 'r-1', title: 'September 2026', seenAt: '2026-10-02T10:00:00Z' }], pagination: {} }));
    const { calls, navigation } = fakeNavigation();
    const props = { route: { key: 'k', name: 'FeedbackHistory' }, navigation } as unknown as Parameters<typeof FeedbackHistoryScreen>[0];
    await render(<FeedbackHistoryScreen {...props} />);
    await act(settle);
    await fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));
    expect(calls).toEqual([{ kind: 'push', name: 'FeedbackReport', params: { reportId: 'r-1' } }]);
  });
});

/** An entitled member with a live plan on a server that revises plans. */
function withLivePlan(): void {
  useHealthStore.setState({
    today: { program: { id: 'prog-1', status: 'active' } } as unknown as ReturnType<typeof useHealthStore.getState>['today'],
  });
}
