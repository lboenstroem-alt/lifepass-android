/**
 * The camera-first Scan tab on screen (iOS CheckInView, CheckInScanTests'
 * screen half and the plan's CHECKIN-1 acceptance): the camera states, the
 * QR rules through a real render, the rescan capsule, pushed mode, the person
 * button, where the walk-in host sits, the dark tab bar, and check-in links.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, type NavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { createRef, useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Linking, Pressable, Text, type AppStateStatus } from 'react-native';

import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { haptics } from '../../../../lib/haptics';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import CheckInScanView, { FOREIGN_CHIP_MS } from '../CheckInScanView';
import { resetForeignReportForTests } from '../qrRead';
import { PAUSED_AFTER_MS } from '../useScanCamera';
import {
  cameraDouble,
  DENIED,
  DENIED_ASK_AGAIN,
  flowDouble,
  GRANTED,
  resetCameraDouble,
  resetFlowDouble,
  UNDETERMINED,
} from './scanDoubles';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-camera', () => require('./scanDoubles').expoCameraModule);
jest.mock('../../walkin', () => require('./scanDoubles').walkInModule);
jest.mock('../../../meals/ScanMealEntry', () => require('./scanDoubles').mealEntryModule);
/* eslint-enable @typescript-eslint/no-require-imports */

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';
const VENUE_URL = `https://lifepass.is/scan?v=${VENUE}`;
const FOREIGN_URL = 'https://example.com/menu?table=7';
const STAFF_CODE = `{"type":"booking_checkin","id":"${VENUE}"}`;

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ScanTabRoot() {
  return <CheckInScanView pushed={false} />;
}
function ScanPushedRoot() {
  return <CheckInScanView pushed />;
}
function Venue({ navigation }: { navigation: { navigate(name: string): void } }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ScanPushed')}>
      <Text>Scan QR</Text>
    </Pressable>
  );
}
function ProfileStandIn() {
  return <Text>Profile screen</Text>;
}
function HomeStandIn() {
  return <Text>Home screen</Text>;
}

function ScanStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ScanMain" component={ScanTabRoot} />
      <Stack.Screen name="Profile" component={ProfileStandIn} />
    </Stack.Navigator>
  );
}
function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeStandIn} />
      <Stack.Screen name="VenueDetail" component={Venue} />
      <Stack.Screen name="ScanPushed" component={ScanPushedRoot} />
      <Stack.Screen name="Profile" component={ProfileStandIn} />
    </Stack.Navigator>
  );
}

const navigationRef = createRef<NavigationContainerRef<ParamListBase>>();

/**
 * Stands where the tabs shell stands: a parent of every screen, whose mount
 * effect runs after theirs and asks whether a venue is still parked
 * (src/navigation/TabNavigator.tsx `TabsLayout`).
 */
function ShellProbe({ children, onMount }: { children: ReactNode; onMount?: () => void }) {
  useEffect(() => {
    onMount?.();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return children;
}

async function renderApp(initialTab: 'Scan' | 'Home' = 'Scan', onShellMount?: () => void) {
  await render(
    <NavigationContainer ref={navigationRef}>
      <ShellProbe onMount={onShellMount}>
        <Tabs.Navigator initialRouteName={initialTab} screenOptions={{ headerShown: false }} tabBar={() => null}>
          <Tabs.Screen name="Home" component={HomeStack} />
          <Tabs.Screen name="Scan" component={ScanStack} />
        </Tabs.Navigator>
      </ShellProbe>
    </NavigationContainer>,
  );
  await act(async () => undefined);
}

/** The scanner on screen measures its region (Jest has no layout pass). */
async function layOut(testID = 'scan.region') {
  for (const region of screen.getAllByTestId(testID)) {
    await fireEvent(region, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 640 } } });
  }
}

/** One camera frame carrying `payload`, as CameraX hands it over. */
async function frame(payload: string) {
  const camera = screen.getByTestId('scan.camera');
  const handler = camera.props.onBarcodeScanned as ((r: { data: string; type: string }) => void) | undefined;
  if (!handler) return false;
  await act(async () => handler({ data: payload, type: 'qr' }));
  return true;
}

/** The next turn of the event loop: a parked venue is taken there (after the shell's effects). */
async function nextTurn() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const events: [string, AnalyticsParams][] = [];
let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  resetCameraDouble(GRANTED);
  resetFlowDouble();
  resetIntentStoreForTests();
  resetForeignReportForTests();
  events.length = 0;
  setAnalyticsObserver((event, params) => events.push([event, params]));
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  setAnalyticsObserver(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the camera', () => {
  it('is live while the tab is selected: viewfinder, reticle, hint, dark tab bar, scan_tab_viewed', async () => {
    await renderApp();
    await layOut();
    expect(screen.getByRole('header', { name: 'WALK-IN CHECK-IN' })).toBeOnTheScreen();
    expect(screen.getByText('SCAN A VENUE QR')).toBeOnTheScreen();
    expect(screen.getByTestId('scan.camera')).toBeOnTheScreen();
    expect(screen.getByRole('image', { name: 'Point at the LifePass code at the venue' })).toBeOnTheScreen();
    expect(useIntentStore.getState().scanCameraLive).toBe(true);
    expect(events).toContainEqual(['scan_tab_viewed', { camera: 'authorized', mode: 'tab' }]);
  });

  it('is released when the member leaves the tab, and the bar goes back to paper', async () => {
    await renderApp();
    await layOut();
    await act(async () => navigationRef.current?.navigate('Home'));
    expect(screen.queryByTestId('scan.camera')).toBeNull();
    expect(useIntentStore.getState().scanCameraLive).toBe(false);
    await act(async () => navigationRef.current?.navigate('Scan'));
    await layOut();
    expect(screen.getByTestId('scan.camera')).toBeOnTheScreen();
    expect(useIntentStore.getState().scanCameraLive).toBe(true);
  });

  it('is released while the app is in the background', async () => {
    await renderApp();
    await layOut();
    await act(async () => appStateListener?.('background'));
    expect(screen.queryByTestId('scan.camera')).toBeNull();
    expect(useIntentStore.getState().scanCameraLive).toBe(false);
    await act(async () => appStateListener?.('active'));
    expect(screen.getByTestId('scan.camera')).toBeOnTheScreen();
  });

  it('not determined: "Ready to scan", and Open Scanner asks; a yes is the live viewfinder', async () => {
    resetCameraDouble(UNDETERMINED);
    await renderApp();
    await layOut();
    expect(screen.getByText('Ready to scan')).toBeOnTheScreen();
    expect(screen.queryByTestId('scan.camera')).toBeNull();
    expect(events).toContainEqual(['scan_tab_viewed', { camera: 'not_determined', mode: 'tab' }]);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Scanner' }));
    expect(cameraDouble.getState().requests).toBe(1);
    expect(screen.getByTestId('scan.camera')).toBeOnTheScreen();
  });

  it('a first "Don\'t allow" that Android will still ask again keeps the Open Scanner card', async () => {
    resetCameraDouble(DENIED_ASK_AGAIN);
    await renderApp();
    expect(screen.getByRole('button', { name: 'Open Scanner' })).toBeOnTheScreen();
  });

  it('denied: "Camera access is off", meals by search, and Open Settings', async () => {
    resetCameraDouble(DENIED);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderApp();
    expect(screen.getByText('Camera access is off')).toBeOnTheScreen();
    expect(screen.getByText(/You can still log meals by search/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(['scan_tab_viewed', { camera: 'denied', mode: 'tab' }]);
  });

  it('a permission changed in Settings is read again when the member comes back', async () => {
    resetCameraDouble(DENIED);
    await renderApp();
    const reads = cameraDouble.getState().reads;
    await act(async () => appStateListener?.('background'));
    // Turned on in Settings: the screen only knows once it reads it again.
    cameraDouble.setState({ system: GRANTED });
    expect(screen.getByText('Camera access is off')).toBeOnTheScreen();
    await act(async () => appStateListener?.('active'));
    expect(cameraDouble.getState().reads).toBeGreaterThan(reads);
    await layOut();
    expect(screen.getByTestId('scan.camera')).toBeOnTheScreen();
  });

  it('unavailable: no back camera to bind', async () => {
    await renderApp();
    await layOut();
    await act(async () => (screen.getByTestId('scan.camera').props.onMountError as () => void)());
    expect(screen.getByText("The camera isn't available on this device.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  it('says "Camera paused" while the viewfinder waits for a camera another app holds', async () => {
    jest.useFakeTimers();
    await renderApp();
    await layOut();
    expect(screen.queryByText('Camera paused')).toBeNull();
    await act(async () => jest.advanceTimersByTime(PAUSED_AFTER_MS));
    expect(screen.getByText('Camera paused')).toBeOnTheScreen();
    await act(async () => (screen.getByTestId('scan.camera').props.onCameraReady as () => void)());
    expect(screen.queryByText('Camera paused')).toBeNull();
  });
});

describe('QR reads on screen', () => {
  it('a foreign code raises no alert and does not lock; the same code after 3 s chips for 2 s', async () => {
    jest.useFakeTimers();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await renderApp();
    await layOut();
    await act(async () => (screen.getByTestId('scan.camera').props.onCameraReady as () => void)());
    expect(await frame(FOREIGN_URL)).toBe(true);
    expect(screen.queryByText('Error')).toBeNull();
    expect(screen.queryByText('Not a LifePass code')).toBeNull();
    await act(async () => jest.advanceTimersByTime(3_200));
    expect(await frame(FOREIGN_URL)).toBe(true);
    expect(screen.getByText('Not a LifePass code')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Not a LifePass code');
    await act(async () => jest.advanceTimersByTime(FOREIGN_CHIP_MS));
    expect(screen.queryByText('Not a LifePass code')).toBeNull();
    // Never locked: the camera still hands codes over.
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeDefined();
  });

  it('a venue code starts the walk-in once with a haptic and "Processing…", then locks', async () => {
    const impact = jest.spyOn(haptics, 'impact').mockImplementation(() => undefined);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await renderApp();
    await layOut();
    await frame(VENUE_URL);
    expect(flowDouble.getState().starts).toEqual([[VENUE, { fromLink: false }]]);
    expect(impact).toHaveBeenCalledWith('medium');
    expect(announce).toHaveBeenCalledWith('Processing…');
    // Locked: CameraX stops handing codes over, and a phone still pointing at
    // the poster never starts a second walk-in by itself.
    expect(await frame(VENUE_URL)).toBe(false);
    expect(flowDouble.getState().starts).toHaveLength(1);
  });

  it('a staff code alerts and locks; once the flow is idle "Scan another code" resumes', async () => {
    await renderApp();
    await layOut();
    await frame(STAFF_CODE);
    expect(screen.getByText('This QR code is for venue staff, not check-in.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Scan another code' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    const rescan = screen.getByRole('button', { name: 'Scan another code' });
    await fireEvent.press(rescan);
    expect(events.map(([event]) => event)).toContain('qr_rescan_tapped');
    expect(screen.queryByRole('button', { name: 'Scan another code' })).toBeNull();
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeDefined();
  });

  it('the capsule waits while anything of the walk-in is on screen, and the reticle dims under it', async () => {
    await renderApp();
    await layOut();
    await act(async () => flowDouble.setState({ isIdle: false }));
    await frame(VENUE_URL);
    expect(screen.queryByRole('button', { name: 'Scan another code' })).toBeNull();
    await act(async () => flowDouble.setState({ isIdle: true }));
    expect(screen.getByRole('button', { name: 'Scan another code' })).toBeOnTheScreen();
    // The hint gives way to the capsule.
    expect(screen.queryByText('Point at the LifePass code at the venue')).toBeNull();
  });

  it('a walk-in in hand locks the QR, however it started (the flow is shared with the pushed scanner)', async () => {
    await renderApp();
    await layOut();
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeDefined();
    await act(async () => flowDouble.setState({ isIdle: false }));
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeUndefined();
    // Done with it: the member asks for the next read.
    await act(async () => flowDouble.setState({ isIdle: true }));
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Scan another code' })).toBeOnTheScreen();
  });
});

describe('the bar and the meal entry', () => {
  it('the person button opens Profile, and is disabled, not hidden, mid walk-in', async () => {
    await renderApp();
    await layOut();
    await act(async () => flowDouble.setState({ isIdle: false }));
    const person = screen.getByRole('button', { name: 'Open profile: bookings and saved' });
    expect(person).toBeDisabled();
    expect(screen.getByTestId('meal.entry').props.accessibilityState).toEqual({ disabled: true });
    await act(async () => flowDouble.setState({ isIdle: true }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile: bookings and saved' }));
    expect(screen.getByText('Profile screen')).toBeOnTheScreen();
    expect(events).toContainEqual(['profile_opened', { entry: 'scan' }]);
  });

  it('the tab shows the meal entry and mounts the walk-in host over the camera region', async () => {
    await renderApp();
    expect(screen.getByTestId('meal.entry')).toBeOnTheScreen();
    // The host's "Processing…" veil fills its parent: the region, never the bar.
    const region = screen.getByTestId('scan.region');
    expect(within(region).getByTestId('walkin.host')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('pushed from a venue', () => {
  async function openPushed() {
    await renderApp('Home');
    await act(async () => navigationRef.current?.navigate('Home', { screen: 'VenueDetail' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Scan QR' }));
    await layOut();
  }

  it('has a back arrow, no meal entry, and says it was pushed', async () => {
    await openPushed();
    expect(screen.getByTestId('scan.pushed')).toBeOnTheScreen();
    expect(screen.queryByTestId('meal.entry')).toBeNull();
    expect(events).toContainEqual(['scan_tab_viewed', { camera: 'authorized', mode: 'pushed' }]);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Scan QR' })).toBeOnTheScreen();
  });

  it('explains every refusal, a foreign code included', async () => {
    await openPushed();
    await frame(FOREIGN_URL);
    expect(screen.getByText("That doesn't look like a LifePass venue code.")).toBeOnTheScreen();
  });

  it('leaves a parked link to the Scan tab', async () => {
    await openPushed();
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    await nextTurn();
    expect(flowDouble.getState().starts).toEqual([]);
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
  });
});

describe('check-in links', () => {
  it('a parked venue is taken once and asked about: startWalkIn(fromLink: true)', async () => {
    useIntentStore.getState().parkScanVenue(VENUE);
    // Not in the commit that mounted the scanner: the tabs shell, whose
    // first-appearance effect runs after the scanner's, still has to see it
    // parked when it decides its tab (or it switches away from Scan).
    let parkedWhenTheShellLooked: string | null = null;
    await renderApp('Scan', () => {
      parkedWhenTheShellLooked = useIntentStore.getState().pendingScanVenueId;
    });
    expect(parkedWhenTheShellLooked).toBe(VENUE);
    await nextTurn();
    expect(flowDouble.getState().starts).toEqual([[VENUE, { fromLink: true }]]);
    expect(useIntentStore.getState().pendingScanVenueId).toBeNull();
    await nextTurn();
    expect(flowDouble.getState().starts).toHaveLength(1);
  });

  it('a link that arrives on the tab locks the QR, so the camera cannot start a second walk-in', async () => {
    await renderApp();
    await layOut();
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    await nextTurn();
    expect(flowDouble.getState().starts).toEqual([[VENUE, { fromLink: true }]]);
    expect(screen.getByTestId('scan.camera').props.onBarcodeScanned).toBeUndefined();
  });

  it('a link that arrives over Profile on the Scan tab brings the scanner back first', async () => {
    await renderApp();
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile: bookings and saved' }));
    expect(screen.getByText('Profile screen')).toBeOnTheScreen();
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    await nextTurn();
    expect(screen.queryByText('Profile screen')).toBeNull();
    expect(flowDouble.getState().starts).toEqual([[VENUE, { fromLink: true }]]);
  });

  it('waits while another tab is on screen, and is taken when the Scan tab comes forward', async () => {
    await renderApp('Home');
    await act(async () => {
      useIntentStore.getState().parkScanVenue(VENUE);
    });
    await nextTurn();
    // Nothing yet: the tabs shell (not this test) switches to Scan.
    expect(flowDouble.getState().starts).toEqual([]);
    await act(async () => navigationRef.current?.navigate('Scan'));
    await nextTurn();
    expect(flowDouble.getState().starts).toEqual([[VENUE, { fromLink: true }]]);
  });

  it('is not taken by a scanner that left the screen before its turn came', async () => {
    useIntentStore.getState().parkScanVenue(VENUE);
    await renderApp();
    await act(async () => navigationRef.current?.navigate('Home'));
    await nextTurn();
    expect(flowDouble.getState().starts).toEqual([]);
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
  });
});
