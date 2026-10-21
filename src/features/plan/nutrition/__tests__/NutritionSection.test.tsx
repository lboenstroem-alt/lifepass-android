/**
 * Today's food card on the Plan tab (iOS PlanNutritionCard in PlanView),
 * rendered by the real Plan screen against the stub server: what it says
 * for each kind of day and member, and where each of its doors goes (the
 * meal page, the editor, the drafts list, the diary, the body and target
 * sheets).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import { addServerDays, shortDay } from '../../../../i18n/format';
import { ServerFeature, useAppStore } from '../../../../stores/appStore';
import { dayJSON, freshPlan, memberProfile, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import PlanScreen from '../../PlanScreen';
import { installPlanQueuedMeals, resetPlanQueuedMealsForTests, type PlanQueuedMeal } from '../queuedMeals';

const mockOpenBodySheet = jest.fn();
const mockOpenTargetSheet = jest.fn();
jest.mock('../../../body/sheets', () => ({
  ...jest.requireActual('../../../body/sheets'),
  openBodySheet: (mode: unknown) => mockOpenBodySheet(mode),
  openTargetSheet: (mode: unknown) => mockOpenTargetSheet(mode),
}));
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const OTHER_ROUTES = ['MealEditor', 'Drafts', 'Diary', 'MealCapture', 'BodyAndGoals', 'Plans', 'Account'] as const;

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

const Stack = createNativeStackNavigator();

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
          {OTHER_ROUTES.map((name) => (
            <Stack.Screen key={name} name={name} component={StandIn as never} />
          ))}
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

const totals = (kcalLow: number, kcalHigh: number, proteinG: number) => ({ kcalLow, kcalHigh, proteinG, carbsG: 0, fatG: 0 });

function meal(id: string, slot: string, labels: string[], kcal: [number, number], confirmed: boolean | null = true) {
  return {
    id,
    slot,
    confirmed,
    items: labels.map((label, index) => ({ id: `${id}-${index}`, label })),
    totals: totals(kcal[0], kcal[1], 10),
  };
}

const MEALS = {
  date: TODAY,
  meals: [
    meal('m1', 'breakfast', ['Skyr', 'banana'], [320, 320]),
    meal('m2', 'lunch', ['Fish soup'], [550, 700]),
  ],
  totals: totals(870, 1020, 64),
  target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120, basis: 'program' },
};

/** A Today read with these meals (and anything else). */
function day(extra: Record<string, unknown> = {}, date: string = TODAY) {
  return dayJSON(date, { meals: MEALS, ...extra });
}

const card = () => within(screen.getByTestId('plan.nutrition'));

beforeEach(() => {
  freshPlan();
  resetPlanQueuedMealsForTests();
  mockOpenBodySheet.mockReset();
  mockOpenTargetSheet.mockReset();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('what the card says', () => {
  it('today: the target with its Estimate chip, the eaten range, the bars with their numbers, and a neutral status', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day()));
    await renderPlan();
    expect(card().getByRole('header', { name: en('plan.nutrition.title') })).toBeOnTheScreen();
    expect(card().getByText(en('plan.nutrition.kicker').toUpperCase())).toBeOnTheScreen();
    expect(card().getByText(en('plan.nutrition.target', { low: '1,800', high: '2,000', protein: '120' }))).toBeOnTheScreen();
    expect(card().getAllByText(en('health.estimate'))).toHaveLength(2);
    expect(card().getByText(en('plan.nutrition.eaten_range', { low: '870', high: '1,020', protein: '64' }))).toBeOnTheScreen();
    expect(card().getByLabelText('950 kcal / 1,900 kcal')).toBeOnTheScreen();
    expect(card().getByLabelText('64 g / 120 g')).toBeOnTheScreen();
    expect(card().getByText(en('diary.left', { kcal: '950' }))).toBeOnTheScreen();
    expect(screen.queryByTestId('plan.nutrition.back')).toBeNull();
  });

  it('the meals: up to four, their slot and items and energy, then "+N more meals" to the diary', async () => {
    signIn();
    const meals = [
      meal('m1', 'breakfast', ['Skyr', 'banana'], [320, 320]),
      meal('m2', 'lunch', ['Fish soup'], [550, 700]),
      meal('m3', 'snack', ['Apple'], [80, 80]),
      meal('m4', 'dinner', ['Lamb'], [900, 900]),
      meal('m5', 'drink', ['Latte'], [150, 150]),
      meal('m6', 'lunch', ['Draft plate'], [400, 600], false),
    ];
    api.on('GET', '/health', Reply.ok(day({ meals: { ...MEALS, meals } })));
    await renderPlan();
    expect(card().getByText('Skyr, banana')).toBeOnTheScreen();
    expect(card().getByText(en('plan.nutrition.kcal_range', { low: '550', high: '700' }))).toBeOnTheScreen();
    expect(card().getByText(en('slot.breakfast').toUpperCase())).toBeOnTheScreen();
    expect(card().queryByText('Latte')).toBeNull();
    // An unconfirmed meal is a draft, never a saved meal row.
    expect(card().queryByText('Draft plate')).toBeNull();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.more_meals.one', { count: 1 }) }));
    expect(screen.getByText(`route:Diary:${JSON.stringify({ date: TODAY })}`)).toBeOnTheScreen();
  });

  it('nothing logged yet', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ meals: { date: TODAY, meals: [], totals: totals(0, 0, 0), target: null } })));
    await renderPlan();
    expect(card().getByText(en('plan.nutrition.none_yet'))).toBeOnTheScreen();
    expect(card().getByText(en('plan.nutrition.eaten', { kcal: '0', protein: '0' }))).toBeOnTheScreen();
    expect(screen.queryByTestId('plan.nutrition.bar.kcal')).toBeNull();
    expect(screen.queryByTestId('plan.nutrition.status')).toBeNull();
  });

  it('meals saved offline wait in the card with "Waiting to sync"', async () => {
    signIn();
    const queue: PlanQueuedMeal[] = [{ id: 'q1', slot: 'dinner', labels: ['Pasta', 'salad'] }];
    let notify: () => void = () => undefined;
    installPlanQueuedMeals({
      pendingOn: (date) => (date === TODAY ? queue : []),
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    api.on('GET', '/health', Reply.ok(day({ meals: { date: TODAY, meals: [], totals: totals(0, 0, 0), target: null } })));
    await renderPlan();
    const row = screen.getByTestId('plan.nutrition.queued.q1');
    expect(within(row).getByText('Pasta, salad')).toBeOnTheScreen();
    expect(within(row).getByText(en('plan.waiting_sync'))).toBeOnTheScreen();
    expect(card().queryByText(en('plan.nutrition.none_yet'))).toBeNull();
    // The flush sent it: the queue says so and the row goes.
    queue.length = 0;
    await act(async () => notify());
    expect(screen.queryByTestId('plan.nutrition.queued.q1')).toBeNull();
  });

  it('another day: "Food on ...", Back to today, no drafts row, and the meal page opens on that day', async () => {
    signIn();
    const yesterday = addServerDays(TODAY, -1)!;
    api.on('GET', '/health', ({ query }) =>
      Reply.ok(query.date === yesterday ? day({}, yesterday) : day({ pendingDrafts: [{ id: 'd1', loggedAt: '2026-10-16T08:00:00Z' }] })),
    );
    await renderPlan();
    expect(screen.getByTestId('plan.nutrition.drafts')).toBeOnTheScreen();
    await act(async () => {
      const { selectPlanDate } = jest.requireActual('../../shell');
      selectPlanDate(yesterday);
      await settle();
    });
    expect(card().getByRole('header', { name: en('plan.nutrition.title_day', { date: shortDay(yesterday, 'en') }) })).toBeOnTheScreen();
    expect(screen.queryByTestId('plan.nutrition.drafts')).toBeNull();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.scan') }));
    expect(screen.getByText(`route:MealCapture:${JSON.stringify({ origin: 'plan', mode: 'photo', date: yesterday })}`)).toBeOnTheScreen();
  });

  it('Back to today returns the strip to today', async () => {
    signIn();
    const yesterday = addServerDays(TODAY, -1)!;
    api.on('GET', '/health', ({ query }) => Reply.ok(day({}, query.date ?? TODAY)));
    await renderPlan();
    await act(async () => {
      const { selectPlanDate } = jest.requireActual('../../shell');
      selectPlanDate(yesterday);
      await settle();
    });
    await fireEvent.press(screen.getByTestId('plan.nutrition.back'));
    expect(card().getByRole('header', { name: en('plan.nutrition.title') })).toBeOnTheScreen();
  });
});

describe('the target row', () => {
  it('withheld targets say why, and offer nothing', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ meals: { ...MEALS, target: null, targetWithheld: 'bmi_low_lose_weight' } })));
    await renderPlan();
    expect(card().getByText(en('plan.targets.withheld'))).toBeOnTheScreen();
    expect(screen.queryByTestId('plan.nutrition.set_targets')).toBeNull();
  });

  it('a live plan without targets opens the body sheet for that plan, and its save reads the day again', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ meals: { ...MEALS, target: null } })));
    await renderPlan();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.no_target_body') }));
    expect(mockOpenBodySheet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update', programId: 'p-1' }));
    const reads = api.sentAll('/health').length;
    await act(async () => {
      mockOpenBodySheet.mock.calls[0][0].onSaved();
      await settle();
    });
    expect(api.sentAll('/health').length).toBe(reads + 1);
  });

  it('no plan: "Set a calorie goal" opens the goal mode', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ program: null, meals: { ...MEALS, target: null } })));
    await renderPlan();
    await fireEvent.press(await screen.findByRole('button', { name: en('plan.nutrition.set_goal') }));
    expect(mockOpenBodySheet).toHaveBeenCalledWith(expect.objectContaining({ kind: 'goal' }));
  });

  it('a range from the calorie goal says so', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ program: null, meals: { ...MEALS, target: { ...MEALS.target, basis: 'goal' } } })));
    await renderPlan();
    expect(await screen.findByText(en('plan.nutrition.basis_goal'))).toBeOnTheScreen();
  });
});

describe('the target weight row', () => {
  const TARGET_WEIGHT = { targetWeightKg: 72.5, direction: 'lose', appliesTo: 'program', eta: { weeksLow: 6, weeksHigh: 9 } };

  it('today on a server with target weights: the line and the estimate note, which open the target sheet', async () => {
    signIn();
    useAppStore.setState({ serverFeatures: [ServerFeature.targetWeight] });
    api.on('GET', '/health', Reply.ok(day({ targetWeight: TARGET_WEIGHT, features: [ServerFeature.targetWeight] })));
    await renderPlan();
    expect(card().getByText(en('target.line_eta', { kg: '72.5', low: 6, high: 9 }))).toBeOnTheScreen();
    expect(card().getByText(en('target.eta_note'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('plan.nutrition.target_weight.line'));
    expect(mockOpenTargetSheet).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'save', existing: expect.objectContaining({ targetWeightKg: 72.5 }) }),
    );
  });

  it('reached: the note and Set a new target', async () => {
    signIn();
    useAppStore.setState({ serverFeatures: [ServerFeature.targetWeight] });
    api.on(
      'GET',
      '/health',
      Reply.ok(day({ targetWeight: { ...TARGET_WEIGHT, reachedAt: '2026-10-10T08:00:00Z' }, features: [ServerFeature.targetWeight] })),
    );
    await renderPlan();
    expect(card().getByText(en('target.reached.title'))).toBeOnTheScreen();
    await fireEvent.press(card().getByRole('button', { name: en('target.reached.cta') }));
    expect(mockOpenTargetSheet).toHaveBeenCalledTimes(1);
  });

  it('hidden until the server advertises target weights', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ targetWeight: TARGET_WEIGHT })));
    await renderPlan();
    expect(screen.queryByTestId('plan.nutrition.target_weight.line')).toBeNull();
    await act(async () => {
      useAppStore.setState({ serverFeatures: [ServerFeature.targetWeight] });
    });
    expect(screen.getByTestId('plan.nutrition.target_weight.line')).toBeOnTheScreen();
  });
});

describe('the drafts row', () => {
  const drafts = {
    pendingDrafts: [{ id: 'photo-1', logDate: TODAY, loggedAt: '2026-10-16T08:00:00Z', slot: 'breakfast', itemCount: 3 }],
    pendingTextDrafts: [{ id: 'text-1', logDate: TODAY, loggedAt: '2026-10-16T12:40:00Z', slot: 'lunch', itemCount: 2 }],
  };

  it('photo and description estimates together: "2 estimates waiting", the newest opens, See all lists them', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day(drafts)));
    await renderPlan();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.drafts_any.many', { count: 2 }) }));
    expect(screen.getByText(`route:MealEditor:${JSON.stringify({ mode: 'stored', mealId: 'text-1' })}`)).toBeOnTheScreen();
  });

  it('See all opens the drafts list', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day(drafts)));
    await renderPlan();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.drafts_all') }));
    expect(screen.getByText('route:Drafts:{}')).toBeOnTheScreen();
  });

  it('one photo estimate: the photo wording and no See all', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day({ pendingDrafts: drafts.pendingDrafts })));
    await renderPlan();
    expect(card().getByRole('button', { name: en('plan.nutrition.drafts.one', { count: 1 }) })).toBeOnTheScreen();
    expect(card().queryByRole('button', { name: en('plan.nutrition.drafts_all') })).toBeNull();
  });
});

describe('the actions', () => {
  it('an entitled member: Add food opens the meal page on today', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day()));
    await renderPlan();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.add') }));
    expect(screen.getByText(`route:MealCapture:${JSON.stringify({ origin: 'plan', mode: 'search', date: TODAY })}`)).toBeOnTheScreen();
  });

  it('a meal opens the editor', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day()));
    await renderPlan();
    await fireEvent.press(screen.getByTestId('plan.nutrition.meal.m2'));
    expect(screen.getByText(`route:MealEditor:${JSON.stringify({ mode: 'stored', mealId: 'm2' })}`)).toBeOnTheScreen();
  });

  it('Food diary opens the day', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day()));
    await renderPlan();
    await fireEvent.press(card().getByRole('button', { name: en('plan.nutrition.diary') }));
    expect(screen.getByText(`route:Diary:${JSON.stringify({ date: TODAY })}`)).toBeOnTheScreen();
  });

  it('a member who is not entitled reads: no Scan or Add, the diary stays, and the way to targets is disabled', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    api.on('GET', '/health', Reply.ok(day({ meals: { ...MEALS, target: null } })));
    await renderPlan();
    expect(card().queryByRole('button', { name: en('plan.nutrition.scan') })).toBeNull();
    expect(card().queryByRole('button', { name: en('plan.nutrition.add') })).toBeNull();
    expect(card().getByRole('button', { name: en('plan.nutrition.diary') })).toBeOnTheScreen();
    expect(card().getByRole('button', { name: en('plan.nutrition.no_target_body') })).toBeDisabled();
    // Disabled without a fade, as iOS draws `targetButton` (only Scan fades).
    expect(card().getByRole('button', { name: en('plan.nutrition.no_target_body') })).not.toHaveStyle({ opacity: 0.4 });
  });

  it('offline: Scan and Add are disabled, with the hint; the diary still opens', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(day()));
    await renderPlan();
    api.on('GET', '/health', Reply.fail());
    await act(async () => {
      const { reloadPlan } = jest.requireActual('../../shell');
      await reloadPlan({ force: true });
      await settle();
    });
    await waitFor(() => expect(card().getByText(en('health.offline.action_hint'))).toBeOnTheScreen());
    expect(card().getByRole('button', { name: en('plan.nutrition.scan') })).toBeDisabled();
    expect(card().getByRole('button', { name: en('plan.nutrition.add') })).toBeDisabled();
    expect(card().getByRole('button', { name: en('plan.nutrition.diary') })).toBeEnabled();
  });
});
