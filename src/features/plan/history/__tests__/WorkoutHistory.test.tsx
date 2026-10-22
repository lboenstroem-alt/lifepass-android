/**
 * The history (iOS PlanHistory.swift) in a real stack against the stub
 * server: the History card on Plan and where its rows lead, the workouts
 * grouped by ISO week with their lines, paging by cursor, the past plans and
 * their status words, the empty lines, and a workout's detail with its sets,
 * held only while the list that read it is open.
 */
import { createNavigationContainerRef, NavigationContainer, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { decodeHealthDay, useHealthStore } from '../../../../health';
import { translate } from '../../../../i18n';
import { attachPlanNavigator } from '../../shell/planShell';
import HistorySection from '../../sections/History';
import { dayJSON, freshPlan, recordAnalytics, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import { historyItem, resetHistoryItemsForTests } from '../historyCache';
import WorkoutDetailScreen from '../WorkoutDetailScreen';
import WorkoutHistoryScreen from '../WorkoutHistoryScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

function page(data: unknown[], nextCursor: string | null = null) {
  return Reply.ok({ data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 20 } });
}

const LEGS = {
  id: 'h-legs',
  sessionId: 's-legs',
  date: '2026-10-18',
  kind: 'strength',
  title: 'Legs',
  status: 'done',
  minutes: 40,
  feeling: 'ok',
  doneSource: 'check_in',
  checkInVenueName: 'Laugardalslaug',
  performed: [
    {
      exerciseId: 'squat',
      name: 'Goblet squat',
      swappedFromName: 'Back squat',
      sets: [
        { reps: 10, kg: 16, done: true },
        { reps: 8, kg: 16, done: true },
      ],
    },
    { exerciseId: 'plank', name: 'Plank', sets: [{ seconds: 60, done: true }] },
    { exerciseId: 'lunge', name: 'Lunge', skipped: true, sets: [] },
  ],
};
const EXTRA = { id: 's-swim:extra:0', sessionId: 's-swim', date: '2026-10-19', kind: 'rest', title: 'Swim', status: 'done', minutes: 30, isExtra: true, extraKind: 'swim' };
const OLDER = { id: 'h-old', date: '2026-10-12', kind: 'cardio', title: 'Easy run', status: 'skipped', minutes: 20 };
const EARLIEST = { id: 'h-earliest', date: '2026-10-05', kind: 'cardio', title: 'First run', status: 'done', minutes: 15 };

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function Root() {
  return <Text>root</Text>;
}

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

async function renderHistory(segment: 'workouts' | 'pastPlans' = 'workouts') {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Root" component={Root} />
          <Stack.Screen name="WorkoutHistory" component={WorkoutHistoryScreen as never} />
          <Stack.Screen name="WorkoutDetail" component={WorkoutDetailScreen as never} />
          <Stack.Screen name="ProgramOverview" component={StandIn as never} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => (navigationRef.navigate as (name: string, params: object) => void)('WorkoutHistory', { segment }));
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
  resetHistoryItemsForTests();
  signIn();
});

afterEach(async () => {
  // The list's own render batching runs on timers: let it finish inside the test.
  await act(async () => settle());
});

describe('the History card on Plan', () => {
  const navigate = jest.fn();
  beforeEach(() => {
    navigate.mockReset();
    attachPlanNavigator({ navigate, popToTop: jest.fn() });
  });

  function setHistory(history: Record<string, unknown> | null) {
    useHealthStore.setState({ today: decodeHealthDay(dayJSON(TODAY, { history })), selectedDate: TODAY });
  }

  it('shows the latest workout and the logged days, and each row opens its page', async () => {
    const events = recordAnalytics();
    setHistory({
      workouts: [LEGS, OLDER],
      mealDays: [
        { date: '2026-10-18', mealCount: 3 },
        { date: '2026-10-17', mealCount: 0 },
        { date: '2026-10-16', mealCount: 1 },
      ],
    });
    await render(<HistorySection />);
    expect(screen.getByRole('header', { name: en('history.title') })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${en('history.workouts.title')}, Sun 18 Oct` })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: `${en('history.meals.title')}, ${en('history.meal.count.many', { count: '2' })}` }));
    expect(navigate).toHaveBeenCalledWith('MealHistory', undefined);
    await fireEvent.press(screen.getByTestId('plan.history.workouts'));
    expect(navigate).toHaveBeenCalledWith('WorkoutHistory', { segment: 'workouts' });
    expect(events.map((e) => e.params)).toEqual([{ kind: 'meals' }, { kind: 'workouts' }]);
  });

  it('nothing with no workouts and no day with a meal', async () => {
    setHistory({ workouts: [], mealDays: [{ date: '2026-10-18', mealCount: 0 }] });
    await render(<HistorySection />);
    expect(screen.queryByTestId('plan.history')).toBeNull();
  });
});

describe('the workouts', () => {
  it('grouped by ISO week ("Week of" its Monday), each row with its lines and status word', async () => {
    api.on('GET', '/health/sessions', page([EXTRA, LEGS, OLDER]));
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    expect(screen.getByRole('header', { name: en('history.week_of', { date: 'Mon 19 Oct' }) })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en('history.week_of', { date: 'Mon 12 Oct' }) })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mon 19 Oct, Extra workout, Swim, 30 min, done' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sun 18 Oct, Legs, 40 min · Just right, done' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mon 12 Oct, Easy run, 20 min, skipped' })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.done_source.check_in', { venue: 'Laugardalslaug' }))).toBeOnTheScreen();
    const sent = api.sent('/health/sessions', 'GET');
    expect(sent.query).toMatchObject({ limit: '20', locale: 'en' });
  });

  it('pages on by cursor at the end of the list, and stops when the server has no more', async () => {
    api.on('GET', '/health/sessions', (request) =>
      request.query.cursor === 'c2' ? page([EARLIEST]) : page([LEGS, OLDER], 'c2'),
    );
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    await act(async () => {
      fireEvent(screen.getByTestId('history.workouts'), 'onEndReached');
      await settle();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mon 5 Oct, First run, 15 min, done' })).toBeOnTheScreen());
    const cursors = api.sentAll('/health/sessions', 'GET').map((r) => r.query.cursor ?? null);
    expect(cursors).toEqual([null, 'c2']);
    await act(async () => {
      fireEvent(screen.getByTestId('history.workouts'), 'onEndReached');
      await settle();
    });
    expect(api.sentAll('/health/sessions', 'GET')).toHaveLength(2);
  });

  it('the empty line when there are none', async () => {
    api.on('GET', '/health/sessions', page([]));
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    expect(screen.getByText(en('history.workouts.empty'))).toBeOnTheScreen();
  });

  it('a workout opens its detail: the meta, the source, swapped and skipped lines, a line per set', async () => {
    api.on('GET', '/health/sessions', page([LEGS]));
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    await fireEvent.press(screen.getByTestId('history.workout.h-legs'));
    expect(await screen.findByRole('header', { name: 'Legs' })).toBeOnTheScreen();
    expect(screen.getByText('Sun 18 Oct · 40 min · Just right')).toBeOnTheScreen();
    expect(screen.getByText(en('history.detail.swapped', { name: 'Back squat' }))).toBeOnTheScreen();
    expect(screen.getByText('Set 1: 10 reps, 16 kg')).toBeOnTheScreen();
    expect(screen.getByText('Set 2: 8 reps, 16 kg')).toBeOnTheScreen();
    expect(screen.getByText('Set 1: 1 min')).toBeOnTheScreen();
    expect(screen.getByText(en('history.detail.skipped'))).toBeOnTheScreen();
  });

  it('an extra with no sets says so; the list holds its workouts only while it is open', async () => {
    api.on('GET', '/health/sessions', page([EXTRA]));
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    await fireEvent.press(screen.getByTestId('history.workout.s-swim:extra:0'));
    expect(await screen.findByText(en('history.detail.no_sets'))).toBeOnTheScreen();
    expect(screen.getByText(en('history.workout.extra').toUpperCase())).toBeOnTheScreen();
    expect(historyItem(EXTRA.id)).not.toBeNull();
    await act(async () => navigationRef.dispatch(StackActions.popToTop()));
    await act(async () => settle());
    expect(historyItem(EXTRA.id)).toBeNull();
  });
});

describe('the past plans', () => {
  it('opens on the segment asked for, says each plan’s status, and opens one in past mode', async () => {
    const events = recordAnalytics();
    api.on('GET', '/health/sessions', page([]));
    api.on(
      'GET',
      '/health/programs',
      page([
        { id: 'p-done', summaryTitle: 'Stronger legs', status: 'completed', startsOn: '2026-09-01', endsOn: '2026-09-28' },
        { id: 'p-revised', summaryTitle: 'Old version', status: 'abandoned', revised: true },
        { id: 'p-never', summaryTitle: 'Never started', status: 'abandoned', notStarted: true },
        { id: 'p-ended', summaryTitle: 'Given up', status: 'abandoned' },
      ]),
    );
    await renderHistory('pastPlans');
    expect(screen.getByRole('button', { name: `Stronger legs, 1 September to 28 September, ${en('history.plan.completed')}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `Old version, ${en('history.plan.revised')}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `Never started, ${en('history.plan.not_started')}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `Given up, ${en('history.plan.ended')}` })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('history.plan.p-done'));
    expect(await screen.findByText(`route:ProgramOverview:${JSON.stringify({ programId: 'p-done', mode: 'past' })}`)).toBeOnTheScreen();
    expect(events.map((e) => e.event)).toContain('past_plan_opened');
  });

  it('switching segments shows the other list; an empty one says so', async () => {
    api.on('GET', '/health/sessions', page([LEGS]));
    api.on('GET', '/health/programs', page([]));
    await renderHistory();
    await fireEvent.press(screen.getByTestId('history.segment.pastPlans'));
    expect(screen.getByText(en('history.plans.empty'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('history.segment.workouts'));
    expect(screen.getByTestId('history.workout.h-legs')).toBeOnTheScreen();
  });
});
