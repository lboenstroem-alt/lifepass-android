/**
 * Loads every feature's session hooks (`src/features/<area>/register.ts`)
 * once, at startup, so each sign-in hook, sign-out cleaner and activation
 * hook is in place before the first sign-in or sign-out (src/app/signOut.ts).
 *
 * Imported by the app store (src/stores/appStore.ts), which every screen
 * reaches. A register file may import the app store, but must not CALL it
 * while it loads (only inside its hooks): the store is still loading at that
 * moment.
 *
 * A new feature folder adds its line here (F3 owns this file; ask for the
 * line in a contract request). Health Connect is not built (owner decision),
 * so it has no line.
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
