/**
 * "Download my data" (iOS `BodyAndGoalsView.export`, OP-28): the member's
 * whole account as one JSON file, handed to the system share sheet.
 *
 * - The file is the server's answer kept whole (`GET /account/export`, every
 *   key, nothing the app does not model dropped: src/health/api.ts
 *   `exportAccountData`), written to the app's cache folder as
 *   `lifepass-export-YYYY-MM-DD.json` (the server's day).
 * - IT LIVES ONLY AS LONG AS ANOTHER APP MAY BE READING IT. It is the
 *   member's whole account in one file. iOS deletes it when the share sheet
 *   is dismissed; Android's chooser can answer before the chosen app has
 *   opened the file, so it goes a few minutes after the share answered, once
 *   the member is back in LifePass (./cleanup.ts says why and when), and any
 *   left behind goes when the page opens, the app starts, the next export
 *   runs, a health wipe and a sign-out (src/health/localStore.ts
 *   `clearExports`, ../register.ts).
 * - IT BELONGS TO THE PAGE AND THE MEMBER THAT ASKED: a read that lands after
 *   the page has gone or the member has signed out writes nothing and opens
 *   no share sheet (`isCurrent`), so one member's account is never offered
 *   over the sign-in screen.
 * - The server allows two a UTC day: `429 account_export_limit` has its own
 *   line. Any other failure is the generic one; a cancelled call says nothing.
 */
import * as Sharing from 'expo-sharing';

import { isCancellation, isProblem } from '../../../api';
import { exportAccountData, healthLocalStore } from '../../../health';
import { todayServerDay } from '../../../i18n/format';

import { clearAllExports, holdForShare, releaseAfterShare, releaseUnshared } from './cleanup';

/** The page that asked is still open, for the member who asked. */
export type ExportIsCurrent = () => boolean;

const ALWAYS: ExportIsCurrent = () => true;

/** What fetching the export came to. */
export type ExportFetch =
  | { readonly kind: 'ready'; readonly uri: string }
  /** The red line under the row: `bodygoals.export.limit` or `common.error_body`. */
  | { readonly kind: 'failed'; readonly errorKey: string; readonly outcome: 'limit' | 'error' }
  /** The call was cancelled: nothing is said. */
  | { readonly kind: 'cancelled' }
  /** The page or the member's session went while it was read: nothing written, nothing said. */
  | { readonly kind: 'stale' };

/** The error line for a failed export (iOS: the limit has its own copy, everything else the generic line). */
export function exportErrorKey(error: unknown): { errorKey: string; outcome: 'limit' | 'error' } {
  const limited = isProblem(error, 'account_export_limit');
  return { errorKey: limited ? 'bodygoals.export.limit' : 'common.error_body', outcome: limited ? 'limit' : 'error' };
}

/**
 * Reads the export and writes it to its scratch file, replacing any earlier
 * one. Never throws. A read that lands when `isCurrent` says no writes
 * nothing.
 */
export async function fetchExportFile(now: Date = new Date(), isCurrent: ExportIsCurrent = ALWAYS): Promise<ExportFetch> {
  let text: string;
  try {
    text = await exportAccountData();
  } catch (error) {
    if (isCancellation(error)) return { kind: 'cancelled' };
    return { kind: 'failed', ...exportErrorKey(error) };
  }
  if (!isCurrent()) return { kind: 'stale' };
  try {
    await clearAllExports();
    const uri = await healthLocalStore.writeExport(text, todayServerDay(now));
    if (!isCurrent()) {
      await clearAllExports();
      return { kind: 'stale' };
    }
    return { kind: 'ready', uri };
  } catch (error) {
    return { kind: 'failed', ...exportErrorKey(error) };
  }
}

/**
 * Offers the file to the share sheet. Once the sheet has answered, shared or
 * not (closing the chooser is an answer, not an error), the file waits out
 * ./cleanup.ts's grace and then goes. Answers false when the sheet was not
 * shown at all (none available, it failed to open, or `isCurrent` says no
 * by then); the file is deleted at once, since no other app has it.
 */
export async function shareExportFile(uri: string, isCurrent: ExportIsCurrent = ALWAYS): Promise<boolean> {
  let answered = false;
  try {
    if (!(await Sharing.isAvailableAsync()) || !isCurrent()) return false;
    holdForShare();
    await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json' });
    answered = true;
    return true;
  } catch {
    return false;
  } finally {
    if (answered) releaseAfterShare();
    else await releaseUnshared();
  }
}
