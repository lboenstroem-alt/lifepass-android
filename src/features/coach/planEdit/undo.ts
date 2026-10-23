/**
 * Undo, wherever it is tapped: the collapsed card in the chat ("Changed ·
 * Undo") and Plan's Changes list (OP-62 rows). One key per edit, so a
 * second tap, here or there, is the same request; the plan is read again
 * after it (the Today card, the week strip, the preview and the reminders
 * follow the Today read).
 *
 * All or nothing on the server: days done or skipped since the change stay
 * as history (`keptRows`), and the toast says so.
 */
import { newIdempotencyKey } from '../../../api';
import { useHealthStore } from '../../../health';
import { currentLanguage, translate } from '../../../i18n';
import { track } from '../../../lib/analytics';

import { planEditErrorCode, undoPlanEdit } from './api';
import { presentToast } from './platform';

const undoKeys = new Map<string, string>();
let makeKey: () => string = newIdempotencyKey;

/** The plan, the week strip, the preview and the reminders read again. */
export function refreshPlan(): void {
  void (async () => {
    try {
      await useHealthStore.getState().load({ force: true });
    } catch {
      // The next appearance reads again.
    }
  })();
}

/** OP-60 for one edit, then the plan read again. Resolves with the days kept as history; throws the API's error. */
export async function undoEdit(programId: string, editId: string): Promise<number> {
  const key = undoKeys.get(editId) ?? makeKey();
  undoKeys.set(editId, key);
  try {
    const response = await undoPlanEdit(programId, editId, key);
    track('plan_edit_undone');
    refreshPlan();
    return response.keptRows;
  } catch (error) {
    track('plan_edit_error', { code: planEditErrorCode(error) });
    throw error;
  }
}

/** "Change undone", and "Days you already did stay as they are." when some were kept. */
export function announceUndone(keptRows: number): void {
  const language = currentLanguage();
  const toast = translate('coach.planEdit.undoneToast', language);
  presentToast(keptRows > 0 ? `${toast}. ${translate('coach.planEdit.keptRows', language)}` : toast);
}

/** The server's rule (`undoable`) and its window (`undoUntil`), read now. */
export function isUndoable(applied: { readonly undoUntil: Date | null; readonly undoable: boolean }, now: Date = new Date()): boolean {
  if (!applied.undoable) return false;
  return applied.undoUntil === null || applied.undoUntil.getTime() > now.getTime();
}

/** Sign-out and the health wipe: no key outlives its member. */
export function forgetUndoKeys(): void {
  undoKeys.clear();
}

/** Tests: the key minting. */
export function setUndoKeyMakerForTests(next: (() => string) | null): void {
  makeKey = next ?? newIdempotencyKey;
}
