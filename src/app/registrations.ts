/**
 * Loads every feature's session hooks (`src/features/<area>/register.ts`)
 * once, so each sign-in hook, sign-out cleaner, profile-read and activation
 * hook is in place before the first sign-in or sign-out (src/app/signOut.ts).
 *
 * Nobody imports this file at load. `loadRegistrations()` in ./signOut.ts
 * requires it the first time a hook is about to run (the app store's launch
 * calls it first thing), when every module has finished loading. So a
 * register file, and anything it imports (src/health, F4's intent store),
 * may use the app store while it loads: read it, subscribe to it, register a
 * Kenni blocker. Even so, pass hooks as functions that call what they
 * import (`(context) => wipe(context)`), not the imported value itself: a
 * value read while two modules import each other can still be undefined.
 *
 * EACH FILE LOADS ON ITS OWN. A register file that throws while it loads
 * (or anything it imports: a native module missing on one phone) loses its
 * own hooks and nothing else. With plain imports, one throw stopped this
 * file where it stood: every register file after it, and the UI kit's
 * cleaner below them, never registered, and sign-out quietly stopped
 * deleting the Coach's saved chats for the next account on the phone. On
 * iOS `AppState.handleSignOut` calls each wipe by name, so none can be
 * skipped; here the shared layers register FIRST and each feature file is
 * required in its own try, so one broken file costs only itself. The
 * failure is reported (`service_error`, op `register_<area>`) rather than
 * swallowed.
 *
 * A new feature folder adds its line to `FEATURE_REGISTER_FILES` (F3 owns
 * this file; ask for the line in a contract request). Each line is a
 * `require` of a literal path, which is what the bundler can follow. Health
 * Connect is not built (owner decision), so it has no line.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at first use, one by one (see above) */
import type * as UiKitReset from '../components/ui/reset';
import type * as VenuesStore from '../stores/venuesStore';
import { errorDescription, track } from '../lib/analytics';

import { registerSignOutCleaner } from './signOut';

type Load = () => unknown;

/**
 * Shared layers with no feature folder that hold something of the member's
 * outside any screen. Registered before the feature files.
 */
const SHARED_LAYERS: Readonly<Record<string, Load>> = {
  /**
   * The UI kit (F5, contract request): its dialog and toast hosts sit ABOVE
   * the navigator and outlive the switch to the sign-in screens. A confirm
   * queued for the member who left (its buttons bound to their booking or
   * meal) or a toast about their data must never reach the next person on
   * the phone. iOS drops them with the signed-in views it tears down. No
   * button's action runs. Every sign-out, forced ones after a 401 included,
   * runs the cleaners.
   */
  'ui-kit': () => {
    const { resetUiKit } = require('../components/ui/reset') as typeof UiKitReset;
    registerSignOutCleaner('ui-kit', () => resetUiKit());
  },
  /**
   * The shared venue list (F6, contract request in src/stores/venuesStore.ts):
   * its prices were resolved for the member who asked (a member or pass
   * price) and the store outlives every screen that shows it.
   */
  'venues.list': () => {
    const { resetVenuesStore } = require('../stores/venuesStore') as typeof VenuesStore;
    registerSignOutCleaner('venues.list', () => resetVenuesStore());
  },
};

/** Every feature's register file, by area. */
export const FEATURE_REGISTER_FILES: Readonly<Record<string, Load>> = {
  account: () => require('../features/account/register'),
  attractions: () => require('../features/attractions/register'),
  auth: () => require('../features/auth/register'),
  body: () => require('../features/body/register'),
  booking: () => require('../features/booking/register'),
  checkin: () => require('../features/checkin/register'),
  classes: () => require('../features/classes/register'),
  coach: () => require('../features/coach/register'),
  explore: () => require('../features/explore/register'),
  favourites: () => require('../features/favourites/register'),
  feedback: () => require('../features/feedback/register'),
  home: () => require('../features/home/register'),
  kenni: () => require('../features/kenni/register'),
  library: () => require('../features/library/register'),
  meals: () => require('../features/meals/register'),
  plan: () => require('../features/plan/register'),
  plans: () => require('../features/plans/register'),
  runner: () => require('../features/runner/register'),
  venue: () => require('../features/venue/register'),
};

/** The feature areas loaded here, for the test that every register file is listed. */
export const REGISTERED_FEATURE_AREAS: readonly string[] = Object.keys(FEATURE_REGISTER_FILES);

/** Loads each entry in its own try: one that throws loses its own hooks only. */
function loadEach(table: Readonly<Record<string, Load>>): void {
  for (const [area, load] of Object.entries(table)) {
    try {
      load();
    } catch (error) {
      if (__DEV__ && process.env.NODE_ENV !== 'test') {
        console.error(`[registrations] the register file for "${area}" failed to load`, error);
      }
      try {
        track('service_error', { op: `register_${area}`, error: errorDescription(error) });
      } catch {
        // The report must never be what stops the next file loading.
      }
    }
  }
}

loadEach(SHARED_LAYERS);
loadEach(FEATURE_REGISTER_FILES);
