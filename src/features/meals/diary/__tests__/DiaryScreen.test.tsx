/**
 * The food diary on screen (iOS DiaryDayView): the summary against the
 * target, drafts (testADescriptionDraftWaitsInTheDiary,
 * testTheDiaryOpensItsDraftAndAddsToASlot), slots with their meals, items
 * and the meals waiting to sync, Add food on the slot and day, the date bar
 * and its swipe, copy from yesterday with its toast, deleting an item with
 * Undo and the last item's question, offline today from the cache, the
 * other-day offline line, Retry, read-only access, and Icelandic. Also: a
 * new date from the route, a read for a day the member has left, and a
 * removal from the offline copy.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Text, View } from 'react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { ProblemError, TransportError } from '../../../../api';
import { decodeProfile } from '../../../../api/profile';
import { stubApiClientPerTest } from '../../../../api/testing';
import { DialogHost } from '../../../../components/ui';
import { dismissToast, ToastHost } from '../../../../components/ui/Toast';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { setMealApi, type MealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { resetMealOutboxForTests, useMealOutbox } from '../../outbox/mealOutbox';
import { decodeMealDayRecord, decodeMealRecord, type MealDayRecord, type MealPatchBody } from '../../types';
import DiaryScreen from '../DiaryScreen';
import { registerStoredItemEditor } from '../storedItemEditor';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

// The item rows' swipe (ReanimatedSwipeable) builds its gestures from
// worklets; under Jest's Reanimated mock they are plain functions, and RNGH
// says so once per row. A phone build compiles them as worklets.
const consoleError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Some of the callbacks in the gesture are worklets')) return;
    consoleError(...args);
  });
});
afterAll(() => {
  jest.restoreAllMocks();
});

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = todayServerDay();
const YESTERDAY = addServerDays(TODAY, -1)!;
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

// ---------------------------------------------------------------------------
// Fixtures

function itemJSON(id: string, label: string, kcal: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    source: 'usda',
    basis: 'library',
    label,
    foodId: `food-${id}`,
    serving: { unit: 'g' },
    amount: 100,
    servingOptions: [{ unit: 'g' }],
    per100g: { kcal, proteinG: 10, carbsG: 10, fatG: 4 },
    edited: [],
    confirmed: true,
    liquid: false,
    nutrients: { kcalLow: kcal, kcalHigh: kcal, proteinG: 10, carbsG: 10, fatG: 4, grams: 100, macrosComplete: true },
    ...extra,
  };
}

function mealJSON(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    logDate: date,
    loggedAt: `${date}T08:05:00.000Z`,
    slot: 'breakfast',
    source: 'search',
    confirmed: true,
    needsConfirm: false,
    hasEstimate: false,
    items: [itemJSON(`${id}-1`, 'Skyr', 120)],
    totals: { kcalLow: 120, kcalHigh: 120, proteinG: 10, carbsG: 10, fatG: 4 },
    updatedAt: `${date}T08:05:00.123Z`,
    ...extra,
  };
}

function dayJSON(date: string, extra: Record<string, unknown> = {}) {
  return {
    date,
    meals: [],
    drafts: [],
    totals: { kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    target: null,
    ...extra,
  };
}

const day = (json: Record<string, unknown>): MealDayRecord => decodeMealDayRecord(json, 'day');

const fullDay = (date: string) =>
  day(
    dayJSON(date, {
      meals: [
        mealJSON('breakfast-1', date, {
          items: [itemJSON('b1', 'Skyr', 120), itemJSON('b2', 'Banana', 90, { amount: 120 })],
          totals: { kcalLow: 210, kcalHigh: 210, proteinG: 12, carbsG: 30, fatG: 1 },
        }),
        mealJSON('lunch-1', date, {
          slot: 'lunch',
          loggedAt: `${date}T12:40:00.000Z`,
          items: [itemJSON('l1', 'Soup', 300)],
          totals: { kcalLow: 300, kcalHigh: 300, proteinG: 15, carbsG: 20, fatG: 10 },
        }),
      ],
      drafts: [mealJSON('photo-1', date, { source: 'photo', confirmed: false, slot: 'dinner', loggedAt: `${date}T18:10:00.000Z` })],
      textDrafts: [mealJSON('text-1', date, { source: 'text', confirmed: false, slot: 'lunch', loggedAt: `${date}T12:40:00.000Z` })],
      totals: { kcalLow: 510, kcalHigh: 510, proteinG: 27, carbsG: 50, fatG: 11 },
      target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120, basis: 'program' },
    }),
  );

// ---------------------------------------------------------------------------
// Harness

type Routes = {
  Start: undefined;
  Diary: { date: string };
  MealEditor: { mode: 'stored'; mealId: string };
  MealCapture: { origin: string; mode: string; slot?: string; date?: string };
};
const Stack = createNativeStackNavigator<Routes>();
const navigationRef = createNavigationContainerRef<Routes>();

function MealEditorStandIn({ route }: NativeStackScreenProps<Routes, 'MealEditor'>) {
  return (
    <View testID="route.MealEditor">
      <Text>{`editor ${route.params.mealId}`}</Text>
    </View>
  );
}

function MealCaptureStandIn({ route, navigation }: NativeStackScreenProps<Routes, 'MealCapture'>) {
  const { origin, mode, slot, date } = route.params;
  return (
    <View testID="route.MealCapture">
      <Text>{`capture ${origin} ${mode} ${slot} ${date}`}</Text>
      <Text testID="capture.close" onPress={() => navigation.goBack()}>
        close
      </Text>
    </View>
  );
}

async function renderDiary(date = TODAY) {
  await render(
    <>
      <NavigationContainer ref={navigationRef} initialState={{ index: 1, routes: [{ name: 'Start' }, { name: 'Diary', params: { date } }] }}>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="Start" component={View} />
          <Stack.Screen name="Diary" component={DiaryScreen as never} />
          <Stack.Screen name="MealEditor" component={MealEditorStandIn} />
          <Stack.Screen name="MealCapture" component={MealCaptureStandIn} />
        </Stack.Navigator>
      </NavigationContainer>
      <ToastHost />
      <DialogHost />
    </>,
  );
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Answers `mealDay` per date (a function or a record), and records every call. */
function serveDays(days: Record<string, MealDayRecord | Error>, extra: Partial<MealApi> = {}) {
  const reads: string[] = [];
  const api = fakeMealApi({
    mealDay: async (date) => {
      reads.push(date);
      const answer = days[date] ?? day(dayJSON(date));
      if (answer instanceof Error) throw answer;
      return answer;
    },
    ...extra,
  });
  setMealApi(api);
  return reads;
}

function signIn(access: 'entitled' | 'past_due' = 'entitled') {
  const json = {
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access, consent: { version: '2026-09-v1', consentedAt: '2026-10-01T10:00:00Z', ageSource: 'kennitala' }, features: [] },
  };
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(json), healthAccess: access });
  api.on('GET', '/health', Reply.problem(500, 'internal_error'));
}

function problem(status: number, slug: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetMealOutboxForTests();
  resetIntentStoreForTests();
  registerStoredItemEditor(null);
  setCurrentLanguage('en');
});

afterEach(() => {
  dismissToast();
  setMealApi(null);
  registerStoredItemEditor(null);
  resetAppStoreForTests();
});

// ---------------------------------------------------------------------------

it('draws the day: summary against the target, drafts, slots with meals and items, the footer', async () => {
  signIn();
  serveDays({ [TODAY]: fullDay(TODAY) });
  await renderDiary();

  expect(screen.getByText(en('diary.title').toUpperCase())).toBeOnTheScreen();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.next')).toBeDisabled();

  const summary = within(screen.getByTestId('diary.summary'));
  expect(summary.getByText('EATEN')).toBeOnTheScreen();
  expect(summary.getByText('510 kcal')).toBeOnTheScreen();
  expect(summary.getByText(en('plan.nutrition.target', { low: '1,800', high: '2,000', protein: '120' }))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.summary.status')).toHaveTextContent(en('diary.left', { kcal: '1,390' }));
  expect(screen.getByTestId('diary.summary.protein').props.accessibilityLabel).toBe(en('diary.protein_line', { eaten: '27', target: '120' }));
  expect(summary.getByText(en('diary.carbs_fat_line', { carbs: '50', fat: '11' }))).toBeOnTheScreen();
  expect(summary.queryByText(en('diary.empty'))).toBeNull();

  // Both drafts, once each, under their own names.
  const drafts = within(screen.getByTestId('diary.drafts'));
  expect(drafts.getByText(en('diary.drafts').toUpperCase())).toBeOnTheScreen();
  expect(drafts.getByText(en('diary.draft_row', { time: '18:10' }))).toBeOnTheScreen();
  expect(drafts.getByText(en('diary.draft_row_text', { time: '12:40' }))).toBeOnTheScreen();

  const breakfast = within(screen.getByTestId('diary.slot.breakfast'));
  expect(breakfast.getByText(en('slot.breakfast'))).toBeOnTheScreen();
  expect(breakfast.getByTestId('diary.slot.breakfast.kcal')).toHaveTextContent('210 kcal');
  expect(breakfast.getByText('Skyr')).toBeOnTheScreen();
  expect(breakfast.getByText('Banana')).toBeOnTheScreen();
  expect(breakfast.getByText('90 kcal')).toBeOnTheScreen(); // the server's own number for an untouched item, not 120 g recomputed
  expect(breakfast.getByText('120 g')).toBeOnTheScreen();
  expect(screen.getByTestId('diary.meal.breakfast-1').props.accessibilityLabel).toBe(
    en('a11y.open_meal', { slot: en('slot.breakfast'), time: '08:05' }),
  );
  expect(within(screen.getByTestId('diary.slot.dinner')).queryByTestId('diary.slot.dinner.kcal')).toBeNull();
  for (const slot of ['breakfast', 'lunch', 'dinner', 'snack', 'drink']) expect(screen.getByTestId(`diary.add.${slot}`)).toBeOnTheScreen();
  expect(screen.getByText(en('meal.estimate.accuracy'))).toBeOnTheScreen();
  expect(screen.getByText(en('food.credits_line'))).toBeOnTheScreen();
});

it('a description draft waits in the diary and opens the meal editor (testADescriptionDraftWaitsInTheDiary)', async () => {
  signIn();
  serveDays({ [TODAY]: fullDay(TODAY) });
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.draft.text-1'));
  expect(await screen.findByText('editor text-1')).toBeOnTheScreen();
});

it('Add food opens Search on the slot and the day (testTheDiaryOpensItsDraftAndAddsToASlot)', async () => {
  signIn();
  serveDays({ [YESTERDAY]: fullDay(YESTERDAY) });
  await renderDiary(YESTERDAY);
  await fireEvent.press(screen.getByTestId('diary.add.breakfast'));
  expect(await screen.findByText(`capture diary search breakfast ${YESTERDAY}`)).toBeOnTheScreen();
});

it('back from the meal page, the day is read again', async () => {
  signIn();
  const reads = serveDays({ [YESTERDAY]: fullDay(YESTERDAY) });
  await renderDiary(YESTERDAY);
  expect(reads).toEqual([YESTERDAY]);
  await fireEvent.press(screen.getByTestId('diary.add.lunch'));
  await fireEvent.press(await screen.findByTestId('capture.close'));
  await settle();
  expect(reads).toEqual([YESTERDAY, YESTERDAY]);
});

it('an empty day says so, and a target that is withheld says why', async () => {
  signIn();
  serveDays({ [TODAY]: day(dayJSON(TODAY, { targetWithheld: 'bmi_high' })) });
  await renderDiary();
  expect(screen.getByText(en('diary.empty'))).toBeOnTheScreen();
  expect(screen.getByText(en('plan.targets.withheld'))).toBeOnTheScreen();
  expect(screen.queryByTestId('diary.summary.status')).toBeNull();
  expect(screen.queryByTestId('diary.drafts')).toBeNull();
});

it('an estimated day shows its range with the Estimate chip', async () => {
  signIn();
  serveDays({
    [TODAY]: day(dayJSON(TODAY, { meals: [mealJSON('m', TODAY)], totals: { kcalLow: 1294, kcalHigh: 1546, proteinG: 40, carbsG: 100, fatG: 30 } })),
  });
  await renderDiary();
  expect(screen.getByText(en('plan.nutrition.kcal_range', { low: '1,294', high: '1,546' }))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.summary.estimate')).toBeOnTheScreen();
});

it('meals waiting on the phone show under their slot with "Waiting to sync"', async () => {
  signIn();
  serveDays({ [TODAY]: day(dayJSON(TODAY)) });
  useMealOutbox.setState({
    items: [
      {
        id: 'q1',
        key: 'k1',
        createdAt: new Date(),
        state: 'pending',
        body: {
          slot: 'lunch',
          logDate: TODAY,
          loggedAt: new Date(),
          source: 'quick_add',
          items: [
            {
              id: null,
              source: 'quick_add',
              label: 'Soup from the canteen',
              brand: null,
              foodId: null,
              barcode: null,
              off: null,
              serving: { unit: 'serving', label: '1 serving', grams: null },
              amount: 1,
              per100g: null,
              perServing: { kcal: 300, proteinG: null, carbsG: null, fatG: null },
              overrides: null,
              confirmed: true,
            },
          ],
        },
      },
    ],
  });
  await renderDiary();
  const lunch = within(screen.getByTestId('diary.slot.lunch'));
  expect(lunch.getByText('Soup from the canteen')).toBeOnTheScreen();
  expect(lunch.getByText(en('plan.waiting_sync'))).toBeOnTheScreen();
  // A waiting meal makes the day not empty.
  expect(screen.queryByText(en('diary.empty'))).toBeNull();
});

it('the date bar steps back and forward, and a swipe on the summary changes the day', async () => {
  signIn();
  const reads = serveDays({ [TODAY]: fullDay(TODAY) });
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.prev'));
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.yesterday'))).toBeOnTheScreen();
  expect(reads).toContain(YESTERDAY);
  expect(screen.getByTestId('diary.next')).toBeEnabled();

  await act(async () => {
    fireGestureHandler(getByGestureTestId('diary.summary.swipe'), [{ translationX: 0 }, { translationX: -90, translationY: 5 }]);
  });
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
});

it('the calendar opens a picked day', async () => {
  signIn();
  serveDays({});
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.date'));
  expect(screen.getByText(en('meal.header.change_date'))).toBeOnTheScreen();
  const twoDaysAgo = addServerDays(TODAY, -2)!;
  await fireEvent.press(screen.getByTestId(`classes.calendar.day.${twoDaysAgo}`));
  await fireEvent.press(screen.getByTestId('diary.dateSheet.done'));
  await settle();
  expect(within(screen.getByTestId('diary.date')).queryByText(en('diary.today'))).toBeNull();
  expect(within(screen.getByTestId('diary.date')).queryByText(en('diary.yesterday'))).toBeNull();
});

it('copies yesterday’s confirmed meals into an empty slot today, then says the day’s total', async () => {
  signIn();
  const copies: { id: string; body: unknown }[] = [];
  const yesterday = day(
    dayJSON(YESTERDAY, {
      meals: [
        mealJSON('y-first', YESTERDAY, { loggedAt: `${YESTERDAY}T07:00:00.000Z` }),
        mealJSON('y-second', YESTERDAY, { loggedAt: `${YESTERDAY}T09:00:00.000Z` }),
        mealJSON('y-draft', YESTERDAY, { confirmed: false }),
        mealJSON('y-lunch', YESTERDAY, { slot: 'lunch' }),
      ],
    }),
  );
  const todayMeals: Record<string, unknown>[] = [mealJSON('t-lunch', TODAY, { slot: 'lunch' })];
  setMealApi(
    fakeMealApi({
      mealDay: async (date) => (date === TODAY ? day(dayJSON(TODAY, { meals: todayMeals })) : yesterday),
      copyMeal: async (id, body) => {
        copies.push({ id, body });
        todayMeals.push(mealJSON(`copy-${id}`, TODAY));
        return { meal: decodeMealRecord(mealJSON(`copy-${id}`, TODAY), 'meal'), replayed: false };
      },
    }),
  );
  await renderDiary();
  expect(screen.getByTestId('diary.copy.breakfast')).toBeOnTheScreen();
  expect(screen.queryByTestId('diary.copy.lunch')).toBeNull(); // today's lunch is logged
  expect(screen.queryByTestId('diary.copy.dinner')).toBeNull(); // nothing yesterday

  await fireEvent.press(screen.getByTestId('diary.copy.breakfast'));
  await settle();
  expect(copies.map((copy) => copy.id)).toEqual(['y-first', 'y-second']);
  expect(copies[0]!.body).toEqual({ logDate: TODAY, loggedAt: expect.any(Date), slot: 'breakfast' });
  // No Today read to total from in this test: the plain line, with the way to the diary.
  expect(await screen.findByText(en('meal.saved'))).toBeOnTheScreen();
  expect(screen.getByText(en('diary.title'), { exact: true, includeHiddenElements: false })).toBeOnTheScreen();
  expect(screen.queryByTestId('diary.copy.breakfast')).toBeNull();

  // "Food diary" goes through Plan, as iOS `MealSaveFeedback.saved` sends it.
  await fireEvent.press(screen.getByText(en('diary.title'), { exact: true, includeHiddenElements: false }));
  expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openDiary', date: TODAY });
  expect(useIntentStore.getState().pendingTab).toBe('Plan');
});

it('a copy refused by the membership presents the gate', async () => {
  signIn();
  const yesterday = day(dayJSON(YESTERDAY, { meals: [mealJSON('y1', YESTERDAY)] }));
  setMealApi(
    fakeMealApi({
      mealDay: async (date) => (date === TODAY ? day(dayJSON(TODAY)) : yesterday),
      copyMeal: async () => {
        throw new ProblemError({ type: 'https://lifepass.is/problems/no_active_plan_or_pass', status: 403, memberPricing: 'pass_holder' }, 403);
      },
    }),
  );
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.copy.breakfast'));
  await settle();
  expect(useAppStore.getState().healthAccess).toBe('pass_only');
  // No app-wide host in this test: the page draws the gate itself.
  expect(screen.getByText(en('meal.gate.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('meal.gate.body_pass'))).toBeOnTheScreen();
});

it('deleting an item patches the meal with the rest, and Undo puts it back', async () => {
  signIn();
  const patches: { id: string; body: MealPatchBody }[] = [];
  serveDays(
    { [TODAY]: fullDay(TODAY) },
    {
      patchMeal: async (id, body) => {
        patches.push({ id, body });
        return { meal: decodeMealRecord(mealJSON(id, TODAY, { updatedAt: `${TODAY}T08:06:00.999Z` }), 'meal'), replayed: false };
      },
    },
  );
  await renderDiary();
  const banana = screen.getByTestId('diary.item.b2');
  expect(banana.props.accessibilityActions).toEqual([{ name: 'delete', label: en('common.delete') }]);
  await act(async () => {
    banana.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
  await settle();
  expect(patches[0]!.id).toBe('breakfast-1');
  expect(patches[0]!.body.items?.map((input) => input.id)).toEqual(['b1']);
  expect(patches[0]!.body.expectedUpdatedAt).toBe(`${TODAY}T08:05:00.123Z`);

  expect(await screen.findByText(en('food.editor.removed'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByText(en('plan.undo')));
  await settle();
  expect(patches[1]!.body.items?.map((input) => input.id)).toEqual(['b1', null]);
  expect(patches[1]!.body.expectedUpdatedAt).toBe(`${TODAY}T08:06:00.999Z`);
});

it('the swipe action deletes too', async () => {
  signIn();
  const patches: string[] = [];
  serveDays(
    { [TODAY]: fullDay(TODAY) },
    {
      patchMeal: async (id) => {
        patches.push(id);
        return { meal: decodeMealRecord(mealJSON(id, TODAY), 'meal'), replayed: false };
      },
    },
  );
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.item.b1.delete'));
  await settle();
  expect(patches).toEqual(['breakfast-1']);
});

it('the last item asks "Delete this meal?" and deletes it', async () => {
  signIn();
  const deleted: string[] = [];
  serveDays(
    { [TODAY]: fullDay(TODAY) },
    {
      deleteMeal: async (id) => {
        deleted.push(id);
      },
    },
  );
  await renderDiary();
  await act(async () => {
    screen.getByTestId('diary.item.l1').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
  expect(screen.getByText(en('meal.delete.title'))).toBeOnTheScreen();
  expect(screen.getByText(en('meal.delete.body'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('diary.deleteMeal.confirm'));
  await settle();
  expect(deleted).toEqual(['lunch-1']);
});

it('a meal changed elsewhere says so and reads the day again', async () => {
  signIn();
  const reads = serveDays(
    { [TODAY]: fullDay(TODAY) },
    {
      patchMeal: async () => {
        throw problem(409, 'meal_changed');
      },
    },
  );
  await renderDiary();
  const before = reads.length;
  await act(async () => {
    screen.getByTestId('diary.item.b2').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
  await settle();
  expect(await screen.findByText(en('health.err.changed'))).toBeOnTheScreen();
  expect(reads.length).toBeGreaterThan(before);
});

it('tapping an item opens the registered item editor, or the meal editor without one', async () => {
  signIn();
  serveDays({ [TODAY]: fullDay(TODAY) });
  const opened: string[] = [];
  registerStoredItemEditor((request) => {
    opened.push(`${request.meal.id}/${request.item.storedId}`);
    return true;
  });
  await renderDiary();
  await fireEvent.press(screen.getByTestId('diary.item.b2'));
  expect(opened).toEqual(['breakfast-1/b2']);

  registerStoredItemEditor(null);
  await fireEvent.press(screen.getByTestId('diary.item.b2'));
  expect(await screen.findByText('editor breakfast-1')).toBeOnTheScreen();
});

it('offline today falls back to the cached Today read with the banner, and offers no copy', async () => {
  signIn();
  useHealthStore.setState({
    cachedAt: new Date(`${TODAY}T07:30:00.000Z`),
    today: decodeHealthDay({
      contractVersion: '2026-09-v1',
      date: TODAY,
      today: TODAY,
      locale: 'en',
      access: 'entitled',
      upcoming: [],
      meals: {
        date: TODAY,
        meals: [
          {
            id: 'cached-1',
            logDate: TODAY,
            loggedAt: `${TODAY}T07:00:00Z`,
            slot: 'breakfast',
            confirmed: true,
            items: [{ id: 'ci', label: 'Oats', serving: { unit: 'g' }, amount: 60, nutrients: { kcalLow: 220, kcalHigh: 220 } }],
            totals: { kcalLow: 220, kcalHigh: 220, proteinG: 8, carbsG: 36, fatG: 4 },
          },
        ],
        totals: { kcalLow: 220, kcalHigh: 220, proteinG: 8, carbsG: 36, fatG: 4 },
      },
    }),
  });
  serveDays({ [TODAY]: new TransportError('offline'), [YESTERDAY]: day(dayJSON(YESTERDAY, { meals: [mealJSON('y', YESTERDAY, { slot: 'lunch' })] })) });
  await renderDiary();
  expect(within(screen.getByTestId('diary.offline')).getByText(en('health.offline.banner', { time: '07:30' }))).toBeOnTheScreen();
  expect(screen.getByText('Oats')).toBeOnTheScreen();
  expect(screen.queryByTestId('diary.copy.lunch')).toBeNull();
});

it('offline on another day says it needs a connection, and Try again reads again', async () => {
  signIn();
  let answer: MealDayRecord | Error = new TransportError('offline');
  const reads: string[] = [];
  setMealApi(
    fakeMealApi({
      mealDay: async (date) => {
        reads.push(date);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    }),
  );
  await renderDiary(YESTERDAY);
  expect(within(screen.getByTestId('diary.failed')).getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  answer = fullDay(YESTERDAY);
  await fireEvent.press(screen.getByTestId('diary.retry'));
  await settle();
  expect(screen.getByTestId('diary.summary')).toBeOnTheScreen();
});

it('any other failure says something went wrong', async () => {
  signIn();
  serveDays({ [YESTERDAY]: problem(500, 'internal_error') });
  await renderDiary(YESTERDAY);
  expect(within(screen.getByTestId('diary.failed')).getByText(en('common.error_body'))).toBeOnTheScreen();
});

it('read only without the membership: no Add food or copy, items can still be deleted', async () => {
  signIn('past_due');
  serveDays({ [TODAY]: fullDay(TODAY) });
  await renderDiary();
  expect(screen.queryByTestId('diary.add.breakfast')).toBeNull();
  expect(screen.queryByTestId('diary.copy.breakfast')).toBeNull();
  expect(screen.getByTestId('diary.item.b1').props.accessibilityActions).toHaveLength(1);
});

it('speaks Icelandic', async () => {
  signIn();
  setCurrentLanguage('is');
  serveDays({ [TODAY]: fullDay(TODAY) });
  await renderDiary();
  const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);
  expect(screen.getByText(is('diary.title').toLocaleUpperCase('is'))).toBeOnTheScreen();
  expect(screen.getByText(is('diary.draft_row_text', { time: '12:40' }))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.summary.status')).toHaveTextContent(is('diary.left', { kcal: '1.390' }));
});

it('offline today with nothing cached says it needs a connection', async () => {
  signIn();
  serveDays({ [TODAY]: new TransportError('offline') });
  await renderDiary();
  expect(within(screen.getByTestId('diary.failed')).getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
});

it('a new date from the route shows that day and reads it again (navigate onto a Diary already on top)', async () => {
  signIn();
  const reads = serveDays({ [TODAY]: fullDay(TODAY), [YESTERDAY]: fullDay(YESTERDAY) });
  await renderDiary(YESTERDAY);
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.yesterday'))).toBeOnTheScreen();

  // Plan's openDiary navigates; React Navigation gives the Diary on top new params.
  await act(async () => {
    navigationRef.navigate('Diary', { date: TODAY });
  });
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
  expect(reads.filter((date) => date === TODAY).length).toBeGreaterThan(0);

  // The member steps back a day; a link to today brings today back, read afresh.
  await fireEvent.press(screen.getByTestId('diary.prev'));
  await settle();
  const before = reads.filter((date) => date === TODAY).length;
  await act(async () => {
    navigationRef.navigate('Diary', { date: TODAY });
  });
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
  expect(reads.filter((date) => date === TODAY).length).toBeGreaterThan(before);
});

it('a read for a day the member has left never takes the offline banner off the day on screen', async () => {
  signIn();
  useHealthStore.setState({ cachedAt: new Date(`${TODAY}T07:30:00.000Z`), today: cachedTodayRead(TODAY) });
  let releaseYesterday: (value: MealDayRecord) => void = () => undefined;
  setMealApi(
    fakeMealApi({
      mealDay: (date) => {
        if (date === TODAY) return Promise.reject(new TransportError('offline'));
        return new Promise<MealDayRecord>((resolve) => {
          releaseYesterday = resolve;
        });
      },
    }),
  );
  await renderDiary();
  expect(screen.getByTestId('diary.offline')).toBeOnTheScreen();

  // To yesterday (its read hangs), and back to today's offline copy.
  await fireEvent.press(screen.getByTestId('diary.prev'));
  await settle();
  expect(screen.getByTestId('diary.loading')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('diary.next'));
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.offline')).toBeOnTheScreen();

  await act(async () => releaseYesterday(fullDay(YESTERDAY)));
  await settle();
  expect(within(screen.getByTestId('diary.date')).getByText(en('diary.today'))).toBeOnTheScreen();
  expect(screen.getByTestId('diary.offline')).toBeOnTheScreen();
  expect(screen.getByText('Oats')).toBeOnTheScreen();
});

it('a Today read of another day is never shown as today offline', async () => {
  signIn();
  useHealthStore.setState({ cachedAt: new Date(`${YESTERDAY}T07:30:00.000Z`), today: cachedTodayRead(YESTERDAY) });
  serveDays({ [TODAY]: new TransportError('offline') });
  await renderDiary();
  expect(within(screen.getByTestId('diary.failed')).getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  expect(screen.queryByText('Oats')).toBeNull();
});

it('removing an item from the offline copy reads the day first and patches the meal as the server has it', async () => {
  signIn();
  useHealthStore.setState({ cachedAt: new Date(`${TODAY}T07:30:00.000Z`), today: cachedTodayRead(TODAY, true) });
  let online = false;
  const patches: { id: string; body: MealPatchBody }[] = [];
  setMealApi(
    fakeMealApi({
      mealDay: async (date) => {
        if (!online) throw new TransportError('offline');
        return date === TODAY ? fullDay(TODAY) : day(dayJSON(date));
      },
      patchMeal: async (id, body) => {
        patches.push({ id, body });
        return { meal: decodeMealRecord(mealJSON(id, TODAY), 'meal'), replayed: false };
      },
    }),
  );
  await renderDiary();
  expect(screen.getByTestId('diary.offline')).toBeOnTheScreen();

  // Still offline: nothing is sent, and the member is told.
  await act(async () => {
    screen.getByTestId('diary.item.b2').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
  await settle();
  expect(patches).toHaveLength(0);
  expect(await screen.findByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  await act(async () => dismissToast());

  // Back online: the real day replaces the copy and the removal keeps the other item's numbers.
  online = true;
  await act(async () => {
    screen.getByTestId('diary.item.b2').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
  await settle();
  expect(patches).toHaveLength(1);
  expect(patches[0]!.id).toBe('breakfast-1');
  expect(patches[0]!.body.items?.map((input) => input.id)).toEqual(['b1']);
  // The server's item (its source and food), and its updatedAt for the conflict guard: never the copy's.
  expect(patches[0]!.body.items?.[0]).toMatchObject({ source: 'usda', foodId: 'food-b1' });
  expect(patches[0]!.body.expectedUpdatedAt).toBe(`${TODAY}T08:05:00.123Z`);
  expect(screen.queryByTestId('diary.offline')).toBeNull();
});

/** A Today read of `date` with one breakfast (or the full day's two-item breakfast), as the phone caches it. */
function cachedTodayRead(date: string, twoItems = false) {
  const items = twoItems
    ? [
        { id: 'b1', label: 'Skyr', serving: { unit: 'g' }, amount: 100, nutrients: { kcalLow: 120, kcalHigh: 120 } },
        { id: 'b2', label: 'Banana', serving: { unit: 'g' }, amount: 120, nutrients: { kcalLow: 90, kcalHigh: 90 } },
      ]
    : [{ id: 'ci', label: 'Oats', serving: { unit: 'g' }, amount: 60, nutrients: { kcalLow: 220, kcalHigh: 220 } }];
  return decodeHealthDay({
    contractVersion: '2026-09-v1',
    date,
    today: date,
    locale: 'en',
    access: 'entitled',
    upcoming: [],
    meals: {
      date,
      meals: [
        {
          id: twoItems ? 'breakfast-1' : 'cached-1',
          logDate: date,
          loggedAt: `${date}T07:00:00Z`,
          slot: 'breakfast',
          confirmed: true,
          items,
          totals: { kcalLow: 220, kcalHigh: 220, proteinG: 8, carbsG: 36, fatG: 4 },
        },
      ],
      totals: { kcalLow: 220, kcalHigh: 220, proteinG: 8, carbsG: 36, fatG: 4 },
    },
  });
}
