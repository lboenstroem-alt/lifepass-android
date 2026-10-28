/**
 * MEAL-4's editors with MEAL-2's real meal page: "Add food" on a draft or a
 * saved meal opens a second page whose "Add to meal" hands the items back to
 * that meal (iOS `MealCaptureView(origin: .editor, onAddToMeal: {
 * addItems($0) })`), and Review, pushed inside a page, edits and saves that
 * page's own tray.
 *
 * MERGE STEP, MEAL-2 + MEAL-4. The two packages were built side by side, so
 * neither could import the other. Until MEAL-2 is merged the meal page is
 * F4's stub and this suite is skipped. Once MEAL-2's page is in the tree
 * (src/features/meals/capture/capturePages.ts) the suite runs, and it FAILS
 * until the two seams in this folder use that page instead of MEAL-4's
 * stand-ins (all three from '../capture/capturePages'):
 *
 *   captureLink.ts  useMealCaptureLink()       return useCaptureModel();
 *   addFood.ts      openAddFoodPage(request)   return openMealCaptureForEditor(request);
 *                   dropAddFoodHandoff(f)      if (peekEditorHandoff() === f) setEditorHandoff(null);
 *
 * Then drop the stand-ins (`attachMealCaptureLink`, `pageKeyOf`,
 * `resetMealCaptureLinksForTests` in captureLink.ts; the `parked` slot and
 * `takeAddFoodHandoff` in addFood.ts; both from index.ts) and switch their
 * uses in routes.test.tsx to MEAL-2's `registerCapturePage`, `pageKeyOf`,
 * `resetCapturePagesForTests` and `takeEditorHandoff`. Without this step the
 * foods picked for a draft or a saved meal are thrown away, and Review and
 * Draft never find their page.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { existsSync } from 'fs';
import { join } from 'path';
import { useEffect, type ComponentType } from 'react';
import { Text } from 'react-native';
import { createStore } from 'zustand/vanilla';

import { decodeProfile } from '../../../../api/profile';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { dismissToast } from '../../../../components/ui/Toast';
import * as localStore from '../../../../health/localStore';
import { resetMealGatePresenter } from '../../../../health/gate/mealGate';
import { resetHealthStoreForTests } from '../../../../health/store';
import { translate } from '../../../../i18n';
import { todayServerDay } from '../../../../i18n/format';
import MealCaptureNavigator from '../../../../navigation/MealCaptureNavigator';
import { navigationRef } from '../../../../navigation/navigationRef';
import type { RootStackParamList } from '../../../../navigation/types';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { setMealApi, type MealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { resetFoodsCacheMemory } from '../../foodsCache';
import { mealRecord, photoItemJson, skyrChoice, skyrItemJson } from '../../itemEditor/__tests__/fixtures';
import MealGlobalChromeHost from '../../MealGlobalChromeHost';
import { resetMealOutboxForTests } from '../../outbox';
import type { FoodPresets, FoodSearchResult, MealCreateBody, MealPatchBody, MealRecord, MyFoods } from '../../types/models';
import { openAddFoodPage } from '../addFood';
import { useMealCaptureLink, type MealCaptureLink, type MealCaptureLinkState } from '../captureLink';
import MealEditorView from '../MealEditorView';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('../../describe', () => ({ openDescribe: jest.fn(), DescribeHost: () => null }));
// The rows' swipe is not under test (and its gesture warns under Reanimated's mock).
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30_000);

/** MEAL-2's meal page, once it is in the tree. */
const withMealPage = existsSync(join(__dirname, '..', '..', 'capture', 'capturePages.ts'));
const describeWithMealPage = withMealPage ? describe : describe.skip;

/** What these tests use of MEAL-2's capture/capturePages.ts. */
interface CapturePages {
  registerCapturePage(pageKey: string, model: unknown): () => void;
  pageKeyOf(navigation: unknown): string | null;
  peekEditorHandoff(): unknown;
  resetCapturePagesForTests(): void;
}

/** Required lazily, so this file compiles and the suite skips before MEAL-2 is merged. */
function capturePages(): CapturePages {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../capture/capturePages') as CapturePages;
}

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = todayServerDay();
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const Root = createNativeStackNavigator<RootStackParamList>();
const Page = createNativeStackNavigator();

function signIn() {
  const profile = decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access: 'entitled', consent: { version: '2026-09-v1' } },
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile, language: 'en' });
}

const presets = (): FoodPresets => ({ libraryVersion: '1', foods: [skyrChoice()], meals: [], categories: [] });
const myFoods = (): MyFoods => ({ recents: [skyrChoice()], frequent: [], mine: [], recentMeals: [] });
const skyrResult = (): FoodSearchResult => ({ query: 'skyr', mine: [skyrChoice()], foods: [], meals: [], closest: false });

function useApi(overrides: Partial<MealApi> = {}): void {
  setMealApi(
    fakeMealApi({
      presets: jest.fn(async () => presets()),
      myFoods: jest.fn(async () => myFoods()),
      search: jest.fn(async () => skyrResult()),
      ...overrides,
    }),
  );
}

function Home() {
  return <Text>Home screen</Text>;
}

/** The app's root stack: `main` under, the meal page as the root modal. */
async function renderApp(main: ComponentType) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Main" component={main} />
          <Root.Screen name="MealCapture" component={MealCaptureNavigator} options={{ presentation: 'fullScreenModal' }} />
        </Root.Navigator>
        <MealGlobalChromeHost />
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

/** On the page: one tap adds skyr's usual portion. */
async function addSkyrOnThePage() {
  await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
  await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
}

/** A page model stand-in, as far as the editors read it. */
function standIn(): MealCaptureLink {
  const store = createStore<MealCaptureLinkState>()(() => ({
    mode: 'search',
    slot: 'lunch',
    date: TODAY,
    tray: [],
    chosenLoggedAt: null,
    saveErrorKey: null,
    drafts: {},
  }));
  const noop = () => undefined;
  return {
    origin: 'plan',
    store,
    replace: noop,
    add: noop,
    remove: noop,
    setSlot: noop,
    setDate: noop,
    setChosenLoggedAt: noop,
    setMode: noop,
    save: async () => ({ kind: 'failed' }),
    close: noop,
    discardTray: noop,
  };
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  resetMealGatePresenter();
  dismissToast();
  if (withMealPage) capturePages().resetCapturePagesForTests();
  signIn();
});

afterEach(async () => {
  setMealApi(null);
  jest.restoreAllMocks();
  await localStore.settled();
});

describeWithMealPage('MERGE STEP: the editors use MEAL-2’s meal page (see this file’s header)', () => {
  it('captureLink.ts: a screen pushed inside a page finds the model MEAL-2’s page registered', async () => {
    const model = standIn();
    const found: (MealCaptureLink | null)[] = [];
    function Capture({ navigation }: { navigation: unknown }) {
      useEffect(() => {
        const key = capturePages().pageKeyOf(navigation);
        return key ? capturePages().registerCapturePage(key, model) : undefined;
      }, [navigation]);
      return null;
    }
    function Probe() {
      found.push(useMealCaptureLink());
      return null;
    }
    const pageRef = createNavigationContainerRef<Record<string, object | undefined>>();
    await render(
      <NavigationContainer ref={pageRef}>
        <Page.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Page.Screen name="Capture" component={Capture as ComponentType} />
          <Page.Screen name="Probe" component={Probe} />
        </Page.Navigator>
      </NavigationContainer>,
    );
    await act(async () => undefined);
    // Pushed after the page registered its model, as Review and Draft are.
    await act(async () => pageRef.navigate('Probe'));
    expect(found.length).toBeGreaterThan(0);
    if (found[found.length - 1] !== model) {
      throw new Error(
        'MERGE STEP (MEAL-2 + MEAL-4): captureLink.ts useMealCaptureLink must return MEAL-2’s useCaptureModel(); see the header of captureIntegration.test.tsx',
      );
    }
  });
});

describeWithMealPage('MERGE STEP: Add food goes through MEAL-2’s handoff (see this file’s header)', () => {
  it('addFood.ts: openAddFoodPage parks the receiver where MEAL-2’s editor page takes it', () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
    jest.spyOn(navigationRef, 'getRootState').mockReturnValue({ key: 'root' } as never);
    jest.spyOn(navigationRef, 'dispatch').mockImplementation(() => undefined);
    const receiver = jest.fn();
    expect(openAddFoodPage({ slot: 'dinner', date: TODAY, onAddToMeal: receiver })).toBe(true);
    if (capturePages().peekEditorHandoff() !== receiver) {
      throw new Error(
        'MERGE STEP (MEAL-2 + MEAL-4): addFood.ts openAddFoodPage must call MEAL-2’s openMealCaptureForEditor; see the header of captureIntegration.test.tsx',
      );
    }
  });
});

describeWithMealPage('Add food on a meal that exists, with MEAL-2’s page', () => {
  it('a draft: the page’s Add to meal puts the item in the draft, and Save confirms it with the rest', async () => {
    const draft = mealRecord({ items: [photoItemJson()], confirmed: false, source: 'photo' });
    const confirmed = mealRecord({ items: [photoItemJson('item-photo', { confirmed: true })], updatedAt: '2026-10-21T08:20:00Z' });
    const patchMeal = jest.fn(async (_id: string, _body: MealPatchBody) => ({ meal: confirmed, replayed: false }));
    const createMeal = jest.fn();
    useApi({ meal: jest.fn(async () => draft), patchMeal, createMeal });
    await renderApp(() => <MealEditorView mode={{ kind: 'stored', mealId: 'meal-1', capture: null }} />);
    await waitFor(() => expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen());

    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('meal.editor.add_food') })));
    await addSkyrOnThePage();
    await act(async () => fireEvent.press(screen.getByText(en('meal.tray.add_to_meal'))));

    // Back on the draft, the page gone, with the item joined to it.
    await waitFor(() => expect(screen.queryByTestId('meal.trayBar')).toBeNull());
    expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen();
    expect(screen.getByText('Skyr, plain')).toBeOnTheScreen();
    expect(screen.getByText('Fish stew')).toBeOnTheScreen();
    expect(createMeal).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('meal.estimate.confirm_all') })));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('meal.editor.save') })));
    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(1));
    const body = patchMeal.mock.calls[0]![1];
    expect(body.confirmed).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items?.[1]).toEqual(expect.objectContaining({ label: 'Skyr, plain' }));
  });

  it('a saved meal: the item is committed at once with the others', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    const after: MealRecord = { ...meal, items: [...meal.items, ...meal.items.map((item) => ({ ...item, id: 'item-new' }))] };
    const patchMeal = jest.fn(async (_id: string, _body: MealPatchBody) => ({ meal: after, replayed: false }));
    useApi({ meal: jest.fn(async () => meal), patchMeal });
    await renderApp(() => <MealEditorView mode={{ kind: 'stored', mealId: 'meal-1', capture: null }} />);
    await waitFor(() => expect(screen.getByText(en('meal.editor.title_edit').toUpperCase())).toBeOnTheScreen());

    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('meal.editor.add_food') })));
    await addSkyrOnThePage();
    await act(async () => fireEvent.press(screen.getByText(en('meal.tray.add_to_meal'))));

    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(1));
    const [id, body] = patchMeal.mock.calls[0]!;
    expect(id).toBe('meal-1');
    expect(body.items?.map((item) => item.id ?? null)).toEqual(['item-skyr', null]);
    await waitFor(() => expect(screen.getAllByText('Skyr, plain')).toHaveLength(2));
  });
});

describeWithMealPage('Review inside MEAL-2’s page', () => {
  it('edits the page’s own tray and saves it through the page, which closes', async () => {
    const createMeal = jest.fn(async (body: MealCreateBody) => ({
      meal: mealRecord({ items: [skyrItemJson()], logDate: body.logDate, slot: body.slot }),
      replayed: false,
    }));
    useApi({ createMeal });
    await renderApp(Home);
    await act(async () => {
      (navigationRef.navigate as unknown as (name: string, params: object) => void)('MealCapture', {
        origin: 'scanTab',
        mode: 'search',
        date: TODAY,
      });
    });
    await addSkyrOnThePage();
    await act(async () => fireEvent.press(screen.getByTestId('meal.tray.review')));

    // MEAL-4's Review found the page's model: its tray, and its save.
    await waitFor(() => expect(screen.getByText(en('meal.editor.title_new').toUpperCase())).toBeOnTheScreen());
    expect(screen.getByTestId('mealReview.item.0')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('meal.editor.save') })));
    await waitFor(() => expect(createMeal).toHaveBeenCalledTimes(1));
    expect(createMeal.mock.calls[0]![0].items).toEqual([expect.objectContaining({ label: 'Skyr, plain' })]);
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
  });
});
