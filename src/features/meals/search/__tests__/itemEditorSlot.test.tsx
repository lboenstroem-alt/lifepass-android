/**
 * A food row's tap opens the item editor through MEAL-2's slot (MEAL-4's
 * `FoodItemEditorSheet` in its new-item context): the food at its default
 * portion goes in, and what the editor hands back joins the tray with the
 * row's meal-level source.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { dismissToast } from '../../../../components/ui/Toast';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests } from '../../../../health/store';
import { todayServerDay } from '../../../../i18n/format';
import MealCaptureNavigator from '../../../../navigation/MealCaptureNavigator';
import { navigationRef } from '../../../../navigation/navigationRef';
import type { RootStackParamList } from '../../../../navigation/types';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { setMealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { choice, myFoods, presets, signIn } from '../../capture/__tests__/mealFixtures';
import { resetCapturePagesForTests } from '../../capture/capturePages';
import type { NewItemEditorProps } from '../../capture/slots';
import { resetFoodsCacheMemory } from '../../foodsCache';
import { resetMealOutboxForTests } from '../../outbox';

/** Each render of the editor: which presentation (its mount) and the item it was handed. */
const mockEditorRenders: { mount: number; localId: string }[] = [];
let mockEditorMounts = 0;

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('../../capture/slots', () => ({
  PhotoMode: null,
  BarcodeMode: null,
  NewItemEditor: function FakeEditor({ visible, item, onAdd, onClose }: NewItemEditorProps) {
    const { Pressable: Press, Text: Words } = require('react-native') as typeof import('react-native');
    const { useState: useOnce } = require('react') as typeof import('react');
    const [mount] = useOnce(() => ++mockEditorMounts);
    mockEditorRenders.push({ mount, localId: item.localId });
    if (!visible) return null;
    return (
      <>
        <Press
          accessibilityRole="button"
          onPress={() => {
            onAdd({ ...item, amount: 2 });
            onClose();
          }}
        >
          <Words>{`Editor for ${item.label}`}</Words>
        </Press>
        <Press accessibilityRole="button" onPress={onClose}>
          <Words>Cancel editor</Words>
        </Press>
      </>
    );
  },
}));
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30_000);

const Root = createNativeStackNavigator<RootStackParamList>();

function Home() {
  return (
    <Pressable>
      <Text>Home screen</Text>
    </Pressable>
  );
}

beforeEach(() => {
  mockEditorRenders.length = 0;
  mockEditorMounts = 0;
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  resetCapturePagesForTests();
  dismissToast();
  signIn();
  setMealApi(fakeMealApi({ presets: jest.fn(async () => presets()), myFoods: jest.fn(async () => myFoods()) }));
});

afterEach(async () => {
  setMealApi(null);
  await localStore.settled();
});

it('a row opens the editor with the default portion, and its answer joins the tray', async () => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Main" component={Home} />
          <Root.Screen name="MealCapture" component={MealCaptureNavigator} />
        </Root.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params: object) => void)('MealCapture', {
      origin: 'scanTab',
      mode: 'search',
      date: todayServerDay(),
    });
  });
  await waitFor(() => expect(screen.getAllByTestId(`food.open.${choice().key}`).length).toBeGreaterThan(0));
  await act(async () => fireEvent.press(screen.getAllByTestId(`food.open.${choice().key}`)[0]!));
  expect(screen.getByText('Editor for Skyr, plain')).toBeOnTheScreen();
  await act(async () => fireEvent.press(screen.getByText('Editor for Skyr, plain')));
  expect(within(screen.getByTestId('meal.trayBar')).getByText('1 item · 214 kcal')).toBeOnTheScreen();
  expect(screen.getByText('Added')).toBeOnTheScreen();
});

it('the open editor keeps its item while the page redraws, and the same food opened again is a fresh editor', async () => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Main" component={Home} />
          <Root.Screen name="MealCapture" component={MealCaptureNavigator} />
        </Root.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params: object) => void)('MealCapture', {
      origin: 'scanTab',
      mode: 'search',
      date: todayServerDay(),
    });
  });
  await waitFor(() => expect(screen.getAllByTestId(`food.open.${choice().key}`).length).toBeGreaterThan(0));
  await act(async () => fireEvent.press(screen.getAllByTestId(`food.open.${choice().key}`)[0]!));
  expect(screen.getByText('Editor for Skyr, plain')).toBeOnTheScreen();

  // The search redraws behind the open editor (a keystroke here; a search
  // answer or the lists refreshing do the same).
  await act(async () => fireEvent.changeText(screen.getByTestId('food.search.field'), 's'));
  const first = mockEditorRenders.filter((entry) => entry.mount === 1);
  expect(first.length).toBeGreaterThan(1);
  expect(new Set(first.map((entry) => entry.localId)).size).toBe(1);

  // Closed, then the same food again: a new editor with a new item.
  await act(async () => fireEvent.press(screen.getByText('Cancel editor')));
  await act(async () => fireEvent.changeText(screen.getByTestId('food.search.field'), ''));
  await act(async () => fireEvent.press(screen.getAllByTestId(`food.open.${choice().key}`)[0]!));
  expect(screen.getByText('Editor for Skyr, plain')).toBeOnTheScreen();
  const second = mockEditorRenders.filter((entry) => entry.mount === 2);
  expect(second.length).toBeGreaterThan(0);
  expect(second[0]!.localId).not.toBe(first[0]!.localId);
});
