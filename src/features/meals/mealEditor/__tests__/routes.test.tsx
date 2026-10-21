/**
 * The three routes as the navigators mount them: `Review` and `Draft` inside
 * a meal page find the page's link by their stack's key; `MealEditor` reads
 * a meal by id and has the day read again. Plus what other meal packages
 * hand the editor: the Add food handoff, the draft's photo in memory, the
 * new-item slot and the stored-item presenter.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, type ComponentType } from 'react';
import { Text } from 'react-native';
import { createStore } from 'zustand/vanilla';

import { decodeProfile } from '../../../../api/profile';
import { runSignOutCleaners } from '../../../../app/signOut';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { runHealthWipeHooks } from '../../../../health/wipe';
import { translate } from '../../../../i18n';
import { todayServerDay } from '../../../../i18n/format';
import { navigationRef as appNavigationRef } from '../../../../navigation/navigationRef';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { setMealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { mealRecord, newSkyr, photoItemJson, skyrChoice, skyrItemJson } from '../../itemEditor/__tests__/fixtures';
import ItemEditorHost from '../../itemEditor/ItemEditorHost';
import { dismissItemEditor, presentStoredItemEditor } from '../../itemEditor/itemEditorPresenter';
import NewItemEditorSheet from '../../itemEditor/NewItemEditorSheet';
import { draftFromChoice, draftFromRecord } from '../../types/draftFactory';
import type { MealRecord } from '../../types/models';
import { openAddFoodPage, takeAddFoodHandoff, dropAddFoodHandoff } from '../addFood';
import { attachMealCaptureLink, pageKeyOf, resetMealCaptureLinksForTests, type MealCaptureLink, type MealCaptureLinkState } from '../captureLink';
import { draftThumbnail, forgetDraftThumbnail, rememberDraftThumbnail } from '../draftThumbnails';
import MealDraftScreen from '../MealDraftScreen';
import MealEditorScreen from '../MealEditorScreen';
import MealReviewScreen from '../MealReviewScreen';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

function signIn() {
  const profile = decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access: 'entitled', consent: null, features: [] },
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile });
}

function link(state: Partial<MealCaptureLinkState> = {}): MealCaptureLink {
  const store = createStore<MealCaptureLinkState>()(() => ({
    mode: 'search',
    slot: 'lunch',
    date: todayServerDay(),
    tray: [],
    chosenLoggedAt: null,
    saveErrorKey: null,
    drafts: {},
    ...state,
  }));
  return {
    origin: 'plan',
    store,
    replace: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    setSlot: jest.fn(),
    setDate: jest.fn(),
    setChosenLoggedAt: jest.fn(),
    setMode: jest.fn(),
    save: jest.fn(async () => ({ kind: 'failed' as const })),
    close: jest.fn(),
    discardTray: jest.fn(),
  };
}

const pageRef = createNavigationContainerRef<Record<string, object | undefined>>();
const Stack = createNativeStackNavigator();

/** The page's first screen: registers the link under its stack's key, as MEAL-2's Capture screen does. */
function capturePage(pageLink: MealCaptureLink | null): ComponentType<{ navigation: unknown }> {
  return function Capture({ navigation }: { navigation: unknown }) {
    useEffect(() => {
      const key = pageKeyOf(navigation);
      return pageLink && key ? attachMealCaptureLink(key, pageLink) : undefined;
    }, [navigation]);
    return <Text testID="route.Capture">Capture</Text>;
  };
}

async function renderPage(pageLink: MealCaptureLink | null, push: { name: 'Review' } | { name: 'Draft'; params: { mealId: string } }) {
  const Capture = capturePage(pageLink);
  await render(
    <NavigationContainer ref={pageRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Capture" component={Capture as ComponentType} />
        <Stack.Screen name="Review" component={MealReviewScreen as unknown as ComponentType} />
        <Stack.Screen name="Draft" component={MealDraftScreen as unknown as ComponentType} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(async () => {
    if (push.name === 'Review') pageRef.navigate('Review');
    else pageRef.navigate('Draft', push.params);
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetMealCaptureLinksForTests();
  setMealApi(null);
  signIn();
});

afterEach(() => setMealApi(null));

describe('Review, inside a meal page', () => {
  it('is the editor over the page’s tray', async () => {
    await renderPage(link({ tray: [newSkyr()] }), { name: 'Review' });
    expect(screen.getByText(en('meal.editor.title_new').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')).toBeOnTheScreen();
  });

  it('without a page there is nothing to review: back to it', async () => {
    await renderPage(null, { name: 'Review' });
    expect(pageRef.getCurrentRoute()?.name).toBe('Capture');
  });
});

describe('Draft, inside a meal page', () => {
  it('opens the draft the page was handed, without a read', async () => {
    const meal = mealRecord({ id: 'draft-1', items: [photoItemJson()], confirmed: false, source: 'photo' });
    const read = jest.fn();
    setMealApi(fakeMealApi({ meal: read }));
    await renderPage(link({ drafts: { 'draft-1': meal } }), { name: 'Draft', params: { mealId: 'draft-1' } });
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen();
  });

  it('reads a draft the page knows only by id', async () => {
    const meal = mealRecord({ id: 'draft-2', items: [photoItemJson()], confirmed: false, source: 'text' });
    const read = jest.fn(async () => meal);
    setMealApi(fakeMealApi({ meal: read }));
    await renderPage(link(), { name: 'Draft', params: { mealId: 'draft-2' } });
    expect(read).toHaveBeenCalledWith('draft-2', 'en');
    expect(screen.getByText(en('meal.describe.banner'))).toBeOnTheScreen();
  });
});

describe('MealEditor, a shared route', () => {
  it('reads the meal by id and has the day read again', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    setMealApi(fakeMealApi({ meal: async () => meal }));
    const load = jest.spyOn(useHealthStore.getState(), 'load').mockResolvedValue(undefined);
    const ref = createNavigationContainerRef<Record<string, object | undefined>>();
    await render(
      <NavigationContainer ref={ref}>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen
            name="MealEditor"
            component={MealEditorScreen as unknown as ComponentType}
            initialParams={{ mode: 'stored', mealId: 'meal-1' }}
          />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText(en('meal.editor.title_edit').toUpperCase())).toBeOnTheScreen();
    expect(load).toHaveBeenCalledWith({ force: true });
    load.mockRestore();
  });
});

describe('Add food on a draft or a saved meal', () => {
  it('parks the receiver and pushes a second meal page on the root stack', () => {
    const ready = jest.spyOn(appNavigationRef, 'isReady').mockReturnValue(true);
    const rootState = jest.spyOn(appNavigationRef, 'getRootState').mockReturnValue({ key: 'root' } as never);
    const dispatch = jest.spyOn(appNavigationRef, 'dispatch').mockImplementation(() => undefined);
    const receiver = jest.fn();

    expect(openAddFoodPage({ slot: 'dinner', date: '2026-10-21', onAddToMeal: receiver })).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PUSH',
        target: 'root',
        payload: { name: 'MealCapture', params: { origin: 'editor', slot: 'dinner', date: '2026-10-21', mode: 'search' } },
      }),
    );
    expect(takeAddFoodHandoff()).toBe(receiver);
    // Taken once.
    expect(takeAddFoodHandoff()).toBeNull();

    openAddFoodPage({ slot: 'dinner', date: '2026-10-21', onAddToMeal: receiver });
    dropAddFoodHandoff(receiver);
    expect(takeAddFoodHandoff()).toBeNull();
    ready.mockRestore();
    rootState.mockRestore();
    dispatch.mockRestore();
  });

  it('does nothing before the app is ready', () => {
    const ready = jest.spyOn(appNavigationRef, 'isReady').mockReturnValue(false);
    expect(openAddFoodPage({ slot: 'dinner', date: '2026-10-21', onAddToMeal: jest.fn() })).toBe(false);
    expect(takeAddFoodHandoff()).toBeNull();
    ready.mockRestore();
  });
});

describe('a draft’s photo', () => {
  it('is kept in memory for its draft and forgotten', () => {
    rememberDraftThumbnail('m-1', 'data:image/jpeg;base64,AAAA');
    expect(draftThumbnail('m-1')).toBe('data:image/jpeg;base64,AAAA');
    forgetDraftThumbnail('m-1');
    expect(draftThumbnail('m-1')).toBeNull();
  });

  it('goes with a health wipe and a sign-out', async () => {
    rememberDraftThumbnail('m-1', 'data:a');
    await runHealthWipeHooks({ profileId: MEMBER, reason: 'withdrawn' });
    expect(draftThumbnail('m-1')).toBeNull();
    rememberDraftThumbnail('m-2', 'data:b');
    await runSignOutCleaners({ memberId: MEMBER });
    expect(draftThumbnail('m-2')).toBeNull();
  });

  it('keeps no more than a few', () => {
    for (let index = 0; index < 12; index += 1) rememberDraftThumbnail(`m-${index}`, `data:${index}`);
    expect(draftThumbnail('m-0')).toBeNull();
    expect(draftThumbnail('m-11')).toBe('data:11');
  });
});

describe('the item editor for other meal screens', () => {
  it('the new-item slot adds the item as set and closes', async () => {
    const onAdd = jest.fn();
    const onClose = jest.fn();
    await render(<NewItemEditorSheet visible item={newSkyr()} offBarcode={null} onAdd={onAdd} onClose={onClose} />);
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('a11y.portion_times', { value: '2' }) })));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('food.editor.add') })));
    expect(onAdd.mock.calls[0][0].amount).toBe(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the member’s changes when the page hands a fresh draft of the same food on every render', async () => {
    const onAdd = jest.fn();
    // MEAL-2's search draws the slot with `draftFromChoice(choice)` inline: a new local id each render.
    const page = () => <NewItemEditorSheet visible item={draftFromChoice(skyrChoice())} offBarcode={null} onAdd={onAdd} onClose={jest.fn()} />;
    const view = await render(page());
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('a11y.portion_times', { value: '2' }) })));
    await act(async () => view.rerender(page()));
    expect(screen.getByLabelText('Calories, kcal')).toHaveDisplayValue('211');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('food.editor.add') })));
    expect(onAdd.mock.calls[0][0].amount).toBe(2);
  });

  it('the diary’s stored item opens through the host, and not without one', async () => {
    const meal: MealRecord = mealRecord({ items: [skyrItemJson()] });
    const request = {
      meal,
      item: draftFromRecord(meal.items[0]!),
      offBarcode: null,
      onCommitted: jest.fn(),
      onDeleted: jest.fn(),
    };
    expect(presentStoredItemEditor(request)).toBe(false);

    await render(<ItemEditorHost />);
    await act(async () => {
      expect(presentStoredItemEditor(request)).toBe(true);
    });
    expect(screen.getByRole('button', { name: en('food.editor.update') })).toBeOnTheScreen();
    await act(async () => dismissItemEditor());
  });
});
