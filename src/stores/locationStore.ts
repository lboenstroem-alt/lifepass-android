// Where the member is, if they allow it: the Android port of iOS
// `LocationService` (Services/LocationService.swift).
//
// POLICY
//  - Reading never prompts. `refreshPermission()` reads the permission with
//    `getForegroundPermissionsAsync` and is safe anywhere (the app coming back
//    from Settings, a list ordering itself). Only `requestLocation()` can show
//    the system dialog, and only while the member has not decided yet: once
//    they have said no, it never asks again (as iOS, which cannot ask twice;
//    Android could, and that would be nagging). Callers are the places iOS
//    asks from: app launch (`startLocationAtLaunch`), an Explore visit, Home,
//    Coach "near me", classes "Near me".
//  - "Not decided yet" is read as iOS reads it, which on Android takes more
//    than Expo's status (`permissionMeaning` below): an "Only this time"
//    grant that ran out is undecided again, as an expired "Allow Once" is on
//    iOS, and is asked about again.
//  - Location switched off on the phone reads as `denied`, as iOS reads
//    Location Services switched off (CLAuthorizationStatus.denied covers
//    "disabled globally in Settings"): no dialog, no fix, no distance order,
//    and the Explore banner shows. Android reports the permission as granted
//    with the toggle off, so the toggle is read with it
//    (`hasServicesEnabledAsync`, which never prompts) and `selectLocationOffReason`
//    says which of the two the banner's Open should fix.
//  - A fix never brings up a dialog either: expo-location would show Google
//    Play services' "Turn on location" dialog for a fix while the network
//    provider is off (`mayShowUserSettingsDialog` defaults to true on
//    Android), and a fix is asked for on reads. CoreLocation never does; a
//    phone with location off just has no fix, silently.
//  - A screenshot or fixture run (`EXPO_PUBLIC_FIXTURE` with `state=`) never
//    shows the dialog over the screen under test (iOS
//    `ScreenshotFixtures.suppressesSystemPrompts`).
//  - About 100 m accuracy (Balanced), which the 3 km band and the map dot
//    need; an approximate grant (Android 12+) still counts as granted, as a
//    reduced-accuracy grant does on iOS.
//  - A fix older than 60 s when it arrives is ignored (a cached position that
//    does not reflect the current walk).
//
// THREE POSITIONS, three uses:
//  - `selectGrantedLocation`: where the member REALLY is, a fix with
//    permission granted NOW. The only position a list may be ordered by, or a
//    distance printed from, as "from you". Null without one; never the
//    Reykjavík fallback, and never a fix kept from before permission was
//    taken away.
//  - `selectEffectiveLocation`: the last fix or Reykjavík centre, never null,
//    for distance FILTERS only (classes "Near me"), so they always give a
//    deterministic result. Nothing may present it as where the member is.
//  - `currentLocation`: the raw last fix, as iOS keeps it.
//
// Every fix and every permission change is told to the browse session
// (./browseSession), which holds the bands still. The location never leaves
// the phone for ordering.
import * as Location from 'expo-location';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { hasFixture } from '../dev/fixtures';
import { REYKJAVIK_CENTRE, type Coordinate } from '../lib/geo';
import { browseSession, type BrowseSessionStore } from './browseSession';

/** The three answers. A restricted device reads as `denied`. */
export type LocationPermission = 'undetermined' | 'granted' | 'denied';

/**
 * Why location is off: the member refused the app (fixed in the app's
 * settings) or location is switched off for the whole phone (fixed in the
 * phone's location settings).
 */
export type LocationOffReason = 'permission' | 'services';

/** A position fix. */
export interface LocationFix extends Coordinate {
  /** Radius of uncertainty in metres, when the platform gives one. */
  readonly accuracy: number | null;
  /** When the fix was taken (ms since the epoch). */
  readonly timestamp: number;
}

/** A permission read. */
export interface PermissionSnapshot {
  readonly permission: LocationPermission;
  readonly canAskAgain: boolean;
  /** Android 12+: the member allowed approximate location only. */
  readonly approximate: boolean;
  /**
   * Whether location is switched on for the phone (Android's location
   * toggle; read with the permission, never prompting). Absent reads as on:
   * only a definite "off" may take location away.
   */
  readonly servicesEnabled?: boolean;
}

/** The platform calls the store makes (expo-location in the app; fakes in tests). */
export interface LocationPlatform {
  /** Reads the permission without prompting. */
  getPermission(): Promise<PermissionSnapshot>;
  /** Shows the system dialog (when Android still will) and answers the result. */
  requestPermission(): Promise<PermissionSnapshot>;
  /** One fresh fix. Rejects when none can be had. */
  currentFix(): Promise<LocationFix>;
}

/** A fix older than this when it arrives is ignored (iOS: 60 s). */
export const MAX_FIX_AGE_MS = 60_000;
/** How long one fix may take before the store stops waiting for it. */
export const FIX_TIMEOUT_MS = 15_000;

export interface LocationState {
  /** The permission as last read, as iOS would report it (`permissionMeaning`). */
  readonly permission: LocationPermission;
  /** Whether the permission has been read since launch (before that, nothing is known). */
  readonly permissionKnown: boolean;
  /** Expo's raw `canAskAgain` (Android: whether it would show a rationale). */
  readonly canAskAgain: boolean;
  readonly approximate: boolean;
  /** Whether location is switched on for the phone, as last read. Off makes `permission` read `denied`. */
  readonly servicesEnabled: boolean;
  /** The last fresh fix. Read through the selectors below. */
  readonly currentLocation: LocationFix | null;

  /** Reads the permission (never prompts); a change to granted asks for a fix. */
  refreshPermission(): Promise<void>;
  /**
   * Prompts if the member has not decided yet; otherwise refreshes the fix
   * when location is allowed. Safe to call repeatedly.
   */
  requestLocation(): Promise<void>;
  /** A fresh fix if, and only if, location is already allowed. Never prompts. */
  refreshIfAuthorized(): Promise<void>;
}

/** The granted position, or null (see the file comment). Stable between fixes. */
export function selectGrantedLocation(state: Pick<LocationState, 'permission' | 'currentLocation'>): LocationFix | null {
  return grantedFix(state.currentLocation, state.permission);
}

/** Only a fix with permission granted NOW counts (iOS `LocationService.granted`). */
export function grantedFix<T>(fix: T | null, permission: LocationPermission): T | null {
  return permission === 'granted' ? fix : null;
}

/** The last fix or Reykjavík centre: for distance filters only. */
export function selectEffectiveLocation(state: Pick<LocationState, 'currentLocation'>): Coordinate {
  return state.currentLocation ?? REYKJAVIK_CENTRE;
}

/**
 * Location is off: the member said no, or location is switched off for the
 * phone (both are iOS `.denied`). The Explore banner ("Location is off",
 * Open) shows while this holds; it appears as soon as "Don't allow" is chosen
 * and goes once location is allowed or switched on again (re-read on
 * return). A grant that ran out is not a no (see `permissionMeaning`), so it
 * shows no banner.
 */
export function selectLocationOff(state: Pick<LocationState, 'permission' | 'permissionKnown'>): boolean {
  return state.permissionKnown && state.permission === 'denied';
}

/**
 * Why location is off (null while it is not), so the banner's Open goes where
 * it can be fixed (`openLocationSettings`). Location switched off for the
 * phone comes first: allowing the app changes nothing until it is on.
 */
export function selectLocationOffReason(
  state: Pick<LocationState, 'permission' | 'permissionKnown' | 'servicesEnabled'>,
): LocationOffReason | null {
  if (!selectLocationOff(state)) return null;
  return state.servicesEnabled ? 'permission' : 'services';
}

/**
 * The banner's Open (iOS opens the Settings app at LifePass): the phone's
 * location settings when location is switched off, the app's own settings
 * page when the member refused it. Never a dialog of its own; the store
 * re-reads both when the app comes back (`startLocationLifecycle`).
 */
export async function openLocationSettings(reason: LocationOffReason | null): Promise<void> {
  if (reason === 'services') {
    try {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    } catch {
      // No location settings screen on this phone: the app's page instead.
    }
  }
  try {
    await Linking.openSettings();
  } catch {
    // Nothing to open: the banner stays, as it would on iOS.
  }
}

/**
 * What an Android permission read means, in iOS's terms.
 *
 * Location switched off for the phone is `denied`, whatever the permission
 * (iOS `.denied` covers "disabled globally in Settings"): nothing is asked
 * and no fix counts until it is on again, when the permission reads as it is.
 *
 * Expo reports every permission it has asked for and does not hold as
 * `denied` (expo-modules-core PermissionsService: asked before, not granted,
 * reads DENIED), so `denied` alone cannot tell a member who said no from one
 * whose "Only this time" grant ran out. iOS can: an expired "Allow Once" is
 * `.notDetermined` again, and `requestLocation()` asks again. Android's
 * `canAskAgain` (its "show a rationale" flag) splits the reads in two:
 *  - denied, canAskAgain: the member said no, and Android would still show
 *    the dialog (a first "Don't allow", or "Don't allow" in Settings). That is
 *    iOS `.denied`: never asked again.
 *  - denied, not canAskAgain: either a no Android itself will no longer ask
 *    about (a second "Don't allow"; "Don't ask again" before Android 11), or
 *    a case where nobody said no and Android WILL ask again: a one-time grant
 *    that ran out, a dialog closed without an answer, a permission reset for
 *    an unused app. The read cannot tell these apart; asking can, and costs
 *    the first kind nothing (Android answers `denied` at once, with no
 *    dialog). So it means undetermined until this process has asked and been
 *    told no (`lastAnswer`), and is then a no until the app is next started.
 * Nothing is stored between launches: each launch's one request (silent for
 * a no Android keeps) settles it again, and a no that Android would still
 * show the dialog for (canAskAgain) is never re-asked.
 */
export function permissionMeaning(snapshot: PermissionSnapshot, lastAnswer: LocationPermission | null): LocationPermission {
  if (snapshot.servicesEnabled === false) return 'denied';
  if (snapshot.permission !== 'denied' || snapshot.canAskAgain) return snapshot.permission;
  return lastAnswer === 'denied' ? 'denied' : 'undetermined';
}

/** expo-location, as the store needs it. */
export const expoLocationPlatform: LocationPlatform = {
  async getPermission() {
    const [response, servicesEnabled] = await Promise.all([Location.getForegroundPermissionsAsync(), servicesOn()]);
    return snapshotOf(response, servicesEnabled);
  },
  async requestPermission() {
    const response = await Location.requestForegroundPermissionsAsync();
    return snapshotOf(response, await servicesOn());
  },
  async currentFix() {
    // Never the "Turn on location" dialog (see the file comment): with the
    // network provider off this fails, or finds a GPS fix, without a word.
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? null,
      timestamp: fix.timestamp,
    };
  },
};

/**
 * Whether location is switched on for the phone (GPS or network provider on).
 * Never prompts. A read that fails, or answers nothing, counts as on: only a
 * definite "off" takes location away.
 */
async function servicesOn(): Promise<boolean> {
  try {
    return (await Location.hasServicesEnabledAsync()) !== false;
  } catch {
    return true;
  }
}

function snapshotOf(response: Location.LocationPermissionResponse, servicesEnabled: boolean): PermissionSnapshot {
  const permission: LocationPermission =
    response.status === Location.PermissionStatus.GRANTED
      ? 'granted'
      : response.status === Location.PermissionStatus.UNDETERMINED
        ? 'undetermined'
        : 'denied';
  return {
    permission,
    canAskAgain: response.canAskAgain,
    approximate: permission === 'granted' && response.android?.accuracy === 'coarse',
    servicesEnabled,
  };
}

export interface LocationStoreOptions {
  readonly platform?: LocationPlatform;
  /** Told of every granted fix and permission change. */
  readonly session?: BrowseSessionStore;
  readonly now?: () => number;
  readonly fixTimeoutMs?: number;
  /**
   * True while the system dialog must not show (iOS DEBUG
   * `ScreenshotFixtures.suppressesSystemPrompts`). Default: a fixture run,
   * `EXPO_PUBLIC_FIXTURE` with `state=` (always false in a release build).
   */
  readonly suppressPrompts?: () => boolean;
  /** Runs at the start of every action (the shared store starts the app's lifecycle with it). */
  readonly onUse?: () => void;
}

export type LocationStore = StoreApi<LocationState>;

const INITIAL = {
  permission: 'undetermined' as LocationPermission,
  permissionKnown: false,
  canAskAgain: true,
  approximate: false,
  servicesEnabled: true,
  currentLocation: null as LocationFix | null,
};

/** A location store; the app uses the shared `locationStore`. */
export function createLocationStore(options: LocationStoreOptions = {}): LocationStore {
  const platform = options.platform ?? expoLocationPlatform;
  const session = options.session ?? browseSession;
  const now = options.now ?? Date.now;
  const fixTimeoutMs = options.fixTimeoutMs ?? FIX_TIMEOUT_MS;
  const suppressPrompts = options.suppressPrompts ?? (() => hasFixture('state'));
  const onUse = options.onUse ?? (() => undefined);

  // One of each at a time: a second caller joins the one in flight.
  let fixInFlight: Promise<void> | null = null;
  let promptInFlight: Promise<void> | null = null;
  // What the last request answered in this process (see `permissionMeaning`).
  let lastAnswer: LocationPermission | null = null;

  return createStore<LocationState>()((set, get) => {
    /** The browse order's bands follow the granted fix, told rather than observed. */
    const tellSession = () => session.getState().locationDidChange(selectGrantedLocation(get()));

    /** Records a permission read; true when it newly allows location. */
    const apply = (snapshot: PermissionSnapshot): boolean => {
      const before = get();
      const permission = permissionMeaning(snapshot, lastAnswer);
      const becameGranted = permission === 'granted' && (before.permission !== 'granted' || !before.permissionKnown);
      set({
        permission,
        permissionKnown: true,
        canAskAgain: snapshot.canAskAgain,
        approximate: snapshot.approximate,
        servicesEnabled: snapshot.servicesEnabled !== false,
      });
      tellSession();
      return becameGranted;
    };

    const requestFix = (): Promise<void> => {
      if (fixInFlight) return fixInFlight;
      const attempt = (async () => {
        try {
          const fix = await withTimeout(platform.currentFix(), fixTimeoutMs);
          // A cached position from minutes ago is not where the member is now.
          if (!fix || Math.abs(now() - fix.timestamp) >= MAX_FIX_AGE_MS) return;
          if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return;
          set({ currentLocation: fix });
          tellSession();
        } catch {
          // Silent, as on iOS: no fix means no distance order and the
          // filters fall back to Reykjavík centre.
        } finally {
          fixInFlight = null;
        }
      })();
      fixInFlight = attempt;
      return attempt;
    };

    const readPermission = async (): Promise<boolean> => {
      try {
        return apply(await platform.getPermission());
      } catch {
        return false;
      }
    };

    return {
      ...INITIAL,

      async refreshPermission() {
        onUse();
        if (await readPermission()) await requestFix();
      },

      async requestLocation() {
        onUse();
        await readPermission();
        // Undetermined includes a lapsed one-time grant (`permissionMeaning`):
        // Android shows the dialog again for it, and for a no it keeps it
        // answers `denied` at once, without one. Location switched off for
        // the phone reads `denied`, so it is not asked about, as on iOS.
        // A fixture run reads and refreshes, but never covers its screen.
        if (get().permission === 'undetermined' && !suppressPrompts()) {
          if (!promptInFlight) {
            promptInFlight = (async () => {
              try {
                const answer = await platform.requestPermission();
                lastAnswer = answer.permission;
                apply(answer);
              } catch {
                // The dialog could not be shown: nothing changes.
              } finally {
                promptInFlight = null;
              }
            })();
          }
          await promptInFlight;
        }
        if (get().permission === 'granted') await requestFix();
      },

      async refreshIfAuthorized() {
        onUse();
        if (get().permission === 'granted') await requestFix();
      },
    };
  });
}

/** `work`, or undefined once `ms` has passed (the work itself carries on). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The app's location store. Its first use starts the app's lifecycle
 * (`ensureLocationLifecycle`), so whichever screen asks first (Explore, Home,
 * Coach, classes) brings the background/active wiring up with it, as iOS has
 * it from the app root; the root also starts it at launch
 * (`startLocationAtLaunch`).
 */
export const locationStore: LocationStore = createLocationStore({ onUse: () => ensureLocationLifecycle() });

/** React: a slice of the shared store (or of `store`). */
export function useLocationStore<T>(selector: (state: LocationState) => T, store: LocationStore = locationStore): T {
  return useStore(store, selector);
}

/** React: the granted fix (or null). Re-renders on a new fix or a permission change. */
export function useGrantedLocation(store: LocationStore = locationStore): LocationFix | null {
  return useStore(store, selectGrantedLocation);
}

// MARK: - The app's lifecycle

type AppStateLike = {
  readonly currentState: AppStateStatus | null | undefined;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
};

export interface LifecycleOptions {
  readonly appState?: AppStateLike;
  readonly location?: LocationStore;
  readonly session?: BrowseSessionStore;
  readonly now?: () => number;
}

/** The shared stores' wiring, while it runs: its stop. */
let stopShared: (() => void) | null = null;

/** Wires `appState` to the stores (no reads of its own); returns the unwiring. */
function wireLifecycle(
  appState: AppStateLike,
  location: LocationStore,
  session: BrowseSessionStore,
  now: () => number,
): () => void {
  const subscription = appState.addEventListener('change', (next) => {
    if (next === 'background') {
      session.getState().didEnterBackground(now());
    } else if (next === 'active') {
      const granted = selectGrantedLocation(location.getState());
      const newVisit = session.getState().didBecomeActive(now(), granted);
      void location
        .getState()
        .refreshPermission()
        .then(() => (newVisit ? location.getState().refreshIfAuthorized() : undefined));
    }
  });
  return () => subscription.remove();
}

/**
 * The shared stores' wiring, started if it is not running; returns its stop.
 * Reads nothing: the shared store calls it at the start of every action,
 * which does its own read.
 */
export function ensureLocationLifecycle(now: () => number = Date.now): () => void {
  if (stopShared) return stopShared;
  const unwire = wireLifecycle(AppState, locationStore, browseSession, now);
  const stop = () => {
    unwire();
    if (stopShared === stop) stopShared = null;
  };
  stopShared = stop;
  return stop;
}

/**
 * Starts the app-wide wiring (iOS LifePassApp's scene-phase handler and the
 * location manager's authorization callback):
 *   - the permission is read now, without prompting;
 *   - 'background' stamps the browse session's visit clock;
 *   - 'active' asks the session whether a new visit begins (30 minutes or
 *     more away), and if so refreshes the fix when location is allowed; and
 *     it re-reads the permission and the location toggle, so a member back
 *     from Settings sees the banner go and their position come in.
 * Once for the shared stores: their first use starts it too (see
 * `locationStore`), and a call while it runs returns the same stop and reads
 * nothing. The app root starts it at launch through `startLocationAtLaunch`.
 */
export function startLocationLifecycle(options: LifecycleOptions = {}): () => void {
  const shared = !options.location && !options.session && !options.appState;
  if (shared) {
    if (stopShared) return stopShared;
    // Wired before the read, so the read's own first use finds it running.
    const stop = ensureLocationLifecycle(options.now);
    void locationStore.getState().refreshPermission();
    return stop;
  }

  const location = options.location ?? locationStore;
  const stop = wireLifecycle(
    options.appState ?? AppState,
    location,
    options.session ?? browseSession,
    options.now ?? Date.now,
  );
  void location.getState().refreshPermission();
  return stop;
}

/**
 * What the app root does once at launch (iOS LifePassApp: `.task {
 * LocationService.shared.requestLocation() }` on the root view, and its
 * scene-phase handler): starts the lifecycle above and asks for location.
 *
 * At LAUNCH, not when Home appears: a link (a QR scan, a booking link) can
 * open the app straight into another tab, and a member who was never asked
 * would get no distance order at all. Asking costs nothing once the member
 * has decided: the dialog shows only while the permission is undetermined,
 * and after that this only refreshes the fix when location is allowed.
 * Returns the lifecycle's stop (the same one on a second call).
 *
 * The app root calls it once, in a mount effect, whichever tab opens first
 * (F4's App.tsx; a contract item of F4's). The lifecycle does not wait for
 * it: the shared store's first use starts that part anyway.
 */
export function startLocationAtLaunch(options: LifecycleOptions = {}): () => void {
  const stop = startLocationLifecycle(options);
  void (options.location ?? locationStore).getState().requestLocation();
  return stop;
}
