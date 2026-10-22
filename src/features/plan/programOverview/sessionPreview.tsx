/**
 * The session preview a day row opens (iOS `SessionPreviewSheet`), for the
 * programme overview's rows and the proposal card's week one. Each screen
 * holds its own preview, as each iOS view does (`@State previewSession` and
 * `.sheet(item:)`):
 *
 *   const preview = useSessionPreview();
 *   preview.available               // false: the rows are not buttons at all
 *   preview.open({ session, canStart, onStart });
 *   return <>{...}{preview.element}</>;
 *
 * Every opening is its own sheet (keyed per opening), so a "Do it today"
 * the server refused in one does not hide the button in the next. Start runs
 * once the sheet has gone (PLAN-2's sheet does that), so the caller can pop
 * to Plan and present the runner without a sheet still sliding over it.
 *
 * THE ONE SEAM WITH PLAN-2. The sheet and the Start rule are PLAN-2's
 * (src/features/plan/preview: `SessionPreviewSheet`, `canStartRunnerToday`),
 * which lands on its own branch. Until it is merged `PreviewSheet` is null:
 * no row is a button, so no tap ever does nothing.
 *
 * MERGER, once parity/plan-2 is in: replace the block marked below with
 *
 *   import { canStartRunnerToday, SessionPreviewSheet } from '../preview';
 *   export const PreviewSheet: ComponentType<PreviewSheetProps> | null = SessionPreviewSheet;
 *   export const canStartToday: CanStartToday = canStartRunnerToday;
 *
 * and delete `canStartFromOverview` (and its tests) from ./overviewRules.ts.
 * REL-1: `PreviewSheet` must not be null in a release build.
 */
import { useCallback, useRef, useState, type ComponentType, type ReactElement } from 'react';

import type { SessionView } from '../../../health';

import { canStartFromOverview } from './overviewRules';

/** What PLAN-4 hands the sheet: a subset of PLAN-2's `SessionPreviewSheetProps`. */
export interface PreviewSheetProps {
  visible: boolean;
  /** The member asked to close it: the host sets `visible` to false. */
  onClose: () => void;
  /** It has fully left the screen. */
  onClosed?: () => void;
  session: SessionView;
  /** Today's planned session of a live plan: Start is offered. */
  canStart?: boolean;
  /** Start: runs once the sheet has gone. */
  onStart?: () => void;
  testID?: string;
}

/** Start in a preview (PLAN-2's `canStartRunnerToday`). */
export type CanStartToday = (
  session: Pick<SessionView, 'kind' | 'scheduledFor' | 'status'>,
  context: { readonly readOnly: boolean; readonly programPaused: boolean; readonly outboxPending: boolean; readonly today: string },
) => boolean;

// ---- Until parity/plan-2 is merged (MERGER: replace this block, see above) ----
export const PreviewSheet: ComponentType<PreviewSheetProps> | null = null;
export const canStartToday: CanStartToday = canStartFromOverview;
// ---- end of block ----

export interface PreviewRequest {
  readonly session: SessionView;
  /** Start is offered (today's planned session, previewed from a live plan's overview). */
  readonly canStart: boolean;
  /** Start was tapped: the sheet has gone, and the caller opens the runner. */
  readonly onStart?: () => void;
}

export interface SessionPreview {
  /** A preview can be opened: the rows that open one are buttons. */
  readonly available: boolean;
  open(request: PreviewRequest): void;
  /** The sheet, to render anywhere in the screen (it draws in the UI kit's portal). */
  readonly element: ReactElement | null;
}

interface Shown extends PreviewRequest {
  readonly id: number;
  readonly visible: boolean;
}

/** `sheet`: PLAN-2's (the default); tests hand in a stand-in. */
export function useSessionPreview(testID = 'plan.preview', sheet: ComponentType<PreviewSheetProps> | null = PreviewSheet): SessionPreview {
  const [shown, setShown] = useState<Shown | null>(null);
  const nextId = useRef(0);

  const open = useCallback((request: PreviewRequest) => {
    nextId.current += 1;
    setShown({ ...request, id: nextId.current, visible: true });
  }, []);

  let element: ReactElement | null = null;
  if (sheet && shown) {
    const Sheet = sheet;
    const { id } = shown;
    element = (
      <Sheet
        key={id}
        visible={shown.visible}
        session={shown.session}
        canStart={shown.canStart}
        onStart={shown.onStart}
        // Bound to this opening, so a sheet still sliding away never closes the next one.
        onClose={() => setShown((current) => (current?.id === id ? { ...current, visible: false } : current))}
        onClosed={() => setShown((current) => (current?.id === id ? null : current))}
        testID={testID}
      />
    );
  }
  return { available: sheet !== null, open, element };
}
