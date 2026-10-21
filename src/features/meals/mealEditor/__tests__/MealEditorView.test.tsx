/**
 * The meal editor on screen, in a real stack: a saved meal committed at
 * once, a draft checked and confirmed (the body iOS sends, a meal changed
 * elsewhere, no connection, leaving it), the capture page's tray reviewed
 * and saved through the page, read-only, a meal gone, and a failed read.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createStore } from 'zustand/vanilla';

import { ProblemError, TransportError } from '../../../../api';
import { decodeProfile } from '../../../../api/profile';
import { ToastHost } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeHealthDay } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { translate } from '../../../../i18n';
import { shortDay, todayServerDay } from '../../../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { setMealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { bananaItemJson, mealRecord, newSkyr, offItemJson, photoItemJson, skyrItemJson, UPDATED_AT } from '../../itemEditor/__tests__/fixtures';
import type { MealItemDraft } from '../../types/draft';
import type { MealPatchBody, MealRecord } from '../../types/models';
import type { MealCaptureLink, MealCaptureLinkState, MealCaptureSaveOutcome } from '../captureLink';
import { rememberDraftThumbnail } from '../draftThumbnails';
import MealEditorView, { type MealEditorMode } from '../MealEditorView';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const NEXT = '2026-10-21T08:20:00.000001+00:00';
const PAST_DAY = '2026-10-14';

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const button = (name: string) => screen.getByRole('button', { name });

function problem(slug: string, status = 409): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

function signIn(access: 'entitled' | 'pass_only' = 'entitled') {
  const profile = decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access,
      consent: null,
      features: [],
    },
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile });
}

// ---------------------------------------------------------------------------
// The editor pushed over a first screen

const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();
const Stack = createNativeStackNavigator();

function Start() {
  return <Text testID="route.Start">Start</Text>;
}

async function renderEditor(mode: MealEditorMode, onChanged?: () => void) {
  const view = await render(
    <>
      <NavigationContainer ref={navigationRef} initialState={{ index: 1, routes: [{ name: 'Start' }, { name: 'Editor' }] }}>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="Start" component={Start} />
          <Stack.Screen name="Editor">{() => <MealEditorView mode={mode} onChanged={onChanged} />}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      <ToastHost />
    </>,
  );
  await settle();
  return view;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

const currentRoute = () => navigationRef.getCurrentRoute()?.name;

type PatchMock = jest.Mock<Promise<{ meal: MealRecord; replayed: boolean | null }>, [string, MealPatchBody, string]>;
const patchMock = (): PatchMock => jest.fn();

// ---------------------------------------------------------------------------
// A capture page stand-in (MEAL-2's model, as far as the editor uses it)

function fakeCapture(initial: Partial<MealCaptureLinkState> = {}, save: () => Promise<MealCaptureSaveOutcome> = async () => ({ kind: 'queued' })) {
  // The store's setState stays reachable for the tests (the link itself only reads).
  const store = createStore<MealCaptureLinkState>()(() => ({
    mode: 'search',
    slot: 'lunch',
    date: todayServerDay(),
    tray: [],
    chosenLoggedAt: null,
    saveErrorKey: null,
    drafts: {},
    ...initial,
  }));
  const link: MealCaptureLink & { closed: jest.Mock; modes: string[]; state: typeof store } = {
    state: store,
    origin: 'scanTab',
    store,
    closed: jest.fn(),
    modes: [],
    replace: (item: MealItemDraft) =>
      store.setState({ tray: store.getState().tray.map((entry) => (entry.localId === item.localId ? item : entry)) }),
    add: (items: readonly MealItemDraft[]) => store.setState({ tray: [...store.getState().tray, ...items] }),
    remove: (itemId: string) => store.setState({ tray: store.getState().tray.filter((entry) => entry.localId !== itemId) }),
    setSlot: (slot) => store.setState({ slot }),
    setDate: (date) => store.setState({ date }),
    setChosenLoggedAt: (at) => store.setState({ chosenLoggedAt: at }),
    setMode: (mode) => {
      link.modes.push(mode);
      store.setState({ mode });
    },
    save,
    close: () => link.closed(),
    discardTray: () => store.setState({ tray: [] }),
  };
  return link;
}

beforeEach(() => {
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  setMealApi(null);
  signIn();
});

afterEach(() => setMealApi(null));

// ---------------------------------------------------------------------------

describe('a saved meal', () => {
  it('reads it, says Edit meal, and every row opens the item editor', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const read = jest.fn(async () => meal);
    setMealApi(fakeMealApi({ meal: read }));
    const onChanged = jest.fn();
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null }, onChanged);

    expect(read).toHaveBeenCalledWith('meal-1', 'en');
    expect(screen.getByText(en('meal.editor.title_edit').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Banana, 120 g, 107 kcal')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('meal.editor.save') })).toBeNull();
    expect(onChanged).toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByLabelText('Banana, 120 g, 107 kcal')));
    expect(screen.getByRole('button', { name: en('food.editor.update') })).toBeOnTheScreen();
  });

  it('a new slot is committed at once with the loaded updatedAt', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    const patchMeal = patchMock().mockResolvedValue({ meal: mealRecord({ items: [skyrItemJson()], slot: 'dinner', updatedAt: NEXT }), replayed: false });
    setMealApi(fakeMealApi({ meal: async () => meal, patchMeal }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    await act(async () => fireEvent.press(button(en('slot.dinner'))));
    expect(patchMeal).toHaveBeenCalledTimes(1);
    expect(patchMeal.mock.calls[0]![1]).toEqual({ slot: 'dinner', expectedUpdatedAt: UPDATED_AT });
    expect(button(en('slot.dinner'))).toBeSelected();
  });

  it('a slot the server refused goes back to what the meal had', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    setMealApi(fakeMealApi({ meal: async () => meal, patchMeal: async () => Promise.reject(new TransportError('offline')) }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    await act(async () => fireEvent.press(button(en('slot.dinner'))));
    await settle();
    expect(button(en('slot.lunch'))).toBeSelected();
    expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
  });

  it('removing a library item commits the rest and offers Undo', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const after = mealRecord({ items: [skyrItemJson()], updatedAt: NEXT });
    const patchMeal = patchMock().mockResolvedValueOnce({ meal: after, replayed: false }).mockResolvedValueOnce({ meal, replayed: false });
    setMealApi(fakeMealApi({ meal: async () => meal, patchMeal, myFoods: () => new Promise(() => undefined) }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    await act(async () => {
      fireEvent(screen.getByLabelText('Banana, 120 g, 107 kcal'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    });
    await settle();
    expect(patchMeal.mock.calls[0]![1].items?.map((item) => item.id)).toEqual(['item-skyr']);
    expect(screen.queryByLabelText('Banana, 120 g, 107 kcal')).toBeNull();

    await act(async () => fireEvent.press(button(en('plan.undo'))));
    await settle();
    expect(patchMeal.mock.calls[1]![1]).toEqual(expect.objectContaining({ expectedUpdatedAt: NEXT }));
    expect(patchMeal.mock.calls[1]![1].items?.map((item) => item.id)).toEqual(['item-skyr', null]);
    expect(screen.getByLabelText('Banana, 120 g, 107 kcal')).toBeOnTheScreen();
  });

  it('a product asks before it is removed, and gets no Undo', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), offItemJson()] });
    const patchMeal = patchMock().mockResolvedValue({ meal: mealRecord({ items: [skyrItemJson()], updatedAt: NEXT }), replayed: false });
    setMealApi(fakeMealApi({ meal: async () => meal, patchMeal, myFoods: () => new Promise(() => undefined) }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    const product = screen.getByLabelText('Hafrakex, 30 g, 135 kcal');
    await act(async () => fireEvent(product, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } }));
    expect(patchMeal).not.toHaveBeenCalled();
    expect(screen.getByText(en('food.editor.remove_title'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.remove.confirm')));
    await settle();
    expect(patchMeal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en('food.editor.removed'))).toBeNull();
  });

  it('Delete meal asks, deletes, reads today again and leaves', async () => {
    const meal = mealRecord({ items: [skyrItemJson()], logDate: todayServerDay() });
    const deleteMeal = jest.fn(async () => undefined);
    setMealApi(fakeMealApi({ meal: async () => meal, deleteMeal }));
    const load = jest.spyOn(useHealthStore.getState(), 'load').mockResolvedValue(undefined);
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    await act(async () => fireEvent.press(button(en('meal.editor.delete'))));
    expect(screen.getByText(en('meal.delete.title'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.delete.confirm')));
    await settle();
    expect(deleteMeal).toHaveBeenCalledWith('meal-1');
    expect(load).toHaveBeenCalledWith({ force: true });
    expect(currentRoute()).toBe('Start');
    load.mockRestore();
  });

  it('a meal that is gone says so and leaves', async () => {
    setMealApi(fakeMealApi({ meal: async () => Promise.reject(problem('health_meal_not_found', 404)) }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });
    expect(screen.getByText(en('health.err.changed'))).toBeOnTheScreen();
    expect(currentRoute()).toBe('Start');
  });

  it('a failed read shows the error with Try again, which reads again', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    const read = jest.fn<Promise<MealRecord>, [string, string]>().mockRejectedValueOnce(new TransportError('offline')).mockResolvedValueOnce(meal);
    setMealApi(fakeMealApi({ meal: read }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });

    await act(async () => fireEvent.press(button(en('health.retry'))));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')).toBeOnTheScreen();
  });

  it('shows the day line for today against the target', async () => {
    const meal = mealRecord({ items: [skyrItemJson()], logDate: todayServerDay() });
    useHealthStore.setState({
      today: decodeHealthDay(
        {
          date: todayServerDay(),
          meals: {
            date: todayServerDay(),
            meals: [{ id: 'breakfast', confirmed: true, totals: { kcalLow: 400, kcalHigh: 500, proteinG: 1, carbsG: 1, fatG: 1 } }],
            target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 },
          },
        },
      ),
    });
    setMealApi(fakeMealApi({ meal: async () => meal }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });
    expect(screen.getByText(en('meal.editor.day_line', { eaten: '560', low: '1,800', high: '2,000' }))).toBeOnTheScreen();
  });

  it('read-only: no Save and no Add food; the rows still open the item editor read-only', async () => {
    signIn('pass_only');
    const meal = mealRecord({ items: [skyrItemJson()] });
    setMealApi(fakeMealApi({ meal: async () => meal }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });
    expect(screen.queryByRole('button', { name: en('meal.editor.add_food') })).toBeNull();
    expect(button(en('slot.dinner'))).toBeDisabled();
    await act(async () => fireEvent.press(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')));
    expect(screen.queryByRole('button', { name: en('food.editor.update') })).toBeNull();
  });
});

describe('a draft', () => {
  const draft = () =>
    mealRecord({ items: [photoItemJson(), skyrItemJson()], confirmed: false, source: 'photo', logDate: PAST_DAY, loggedAt: `${PAST_DAY}T12:40:00Z` });

  it('says it is an estimate, waits for the check, and confirms with the body iOS sends', async () => {
    const meal = draft();
    const confirmed = mealRecord({ items: [photoItemJson('item-photo', { confirmed: true }), skyrItemJson()], logDate: PAST_DAY, updatedAt: NEXT });
    const patchMeal = patchMock().mockResolvedValue({ meal: confirmed, replayed: false });
    setMealApi(fakeMealApi({ patchMeal, myFoods: () => new Promise(() => undefined) }));
    const capture = fakeCapture({ tray: [] });
    await renderEditor({ kind: 'draft', meal, capture });

    expect(screen.getByText(en('meal.editor.title_new').toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen();
    expect(screen.getByText(en('meal.item.check_amount'))).toBeOnTheScreen();
    expect(screen.getByText('Check 1 item before saving')).toBeOnTheScreen();
    expect(button(en('meal.editor.save'))).toBeDisabled();

    await act(async () => fireEvent.press(button(en('meal.estimate.confirm_all'))));
    expect(button(en('meal.editor.save'))).toBeEnabled();
    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();

    const [id, body] = patchMeal.mock.calls[0]!;
    expect(id).toBe('meal-1');
    expect(body.confirmed).toBe(true);
    expect(body.expectedUpdatedAt).toBe(UPDATED_AT);
    expect(body.slot).toBe('lunch');
    expect(body.logDate).toBe(PAST_DAY);
    expect(body.loggedAt?.toISOString()).toBe(`${PAST_DAY}T12:40:00.000Z`);
    expect(body.items?.map((item) => [item.id, item.confirmed])).toEqual([
      ['item-photo', true],
      ['item-skyr', true],
    ]);
    // Saved: the page closes, and the toast says where it went.
    expect(capture.closed).toHaveBeenCalled();
    expect(screen.getByText(en('meal.saved_on', { date: shortDay(PAST_DAY, 'en') }))).toBeOnTheScreen();
    expect(button(en('diary.title'))).toBeOnTheScreen();
  });

  it('the page’s tray joins the draft as extra items', async () => {
    const capture = fakeCapture({ tray: [newSkyr()] });
    await renderEditor({ kind: 'draft', meal: mealRecord({ items: [photoItemJson()], confirmed: false }), capture });
    expect(screen.getAllByText('Skyr, plain')).toHaveLength(1);
    expect(screen.getByText('Fish stew')).toBeOnTheScreen();
  });

  it('shows the photo it came from', async () => {
    const meal = draft();
    rememberDraftThumbnail(meal.id, 'data:image/jpeg;base64,AAAA');
    await renderEditor({ kind: 'draft', meal, capture: fakeCapture() });
    expect(screen.getByLabelText(en('meal.photo.preview_label'))).toBeOnTheScreen();
  });

  it('a description draft says so and offers no "photo missed" row', async () => {
    const meal = mealRecord({ items: [photoItemJson()], confirmed: false, source: 'text' });
    await renderEditor({ kind: 'draft', meal, capture: fakeCapture() });
    expect(screen.getByText(en('meal.describe.banner'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('meal.photo.add_missing') })).toBeNull();
    expect(button(en('meal.editor.add_food'))).toBeOnTheScreen();
  });

  it('meal_changed reloads, keeps the edits, and says so twice (banner and toast)', async () => {
    const meal = draft();
    const reloaded = mealRecord({ items: [photoItemJson(), skyrItemJson()], confirmed: false, source: 'photo', logDate: PAST_DAY, updatedAt: NEXT });
    const patchMeal = patchMock().mockRejectedValueOnce(problem('meal_changed'));
    const read = jest.fn(async () => reloaded);
    setMealApi(fakeMealApi({ patchMeal, meal: read }));
    await renderEditor({ kind: 'draft', meal, capture: fakeCapture() });

    await act(async () => fireEvent.press(button(en('meal.estimate.confirm_all'))));
    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();
    expect(read).toHaveBeenCalledWith('meal-1', 'en');
    expect(screen.getByText(en('meal.editor.changed_banner'))).toBeOnTheScreen();
    expect(screen.getByText(en('health.err.changed'))).toBeOnTheScreen();
    // The member's check is kept: Save is still ready.
    expect(button(en('meal.editor.save'))).toBeEnabled();
  });

  it('meal_needs_confirmation asks for the untouched low-confidence items again', async () => {
    const meal = draft();
    setMealApi(
      fakeMealApi({
        patchMeal: patchMock().mockRejectedValueOnce(problem('meal_needs_confirmation')),
        meal: async () => meal,
      }),
    );
    await renderEditor({ kind: 'draft', meal, capture: fakeCapture() });
    await act(async () => fireEvent.press(button(en('meal.estimate.confirm_all'))));
    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();
    expect(screen.queryByText(en('meal.editor.changed_banner'))).toBeNull();
    expect(button(en('meal.editor.save'))).toBeDisabled();
    expect(screen.getByText('Check 1 item before saving')).toBeOnTheScreen();
  });

  it('offline it is never queued: it says so and keeps the edits', async () => {
    setMealApi(fakeMealApi({ patchMeal: async () => Promise.reject(new TransportError('offline')) }));
    await renderEditor({ kind: 'draft', meal: draft(), capture: fakeCapture() });
    await act(async () => fireEvent.press(button(en('meal.estimate.confirm_all'))));
    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();
    expect(screen.getByText(en('health.offline.action_hint'))).toBeOnTheScreen();
    expect(currentRoute()).toBe('Editor');
  });

  it('back asks to keep it for later; Keep leaves it as it is', async () => {
    const deleteMeal = jest.fn(async () => undefined);
    setMealApi(fakeMealApi({ deleteMeal }));
    await renderEditor({ kind: 'draft', meal: draft(), capture: fakeCapture() });

    await act(async () => fireEvent.press(button(en('common.back'))));
    expect(screen.getByText(en('meal.draft_leave.title'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.leave.keep')));
    await settle();
    expect(currentRoute()).toBe('Start');
    expect(deleteMeal).not.toHaveBeenCalled();
  });

  it('Android back asks too, and Discard deletes the estimate and closes the page', async () => {
    const deleteMeal = jest.fn(async () => undefined);
    setMealApi(fakeMealApi({ deleteMeal }));
    const capture = fakeCapture();
    await renderEditor({ kind: 'draft', meal: draft(), capture });

    await act(async () => navigationRef.goBack());
    expect(currentRoute()).toBe('Editor');
    expect(screen.getByText(en('meal.draft_leave.title'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.leave.discard')));
    await settle();
    expect(deleteMeal).toHaveBeenCalledWith('meal-1');
    expect(capture.closed).toHaveBeenCalled();
  });

  it('a draft opened from Plan (no page) goes back once discarded', async () => {
    const meal = draft();
    const deleteMeal = jest.fn(async () => undefined);
    setMealApi(fakeMealApi({ meal: async () => meal, deleteMeal }));
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture: null });
    expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen();

    await act(async () => fireEvent.press(button(en('meal.editor.discard_estimate'))));
    expect(screen.getByText(en('meal.discard.title'))).toBeOnTheScreen();
    expect(screen.getByText(en('meal.discard.body'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.discard.confirm')));
    await settle();
    expect(deleteMeal).toHaveBeenCalledWith('meal-1');
    expect(currentRoute()).toBe('Start');
  });

  it('Cancel stays on the draft', async () => {
    await renderEditor({ kind: 'draft', meal: draft(), capture: fakeCapture() });
    await act(async () => navigationRef.goBack());
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.leave.cancel')));
    expect(currentRoute()).toBe('Editor');
    expect(screen.queryByText(en('meal.draft_leave.title'))).toBeNull();
  });

  it('the amount pill doubles a photo item in one tap and checks it', async () => {
    await renderEditor({ kind: 'draft', meal: draft(), capture: fakeCapture() });
    expect(screen.getByText(en('meal.item.about_grams', { grams: '300' }))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.item.0.pill')));
    await act(async () => fireEvent.press(screen.getByTestId('mealEditor.item.0.pill.multiplier.2')));
    // The row's amount and the pill both read the new grams.
    expect(screen.getAllByText('600 g')).toHaveLength(2);
    expect(screen.queryByText(en('meal.item.check_amount'))).toBeNull();
    expect(button(en('meal.editor.save'))).toBeEnabled();
  });

  it('Quick add joins the draft', async () => {
    await renderEditor({ kind: 'draft', meal: draft(), capture: fakeCapture() });
    await act(async () => fireEvent.press(button(en('food.quick_add'))));
    await act(async () => fireEvent.changeText(screen.getByTestId('quickAdd.kcal'), '250'));
    await act(async () => fireEvent.press(screen.getByTestId('quickAdd.add')));
    expect(screen.getByLabelText(`${en('food.quick.default_name')}, ${en('food.create.serving_default')}, 250 kcal`)).toBeOnTheScreen();
  });

  it('a draft opened by id inside the page reads it, then joins the tray', async () => {
    const meal = draft();
    const read = jest.fn(async () => meal);
    setMealApi(fakeMealApi({ meal: read }));
    const capture = fakeCapture({ tray: [newSkyr()] });
    await renderEditor({ kind: 'stored', mealId: 'meal-1', capture });
    expect(read).toHaveBeenCalledWith('meal-1', 'en');
    expect(screen.getByText(en('meal.estimate.banner'))).toBeOnTheScreen();
    expect(screen.getAllByText('Skyr, plain')).toHaveLength(2);
  });
});

describe('the tray, reviewed as a new meal', () => {
  it('shows the page’s items and saves through the page, which closes it', async () => {
    const save = jest.fn(async (): Promise<MealCaptureSaveOutcome> => ({ kind: 'queued' }));
    const capture = fakeCapture({ tray: [newSkyr()], slot: 'breakfast' }, save);
    await renderEditor({ kind: 'tray', capture });

    expect(screen.getByText(en('meal.editor.title_new').toUpperCase())).toBeOnTheScreen();
    expect(button(en('slot.breakfast'))).toBeSelected();
    expect(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')).toBeOnTheScreen();
    expect(screen.queryByText(en('meal.estimate.banner'))).toBeNull();

    await act(async () => fireEvent.press(button(en('slot.dinner'))));
    expect(capture.store.getState().slot).toBe('dinner');

    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(capture.closed).toHaveBeenCalled();
  });

  it('a failed save stays, with the page’s reason', async () => {
    const capture = fakeCapture({ tray: [newSkyr()] });
    capture.save = async () => {
      capture.state.setState({ saveErrorKey: 'meal.outbox.full' });
      return { kind: 'failed' };
    };
    await renderEditor({ kind: 'tray', capture });
    await act(async () => fireEvent.press(button(en('meal.editor.save'))));
    await settle();
    expect(screen.getByText(en('meal.outbox.full'))).toBeOnTheScreen();
    expect(capture.closed).not.toHaveBeenCalled();
  });

  it('an emptied tray waits for an item', async () => {
    const capture = fakeCapture({ tray: [newSkyr()] });
    await renderEditor({ kind: 'tray', capture });
    await act(async () => {
      fireEvent(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    });
    expect(capture.store.getState().tray).toHaveLength(0);
    expect(button(en('meal.editor.save'))).toBeDisabled();
    expect(screen.getAllByText(en('meal.editor.no_items')).length).toBeGreaterThan(0);
  });

  it('Add food goes back to Search on the same page', async () => {
    const capture = fakeCapture({ tray: [newSkyr()], mode: 'photo' });
    await renderEditor({ kind: 'tray', capture });
    await act(async () => fireEvent.press(button(en('meal.editor.add_food'))));
    expect(capture.modes).toEqual(['search']);
    expect(currentRoute()).toBe('Start');
  });

  it('an item changed in the item editor goes back to the page’s tray', async () => {
    const capture = fakeCapture({ tray: [newSkyr()] });
    await renderEditor({ kind: 'tray', capture });
    await act(async () => fireEvent.press(screen.getByLabelText('Skyr, plain, 1 cup (170 g), 105 kcal')));
    await act(async () => fireEvent.press(button(en('a11y.portion_times', { value: '2' }))));
    await act(async () => fireEvent.press(button(en('food.editor.update'))));
    expect(capture.store.getState().tray[0]!.amount).toBe(2);
    expect(screen.getByLabelText('Skyr, plain, 2 x 1 cup (170 g), 211 kcal')).toBeOnTheScreen();
  });
});
