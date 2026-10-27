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
import { isApiError, newIdempotencyKey } from '../../../api';
import { useHealthStore } from '../../../health';
import { currentLanguage, translate } from '../../../i18n';
import { track } from '../../../lib/analytics';

import { planEditErrorReason, undoPlanEdit } from './api';
import { presentToast } from './platform';

const undoKeys = new Map<string, string>();
let makeKey: () => string = newIdempotencyKey;

/**
 * The plan, the week strip, the preview and the reminders read again; then
 * every screen holding its own copy of the programme (the overview's weeks
 * and its Changes list) is told to read it again too (iOS posts
 * `.healthPlanChanged` once the read is done).
 */
export function refreshPlan(): void {
  void (async () => {
    try {
      await useHealthStore.getState().load({ force: true });
    } catch {
      // The next appearance reads again.
    } finally {
      useHealthStore.getState().notePlanChanged();
    }
  })();
}

/**
 * OP-60 for one edit (`entry`: the chat's card or Plan's Changes list), then
 * the plan read again. Resolves with the days kept as history; throws the
 * API's error. The key is kept for a retry of the same tap and goes once the
 * server has answered.
 */
export async function undoEdit(programId: string, editId: string, entry: 'card' | 'changes'): Promise<number> {
  const key = undoKeys.get(editId) ?? makeKey();
  undoKeys.set(editId, key);
  try {
    const response = await undoPlanEdit(programId, editId, currentLanguage(), key);
    undoKeys.delete(editId);
    track('plan_edit_undone', { entry });
    refreshPlan();
    return response.keptRows;
  } catch (error) {
    track('plan_edit_error', { reason: planEditErrorReason(error) });
    if (isApiError(error) && error.isProblem('plan_edit_undo_unavailable', 'plan_edit_not_pending')) undoKeys.delete(editId);
    throw error;
  }
}

/**
 * The Changes list's toast (iOS `PlanEditChangesModel`): "Change undone",
 * with "Days you already did stay as they are." after it when an Undo kept
 * some.
 */
export function announceUndone(keptRows: number): void {
  presentToast(translate(keptRows > 0 ? 'coach.planEdit.undoneToastKept' : 'coach.planEdit.undoneToast', currentLanguage()));
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
