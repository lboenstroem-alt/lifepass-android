/**
 * The export tap from start to end (iOS `BodyAndGoalsView.export`): read and
 * write the file, report the outcome (`health_export_requested`: ok, limit
 * or error; a cancelled call reports nothing), then hand the file to the
 * share sheet (./exportData.ts, which says when the file goes).
 *
 * TIED TO THE PAGE AND THE MEMBER: when `isCurrent` says no once the read
 * lands (the member left Body and goals or signed out meanwhile), nothing is
 * written, nothing is shared and nothing is reported. On iOS a sheet set on
 * a view that has gone presents nothing; here the chooser would open over
 * whatever is on screen, the sign-in screen included.
 */
import { track } from '../../../lib/analytics';

import { clearAllExports } from './cleanup';
import { fetchExportFile, shareExportFile, type ExportIsCurrent } from './exportData';

export interface ExportCallbacks {
  /** The file is ready and the share sheet is going up: the row stops spinning. */
  onReady(): void;
  /** The red line under the row (`bodygoals.export.limit` or `common.error_body`). */
  onFailed(errorKey: string): void;
  /** Cancelled, or no longer wanted: the row stops spinning and nothing is said. */
  onCancelled(): void;
  /** The page that asked is still open, for the member who asked (omitted: always). */
  isCurrent?: ExportIsCurrent;
}

export async function startExport(callbacks: ExportCallbacks): Promise<void> {
  const isCurrent: ExportIsCurrent = () => callbacks.isCurrent?.() ?? true;
  const fetched = await fetchExportFile(new Date(), isCurrent);
  switch (fetched.kind) {
    case 'cancelled':
    case 'stale':
      callbacks.onCancelled();
      return;
    case 'failed':
      callbacks.onFailed(fetched.errorKey);
      track('health_export_requested', { outcome: fetched.outcome });
      return;
    case 'ready': {
      if (!isCurrent()) {
        await clearAllExports();
        callbacks.onCancelled();
        return;
      }
      callbacks.onReady();
      track('health_export_requested', { outcome: 'ok' });
      const shown = await shareExportFile(fetched.uri, isCurrent);
      if (!shown && isCurrent()) callbacks.onFailed('common.error_body');
    }
  }
}
