/**
 * Whether a booking, payment or check-in flow is on screen: what the visit
 * rating's card and sheet and the Google Play rating ask wait for (docs/05,
 * "Visit ratings": never while a booking, payment or check-in flow is on
 * screen, and never on the proof reception reads).
 *
 *   check-in   the walk-in flow holds anything (a request, a sheet, a
 *              consent, the hosted page, its proof): src/features/checkin/walkin
 *   proof      a check-in proof is up, live or re-offered on Home
 *   booking    the booking flow is the page on screen, or the class sheet is up
 *   payment    a hosted payment page is open, "Confirming your payment…" is
 *              showing, or Plans (where passes and memberships are bought)
 *              is the page on screen
 *
 * Read at the moment something is about to be shown, and heard as it
 * changes (`subscribeFlowsOnScreen`), so what waited can go once the flow is
 * over (a hosted page closing is heard as the app coming back).
 */
import { AppState } from 'react-native';

import { proofOnScreen, subscribeProofOnScreen } from '../features/checkin/proof/onScreen';
import { isWalkInIdle, walkInStore } from '../features/checkin/walkin/store';
import { currentClassSheetRequest, subscribeClassSheetRequests } from '../features/classes/sheet/requests';
import { navigationRef } from '../navigation/navigationRef';
import { isHostedPageOpen } from '../payments/hostedPage';
import { subscribeRecoveryProgress, visibleRecoveryProgress } from '../payments/recoveryProgress';

export type FlowOnScreen = 'checkin' | 'proof' | 'booking' | 'payment';

/** Pages that are a booking or payment flow while they are the one on screen. */
const FLOW_ROUTES: Readonly<Record<string, FlowOnScreen>> = {
  BookingFlow: 'booking',
  Plans: 'payment',
};

/** The page on screen (the deepest focused route), or null before the navigator is ready. */
function routeOnScreen(): string | null {
  try {
    return navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? null) : null;
  } catch {
    return null;
  }
}

/** The flow on screen now, or null when nothing would be covered. */
export function flowOnScreen(): FlowOnScreen | null {
  if (!isWalkInIdle(walkInStore.getState())) return 'checkin';
  if (proofOnScreen()) return 'proof';
  if (currentClassSheetRequest() !== null) return 'booking';
  if (isHostedPageOpen() || visibleRecoveryProgress() !== null) return 'payment';
  const route = routeOnScreen();
  return route !== null ? (FLOW_ROUTES[route] ?? null) : null;
}

/**
 * Hears every change that can start or end a flow on screen, and the app
 * coming back to the foreground (a hosted page closing). Returns a stop.
 */
export function subscribeFlowsOnScreen(listener: () => void): () => void {
  const foreground = AppState.addEventListener('change', (next) => {
    if (next === 'active') listener();
  });
  const stops = [
    walkInStore.subscribe(() => listener()),
    subscribeProofOnScreen(listener),
    subscribeClassSheetRequests(listener),
    subscribeRecoveryProgress(listener),
    navigationRef.addListener('state', () => listener()),
    () => foreground.remove(),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
