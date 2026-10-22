/**
 * Photo mode on the real meal page (MEAL-2's navigator, MEAL-4's draft
 * route), with the camera, the picker and the encoder's native half faked:
 * the port of iOS MealFlowsUITests' photo half and the screenshot fixtures'
 * phases (live, frozen, estimating, every error card, the tiny picked
 * photo).
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Text } from 'react-native';

import { ProblemError, type ApiError } from '../../../../api';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { dismissToast } from '../../../../components/ui/Toast';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import type { HealthDay } from '../../../../health/models';
import { resetMealGatePresenter } from '../../../../health/gate/mealGate';
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
import { myFoods, presets, signIn } from '../../capture/__tests__/mealFixtures';
import { resetFoodsCacheMemory } from '../../foodsCache';
import { base64FromBytes } from '../../imageEncoder/base64';
import { MealImageEncoderError, type EncodedMealImage, type MealImageCrop, type MealImageSource } from '../../imageEncoder/encoder';
import { cameraJpeg } from '../../imageEncoder/__tests__/fakePipeline';
import { mealRecord, photoItemJson } from '../../itemEditor/__tests__/fixtures';
import { resetMealOutboxForTests } from '../../outbox';
import type { MealScanBody, MealScanResult } from '../../types/models';
import { setPhotoEncoderForTests } from '../PhotoCaptureMode';
import { resetMealScanCoordinator } from '../scanCoordinator';
import { PHOTO_TIP_KEY, resetTipSeenForTests } from '../tipSeen';
import { cameraDouble, DENIED } from './cameraDouble';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
jest.mock('expo-camera', () => require('./cameraDouble').expoCameraModule);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../../describe', () => ({ openDescribe: jest.fn(), DescribeHost: () => null }));
jest.mock('../../../../health/consent/presenter', () => ({
  ...jest.requireActual('../../../../health/consent/presenter'),
  openHealthConsent: jest.fn(() => true),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30_000);

const pick = ImagePicker.launchImageLibraryAsync as jest.MockedFunction<typeof ImagePicker.launchImageLibraryAsync>;
const TODAY = todayServerDay();
const Root = createNativeStackNavigator<RootStackParamList>();

function Home() {
  return <Text>Home screen</Text>;
}

const encodings: { source: MealImageSource; crop: MealImageCrop }[] = [];
let encodeFailure: MealImageEncoderError | null = null;

function encoded(): EncodedMealImage {
  return { base64: base64FromBytes(cameraJpeg({ width: 1024, height: 1024 })), byteLength: 1000, pixelWidth: 1024, pixelHeight: 1024 };
}

const draft = () => mealRecord({ id: 'draft-1', items: [photoItemJson()], confirmed: false, source: 'photo', logDate: TODAY });

function answer(overrides: Partial<MealScanResult> = {}): MealScanResult {
  return { meal: draft(), noFood: false, needsConfirm: true, scansLeftToday: 4, replayed: false, ...overrides };
}

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

function useApi(overrides: Partial<MealApi>): MealApi {
  const api = fakeMealApi({
    presets: jest.fn(async () => presets()),
    myFoods: jest.fn(async () => myFoods()),
    meal: jest.fn(async () => draft()),
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
      mode: 'photo',
      date: TODAY,
      slot: 'lunch',
      ...params,
    });
  });
  // The page lays out (the guide is placed from the measured size).
  await act(async () => {
    fireEvent(screen.getByTestId('meal.photo'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 860 } } });
  });
}

function pageModel() {
  const route = navigationRef.getRootState().routes.find((entry) => entry.name === 'MealCapture');
  const key = route?.state?.key;
  return key ? capturePageFor(key) : null;
}

function currentMealRoute(): string | undefined {
  const route = navigationRef.getRootState().routes.find((entry) => entry.name === 'MealCapture');
  const state = route?.state;
  return state ? state.routes[state.index ?? 0]?.name : undefined;
}

async function shoot() {
  await act(async () => fireEvent.press(screen.getByTestId('meal.photo.shutter')));
  await waitFor(() => expect(screen.getByTestId('meal.photo.use')).toBeOnTheScreen());
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
  resetMealScanCoordinator();
  resetTipSeenForTests();
  await AsyncStorage.setItem(PHOTO_TIP_KEY, 'true');
  dismissToast();
  signIn();
  encodings.length = 0;
  encodeFailure = null;
  pick.mockReset();
  events = [];
  setAnalyticsObserver((event, params) => events.push([event, { ...params }]));
  setPhotoEncoderForTests(async (source, crop) => {
    encodings.push({ source, crop });
    if (encodeFailure) throw encodeFailure;
    return encoded();
  });
});

afterEach(async () => {
  setMealApi(null);
  setAnalyticsObserver(null);
  setPhotoEncoderForTests(null);
  await AsyncStorage.clear();
  await localStore.settled();
});

describe('live', () => {
  it('aims with a guide square and a hint, and opens the camera for photos', async () => {
    useApi({});
    await renderPage();
    // Drawn, and hidden from TalkBack (iOS `accessibilityHidden`).
    expect(screen.getByTestId('meal.photo.guide', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('meal.photo.guide')).toBeNull();
    expect(screen.getByText('Fit the whole plate in the frame')).toBeOnTheScreen();
    expect(screen.getByLabelText('Take photo')).toBeOnTheScreen();
    expect(screen.getByLabelText('Choose a photo')).toBeOnTheScreen();
    expect(cameraDouble.props?.barcodeScannerSettings).toBeUndefined();
    // The page's light, once the camera is open.
    expect(screen.getByTestId('meal.torch')).toBeOnTheScreen();
  });

  it('shows the first-use tip until OK, once per phone', async () => {
    await AsyncStorage.removeItem(PHOTO_TIP_KEY);
    resetTipSeenForTests();
    useApi({});
    await renderPage();
    await waitFor(() => expect(screen.getByText('One plate, from above, in good light. Keep people, screens and papers out of the photo.')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.tip.ok')));
    expect(screen.queryByTestId('meal.photo.tip')).toBeNull();
    expect(await AsyncStorage.getItem(PHOTO_TIP_KEY)).toBe('true');
  });

  it('says how many scans are left when three or fewer remain', async () => {
    useHealthStore.setState({ today: { meals: { scansLeftToday: 1 } } as unknown as HealthDay });
    useApi({});
    await renderPage();
    expect(screen.getByText('1 photo scan left today')).toBeOnTheScreen();
  });

  it('says nothing about scans while more than three remain', async () => {
    useHealthStore.setState({ today: { meals: { scansLeftToday: 5 } } as unknown as HealthDay });
    useApi({});
    await renderPage();
    expect(screen.queryByTestId('meal.photo.scansLeft')).toBeNull();
  });

  it('without the camera, offers the library and never asks for the camera', async () => {
    cameraDouble.reset(DENIED);
    useApi({});
    await renderPage();
    expect(screen.getByText('Camera access is off. You can still choose a photo.')).toBeOnTheScreen();
    expect(screen.queryByTestId('meal.photo.camera')).toBeNull();
    pick.mockResolvedValueOnce({ canceled: true, assets: null });
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.panelLibrary')));
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], exif: false }));
  });
});

describe('a photo, start to finish', () => {
  it('crops a shot to the guide, freezes it, sends it with one key and opens the draft', async () => {
    const scan = jest.fn(async (_body: MealScanBody, _key: string) => answer());
    useApi({ scan });
    await renderPage();
    await shoot();

    // A bitmap in memory, cropped to what the member aimed with, and let go.
    expect(cameraDouble.shots[0]).toEqual(expect.objectContaining({ pictureRef: true, exif: false }));
    expect(encodings[0]?.source.kind).toBe('ref');
    expect(encodings[0]?.crop).toEqual(expect.objectContaining({ kind: 'guide', view: { width: 400, height: 860 } }));
    expect(cameraDouble.pictures[0]?.released).toBe(true);
    expect(events).toContainEqual(['meal_photo_taken', { source: 'camera' }]);
    expect(screen.getByLabelText('The photo that will be sent')).toBeOnTheScreen();
    expect(screen.getByText('Retake')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await waitFor(() => expect(currentMealRoute()).toBe('Draft'));
    expect(scan).toHaveBeenCalledTimes(1);
    const [body, key] = scan.mock.calls[0]!;
    expect(body).toEqual(expect.objectContaining({ slot: 'lunch', logDate: TODAY, image: { mediaType: 'image/jpeg', dataBase64: encoded().base64 } }));
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(pageModel()?.state.drafts['draft-1']?.id).toBe('draft-1');
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'ok' }]);
  });

  it('keeps a picked photo whole and drops the picked copy once read', async () => {
    useApi({});
    pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/one.jpeg', width: 3000, height: 2000 } as never] });
    await renderPage();
    await act(async () => fireEvent.press(screen.getByLabelText('Choose a photo')));
    await waitFor(() => expect(screen.getByTestId('meal.photo.use')).toBeOnTheScreen());
    expect(encodings[0]).toEqual({ source: { kind: 'uri', uri: 'file:///cache/ImagePicker/one.jpeg', dropAfterLoad: true }, crop: { kind: 'none' } });
    expect(events).toContainEqual(['meal_photo_taken', { source: 'library' }]);
  });

  it('Retake goes back to the camera', async () => {
    useApi({});
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.retake')));
    expect(screen.getByTestId('meal.photo.guide', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('meal.photo.frozen')).toBeNull();
  });
});

describe('the estimate', () => {
  function heldScan() {
    const calls: { key: string; resolve: (value: MealScanResult) => void; reject: (error: unknown) => void }[] = [];
    const scan = jest.fn(
      (_body: MealScanBody, key: string) =>
        new Promise<MealScanResult>((resolve, reject) => {
          calls.push({ key, resolve, reject });
        }),
    );
    return { scan, calls };
  }

  it('shows the estimating card with Cancel and Keep going', async () => {
    const { scan } = heldScan();
    useApi({ scan });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    expect(screen.getByText("Estimating what's on the plate")).toBeOnTheScreen();
    expect(screen.getByText('Cancel')).toBeOnTheScreen();
    expect(screen.getByText('Keep going')).toBeOnTheScreen();
  });

  it('Cancel goes back to the frozen photo, deletes a late draft, and a new Use photo has a new key', async () => {
    const { scan, calls } = heldScan();
    const deleteMeal = jest.fn(async () => undefined);
    useApi({ scan, deleteMeal });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.cancel')));
    expect(screen.getByTestId('meal.photo.use')).toBeOnTheScreen();
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'cancelled' }]);
    await act(async () => calls[0]!.resolve(answer()));
    await waitFor(() => expect(deleteMeal).toHaveBeenCalledWith('draft-1'));
    expect(currentMealRoute()).toBe('Capture');

    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it('Keep going closes the page; the answer comes back as a toast', async () => {
    const { scan, calls } = heldScan();
    useApi({ scan });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.keepGoing')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'kept_going' }]);
    await act(async () => calls[0]!.resolve(answer()));
  });

  it('reuses the key for Try again after an upstream failure, and says what it costs', async () => {
    const { scan, calls } = heldScan();
    useApi({ scan });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await act(async () => calls[0]!.reject(problem('coach_upstream_error', 502)));
    await waitFor(() => expect(screen.getByText("We couldn't estimate this photo right now.")).toBeOnTheScreen());
    expect(screen.getByText("Trying again uses one of today's photo scans.")).toBeOnTheScreen();
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'upstream' }]);
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.action.tryAgain')));
    expect(calls[1]!.key).toBe(calls[0]!.key);
  });
});

describe('the error cards', () => {
  it.each([
    ['meal-scan-daily-limit', 429, "You've used today's photo scans. Search or scan a barcode instead.", ['search', 'barcode']],
    ['meal_scan_paused', 503, 'Photo estimates are paused for now. Search or scan a barcode instead.', ['search', 'barcode']],
    ['health_meal_deleted', 409, "This estimate was deleted, so it wasn't made again. Take a new photo or search instead.", ['retake', 'search']],
    ['meal_image_unsupported', 415, "That photo format isn't supported.", ['chooseOther', 'retake']],
  ] as const)('%s (%i)', async (slug, status, copy, actions) => {
    useApi({
      scan: async () => {
        throw problem(slug, status);
      },
    });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await waitFor(() => expect(screen.getByText(copy)).toBeOnTheScreen());
    for (const action of actions) expect(screen.getByTestId(`meal.photo.action.${action}`)).toBeOnTheScreen();
  });

  it('no food: Retake or Search', async () => {
    useApi({ scan: async () => answer({ meal: null, noFood: true }) });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await waitFor(() => expect(screen.getByText("We couldn't see any food in this photo.")).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.action.search')));
    expect(pageModel()?.state.mode).toBe('search');
    expect(await AsyncStorage.getItem('meal.capture.lastMode')).toBe('search');
  });

  it('Barcode on a spent allowance switches to Barcode', async () => {
    useApi({
      scan: async () => {
        throw problem('meal-scan-daily-limit', 429);
      },
    });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await waitFor(() => expect(screen.getByTestId('meal.photo.action.barcode')).toBeOnTheScreen());
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.action.barcode')));
    expect(pageModel()?.state.mode).toBe('barcode');
  });

  // A sticker or a picture saved out of a chat: told the true thing, and no scan is spent.
  it('a picked photo too small to read says so and spends no scan', async () => {
    const scan = jest.fn();
    useApi({ scan });
    encodeFailure = new MealImageEncoderError('tooSmall');
    pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/sticker.png', width: 40, height: 40 } as never] });
    await renderPage();
    await act(async () => fireEvent.press(screen.getByLabelText('Choose a photo')));
    await waitFor(() => expect(screen.getByText('That photo is too small to read. Pick a bigger one or take a new photo.')).toBeOnTheScreen());
    expect(screen.getByTestId('meal.photo.action.chooseOther')).toBeOnTheScreen();
    expect(scan).not.toHaveBeenCalled();
  });

  it('a photo even the smallest encoding cannot fit is too large', async () => {
    useApi({});
    encodeFailure = new MealImageEncoderError('tooLarge');
    await renderPage();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.shutter')));
    await waitFor(() => expect(screen.getByText('That photo is too large to send. Try another one or search instead.')).toBeOnTheScreen());
  });

  it('a membership wall closes the page for the gate', async () => {
    useApi({
      scan: async () => {
        throw problem('no_active_plan_or_pass', 403);
      },
    });
    await renderPage();
    await shoot();
    await act(async () => fireEvent.press(screen.getByTestId('meal.photo.use')));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeOnTheScreen());
  });
});
