/**
 * The location store (iOS LocationService): reading never prompts, the
 * dialog is shown at most once, only a granted fix orders anything, and the
 * app's lifecycle re-reads the permission and starts new browse visits.
 */
import * as Location from 'expo-location';

import { REYKJAVIK_CENTRE } from '../../lib/geo';
import { createBrowseSession, VISIT_GAP_MS } from '../browseSession';
import {
  createLocationStore,
  expoLocationPlatform,
  MAX_FIX_AGE_MS,
  selectEffectiveLocation,
  selectGrantedLocation,
  selectLocationOff,
  startLocationAtLaunch,
  startLocationLifecycle,
  type LocationFix,
  type LocationPermission,
  type LocationPlatform,
  type PermissionSnapshot,
} from '../locationStore';

// The real module's enums and types, with the three calls the store makes as fakes.
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const NOW = 1_790_000_000_000;
const reykjavikFix: LocationFix = { latitude: 64.1466, longitude: -21.9426, accuracy: 35, timestamp: NOW - 1_000 };
const akureyriFix: LocationFix = { latitude: 65.6839, longitude: -18.0906, accuracy: 35, timestamp: NOW - 1_000 };

/** A phone: what the permission is, what the dialog answers, what fix it gives. */
class FakePhone implements LocationPlatform {
  permission: LocationPermission = 'undetermined';
  /** What the member taps in the dialog. */
  answer: LocationPermission = 'granted';
  approximate = false;
  fix: LocationFix | Error = reykjavikFix;
  reads = 0;
  prompts = 0;
  fixes = 0;

  private snapshot(): PermissionSnapshot {
    return {
      permission: this.permission,
      canAskAgain: this.permission !== 'denied',
      approximate: this.approximate,
    };
  }

  async getPermission() {
    this.reads += 1;
    return this.snapshot();
  }

  async requestPermission() {
    this.prompts += 1;
    // Android shows the dialog only while it still may.
    if (this.permission === 'undetermined') this.permission = this.answer;
    return this.snapshot();
  }

  async currentFix() {
    this.fixes += 1;
    if (this.fix instanceof Error) throw this.fix;
    return this.fix;
  }
}

function setup(phone = new FakePhone()) {
  const session = createBrowseSession({ seed: 7 });
  const store = createLocationStore({ platform: phone, session, now: () => NOW });
  return { phone, session, store };
}

it('reading the permission never prompts', async () => {
  const { phone, store } = setup();
  await store.getState().refreshPermission();
  await store.getState().refreshIfAuthorized();
  expect(phone.reads).toBe(1);
  expect(phone.prompts).toBe(0);
  expect(phone.fixes).toBe(0);
  expect(store.getState()).toMatchObject({ permission: 'undetermined', permissionKnown: true });
  expect(selectLocationOff(store.getState())).toBe(false);
});

it('asks once, and a granted fix reaches the browse order', async () => {
  const { phone, session, store } = setup();
  await store.getState().requestLocation();
  expect(phone.prompts).toBe(1);
  expect(phone.fixes).toBe(1);
  expect(selectGrantedLocation(store.getState())).toEqual(reykjavikFix);
  expect(session.getState().origin).toEqual(reykjavikFix);

  // Asking again only refreshes the fix: no second dialog.
  phone.fix = akureyriFix;
  await store.getState().requestLocation();
  expect(phone.prompts).toBe(1);
  expect(phone.fixes).toBe(2);
  expect(selectGrantedLocation(store.getState())).toEqual(akureyriFix);
  expect(session.getState().origin).toEqual(akureyriFix); // a real move re-bands
});

/** Once the member has said no, the app never asks again (iOS cannot; Android could, and must not). */
it('a member who said no is never asked again', async () => {
  const phone = new FakePhone();
  phone.answer = 'denied';
  const { store, session } = setup(phone);
  await store.getState().requestLocation();
  await store.getState().requestLocation();
  await store.getState().requestLocation();
  expect(phone.prompts).toBe(1);
  expect(phone.fixes).toBe(0);
  expect(selectGrantedLocation(store.getState())).toBeNull();
  expect(selectLocationOff(store.getState())).toBe(true); // the Explore banner shows
  expect(session.getState().origin).toBeNull();
});

it('two callers at once share one dialog', async () => {
  const { phone, store } = setup();
  await Promise.all([store.getState().requestLocation(), store.getState().requestLocation()]);
  expect(phone.prompts).toBe(1);
});

it('a fix older than a minute is ignored', async () => {
  const phone = new FakePhone();
  phone.permission = 'granted';
  phone.fix = { ...reykjavikFix, timestamp: NOW - MAX_FIX_AGE_MS };
  const { store, session } = setup(phone);
  await store.getState().refreshIfAuthorized();
  await store.getState().refreshPermission();
  expect(phone.fixes).toBeGreaterThanOrEqual(1);
  expect(store.getState().currentLocation).toBeNull();
  expect(session.getState().origin).toBeNull();

  phone.fix = { ...reykjavikFix, timestamp: NOW - MAX_FIX_AGE_MS + 1 };
  await store.getState().refreshIfAuthorized();
  expect(store.getState().currentLocation).toEqual(phone.fix);
});

it('a failed fix is silent', async () => {
  const phone = new FakePhone();
  phone.permission = 'granted';
  phone.fix = new Error('Current location is unavailable');
  const { store } = setup(phone);
  await expect(store.getState().requestLocation()).resolves.toBeUndefined();
  expect(store.getState().currentLocation).toBeNull();
});

it('a fix that never comes stops being waited for', async () => {
  jest.useFakeTimers();
  try {
    const phone = new FakePhone();
    phone.permission = 'granted';
    const pending = new Promise<LocationFix>(() => undefined);
    phone.currentFix = () => pending;
    const session = createBrowseSession({ seed: 7 });
    const store = createLocationStore({ platform: phone, session, now: () => NOW, fixTimeoutMs: 1_000 });
    let done = false;
    void store
      .getState()
      .refreshPermission()
      .then(() => {
        done = true;
      });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(done).toBe(true);
    expect(store.getState().currentLocation).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

/**
 * Only a fix with permission granted NOW counts. Taken away in Settings, the
 * fix stops ordering lists at once; the filters keep their last measuring
 * point, as iOS's `effectiveLocation` does.
 */
it('a revoked permission takes the fix out of the browse order', async () => {
  const { phone, session, store } = setup();
  await store.getState().requestLocation();
  expect(session.getState().origin).toEqual(reykjavikFix);

  phone.permission = 'denied';
  await store.getState().refreshPermission();
  expect(selectGrantedLocation(store.getState())).toBeNull();
  expect(session.getState().origin).toBeNull();
  expect(selectLocationOff(store.getState())).toBe(true);
  expect(selectEffectiveLocation(store.getState())).toEqual(reykjavikFix);
});

it('the effective location falls back to Reykjavík centre, never null', () => {
  const { store } = setup();
  expect(selectEffectiveLocation(store.getState())).toBe(REYKJAVIK_CENTRE);
});

it('an approximate grant still counts as granted', async () => {
  const phone = new FakePhone();
  phone.approximate = true;
  const { store } = setup(phone);
  await store.getState().requestLocation();
  expect(store.getState()).toMatchObject({ permission: 'granted', approximate: true });
  expect(selectGrantedLocation(store.getState())).toEqual(reykjavikFix);
});

it('the granted fix keeps its identity between renders', async () => {
  const { store } = setup();
  await store.getState().requestLocation();
  expect(selectGrantedLocation(store.getState())).toBe(selectGrantedLocation(store.getState()));
});

describe('the lifecycle', () => {
  /** An AppState that the test drives. */
  function fakeAppState() {
    const listeners: ((state: 'active' | 'background') => void)[] = [];
    return {
      currentState: 'active' as const,
      addEventListener: (_type: 'change', listener: (state: 'active' | 'background') => void) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      },
      emit: (state: 'active' | 'background') => listeners.forEach((listener) => listener(state)),
      get count() {
        return listeners.length;
      },
    };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('reads the permission at start without prompting', async () => {
    const phone = new FakePhone();
    const session = createBrowseSession({ seed: 7 });
    const location = createLocationStore({ platform: phone, session, now: () => NOW });
    const appState = fakeAppState();
    const stop = startLocationLifecycle({ appState, location, session, now: () => NOW });
    await flush();
    expect(phone.reads).toBe(1);
    expect(phone.prompts).toBe(0);
    stop();
    expect(appState.count).toBe(0);
  });

  /** The member turns location on in Settings and comes back: the banner goes and the fix comes in. */
  it('coming back from Settings re-reads the permission', async () => {
    const phone = new FakePhone();
    phone.permission = 'denied';
    const session = createBrowseSession({ seed: 7 });
    const location = createLocationStore({ platform: phone, session, now: () => NOW });
    const appState = fakeAppState();
    const stop = startLocationLifecycle({ appState, location, session, now: () => NOW });
    await flush();
    expect(selectLocationOff(location.getState())).toBe(true);

    phone.permission = 'granted';
    appState.emit('background');
    appState.emit('active');
    await flush();
    await flush();
    expect(selectLocationOff(location.getState())).toBe(false);
    expect(selectGrantedLocation(location.getState())).toEqual(reykjavikFix);
    expect(session.getState().origin).toEqual(reykjavikFix);
    expect(phone.prompts).toBe(0);
    stop();
  });

  it('half an hour away is a new visit with a fresh fix; less is not', async () => {
    const phone = new FakePhone();
    phone.permission = 'granted';
    let clock = NOW;
    const draws = [1001];
    const session = createBrowseSession({ seed: 7, drawSeed: () => draws.shift() ?? 0 });
    const location = createLocationStore({ platform: phone, session, now: () => clock });
    const appState = fakeAppState();
    const stop = startLocationLifecycle({ appState, location, session, now: () => clock });
    await flush();
    const fixesAtStart = phone.fixes;

    appState.emit('background');
    clock += VISIT_GAP_MS - 1;
    appState.emit('active');
    await flush();
    expect(session.getState().seed).toBe(7);
    expect(phone.fixes).toBe(fixesAtStart);

    appState.emit('background');
    clock += VISIT_GAP_MS;
    phone.fix = { ...akureyriFix, timestamp: clock - 1_000 };
    appState.emit('active');
    await flush();
    await flush();
    expect(session.getState().seed).toBe(1001);
    expect(phone.fixes).toBe(fixesAtStart + 1);
    expect(session.getState().origin).toEqual(phone.fix);
    stop();
  });

  it('launch asks once, while the member has not decided, and never again', async () => {
    const phone = new FakePhone();
    phone.answer = 'denied';
    const session = createBrowseSession({ seed: 7 });
    const location = createLocationStore({ platform: phone, session, now: () => NOW });
    const appState = fakeAppState();
    const stop = startLocationAtLaunch({ appState, location, session, now: () => NOW });
    await flush();
    await flush();
    expect(phone.prompts).toBe(1);
    // "Don't allow" shows the banner at once, and nothing orders by a fix.
    expect(selectLocationOff(location.getState())).toBe(true);
    expect(session.getState().origin).toBeNull();
    stop();

    // The next launch: the member has decided, so no dialog.
    const relaunch = startLocationAtLaunch({ appState, location, session, now: () => NOW });
    await flush();
    await flush();
    expect(phone.prompts).toBe(1);
    relaunch();
    expect(appState.count).toBe(0);
  });

  it('launch with location allowed brings the first fix to the browse order', async () => {
    const phone = new FakePhone();
    phone.permission = 'granted';
    const session = createBrowseSession({ seed: 7 });
    const location = createLocationStore({ platform: phone, session, now: () => NOW });
    const stop = startLocationAtLaunch({ appState: fakeAppState(), location, session, now: () => NOW });
    await flush();
    await flush();
    expect(phone.prompts).toBe(0);
    expect(phone.fixes).toBe(1);
    expect(session.getState().origin).toEqual(reykjavikFix);
    stop();
  });

  it('the shared wiring starts once', () => {
    const first = startLocationLifecycle();
    expect(startLocationLifecycle()).toBe(first);
    first();
    const again = startLocationLifecycle();
    expect(again).not.toBe(first);
    again();
  });
});

describe('expo-location', () => {
  const response = (status: Location.PermissionStatus, accuracy?: 'fine' | 'coarse' | 'none') =>
    ({
      status,
      granted: status === Location.PermissionStatus.GRANTED,
      canAskAgain: status !== Location.PermissionStatus.DENIED,
      expires: 'never',
      android: accuracy ? { accuracy } : undefined,
    }) as Location.LocationPermissionResponse;

  it("reads Expo's answers", async () => {
    const read = jest.mocked(Location.getForegroundPermissionsAsync);
    read.mockResolvedValueOnce(response(Location.PermissionStatus.UNDETERMINED));
    expect(await expoLocationPlatform.getPermission()).toEqual({
      permission: 'undetermined',
      canAskAgain: true,
      approximate: false,
    });
    read.mockResolvedValueOnce(response(Location.PermissionStatus.DENIED));
    expect((await expoLocationPlatform.getPermission()).permission).toBe('denied');
    read.mockResolvedValueOnce(response(Location.PermissionStatus.GRANTED, 'coarse'));
    expect(await expoLocationPlatform.getPermission()).toEqual({
      permission: 'granted',
      canAskAgain: true,
      approximate: true,
    });
  });

  it('asks for a balanced (about 100 m) fix', async () => {
    const current = jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 64.1, longitude: -21.9, accuracy: 50, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: NOW,
    });
    expect(await expoLocationPlatform.currentFix()).toEqual({ latitude: 64.1, longitude: -21.9, accuracy: 50, timestamp: NOW });
    expect(current).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('the dialog answer is read the same way', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(response(Location.PermissionStatus.GRANTED, 'fine'));
    expect(await expoLocationPlatform.requestPermission()).toEqual({
      permission: 'granted',
      canAskAgain: true,
      approximate: false,
    });
  });
});
