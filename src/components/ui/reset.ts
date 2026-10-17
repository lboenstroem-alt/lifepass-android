// Clears what the UI kit holds app-wide: the queued dialogs and the toast on
// screen. No button's action runs. iOS sign-out resets AppState, which drops
// the alerts it was presenting, and the meal toasts belong to the signed-in
// tab view it tears down; here DialogHost and ToastHost sit in UiKitProvider
// ABOVE the navigator and outlive the switch to the sign-in screens, so this
// must run at every sign-out (a forced one after a 401 too). Otherwise a
// queued confirm whose buttons are bound to the previous member's data could
// fire on the Login screen, and its message (a booking at a named venue), or
// a meal toast with "Food diary" or "Undo", would be shown to the next
// person to pick up the phone.
//
// WIRED in src/app/registrations.ts (`registerSignOutCleaner('ui-kit', () =>
// resetUiKit())`), so every sign-out runs it; do not register it a second
// time. Sheets need nothing here: they belong to screens, which the navigator
// unmounts on sign-out. A toast that is still fading out when this runs keeps
// no working button (Toast.tsx, AN ACTION BELONGS TO ITS TOAST).
import { dismissAllDialogs } from './Dialog';
import { dismissToast } from './Toast';

export function resetUiKit(): void {
  dismissAllDialogs();
  dismissToast();
}
