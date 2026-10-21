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

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('../../capture/slots', () => ({
  PhotoMode: null,
  BarcodeMode: null,
  NewItemEditor: function FakeEditor({ visible, item, onAdd, onClose }: NewItemEditorProps) {
    const { Pressable: Press, Text: Words } = require('react-native') as typeof import('react-native');
    if (!visible) return null;
    return (
      <Press
        accessibilityRole="button"
        onPress={() => {
          onAdd({ ...item, amount: 2 });
          onClose();
        }}
      >
        <Words>{`Editor for ${item.label}`}</Words>
      </Press>
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
