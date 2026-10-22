/**
 * Barcode mode on the real meal page (MEAL-2's navigator, MEAL-4's item
 * editor), with the camera, the server and Open Food Facts faked: the port
 * of iOS MealFlowsUITests' barcode half (a product added from the label, not
 * found, no nutrition, lookup failed, typed codes) and
 * testTheBarcodeCardNamesTheAppVersionItSends.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { dismissToast } from '../../../../components/ui/Toast';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests } from '../../../../health/store';
import { resetMealGatePresenter } from '../../../../health/gate/mealGate';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import MealCaptureNavigator from '../../../../navigation/MealCaptureNavigator';
import { navigationRef } from '../../../../navigation/navigationRef';
import type { MealCaptureParams, RootStackParamList } from '../../../../navigation/types';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { setMealApi, type MealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { capturePageFor, resetCapturePagesForTests } from '../../capture/capturePages';
import { choice, myFoods, presets, signIn } from '../../capture/__tests__/mealFixtures';
import { resetFoodsCacheMemory } from '../../foodsCache';
import { setFoodFacts, type FoodFactsLookup } from '../../offClient/client';
import type { OFFLookupOutcome } from '../../offClient/parse';
import { resetMealOutboxForTests } from '../../outbox';
import { BARCODE_TIP_KEY, resetTipSeenForTests } from '../../photo/tipSeen';
import { cameraDouble, DENIED } from '../../photo/__tests__/cameraDouble';
import type { BarcodeLookupResult, OFFSnapshot } from '../../types/models';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('expo-camera', () => require('../../photo/__tests__/cameraDouble').expoCameraModule);
jest.mock('../../describe', () => ({ openDescribe: jest.fn(), DescribeHost: () => null }));
// Search's My foods rows swipe; under Reanimated's Jest mock the gesture
// library complains about every row. The swipe is not under test here.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30_000);

const TODAY = todayServerDay();
const Root = createNativeStackNavigator<RootStackParamList>();
const CODE = '5690527282050';

function Home() {
  return <Text>Home screen</Text>;
}

const skyr: OFFSnapshot = {
  barcode: CODE,
  productName: 'Skyr vanilla',
  productNameLang: 'other',
  brand: 'Ísey',
  per100g: { kcal: 76, proteinG: 9.6, carbsG: 8.1, fatG: 0.2, fibreG: null, sugarsG: null, saturatedFatG: null, saltG: null },
  energyFromKj: false,
  servingLabel: '200 g',
  servingQuantityG: 200,
  retrievedAt: '2026-10-22T10:00:00.000Z',
};

let offAnswer: OFFLookupOutcome = { kind: 'notFound' };
let serverAnswer: BarcodeLookupResult = { food: null, origin: null };
const offCalls: string[] = [];

function useApi(overrides: Partial<MealApi> = {}): MealApi {
  const api = fakeMealApi({
    presets: jest.fn(async () => presets()),
    myFoods: jest.fn(async () => myFoods()),
    barcode: jest.fn(async () => serverAnswer),
    ...overrides,
  });
  setMealApi(api);
  return api;
}

async function renderPage(params: Partial<MealCaptureParams> = {}) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <UiKitProvider>
        <Root.Navigator screenOptions={{ headerShown: false }}>
          <Root.Screen name="Main" component={Home} />
          <Root.Screen name="MealCapture" component={MealCaptureNavigator} options={{ presentation: 'fullScreenModal' }} />
        </Root.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params: object) => void)('MealCapture', {
      origin: 'scanTab',
      mode: 'barcode',
      date: TODAY,
      slot: 'snack',
      ...params,
    });
  });
  await act(async () => {
    fireEvent(screen.getByTestId('meal.barcode'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 860 } } });
  });
}

function pageModel() {
  const route = navigationRef.getRootState().routes.find((entry) => entry.name === 'MealCapture');
  const key = route?.state?.key;
  return key ? capturePageFor(key) : null;
}

/** The same code in two frames: a read. */
async function scan(type: string, data: string) {
  await act(async () => {
    cameraDouble.showBarcode(type, data);
    cameraDouble.showBarcode(type, data);
  });
  await act(async () => undefined);
}

let events: [string, Record<string, unknown>][] = [];

beforeEach(async () => {
  bottomSheetMock.reset();
  cameraDouble.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  resetCapturePagesForTests();
  resetMealGatePresenter();
  resetTipSeenForTests();
  await AsyncStorage.setItem(BARCODE_TIP_KEY, 'true');
  dismissToast();
  signIn();
  offAnswer = { kind: 'notFound' };
  serverAnswer = { food: null, origin: null };
  offCalls.length = 0;
  const lookup: FoodFactsLookup = {
    lookup: async (code) => {
      offCalls.push(code);
      return offAnswer;
    },
  };
  setFoodFacts(lookup);
  events = [];
  setAnalyticsObserver((event, params) => events.push([event, { ...params }]));
});

afterEach(async () => {
  jest.restoreAllMocks();
  setMealApi(null);
  setFoodFacts(null);
  setAnalyticsObserver(null);
  await AsyncStorage.clear();
  await localStore.settled();
});

describe('the camera', () => {
  it('reads the four retail formats under a reticle, with a hint and Type the number', async () => {
    useApi();
    await renderPage();
    expect(cameraDouble.props?.barcodeScannerSettings?.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_e', 'upc_a']);
    expect(screen.getByTestId('meal.barcode.reticle', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Line up the barcode inside the frame')).toBeOnTheScreen();
    expect(screen.getByText('Type the number')).toBeOnTheScreen();
  });

  // testTheBarcodeCardNamesTheAppVersionItSends: what Open Food Facts receives, said before the first lookup.
  it('says what Open Food Facts receives, until OK', async () => {
    await AsyncStorage.removeItem(BARCODE_TIP_KEY);
    resetTipSeenForTests();
    useApi();
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(
          "Barcode lookups go from your phone to Open Food Facts, a free food database. It receives only the barcode number, your phone's IP address and the app version.",
        ),
      ).toBeOnTheScreen(),
    );
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.privacy.ok')));
    expect(screen.queryByTestId('meal.barcode.privacy')).toBeNull();
    expect(await AsyncStorage.getItem(BARCODE_TIP_KEY)).toBe('true');
  });

  // The same iOS test in Icelandic: the card names the IP address and the app version, not the stale wording.
  it('says it in Icelandic too', async () => {
    await AsyncStorage.removeItem(BARCODE_TIP_KEY);
    resetTipSeenForTests();
    // jest.setup.ts puts English back once the page has unmounted.
    setCurrentLanguage('is');
    useApi();
    await renderPage();
    const card = await screen.findByTestId('meal.barcode.privacy');
    expect(card).toHaveTextContent(translate('meal.barcode.privacy', 'is'), { exact: false });
    expect(card).toHaveTextContent(/IP-tala símans og útgáfa appsins/);
    expect(card).not.toHaveTextContent(/strikamerkisins og IP-tala/);
    expect(screen.getByText(translate('meal.barcode.hint', 'is'))).toBeOnTheScreen();
  });

  it('wants the same code in two frames, and looks a UPC-A up as the 13 digits iOS saves', async () => {
    const api = useApi();
    await renderPage();
    await act(async () => cameraDouble.showBarcode('upc_a', '042100005264'));
    expect(api.barcode).not.toHaveBeenCalled();
    await scan('upc_a', '042100005264');
    expect(api.barcode).toHaveBeenCalledWith('0042100005264', 'en');
    expect(offCalls).toEqual(['0042100005264']);
    expect(events).toContainEqual(['barcode_scanned', { source: 'camera' }]);
  });

  // testBarcodeModeStillScansAfterTheAppWasInactive: the camera goes with the app and comes back reading.
  it('lets the camera go in the background and reads again when the app is back', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    const api = useApi();
    await renderPage();
    expect(screen.getByTestId('meal.barcode.camera')).toBeOnTheScreen();
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(screen.queryByTestId('meal.barcode.camera')).toBeNull();
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(screen.getByTestId('meal.barcode.camera')).toBeOnTheScreen();
    await scan('ean8', '96385074');
    expect(api.barcode).toHaveBeenCalledWith('96385074', 'en');
  });

  it('looks nothing up for a code that cannot be one, and keeps reading', async () => {
    const api = useApi();
    await renderPage();
    await scan('upc_e', '24252614');
    expect(api.barcode).not.toHaveBeenCalled();
    await scan('ean13', CODE);
    expect(api.barcode).toHaveBeenCalledWith(CODE, 'en');
  });
});

describe('the result', () => {
  it('a product: the item editor with its per 100 g line and the attribution; Add puts it in the tray', async () => {
    offAnswer = { kind: 'found', snapshot: skyr, liquid: false };
    useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByText('Per 100 g: 76 kcal · 9.6 g protein · 8.1 g carbs · 0.2 g fat')).toBeOnTheScreen());
    expect(screen.getAllByText('View on Open Food Facts').length).toBeGreaterThan(0);
    expect(events).toContainEqual(['barcode_result', { outcome: 'off_found' }]);
    await act(async () => fireEvent.press(screen.getByText('Add to meal')));
    const tray = pageModel()?.state.tray ?? [];
    expect(tray).toHaveLength(1);
    expect(tray[0]).toMatchObject({ source: 'off', barcode: CODE, label: 'Skyr vanilla', amount: 1 });
    expect(pageModel()?.state.traySource).toBe('barcode');
    await waitFor(() => expect(screen.getByText('Added')).toBeOnTheScreen());
    expect(screen.getByText('Undo')).toBeOnTheScreen();
  });

  it("the member's own food: 'Your food'", async () => {
    serverAnswer = { food: choice(), origin: 'mine' };
    useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByText('Your food')).toBeOnTheScreen());
    expect(events).toContainEqual(['barcode_result', { outcome: 'mine_found' }]);
  });

  it('not found: Create my food, Quick add, Search instead, Scan again', async () => {
    useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByText("We couldn't find this product")).toBeOnTheScreen());
    expect(screen.getByText('Add it yourself from the label. It will be ready for next time.')).toBeOnTheScreen();
    expect(screen.getByTestId('meal.barcode.create')).toBeOnTheScreen();
    expect(screen.getByTestId('meal.barcode.quickAdd')).toBeOnTheScreen();
    expect(screen.getByTestId('meal.barcode.searchInstead')).toBeOnTheScreen();
    expect(screen.getByTestId('meal.barcode.scanAgain')).toBeOnTheScreen();
    expect(events).toContainEqual(['barcode_result', { outcome: 'not_found' }]);
  });

  it('Scan again closes the sheet and reads again a second later', async () => {
    const api = useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByTestId('meal.barcode.scanAgain')).toBeOnTheScreen());
    jest.useFakeTimers();
    try {
      await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.scanAgain')));
      // Still holding: the same packet is still in view.
      await scan('ean13', CODE);
      expect(api.barcode).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await scan('ean13', CODE);
      expect(api.barcode).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('no nutrition: Create my food prefilled with the name, and the attribution', async () => {
    offAnswer = { kind: 'noNutrition', name: 'Harðfiskur', brand: 'Eyjabiti' };
    useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByText('No nutrition facts for this product')).toBeOnTheScreen());
    expect(screen.getByTestId('meal.barcode.attribution')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.create')));
    await waitFor(() => expect(screen.getByDisplayValue('Harðfiskur')).toBeOnTheScreen());
    expect(screen.getByDisplayValue('Eyjabiti')).toBeOnTheScreen();
  });

  it('lookup failed: Try again asks both again', async () => {
    offAnswer = { kind: 'failed' };
    const api = useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByText("The product lookup isn't answering right now.")).toBeOnTheScreen());
    offAnswer = { kind: 'found', snapshot: skyr, liquid: false };
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.retry')));
    await waitFor(() => expect(screen.getByText('Add to meal')).toBeOnTheScreen());
    expect(api.barcode).toHaveBeenCalledTimes(2);
  });

  it('Search instead switches the page to Search', async () => {
    useApi();
    await renderPage();
    await scan('ean13', CODE);
    await waitFor(() => expect(screen.getByTestId('meal.barcode.searchInstead')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.searchInstead')));
    expect(pageModel()?.state.mode).toBe('search');
    expect(await AsyncStorage.getItem('meal.capture.lastMode')).toBe('search');
  });
});

describe('typing the number', () => {
  it('without the camera, only the typed panel shows', async () => {
    cameraDouble.reset(DENIED);
    useApi();
    await renderPage();
    expect(screen.getByTestId('meal.barcode.typedPanel')).toBeOnTheScreen();
    expect(screen.getByText('Barcode number')).toBeOnTheScreen();
    expect(screen.queryByTestId('meal.barcode.camera')).toBeNull();
  });

  it('wants 8, 12, 13 or 14 digits, then looks them up', async () => {
    const api = useApi();
    await renderPage();
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.type')));
    await act(async () => fireEvent.changeText(screen.getByTestId('meal.barcode.typedField'), '12345'));
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.lookup')));
    expect(screen.getByText('Barcodes have 8, 12, 13 or 14 digits.')).toBeOnTheScreen();
    expect(api.barcode).not.toHaveBeenCalled();
    await act(async () => fireEvent.changeText(screen.getByTestId('meal.barcode.typedField'), '5690 5272 8205 0'));
    expect(screen.queryByText('Barcodes have 8, 12, 13 or 14 digits.')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('meal.barcode.lookup')));
    expect(api.barcode).toHaveBeenCalledWith(CODE, 'en');
    expect(events).toContainEqual(['barcode_scanned', { source: 'typed' }]);
  });
});
