/**
 * The export tap from start to end (iOS `BodyAndGoalsView.export`): read and
 * write the file, report the outcome (`health_export_requested`: ok, limit
 * or error; a cancelled call reports nothing), then hand the file to the
 * share sheet, which deletes it when it answers (./exportData.ts).
 */
import { track } from '../../../lib/analytics';

import { fetchExportFile, shareExportFile } from './exportData';

export interface ExportCallbacks {
  /** The file is ready and the share sheet is going up: the row stops spinning. */
  onReady(): void;
  /** The red line under the row (`bodygoals.export.limit` or `common.error_body`). */
  onFailed(errorKey: string): void;
  /** Cancelled: the row stops spinning and nothing is said. */
  onCancelled(): void;
}

export async function startExport(callbacks: ExportCallbacks): Promise<void> {
  const fetched = await fetchExportFile();
  switch (fetched.kind) {
    case 'cancelled':
      callbacks.onCancelled();
      return;
    case 'failed':
      callbacks.onFailed(fetched.errorKey);
      track('health_export_requested', { outcome: fetched.outcome });
      return;
    case 'ready': {
      callbacks.onReady();
      track('health_export_requested', { outcome: 'ok' });
      const shown = await shareExportFile(fetched.uri);
      if (!shown) callbacks.onFailed('common.error_body');
    }
  }
}
