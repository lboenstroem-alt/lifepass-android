/**
 * The meal calendar on screen (iOS MealHistoryView): the first 30-day window
 * ending today, month cards, the meta line and bar, "Load earlier" reading
 * the window before until the first logged day, then the start line; the
 * empty state; a day opening the diary; Icelandic.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text, View } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import MealHistoryScreen from '../MealHistoryScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const TODAY = todayServerDay();
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

type Routes = { Start: undefined; MealHistory: undefined; Diary: { date: string } };
const Stack = createNativeStackNavigator<Routes>();

function DiaryStandIn({ route }: NativeStackScreenProps<Routes, 'Diary'>) {
  return (
    <View testID="route.Diary">
      <Text>{`diary ${route.params.date}`}</Text>
    </View>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderHistory() {
  await render(
    <NavigationContainer initialState={{ index: 1, routes: [{ name: 'Start' }, { name: 'MealHistory' }] }}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Start" component={View} />
        <Stack.Screen name="MealHistory" component={MealHistoryScreen as never} />
        <Stack.Screen name="Diary" component={DiaryStandIn} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await settle();
}

const day = (offset: number, extra: Record<string, unknown> = {}) => ({
  date: addServerDays(TODAY, offset)!,
  kcalLow: 1640,
  kcalHigh: 1640,
  proteinG: 92,
  carbsG: 180,
  fatG: 50,
  mealCount: 3,
  draftCount: 0,
  target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 },
  ...extra,
});

afterEach(() => setCurrentLanguage('en'));

it('reads 30 days ending today and draws them by month, with their meta line and bar', async () => {
  api.on('GET', '/health/meals/days', Reply.ok({ days: [day(0), day(-1, { target: null }), day(-3, { mealCount: 0, kcalLow: null, kcalHigh: null })], firstLogDate: addServerDays(TODAY, -3) }));
  await renderHistory();

  const sent = api.sent('/health/meals/days', 'GET');
  expect(sent.query).toEqual({ from: addServerDays(TODAY, -29), to: TODAY, locale: 'en' });

  expect(screen.getByText(en('history.meals.title').toUpperCase())).toBeOnTheScreen();
  const today = within(screen.getByTestId(`mealHistory.day.${TODAY}`));
  expect(today.getByText(en('history.meal.meta', { kcal: '1,640', protein: '92', meals: en('history.meal.count.many', { count: 3 }) }))).toBeOnTheScreen();
  expect(screen.getByTestId(`mealHistory.day.${TODAY}.bar`)).toBeOnTheScreen();
  expect(screen.queryByTestId(`mealHistory.day.${addServerDays(TODAY, -1)}.bar`)).toBeNull(); // no target, no bar
  expect(within(screen.getByTestId(`mealHistory.day.${addServerDays(TODAY, -3)}`)).getByText(en('plan.nutrition.not_logged'))).toBeOnTheScreen();

  // The window reached the first logged day.
  expect(screen.queryByTestId('mealHistory.loadEarlier')).toBeNull();
  expect(screen.getByText(en('history.meals.start'))).toBeOnTheScreen();
});

it('"Load earlier" reads the window before, until the first logged day', async () => {
  const firstLogDate = addServerDays(TODAY, -45)!;
  api.on('GET', '/health/meals/days', (request) =>
    Reply.ok({
      days: request.query.to === TODAY ? [day(0)] : [day(-40)],
      firstLogDate,
    }),
  );
  await renderHistory();
  expect(screen.queryByText(en('history.meals.start'))).toBeNull();
  await fireEvent.press(screen.getByTestId('mealHistory.loadEarlier'));
  await settle();
  const reads = api.sentAll('/health/meals/days', 'GET').map((request) => [request.query.from, request.query.to]);
  expect(reads).toEqual([
    [addServerDays(TODAY, -29), TODAY],
    [addServerDays(TODAY, -59), addServerDays(TODAY, -30)],
  ]);
  expect(screen.getByTestId(`mealHistory.day.${addServerDays(TODAY, -40)}`)).toBeOnTheScreen();
  expect(screen.queryByTestId('mealHistory.loadEarlier')).toBeNull();
  expect(screen.getByText(en('history.meals.start'))).toBeOnTheScreen();
});

it('says meals show up here when there are none, or the read failed', async () => {
  api.on('GET', '/health/meals/days', Reply.ok({ days: [], firstLogDate: null }));
  await renderHistory();
  expect(screen.getByText(en('history.meals.empty'))).toBeOnTheScreen();
  expect(screen.queryByTestId('mealHistory.loadEarlier')).toBeNull();
  expect(screen.queryByText(en('history.meals.start'))).toBeNull();
});

it('a failed read shows the empty line too, as iOS', async () => {
  api.on('GET', '/health/meals/days', Reply.problem(500, 'internal_error'));
  await renderHistory();
  expect(screen.getByText(en('history.meals.empty'))).toBeOnTheScreen();
});

it('a day opens the diary for it', async () => {
  api.on('GET', '/health/meals/days', Reply.ok({ days: [day(-2)], firstLogDate: null }));
  await renderHistory();
  await fireEvent.press(screen.getByTestId(`mealHistory.day.${addServerDays(TODAY, -2)}`));
  expect(await screen.findByText(`diary ${addServerDays(TODAY, -2)}`)).toBeOnTheScreen();
});

it('speaks Icelandic', async () => {
  setCurrentLanguage('is');
  api.on('GET', '/health/meals/days', Reply.ok({ days: [day(0, { mealCount: 1 })], firstLogDate: TODAY }));
  await renderHistory();
  expect(api.sent('/health/meals/days', 'GET').query.locale).toBe('is');
  expect(
    screen.getByText(translate('history.meal.meta', 'is', { kcal: '1.640', protein: '92', meals: translate('history.meal.count.one', 'is', { count: 1 }) })),
  ).toBeOnTheScreen();
  expect(screen.getByText(translate('history.meals.start', 'is'))).toBeOnTheScreen();
});
