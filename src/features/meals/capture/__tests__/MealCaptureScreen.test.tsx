/**
 * The meal page on screen, through the real navigator and the UI kit: the
 * port of MealFlowsUITests' search half (testALunchBySearchIsFourTapsFromTheScanTab,
 * testWithoutTheFeatureThereIsNoDescribe, testTheAllListOffersDescribeAMeal),
 * the tray restore, the leave dialog, the editor's Add food page, the gate
 * after a 403, and a check-in link closing the page over the Scan tab.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { DeviceEventEmitter, Text } from 'react-native';

import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { dismissToast } from '../../../../components/ui/Toast';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import type { HealthAccess, HealthDay } from '../../../../health/models';
import { resetMealGatePresenter } from '../../../../health/gate/mealGate';
import { todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import MealCaptureNavigator from '../../../../navigation/MealCaptureNavigator';
import * as navigationRefModule from '../../../../navigation/navigationRef';
import { navigationRef } from '../../../../navigation/navigationRef';
import type { MealCaptureParams, RootStackParamList } from '../../../../navigation/types';
import { resetAppStoreForTests, ServerFeature, useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { setMealApi, type MealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { resetFoodsCacheMemory } from '../../foodsCache';
import MealGlobalChromeHost from '../../MealGlobalChromeHost';
import { resetMealOutboxForTests } from '../../outbox';
import { restoreTray, saveTray } from '../../tray';
import { draftFromChoice } from '../../types/draftFactory';
import type { FoodSearchResult, MealCreateBody, MealRecord, MealWriteResult } from '../../types/models';
import { openHealthConsent, useHealthConsentPresenter } from '../../../../health/consent/presenter';
import { capturePageFor, openMealCaptureForEditor, resetCapturePagesForTests } from '../capturePages';
import { choice, MEMBER, myFoods, myOats, offline, presets, problem, signIn, storedMeal } from './mealFixtures';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('../../describe', () => ({ openDescribe: jest.fn(), DescribeHost: () => null }));
// Under Reanimated's Jest mock the swipe's callbacks are not worklets and the
// gesture library says so on every My foods row; the swipe itself is not
// under test here (TalkBack's action is).
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../../../health/consent/presenter', () => ({
  ...jest.requireActual('../../../../health/consent/presenter'),
  openHealthConsent: jest.fn(() => true),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const describeModule = require('../../describe') as { openDescribe: jest.Mock };

jest.setTimeout(30_000);

const TODAY = todayServerDay();
const Root = createNativeStackNavigator<RootStackParamList>();

function Home() {
  return <Text>Home screen</Text>;
}

interface AppOptions {
  /** The app shell's health host (the consent sheet, the gate); false: none mounted. */
  readonly chrome?: boolean;
  /** Something in the page holds its removal (MEAL-4's "keep for later"), while this says so. */
  readonly holdsRemoval?: () => boolean;
}

async function renderApp({ chrome = true, holdsRemoval }: AppOptions = {}) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Main" component={Home} />
          <Root.Screen
            name="MealCapture"
            component={MealCaptureNavigator}
            options={{ presentation: 'fullScreenModal' }}
            listeners={{
              beforeRemove: (event) => {
                if (holdsRemoval?.()) event.preventDefault();
              },
            }}
          />
        </Root.Navigator>
        {chrome ? <MealGlobalChromeHost /> : null}
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

/** The model of the meal page on top. */
function openPageModel() {
  const route = navigationRef.getRootState().routes.find((entry) => entry.name === 'MealCapture');
  const key = route?.state?.key;
  return key ? capturePageFor(key) : null;
}

async function openPage(params: Partial<MealCaptureParams> = {}) {
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params: object) => void)('MealCapture', {
      origin: 'scanTab',
      mode: 'search',
      date: TODAY,
      ...params,
    });
  });
  await act(async () => undefined);
}

function written(body: MealCreateBody): MealWriteResult {
  return { meal: storedMeal(body.logDate, { slot: body.slot }), replayed: false };
}

const skyrResult: FoodSearchResult = { query: 'skyr', mine: [choice()], foods: [], meals: [], closest: false };

function useApi(overrides: Partial<MealApi> = {}): MealApi {
  const api = fakeMealApi({
    presets: jest.fn(async () => presets()),
    myFoods: jest.fn(async () => myFoods()),
    search: jest.fn(async () => skyrResult),
    createMeal: jest.fn(async (body: MealCreateBody) => written(body)),
    ...overrides,
  });
  setMealApi(api);
  return api;
}

/** The Today read after a save, answered with the day's totals. */
function todayAnswers(kcal: number) {
  const load = jest.fn(async () => {
    useHealthStore.setState({ today: { meals: { totals: { kcalLow: kcal, kcalHigh: kcal, proteinG: 80 } } } as unknown as HealthDay });
  });
  useHealthStore.setState({ load });
  return load;
}

async function typeSearch(words: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('food.search.field'), words);
  });
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  resetCapturePagesForTests();
  resetMealGatePresenter();
  dismissToast();
  signIn();
});

afterEach(async () => {
  setMealApi(null);
  setAnalyticsObserver(null);
  jest.restoreAllMocks();
  await localStore.settled();
});

describe('a lunch by search', () => {
  it('Search shows the recents before anything is typed, then four taps log the lunch and the toast leads to the diary', async () => {
    const api = useApi();
    todayAnswers(1460);
    await renderApp();
    await openPage();

    expect(screen.getByPlaceholderText('Search foods and meals')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText('RECENT MEALS')).toBeOnTheScreen());

    await typeSearch('skyr');
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('skyr', 'en', expect.anything()));
    await waitFor(() => expect(screen.getByText('YOUR FOODS')).toBeOnTheScreen());

    await act(async () => fireEvent.press(screen.getByLabelText('Add Skyr, plain')));
    expect(screen.getByText('Added')).toBeOnTheScreen();
    expect(screen.getByText('1 item · 107 kcal')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Saved. About 1,460 kcal today.')).toBeOnTheScreen());
    const [body] = (api.createMeal as jest.Mock).mock.calls[0] as [MealCreateBody, string];
    expect(body).toMatchObject({ logDate: TODAY, source: 'search' });
    expect(body.items).toHaveLength(1);
    expect(screen.queryByTestId('food.search.field')).toBeNull();
    expect(screen.getByText('Home screen')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByText('Food diary')));
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openDiary', date: TODAY });
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
  });

  // MERGE GATE with MEAL-4: once ../slots.ts exports MEAL-4's
  // NewItemEditorSheet, a row's tap opens the editor (iOS
  // testTheItemEditorChangesTheAmountInOneTap) and this case must assert
  // that instead; ../../search/__tests__/itemEditorSlot.test.tsx covers the
  // wired slot.
  it('without the item editor wired in, a row’s tap adds its usual portion', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByTestId(`food.open.${choice().key}`).length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByTestId(`food.open.${choice().key}`)[0]!));
    expect(within(screen.getByTestId('meal.trayBar')).getByText('1 item · 107 kcal')).toBeOnTheScreen();
  });

  it('Undo takes the last add back out of the tray', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    expect(screen.getByTestId('meal.trayBar')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Undo')));
    expect(screen.queryByTestId('meal.trayBar')).toBeNull();
  });

  it('a meal for another day says which day, offline says it is kept', async () => {
    const yesterdayApi = useApi();
    await renderApp();
    await openPage({ date: '2026-09-17' });
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText(/^Meal saved to .*17 Sep/)).toBeOnTheScreen());
    expect(yesterdayApi.createMeal).toHaveBeenCalledTimes(1);

    useApi({ createMeal: jest.fn(async () => Promise.reject(offline())) });
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText("Saved on this phone. It will sync when you're back online.")).toBeOnTheScreen());
    expect(screen.getByText('Home screen')).toBeOnTheScreen();
  });
});

describe('Describe', () => {
  it('without the feature there is no Describe, and an empty search still offers Quick add', async () => {
    useApi({ search: jest.fn(async () => ({ query: 'focaccia sandwich', mine: [], foods: [], meals: [], closest: false })) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Quick add calories')).toBeOnTheScreen());
    expect(screen.queryByTestId('food.describe')).toBeNull();
    await typeSearch('focaccia sandwich');
    await waitFor(() => expect(screen.getByText('No matches for “focaccia sandwich”')).toBeOnTheScreen());
    expect(screen.getByText('Quick add calories')).toBeOnTheScreen();
    expect(screen.queryByTestId('food.describe_instead')).toBeNull();
  });

  it('with the feature, Describe a meal sits above Quick add and an empty search describes the typed words', async () => {
    useAppStore.setState({ serverFeatures: [ServerFeature.mealDescribe] });
    useApi({ search: jest.fn(async () => ({ query: 'focaccia sandwich', mine: [], foods: [], meals: [], closest: false })) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.describe')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.describe')));
    expect(describeModule.openDescribe).toHaveBeenLastCalledWith(expect.objectContaining({ text: '', date: TODAY }));

    await typeSearch('focaccia sandwich');
    await waitFor(() => expect(screen.getByTestId('food.describe_instead')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.describe_instead')));
    expect(describeModule.openDescribe).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'focaccia sandwich' }));
  });

  it('a membership wall in the describe sheet closes the page, then the gate shows over what was underneath', async () => {
    useAppStore.setState({ serverFeatures: [ServerFeature.mealDescribe] });
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.describe')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.describe')));
    const prefill = describeModule.openDescribe.mock.calls.at(-1)![0] as { onGate: (access: HealthAccess) => void };
    await act(async () => prefill.onGate('pass_only'));
    await waitFor(() => expect(screen.getByText('Included with a LifePass membership')).toBeOnTheScreen());
    expect(screen.getByText('Your visitor pass covers venues and day plans. The food log is included with a membership.')).toBeOnTheScreen();
    expect(screen.getByText('Home screen', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('food.search.field', { includeHiddenElements: true })).toBeNull();
  });

  it('a refusal in the describe sheet that ends the page (a minor, a wipe) closes it', async () => {
    useAppStore.setState({ serverFeatures: [ServerFeature.mealDescribe] });
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.describe')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.describe')));
    const prefill = describeModule.openDescribe.mock.calls.at(-1)![0] as { onClosePage: () => void };
    await act(async () => prefill.onClosePage());
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('food.search.field')).toBeNull();
  });

  it('the description’s draft opens in the page with the record the server saved, once the sheet is down', async () => {
    useAppStore.setState({ serverFeatures: [ServerFeature.mealDescribe] });
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.describe')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.describe')));
    const prefill = describeModule.openDescribe.mock.calls.at(-1)![0] as { onDraft: (mealId: string, meal: MealRecord) => void };
    const draft = storedMeal(TODAY, { id: 'draft-1', confirmed: false, source: 'describe' });
    const model = openPageModel();
    expect(model).not.toBeNull();
    await act(async () => prefill.onDraft('draft-1', draft));
    expect(navigationRef.getCurrentRoute()?.name).toBe('Capture');
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Draft'));
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ mealId: 'draft-1' });
    // The editor opens it from the page's model, without reading it again (offline too).
    expect(model?.state.drafts['draft-1']).toBe(draft);
  });

  it('is not offered for a day older than 30 days', async () => {
    useAppStore.setState({ serverFeatures: [ServerFeature.mealDescribe] });
    useApi();
    await renderApp();
    await openPage({ date: '2025-01-01' });
    await waitFor(() => expect(screen.getByText('Quick add calories')).toBeOnTheScreen());
    expect(screen.queryByTestId('food.describe')).toBeNull();
  });
});

describe('the tray across visits', () => {
  it('comes back within a day, with its slot, and says so', async () => {
    useApi();
    await saveTray({ items: [draftFromChoice(choice())], slot: 'breakfast', date: TODAY, source: 'recent', savedAt: new Date() }, MEMBER);
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Your unsaved items are back.')).toBeOnTheScreen());
    expect(screen.getByText('1 item · 107 kcal')).toBeOnTheScreen();
    expect(within(screen.getByTestId('meal.header')).getByText('Breakfast · Today')).toBeOnTheScreen();
  });

  it('closing with items asks first: Keep for later keeps them, Discard removes them, Keep adding stays', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));

    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    expect(screen.getByText('Discard these items?')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Keep adding')));
    expect(screen.getByTestId('food.search.field')).toBeOnTheScreen();

    // Hardware back asks the same.
    await act(async () => DeviceEventEmitter.emit('hardwareBackPress'));
    expect(screen.getByText('Discard these items?')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Keep for later')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    await localStore.settled();
    expect((await restoreTray(MEMBER))?.items).toHaveLength(1);

    await openPage();
    await waitFor(() => expect(screen.getByText('Your unsaved items are back.')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    await act(async () => fireEvent.press(screen.getByText('Discard')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeFalsy();
  });

  it('an empty page closes without asking', async () => {
    useApi();
    await renderApp();
    await openPage();
    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    expect(screen.queryByText('Discard these items?')).toBeNull();
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
  });
});

describe('a meal editor’s Add food page', () => {
  it('reads Add to meal, hands the items back, never asks and never keeps a tray', async () => {
    const api = useApi();
    await renderApp();
    const onAddToMeal = jest.fn();
    await act(async () => {
      openMealCaptureForEditor({ slot: 'dinner', date: TODAY, onAddToMeal });
    });
    await act(async () => undefined);
    expect(within(screen.getByTestId('meal.header')).getByText('Dinner · Today')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Add to meal')));
    expect(onAddToMeal).toHaveBeenCalledWith([expect.objectContaining({ label: 'Skyr, plain' })]);
    expect(api.createMeal).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeFalsy();
  });
});

describe('refusals', () => {
  it('a membership wall closes the page and shows the gate over what was underneath', async () => {
    useApi({ createMeal: jest.fn(async () => Promise.reject(problem('no_active_plan_or_pass', 403, { memberPricing: 'pass_holder' }))) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Included with a LifePass membership')).toBeOnTheScreen());
    expect(screen.getByText('Your visitor pass covers venues and day plans. The food log is included with a membership.')).toBeOnTheScreen();
    // Under the gate (hidden from TalkBack while it is up): the page has gone.
    expect(screen.getByText('Home screen', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('food.search.field', { includeHiddenElements: true })).toBeNull();
  });

  it('a consent refusal opens the consent sheet with the retry', async () => {
    useApi({ createMeal: jest.fn(async () => Promise.reject(problem('health_consent_required', 409))) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(openHealthConsent).toHaveBeenCalledWith(expect.objectContaining({ entry: 'scan' })));
    expect(screen.getByTestId('food.search.field')).toBeOnTheScreen();
  });

  it('ten meals waiting offline keep the tray and say why', async () => {
    const full = Array.from({ length: 10 }, (_, index) => ({
      id: `queued-${index}`,
      body: { slot: 'lunch', loggedAt: TODAY + 'T12:00:00Z', logDate: TODAY, source: 'search', items: [] },
      key: `key-${index}`,
      createdAt: new Date().toISOString(),
      state: 'pending',
    }));
    fileSystemState.seed(`health/${MEMBER}/meal-outbox.json`, JSON.stringify(full));
    useApi({ createMeal: jest.fn(async () => Promise.reject(offline())) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Ten meals are waiting to sync. Connect to save more.')).toBeOnTheScreen());
    expect(screen.getByTestId('food.search.field')).toBeOnTheScreen();
  });
});

describe('search errors and My foods', () => {
  it('offline search says it needs a connection; a 403 shows the gate', async () => {
    useApi({ search: jest.fn(async () => Promise.reject(offline())) });
    await renderApp();
    await openPage();
    await typeSearch('skyr');
    await waitFor(() => expect(screen.getByText('Search needs a connection.')).toBeOnTheScreen());

    useApi({ search: jest.fn(async () => Promise.reject(problem('no_active_plan_or_pass', 403))) });
    await typeSearch('skyr bowl');
    await waitFor(() => expect(screen.getByText('Included with a LifePass membership')).toBeOnTheScreen());
  });

  it('removing one of My foods takes it off at once and tells the server', async () => {
    const hideFood = jest.fn(async () => undefined);
    let removed = false;
    hideFood.mockImplementation(async () => {
      removed = true;
    });
    useApi({ hideFood, myFoods: jest.fn(async () => (removed ? myFoods({ mine: [] }) : myFoods())) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.filter.mine')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.filter.mine')));
    await waitFor(() => expect(screen.getByText('Grandma oats')).toBeOnTheScreen());
    await act(async () => {
      fireEvent(screen.getByTestId(`food.open.${myOats().key}`), 'accessibilityAction', { nativeEvent: { actionName: 'remove' } });
    });
    expect(hideFood).toHaveBeenCalledWith(myOats().key, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.getByText('Foods you create show up here.')).toBeOnTheScreen();
  });

  it('a removal that cannot reach the server comes back, with the offline line', async () => {
    useApi({ hideFood: jest.fn(async () => Promise.reject(offline())) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('food.filter.mine')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.filter.mine')));
    await waitFor(() => expect(screen.getByText('Grandma oats')).toBeOnTheScreen());
    await act(async () => {
      fireEvent(screen.getByTestId(`food.open.${myOats().key}`), 'accessibilityAction', { nativeEvent: { actionName: 'remove' } });
    });
    await waitFor(() => expect(screen.getByText('This needs a connection.')).toBeOnTheScreen());
    expect(screen.getByText('Grandma oats')).toBeOnTheScreen();
  });
});

describe('the sheets from Search', () => {
  it('Quick add on an empty tray saves at once as its own meal', async () => {
    const api = useApi();
    todayAnswers(420);
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Quick add calories')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByText('Quick add calories')));
    expect(screen.getByText('Quick add')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('quickAdd.submit')));
    expect(screen.getByText('Enter calories between 0 and 5000.')).toBeOnTheScreen();
    await act(async () => fireEvent.changeText(screen.getByTestId('quickAdd.kcal'), '420'));
    expect(within(screen.getByTestId('quickAdd.submit')).getByText('Save to diary')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('quickAdd.submit')));
    await waitFor(() => expect(api.createMeal).toHaveBeenCalledTimes(1));
    const [body] = (api.createMeal as jest.Mock).mock.calls[0] as [MealCreateBody, string];
    expect(body.source).toBe('quick_add');
    expect(body.items[0]).toMatchObject({ source: 'quick_add', label: 'Quick add', perServing: { kcal: 420, proteinG: null, carbsG: null, fatG: null } });
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
  });

  it('Quick add with a tray joins it and does not save', async () => {
    const api = useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Quick add calories')));
    await act(async () => fireEvent.changeText(screen.getByTestId('quickAdd.kcal'), '200'));
    expect(within(screen.getByTestId('quickAdd.submit')).getByText('Add to meal')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('quickAdd.submit')));
    expect(api.createMeal).not.toHaveBeenCalled();
    expect(screen.getByText('2 items · 307 kcal')).toBeOnTheScreen();
  });

  it('Create my food adds to the tray once the name and calories are right', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Create my food')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.create')));
    await act(async () => fireEvent.press(screen.getByTestId('createFood.add')));
    expect(screen.getByText('Give it a name.')).toBeOnTheScreen();
    expect(screen.getByText('Enter calories between 0 and 900 per 100 g.')).toBeOnTheScreen();
    await act(async () => fireEvent.changeText(screen.getByTestId('createFood.name'), 'Rye bread'));
    await act(async () => fireEvent.changeText(screen.getByTestId('createFood.kcal'), '250'));
    await act(async () => fireEvent.press(screen.getByTestId('createFood.add')));
    expect(screen.getByText('1 item · 250 kcal')).toBeOnTheScreen();
  });

  it('a preset meal adds every ingredient at the servings chosen', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Skyr bowl')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.preset.meal-skyr-bowl')));
    await act(async () => fireEvent.press(screen.getByTestId('preset.servings.up')));
    expect(screen.getByTestId('preset.servings.value')).toHaveTextContent('1.5');
    await act(async () => fireEvent.press(screen.getByTestId('preset.add')));
    expect(within(screen.getByTestId('meal.trayBar')).getByText(/^2 items · /)).toBeOnTheScreen();
  });
});

describe('a preset meal’s sheet', () => {
  it('slides away with its meal still drawn, then goes; opened again it starts at one serving', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('Skyr bowl')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('food.preset.meal-skyr-bowl')));
    await act(async () => fireEvent.press(screen.getByTestId('preset.servings.up')));
    bottomSheetMock.settleDismiss = false;
    await act(async () => fireEvent.press(screen.getByText('Cancel')));
    // Mid-slide: the caller has let go of the meal, the sheet has not.
    expect(screen.getByTestId('preset.servings.value')).toHaveTextContent('1.5');
    await act(async () => bottomSheetMock.latest()?.onDismiss?.());
    expect(screen.queryByTestId('preset.servings.value')).toBeNull();

    bottomSheetMock.settleDismiss = true;
    await act(async () => fireEvent.press(screen.getByTestId('food.preset.meal-skyr-bowl')));
    expect(screen.getByTestId('preset.servings.value')).toHaveTextContent('1');
  });
});

describe('a check-in link', () => {
  it('closes the page over the Scan tab without asking, keeping the tray', async () => {
    useApi();
    jest.spyOn(navigationRefModule, 'currentTab').mockReturnValue('Scan');
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => {
      useIntentStore.getState().parkScanVenue('3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
    });
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    expect(screen.queryByText('Discard these items?')).toBeNull();
    await localStore.settled();
    expect((await restoreTray(MEMBER))?.items).toHaveLength(1);
  });
});

describe('the search timing', () => {
  it('asks once, 300 ms after the last keystroke', async () => {
    const api = useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('RECENT MEALS')).toBeOnTheScreen());
    jest.useFakeTimers();
    try {
      await typeSearch('sk');
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await typeSearch('skyr');
      await act(async () => {
        jest.advanceTimersByTime(299);
      });
      expect(api.search).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(api.search).toHaveBeenCalledTimes(1);
      expect(api.search).toHaveBeenCalledWith('skyr', 'en', expect.anything());
    } finally {
      jest.useRealTimers();
    }
  });

  it('an answer for words no longer in the field never replaces the list', async () => {
    const answers = new Map<string, (result: FoodSearchResult) => void>();
    const search = jest.fn(
      (text: string) =>
        new Promise<FoodSearchResult>((resolve) => {
          answers.set(text, resolve);
        }),
    );
    useApi({ search });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByText('RECENT MEALS')).toBeOnTheScreen());

    await typeSearch('sk');
    await waitFor(() => expect(search).toHaveBeenCalledWith('sk', 'en', expect.anything()));
    // Typed on while the first search was out; its answer comes after.
    await typeSearch('skyr');
    const skittles = choice({ key: 'food:skittles', label: 'Skittles' });
    await act(async () => answers.get('sk')?.({ query: 'sk', mine: [], foods: [skittles], meals: [], closest: false }));
    expect(screen.queryByText('Skittles')).toBeNull();

    await waitFor(() => expect(search).toHaveBeenCalledWith('skyr', 'en', expect.anything()));
    await act(async () => answers.get('skyr')?.(skyrResult));
    await waitFor(() => expect(screen.getByText('YOUR FOODS')).toBeOnTheScreen());
    expect(screen.queryByText('Skittles')).toBeNull();
  });
});

describe('See all', () => {
  it('switches the list to Recent without counting as a chip', async () => {
    const recents = Array.from({ length: 9 }, (_, index) => choice({ key: `food:recent-${index}`, label: `Recent food ${index}` }));
    useApi({ myFoods: jest.fn(async () => myFoods({ recents })) });
    const events: { event: string; params: AnalyticsParams }[] = [];
    setAnalyticsObserver((event, params) => events.push({ event, params }));
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getByTestId('h:recent')).toBeOnTheScreen());
    await act(async () => fireEvent.press(within(screen.getByTestId('h:recent')).getByRole('button')));
    expect(screen.getByTestId('food.filter.recent').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Recent food 8')).toBeOnTheScreen();
    expect(events.filter((entry) => entry.event === 'food_filter_selected')).toEqual([]);

    // A chip still counts.
    await act(async () => fireEvent.press(screen.getByTestId('food.filter.all')));
    expect(events).toContainEqual({ event: 'food_filter_selected', params: { filter: 'all' } });
  });
});

describe('the page’s own toasts', () => {
  it('leave with the page: an “Added” with Undo never stays over the tab once the page is closed', async () => {
    useApi();
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    expect(screen.getByText('Added')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    await act(async () => fireEvent.press(screen.getByText('Keep for later')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    await waitFor(() => expect(screen.queryByText('Added')).toBeNull());
    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('a save’s toast is not the page’s: it stays once the page has gone', async () => {
    useApi();
    await renderApp();
    await openPage({ date: '2026-09-17' });
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    expect(screen.getByText(/^Meal saved to .*17 Sep/)).toBeOnTheScreen();
    expect(screen.queryByText('Added')).toBeNull();
  });
});

describe('closing one page of two', () => {
  it('pops that page, not the editor’s Add food page over it', async () => {
    useApi();
    await renderApp();
    await openPage();
    const below = openPageModel();
    await act(async () => {
      openMealCaptureForEditor({ slot: 'dinner', date: TODAY, onAddToMeal: jest.fn() });
    });
    await act(async () => undefined);
    expect(within(screen.getByTestId('meal.header')).getByText('Dinner · Today')).toBeOnTheScreen();
    expect(navigationRef.getRootState().routes.filter((entry) => entry.name === 'MealCapture')).toHaveLength(2);

    await act(async () => below?.close('kept'));
    const pages = navigationRef.getRootState().routes.filter((entry) => entry.name === 'MealCapture');
    expect(pages).toHaveLength(1);
    expect((pages[0]?.params as MealCaptureParams | undefined)?.origin).toBe('editor');
  });
});

describe('closing when something in the page holds it', () => {
  it('X works again once the hold is gone', async () => {
    useApi();
    let holding = true;
    await renderApp({ holdsRemoval: () => holding });
    await openPage();
    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    expect(screen.getByTestId('food.search.field')).toBeOnTheScreen();
    holding = false;
    await act(async () => fireEvent.press(screen.getByLabelText('Close')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('food.search.field')).toBeNull();
  });
});

describe('the consent sheet for a save', () => {
  it('comes from the app shell’s health host after a 409', async () => {
    const actual = jest.requireActual('../../../../health/consent/presenter') as { openHealthConsent: typeof openHealthConsent };
    (openHealthConsent as jest.Mock).mockImplementationOnce(actual.openHealthConsent);
    useApi({ createMeal: jest.fn(async () => Promise.reject(problem('health_consent_required', 409))) });
    await renderApp();
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Health and fitness tracking')).toBeOnTheScreen());
    // Drawn once, by the host: the page's own sheet stays out of it.
    expect(useHealthConsentPresenter.getState().visible).toBe(true);
    expect(screen.getAllByText('Health and fitness tracking')).toHaveLength(1);
    expect(screen.getByTestId('food.search.field', { includeHiddenElements: true })).toBeTruthy();
  });

  it('with no host mounted, the page shows a sheet of its own', async () => {
    const actual = jest.requireActual('../../../../health/consent/presenter') as { openHealthConsent: typeof openHealthConsent };
    (openHealthConsent as jest.Mock).mockImplementationOnce(actual.openHealthConsent);
    useApi({ createMeal: jest.fn(async () => Promise.reject(problem('health_consent_required', 409))) });
    await renderApp({ chrome: false });
    await openPage();
    await waitFor(() => expect(screen.getAllByLabelText('Add Skyr, plain').length).toBeGreaterThan(0));
    await act(async () => fireEvent.press(screen.getAllByLabelText('Add Skyr, plain')[0]!));
    await act(async () => fireEvent.press(screen.getByText('Save to diary')));
    await waitFor(() => expect(screen.getByText('Health and fitness tracking')).toBeOnTheScreen());
    expect(useHealthConsentPresenter.getState().visible).toBe(false);
    expect(screen.getAllByText('Health and fitness tracking')).toHaveLength(1);
  });
});
