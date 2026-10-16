// Clears what the UI kit holds app-wide: the queued dialogs and the toast on
// screen. Sign-out calls it (F3's sign-out path; iOS sign-out resets
// AppState, which drops the alerts it was presenting), so a queued confirm
// whose buttons are bound to the previous member's data can never fire after
// they have gone, and no toast about their data outlives them. No button's
// action runs. Sheets need nothing here: they belong to screens, which the
// navigator unmounts on sign-out.
import { dismissAllDialogs } from './Dialog';
import { dismissToast } from './Toast';

export function resetUiKit(): void {
  dismissAllDialogs();
  dismissToast();
}
