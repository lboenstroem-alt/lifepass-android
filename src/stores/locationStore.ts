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
import { AppState, type AppStateStatus } from 'react-native';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { REYKJAVIK_CENTRE, type Coordinate } from '../lib/geo';
import { browseSession, type BrowseSessionStore } from './browseSession';

/** The three answers. A restricted device reads as `denied`. */
export type LocationPermission = 'undetermined' | 'granted' | 'denied';

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
 * Location is off: the member said no. The Explore banner ("Location is off",
 * Open) shows while this holds; it appears as soon as "Don't allow" is chosen
 * and goes once location is allowed in Settings (re-read on return). A grant
 * that ran out is not a no (see `permissionMeaning`), so it shows no banner.
 */
export function selectLocationOff(state: Pick<LocationState, 'permission' | 'permissionKnown'>): boolean {
  return state.permissionKnown && state.permission === 'denied';
}

/**
 * What an Android permission read means, in iOS's terms.
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
  if (snapshot.permission !== 'denied' || snapshot.canAskAgain) return snapshot.permission;
  return lastAnswer === 'denied' ? 'denied' : 'undetermined';
}

/** expo-location, as the store needs it. */
export const expoLocationPlatform: LocationPlatform = {
  async getPermission() {
    return snapshotOf(await Location.getForegroundPermissionsAsync());
  },
  async requestPermission() {
    return snapshotOf(await Location.requestForegroundPermissionsAsync());
  },
  async currentFix() {
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? null,
      timestamp: fix.timestamp,
    };
  },
};

function snapshotOf(response: Location.LocationPermissionResponse): PermissionSnapshot {
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
  };
}

export interface LocationStoreOptions {
  readonly platform?: LocationPlatform;
  /** Told of every granted fix and permission change. */
  readonly session?: BrowseSessionStore;
  readonly now?: () => number;
  readonly fixTimeoutMs?: number;
}

export type LocationStore = StoreApi<LocationState>;

const INITIAL = {
  permission: 'undetermined' as LocationPermission,
  permissionKnown: false,
  canAskAgain: true,
  approximate: false,
  currentLocation: null as LocationFix | null,
};

/** A location store; the app uses the shared `locationStore`. */
export function createLocationStore(options: LocationStoreOptions = {}): LocationStore {
  const platform = options.platform ?? expoLocationPlatform;
  const session = options.session ?? browseSession;
  const now = options.now ?? Date.now;
  const fixTimeoutMs = options.fixTimeoutMs ?? FIX_TIMEOUT_MS;

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
      const becameGranted = snapshot.permission === 'granted' && (before.permission !== 'granted' || !before.permissionKnown);
      set({
        permission: permissionMeaning(snapshot, lastAnswer),
        permissionKnown: true,
        canAskAgain: snapshot.canAskAgain,
        approximate: snapshot.approximate,
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
        if (await readPermission()) await requestFix();
      },

      async requestLocation() {
        await readPermission();
        // Undetermined includes a lapsed one-time grant (`permissionMeaning`):
        // Android shows the dialog again for it, and for a no it keeps it
        // answers `denied` at once, without one.
        if (get().permission === 'undetermined') {
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

/** The app's location store. */
export const locationStore: LocationStore = createLocationStore();

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

let stopShared: (() => void) | null = null;

/**
 * Starts the app-wide wiring, once (iOS LifePassApp's scene-phase handler and
 * the location manager's authorization callback):
 *   - the permission is read now, without prompting;
 *   - 'background' stamps the browse session's visit clock;
 *   - 'active' asks the session whether a new visit begins (30 minutes or
 *     more away), and if so refreshes the fix when location is allowed; and
 *     it re-reads the permission, so a member back from Settings sees the
 *     banner go and their position come in.
 * Idempotent for the shared stores: a second call returns the same stop.
 * Meant to start at the app root through `startLocationAtLaunch` (F6 contract
 * request to F4, not wired yet). Until it is, the only caller is the legacy
 * Home hook (src/hooks/useLocation.ts), so nothing runs before Home mounts:
 * whoever replaces that hook (HOME-1) keeps a call until the root has one.
 */
export function startLocationLifecycle(options: LifecycleOptions = {}): () => void {
  const shared = !options.location && !options.session && !options.appState;
  if (shared && stopShared) return stopShared;

  const appState = options.appState ?? AppState;
  const location = options.location ?? locationStore;
  const session = options.session ?? browseSession;
  const now = options.now ?? Date.now;

  void location.getState().refreshPermission();
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

  const stop = () => {
    subscription.remove();
    if (shared && stopShared === stop) stopShared = null;
  };
  if (shared) stopShared = stop;
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
 * The app root calls it once, in a mount effect, whichever tab opens first.
 * That call is F4's (App.tsx); until it lands this is called from nowhere.
 */
export function startLocationAtLaunch(options: LifecycleOptions = {}): () => void {
  const stop = startLocationLifecycle(options);
  void (options.location ?? locationStore).getState().requestLocation();
  return stop;
}
