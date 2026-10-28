/**
 * MERGE GATE: a meal saved offline shows on Plan's food card with "Waiting
 * to sync" (iOS PlanNutritionCard `MealOutbox.shared.pending(on:)`), through
 * the REAL meal outbox and the install in src/features/meals/register.ts.
 *
 * The outbox is MEAL-1's (src/features/meals/outbox). PLAN-5 was cut before
 * MEAL-1 merged, so on PLAN-5's own branch this is skipped. Once both are on
 * one branch it runs, and it FAILS until meals/register.ts installs the queue
 * into the card, beside its `installPlanOutbox('meal', mealOutboxPlanSource)`
 * (the card's own rows are proven in ./NutritionSection.test.tsx):
 *
 *   import { installPlanQueuedMeals } from '../plan/nutrition';
 *   import { pendingMealsOn, useMealOutbox } from './outbox/mealOutbox';
 *
 *   installPlanQueuedMeals({
 *     pendingOn: (date) =>
 *       pendingMealsOn(date).map((item) => ({
 *         id: item.id,
 *         slot: item.body.slot,
 *         labels: item.body.items.map((i) => i.label),
 *       })),
 *     subscribe: (listener) => useMealOutbox.subscribe(() => listener()),
 *   });
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen, within } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import * as healthLocalStore from '../../../../health/localStore';
import { translate } from '../../../../i18n';
import { addServerDays } from '../../../../i18n/format';
import { dayJSON, freshPlan, MEMBER, settle, signIn, TODAY } from '../../__tests__/planFixtures';
import PlanScreen from '../../PlanScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

/** The part of MEAL-1's outbox this uses (typed here: the module is not on PLAN-5's branch). */
interface MealOutboxModule {
  enqueueMeal(body: unknown, key: string, memberId: string): Promise<boolean>;
  discardMealOutboxItem(itemId: string): void;
  resetMealOutboxForTests(): void;
  useMealOutbox: { getState(): { readonly items: readonly { readonly id: string; readonly body: { readonly logDate: string } }[] } };
}

const mealOutboxOnThisBranch = existsSync(join(__dirname, '../../../meals/outbox/mealOutbox.ts'));

let outbox: MealOutboxModule;
beforeAll(() => {
  if (!mealOutboxOnThisBranch) return;
  /* eslint-disable @typescript-eslint/no-require-imports -- the outbox exists only once MEAL-1 is merged */
  // The install under test is meals/register.ts itself, which only the app's
  // registrations import; this loads it the same way, at module load.
  // eslint-disable-next-line lifepass/feature-boundaries -- the merge gate checks MEAL-1's install site
  require('../../../meals/register');
  outbox = require('../../../meals/outbox/index') as MealOutboxModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
});

const Stack = createNativeStackNavigator();

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

/** A meal as the capture page queues it with no connection (OP-34's body). */
function offlineMeal(logDate: string, slot: string, labels: string[]) {
  return {
    slot,
    loggedAt: new Date(),
    logDate,
    source: 'quick_add',
    items: labels.map((label) => ({
      id: null,
      source: 'quick_add',
      label,
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
    })),
  };
}

const EMPTY_DAY = { date: TODAY, meals: [], totals: { kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 }, target: null };

beforeEach(() => {
  freshPlan();
  if (mealOutboxOnThisBranch) outbox.resetMealOutboxForTests();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

(mealOutboxOnThisBranch ? it : it.skip)(
  'a meal queued offline shows on its day with "Waiting to sync", and goes when the queue lets it go',
  async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { meals: EMPTY_DAY })));
    await renderPlan();
    expect(within(screen.getByTestId('plan.nutrition')).getByText(en('plan.nutrition.none_yet'))).toBeOnTheScreen();

    await act(async () => {
      await outbox.enqueueMeal(offlineMeal(TODAY, 'dinner', ['Pasta', 'salad']), 'key-today', MEMBER);
      // Another day's meal is that day's, never today's.
      await outbox.enqueueMeal(offlineMeal(addServerDays(TODAY, -1)!, 'lunch', ['Soup']), 'key-yesterday', MEMBER);
      await settle();
    });
    const queued = outbox.useMealOutbox.getState().items.find((item) => item.body.logDate === TODAY);
    expect(queued).toBeDefined();
    // Fails here until meals/register.ts calls installPlanQueuedMeals (see the header).
    const row = screen.getByTestId(`plan.nutrition.queued.${queued!.id}`);
    expect(within(row).getByText('Pasta, salad')).toBeOnTheScreen();
    expect(within(row).getByText(en('plan.waiting_sync'))).toBeOnTheScreen();
    expect(screen.queryByText('Soup')).toBeNull();
    expect(screen.queryByText(en('plan.nutrition.none_yet'))).toBeNull();

    await act(async () => {
      outbox.discardMealOutboxItem(queued!.id);
      await settle();
    });
    expect(screen.queryByTestId(`plan.nutrition.queued.${queued!.id}`)).toBeNull();
  },
);
