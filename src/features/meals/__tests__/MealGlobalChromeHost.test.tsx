/**
 * The meal chrome over the tabs (../MealGlobalChromeHost.tsx) carries the
 * item editor host: with it mounted, the diary's request for a stored item
 * (iOS DiaryDayView's FoodItemEditorSheet(context: .storedItem(...))) is
 * drawn as the sheet; without it the request is refused and the diary opens
 * the meal editor instead.
 */
import { act, render, screen } from '@testing-library/react-native';

import { UiKitProvider } from '../../../components/ui';
import { bottomSheetMock } from '../../../components/ui/testing/bottomSheetMock';
import { translate } from '../../../i18n';
import { mealRecord, skyrItemJson } from '../itemEditor/__tests__/fixtures';
import { dismissItemEditor, presentStoredItemEditor } from '../itemEditor/itemEditorPresenter';
import MealGlobalChromeHost from '../MealGlobalChromeHost';
import { draftFromRecord } from '../types/draftFactory';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  bottomSheetMock.reset();
});

it('mounts the item editor host, so a diary item opens as the item editor sheet', async () => {
  const meal = mealRecord({ items: [skyrItemJson()] });
  const request = { meal, item: draftFromRecord(meal.items[0]!), offBarcode: null, onCommitted: jest.fn(), onDeleted: jest.fn() };
  expect(presentStoredItemEditor(request)).toBe(false);

  const view = await render(
    <UiKitProvider>
      <MealGlobalChromeHost />
    </UiKitProvider>,
  );
  await act(async () => {
    expect(presentStoredItemEditor(request)).toBe(true);
  });
  expect(screen.getByTestId('itemEditorHost')).toBeOnTheScreen();
  expect(screen.getByText(translate('food.editor.update', 'en'))).toBeOnTheScreen();

  await act(async () => dismissItemEditor());
  await view.unmount();
  expect(presentStoredItemEditor(request)).toBe(false);
});
