/**
 * "Download my data" (iOS `BodyAndGoalsView.export`, OP-28): the member's
 * whole account as one JSON file, handed to the system share sheet.
 *
 * - The file is the server's answer kept whole (`GET /account/export`, every
 *   key, nothing the app does not model dropped: src/health/api.ts
 *   `exportAccountData`), written to the app's cache folder as
 *   `lifepass-export-YYYY-MM-DD.json` (the server's day).
 * - IT LIVES FOR EXACTLY AS LONG AS THE SHARE SHEET IS UP. It is the member's
 *   whole account in one file, so it is deleted once the share answers (on
 *   Android the chooser answers when the member is back in LifePass), and any
 *   left behind goes with the next export, a health wipe and a sign-out
 *   (src/health/localStore.ts `clearExports`, ../register.ts).
 * - The server allows two a UTC day: `429 account_export_limit` has its own
 *   line. Any other failure is the generic one; a cancelled call says nothing.
 */
import * as Sharing from 'expo-sharing';

import { isCancellation, isProblem } from '../../../api';
import { exportAccountData, healthLocalStore } from '../../../health';
import { todayServerDay } from '../../../i18n/format';

/** What fetching the export came to. */
export type ExportFetch =
  | { readonly kind: 'ready'; readonly uri: string }
  /** The red line under the row: `bodygoals.export.limit` or `common.error_body`. */
  | { readonly kind: 'failed'; readonly errorKey: string; readonly outcome: 'limit' | 'error' }
  /** The call was cancelled: nothing is said. */
  | { readonly kind: 'cancelled' };

/** The error line for a failed export (iOS: the limit has its own copy, everything else the generic line). */
export function exportErrorKey(error: unknown): { errorKey: string; outcome: 'limit' | 'error' } {
  const limited = isProblem(error, 'account_export_limit');
  return { errorKey: limited ? 'bodygoals.export.limit' : 'common.error_body', outcome: limited ? 'limit' : 'error' };
}

/** Reads the export and writes it to its scratch file. Never throws. */
export async function fetchExportFile(now: Date = new Date()): Promise<ExportFetch> {
  try {
    const text = await exportAccountData();
    const uri = await healthLocalStore.writeExport(text, todayServerDay(now));
    return { kind: 'ready', uri };
  } catch (error) {
    if (isCancellation(error)) return { kind: 'cancelled' };
    return { kind: 'failed', ...exportErrorKey(error) };
  }
}

/**
 * Offers the file to the share sheet and deletes it once the sheet has
 * answered, shared or not (closing the chooser is an answer, not an error).
 * Answers false when the sheet could not be shown at all; the file is
 * deleted all the same.
 */
export async function shareExportFile(uri: string): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json' });
    return true;
  } catch {
    return false;
  } finally {
    await healthLocalStore.clearExports();
  }
}
