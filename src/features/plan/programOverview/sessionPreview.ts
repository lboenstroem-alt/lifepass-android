/**
 * The session preview a programme's day row opens (iOS
 * `SessionPreviewSheet(session:canStart:onStart:)`), reached through a
 * bridge because the sheet is PLAN-2's (src/features/plan/preview) and
 * lands separately.
 *
 *   PLAN-2, once, at load:  installSessionPreview((request) => showPreview(request));
 *   PLAN-4's rows:          openSessionPreview({ session, canStart, onStart });
 *
 * Until a preview is installed the rows that would open one are not
 * buttons at all (`useSessionPreviewAvailable`), so no tap ever does nothing.
 */
import { create } from 'zustand';

import type { SessionView } from '../../../health';

export interface SessionPreviewRequest {
  readonly session: SessionView;
  /**
   * Start is offered (today's planned session, previewed from a live plan's
   * overview; never from a proposal or a past plan).
   */
  readonly canStart: boolean;
  /** Start was tapped: the sheet has closed, and the caller opens the runner. */
  readonly onStart: () => void;
}

export type SessionPreviewOpener = (request: SessionPreviewRequest) => void;

const usePreviewBridge = create<{ readonly opener: SessionPreviewOpener | null }>()(() => ({ opener: null }));

/** PLAN-2 installs its sheet. Returns the uninstall. */
export function installSessionPreview(opener: SessionPreviewOpener): () => void {
  usePreviewBridge.setState({ opener });
  return () => {
    if (usePreviewBridge.getState().opener === opener) usePreviewBridge.setState({ opener: null });
  };
}

/** Opens the preview; false when none is installed (the row should not have been a button). */
export function openSessionPreview(request: SessionPreviewRequest): boolean {
  const opener = usePreviewBridge.getState().opener;
  if (!opener) return false;
  opener(request);
  return true;
}

/** Whether a day row can open a preview (re-renders when one is installed). */
export function useSessionPreviewAvailable(): boolean {
  return usePreviewBridge((s) => s.opener !== null);
}

/** Tests: nothing installed. */
export function resetSessionPreviewForTests(): void {
  usePreviewBridge.setState({ opener: null });
}
