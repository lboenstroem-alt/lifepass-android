/**
 * The item editor on screen, in its three contexts: the iOS UI tests
 * `testTheItemEditorChangesTheAmountInOneTap` and
 * `testAnEditedCalorieValueIsTaggedAndResets`, the low-confidence confirm,
 * the estimate's range, and a saved meal's item committed at once (Update
 * and Remove with Undo, the last item deleting the meal, a product asking
 * first, a meal changed elsewhere, no connection).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { ProblemError, TransportError } from '../../../../api';
import { ToastHost } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { translate } from '../../../../i18n';
import { setMealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { draftFromRecord } from '../../types/draftFactory';
import type { MealItemDraft } from '../../types/draft';
import { GRAMS_SERVING, type MealPatchBody, type MealRecord } from '../../types/models';
import FoodItemEditorSheet, { type FoodItemEditorContext } from '../FoodItemEditorSheet';

import { bananaItemJson, mealRecord, newSkyr, offItemJson, photoItemJson, skyrItemJson, UPDATED_AT } from './fixtures';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

function problem(slug: string, status = 409): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

/** The sheet as a parent holds it: open on `item` until it asks to close. */
function Harness({ item, context, onClosed }: { item: MealItemDraft; context: FoodItemEditorContext; onClosed?: () => void }) {
  const [open, setOpen] = useState<MealItemDraft | null>(item);
  return (
    <>
      <FoodItemEditorSheet
        item={open}
        context={context}
        offBarcode={item.source === 'off' ? item.barcode : null}
        onClose={() => {
          setOpen(null);
          onClosed?.();
        }}
      />
      <ToastHost />
    </>
  );
}

const field = (label: string) => screen.getByLabelText(label);
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  bottomSheetMock.reset();
  setMealApi(null);
});

afterEach(() => setMealApi(null));

describe('a food the member is about to add', () => {
  it('changes the amount in one tap: 2x a cup of skyr is 211 kcal', async () => {
    const onAdd = jest.fn();
    const onClosed = jest.fn();
    await render(<Harness item={newSkyr()} context={{ kind: 'new', onAdd }} onClosed={onClosed} />);

    expect(field('Calories, kcal')).toHaveDisplayValue('105');
    await act(async () => fireEvent.press(button(en('a11y.portion_times', { value: '2' }))));
    expect(field('Calories, kcal')).toHaveDisplayValue('211');
    expect(button(en('a11y.portion_times', { value: '2' }))).toBeSelected();

    await act(async () => fireEvent.press(button(en('food.editor.add'))));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].amount).toBe(2);
    expect(onClosed).toHaveBeenCalled();
  });

  it('tags a typed calorie value Edited and resets it to the calculated one', async () => {
    await render(<Harness item={newSkyr()} context={{ kind: 'new', onAdd: jest.fn() }} />);
    const calories = field('Calories, kcal');
    await act(async () => fireEvent(calories, 'focus'));
    await act(async () => fireEvent.changeText(calories, '170'));

    expect(field('Calories, kcal')).toHaveDisplayValue('170');
    expect(field('Calories, kcal')).toHaveAccessibilityValue({ text: `170, ${en('food.editor.edited')}` });
    expect(screen.getByText(en('food.editor.edited'))).toBeOnTheScreen();

    await act(async () => fireEvent.press(button(en('a11y.reset_value'))));
    expect(field('Calories, kcal')).toHaveDisplayValue('105');
    expect(screen.queryByText(en('food.editor.edited'))).toBeNull();
  });

  it('says when a typed number is over the limit, and keeps the item', async () => {
    const onAdd = jest.fn();
    await render(<Harness item={newSkyr()} context={{ kind: 'new', onAdd }} />);
    const calories = field('Calories, kcal');
    await act(async () => fireEvent(calories, 'focus'));
    await act(async () => fireEvent.changeText(calories, '20000'));
    expect(screen.getByText(en('food.create.err.kcal'))).toBeOnTheScreen();
    await act(async () => fireEvent(field('Calories, kcal'), 'blur'));
    expect(field('Calories, kcal')).toHaveDisplayValue('105');
  });

  it('a typed amount takes either decimal separator', async () => {
    await render(<Harness item={newSkyr()} context={{ kind: 'new', onAdd: jest.fn() }} />);
    const amount = field(en('food.editor.amount'));
    await act(async () => fireEvent(amount, 'focus'));
    await act(async () => fireEvent.changeText(amount, '1,5'));
    expect(field('Calories, kcal')).toHaveDisplayValue('158');
    await act(async () => fireEvent.changeText(field(en('food.editor.amount')), '0.5'));
    expect(field('Calories, kcal')).toHaveDisplayValue('53');
  });

  it('under 1 g the button waits for a valid amount', async () => {
    const grams = { ...newSkyr(), serving: GRAMS_SERVING, amount: 100 };
    await render(<Harness item={grams} context={{ kind: 'new', onAdd: jest.fn() }} />);
    const amount = field(en('food.editor.amount_grams'));
    await act(async () => fireEvent(amount, 'focus'));
    await act(async () => fireEvent.changeText(amount, '0,5'));
    expect(button(en('food.editor.add'))).toBeDisabled();
    await act(async () => fireEvent.changeText(field(en('food.editor.amount_grams')), '5'));
    expect(button(en('food.editor.add'))).toBeEnabled();
  });
});

describe('an item of an unsaved meal', () => {
  it('a low-confidence item asks to confirm the amount before Update', async () => {
    const onUpdate = jest.fn();
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()], confirmed: false }).items[0]!);
    await render(<Harness item={photo} context={{ kind: 'local', onUpdate, onRemove: jest.fn() }} />);

    expect(screen.getByText(en('meal.item.check_amount_body'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(button(en('food.editor.confirm'))));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(en('meal.item.check_amount_body'))).toBeNull();

    await act(async () => fireEvent.press(button(en('food.editor.update'))));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ storedId: 'item-photo', confirmed: true }));
  });

  it('an untouched estimate shows its range; Set my own number makes it a field', async () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson('item-photo', { confidence: 'high', confirmed: true })] }).items[0]!);
    await render(<Harness item={photo} context={{ kind: 'local', onUpdate: jest.fn(), onRemove: jest.fn() }} />);

    expect(screen.getByText('380 to 520 kcal')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Calories, kcal')).toBeNull();
    await act(async () => fireEvent.press(button(en('food.editor.set_own'))));
    expect(field('Calories, kcal')).toHaveDisplayValue('450');
  });

  it('Remove from meal hands the removal back', async () => {
    const onRemove = jest.fn();
    await render(<Harness item={newSkyr()} context={{ kind: 'local', onUpdate: jest.fn(), onRemove }} />);
    await act(async () => fireEvent.press(button(en('food.editor.remove'))));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('an item of a saved meal (R4)', () => {
  const NEXT = '2026-10-21T08:20:00.000001+00:00';

  function stored(meal: MealRecord, index: number, extra: Partial<FoodItemEditorContext & { kind: 'stored' }> = {}) {
    const onCommitted = jest.fn();
    const onDeleted = jest.fn();
    const item = draftFromRecord(meal.items[index]!);
    const context: FoodItemEditorContext = { kind: 'stored', meal, onCommitted, onDeleted, ...extra } as FoodItemEditorContext;
    return { item, context, onCommitted, onDeleted };
  }

  it('Update sends every item with the loaded updatedAt, then Undo sends the old list with the new one', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const after = mealRecord({ items: [skyrItemJson('item-skyr', { amount: 2 }), bananaItemJson()], updatedAt: NEXT });
    const restored = mealRecord({ items: [skyrItemJson(), bananaItemJson()], updatedAt: '2026-10-21T08:21:00Z' });
    const patchMeal = jest
      .fn<Promise<{ meal: MealRecord; replayed: boolean | null }>, [string, MealPatchBody, string]>()
      .mockResolvedValueOnce({ meal: after, replayed: false })
      .mockResolvedValueOnce({ meal: restored, replayed: false });
    setMealApi(fakeMealApi({ patchMeal, myFoods: () => new Promise(() => undefined) }));
    const { item, context, onCommitted } = stored(meal, 0);
    await render(<Harness item={item} context={context} />);

    await act(async () => fireEvent.press(button(en('a11y.portion_times', { value: '2' }))));
    await act(async () => fireEvent.press(button(en('food.editor.update'))));

    const [id, body, key] = patchMeal.mock.calls[0]!;
    expect(id).toBe('meal-1');
    expect(body.expectedUpdatedAt).toBe(UPDATED_AT);
    expect(body.items?.map((input) => [input.id, input.amount])).toEqual([
      ['item-skyr', 2],
      ['item-banana', 120],
    ]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(onCommitted).toHaveBeenCalledWith(after);

    expect(screen.getByText(en('food.editor.updated'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(button(en('plan.undo'))));
    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(2));
    const [, undoBody, undoKey] = patchMeal.mock.calls[1]!;
    expect(undoBody.expectedUpdatedAt).toBe(NEXT);
    expect(undoBody.items?.map((input) => [input.id, input.amount])).toEqual([
      ['item-skyr', 1],
      ['item-banana', 120],
    ]);
    expect(undoKey).not.toBe(key);
    await waitFor(() => expect(onCommitted).toHaveBeenLastCalledWith(restored));
  });

  it('removing a library item toasts Removed with Undo, which brings it back as a new item', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const after = mealRecord({ items: [skyrItemJson()], updatedAt: NEXT });
    const patchMeal = jest
      .fn<Promise<{ meal: MealRecord; replayed: boolean | null }>, [string, MealPatchBody, string]>()
      .mockResolvedValueOnce({ meal: after, replayed: false })
      .mockResolvedValueOnce({ meal, replayed: false });
    setMealApi(fakeMealApi({ patchMeal, myFoods: () => new Promise(() => undefined) }));
    const { item, context } = stored(meal, 1);
    await render(<Harness item={item} context={context} />);

    await act(async () => fireEvent.press(button(en('food.editor.remove'))));
    expect(patchMeal.mock.calls[0]![1].items?.map((input) => input.id)).toEqual(['item-skyr']);
    expect(screen.getByText(en('food.editor.removed'))).toBeOnTheScreen();

    await act(async () => fireEvent.press(button(en('plan.undo'))));
    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(2));
    const undo = patchMeal.mock.calls[1]![1];
    expect(undo.items?.map((input) => input.id)).toEqual(['item-skyr', null]);
    expect(undo.items?.[1]?.foodId).toBe('banana');
  });

  it('an Open Food Facts product asks before it goes, and gets no Undo', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), offItemJson()] });
    const after = mealRecord({ items: [skyrItemJson()], updatedAt: NEXT });
    const patchMeal = jest.fn(async () => ({ meal: after, replayed: false }));
    setMealApi(fakeMealApi({ patchMeal, myFoods: () => new Promise(() => undefined) }));
    const { item, context } = stored(meal, 1);
    await render(<Harness item={item} context={context} />);

    expect(screen.getByText(en('food.off.attribution'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(button(en('food.editor.remove'))));
    expect(patchMeal).not.toHaveBeenCalled();
    expect(screen.getByText(en('food.editor.remove_title'))).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByTestId('itemEditor.remove.confirm')));
    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(en('food.editor.removed'))).toBeNull();
  });

  it('removing the last item asks to delete the meal, then deletes it', async () => {
    const meal = mealRecord({ items: [skyrItemJson()] });
    const deleteMeal = jest.fn(async () => undefined);
    setMealApi(fakeMealApi({ deleteMeal }));
    const { item, context, onDeleted } = stored(meal, 0);
    await render(<Harness item={item} context={context} />);

    await act(async () => fireEvent.press(button(en('food.editor.remove'))));
    expect(screen.getByText(en('meal.delete.title'))).toBeOnTheScreen();
    expect(screen.getByText(en('meal.delete.body'))).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('itemEditor.deleteMeal.confirm')));
    await waitFor(() => expect(deleteMeal).toHaveBeenCalledWith('meal-1'));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('a meal changed elsewhere reloads, keeps the edit, and says so', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const reloaded = mealRecord({ items: [skyrItemJson(), bananaItemJson()], updatedAt: NEXT });
    const patchMeal = jest
      .fn<Promise<{ meal: MealRecord; replayed: boolean | null }>, [string, MealPatchBody, string]>()
      .mockRejectedValueOnce(problem('meal_changed'))
      .mockResolvedValueOnce({ meal: reloaded, replayed: false });
    const read = jest.fn(async () => reloaded);
    setMealApi(fakeMealApi({ patchMeal, meal: read, myFoods: () => new Promise(() => undefined) }));
    const { item, context, onCommitted } = stored(meal, 0);
    await render(<Harness item={item} context={context} />);

    await act(async () => fireEvent.press(button(en('a11y.portion_times', { value: '2' }))));
    await act(async () => fireEvent.press(button(en('food.editor.update'))));

    expect(await screen.findByText(en('meal.editor.changed_banner'))).toBeOnTheScreen();
    expect(read).toHaveBeenCalledWith('meal-1', 'en');
    expect(onCommitted).toHaveBeenCalledWith(reloaded);
    expect(field('Calories, kcal')).toHaveDisplayValue('211');

    // One more tap saves it, against the meal as it now is.
    await act(async () => fireEvent.press(button(en('food.editor.update'))));
    await waitFor(() => expect(patchMeal).toHaveBeenCalledTimes(2));
    expect(patchMeal.mock.calls[1]![1].expectedUpdatedAt).toBe(NEXT);
  });

  it('without a connection it says so and stays open', async () => {
    const meal = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    setMealApi(fakeMealApi({ patchMeal: jest.fn(async () => Promise.reject(new TransportError('offline'))) }));
    const { item, context, onCommitted } = stored(meal, 0);
    await render(<Harness item={item} context={context} />);
    await act(async () => fireEvent.press(button(en('food.editor.update'))));
    expect(await screen.findByText(en('health.offline.action_hint'))).toBeOnTheScreen();
    expect(onCommitted).not.toHaveBeenCalled();
    expect(button(en('food.editor.update'))).toBeOnTheScreen();
  });

  it('read-only: nothing can be changed and nothing is pinned', async () => {
    const meal = mealRecord({ items: [offItemJson()] });
    const { item, context } = stored(meal, 0);
    await render(<FoodItemEditorSheet item={item} context={context} readOnly offBarcode={item.barcode} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: en('food.editor.update') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('food.editor.remove') })).toBeNull();
    expect(button(en('a11y.increase_amount'))).toBeDisabled();
    // The attribution is still there, at the end of the page.
    expect(screen.getByText(en('food.off.attribution'))).toBeOnTheScreen();
  });
});
