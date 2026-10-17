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
 * A new feature folder adds its line here (F3 owns this file; ask for the
 * line in a contract request). Health Connect is not built (owner decision),
 * so it has no line.
 *
 * Shared layers with no feature folder register at the bottom of this file
 * when they hold something of the member's above the navigator.
 */
import '../features/account/register';
import '../features/attractions/register';
import '../features/auth/register';
import '../features/body/register';
import '../features/booking/register';
import '../features/checkin/register';
import '../features/classes/register';
import '../features/coach/register';
import '../features/explore/register';
import '../features/favourites/register';
import '../features/feedback/register';
import '../features/home/register';
import '../features/kenni/register';
import '../features/library/register';
import '../features/meals/register';
import '../features/plan/register';
import '../features/plans/register';
import '../features/runner/register';
import '../features/venue/register';

import { resetUiKit } from '../components/ui/reset';

import { registerSignOutCleaner } from './signOut';

/** The feature areas loaded above, for the test that every register file is listed. */
export const REGISTERED_FEATURE_AREAS: readonly string[] = [
  'account',
  'attractions',
  'auth',
  'body',
  'booking',
  'checkin',
  'classes',
  'coach',
  'explore',
  'favourites',
  'feedback',
  'home',
  'kenni',
  'library',
  'meals',
  'plan',
  'plans',
  'runner',
  'venue',
];

/**
 * The UI kit (F5, contract request): its dialog and toast hosts sit ABOVE the
 * navigator and outlive the switch to the sign-in screens. A confirm queued
 * for the member who left (its buttons bound to their booking or meal) or a
 * toast about their data must never reach the next person on the phone. iOS
 * drops them with the signed-in views it tears down. No button's action runs.
 * Every sign-out, forced ones after a 401 included, runs the cleaners.
 */
registerSignOutCleaner('ui-kit', () => resetUiKit());
