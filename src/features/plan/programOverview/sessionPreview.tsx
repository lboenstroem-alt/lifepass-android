/**
 * The session preview a day row opens (iOS `SessionPreviewSheet`), for the
 * programme overview's rows and the proposal card's week one. Each screen
 * holds its own preview, as each iOS view does (`@State previewSession` and
 * `.sheet(item:)`):
 *
 *   const preview = useSessionPreview();
 *   preview.open({ session, canStart, onStart, onPulled, onChangeWithCoach });
 *   return <>{...}{preview.element}</>;
 *
 * Every opening is its own sheet (keyed per opening), so a "Do it today"
 * the server refused in one does not hide the button in the next. Start and
 * Change with Coach run once the sheet has gone (../preview's sheet does
 * that), so the caller can pop to Plan and present the runner, or switch to
 * the Coach, without a sheet still sliding over it.
 *
 * The sheet is ../preview's `SessionPreviewSheet` and Start's rule its
 * `canStartRunnerToday`, the same ones the Today card uses: one sheet behind
 * every door into a session (iOS opens the one view from all four).
 */
import { useCallback, useRef, useState, type ComponentType, type ReactElement } from 'react';

import type { SessionActionResponse, SessionView } from '../../../health';
import { canStartRunnerToday, SessionPreviewSheet } from '../preview';

/** What a day row hands the sheet: a subset of ../preview's `SessionPreviewSheetProps`. */
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
  /** A "Do it today" succeeded: the host takes the answer in. */
  onPulled?: (response: SessionActionResponse) => void;
  /** "Change with Coach": runs once the sheet has gone. Absent: not offered. */
  onChangeWithCoach?: () => void;
  testID?: string;
}

/** The sheet every day row opens. */
export const PreviewSheet: ComponentType<PreviewSheetProps> = SessionPreviewSheet;

/** Start in a preview: today's planned session, the runner's kinds, nothing in the way. */
export const canStartToday = canStartRunnerToday;

export interface PreviewRequest {
  readonly session: SessionView;
  /** Start is offered (today's planned session, previewed from a live plan's overview). */
  readonly canStart: boolean;
  /** Start was tapped: the sheet has gone, and the caller opens the runner. */
  readonly onStart?: () => void;
  /** A pull succeeded (iOS hosts that pass no `onPulled` ignore the answer). */
  readonly onPulled?: (response: SessionActionResponse) => void;
  /** Change with Coach was tapped: the sheet has gone. Absent: the sheet does not offer it. */
  readonly onChangeWithCoach?: () => void;
}

export interface SessionPreview {
  open(request: PreviewRequest): void;
  /** The sheet, to render anywhere in the screen (it draws in the UI kit's portal). */
  readonly element: ReactElement | null;
}

interface Shown extends PreviewRequest {
  readonly id: number;
  readonly visible: boolean;
}

/** `sheet`: ../preview's (the default); a test may hand in a stand-in. */
export function useSessionPreview(testID = 'plan.preview', sheet: ComponentType<PreviewSheetProps> = PreviewSheet): SessionPreview {
  const [shown, setShown] = useState<Shown | null>(null);
  const nextId = useRef(0);

  const open = useCallback((request: PreviewRequest) => {
    nextId.current += 1;
    setShown({ ...request, id: nextId.current, visible: true });
  }, []);

  let element: ReactElement | null = null;
  if (shown) {
    const Sheet = sheet;
    const { id } = shown;
    element = (
      <Sheet
        key={id}
        visible={shown.visible}
        session={shown.session}
        canStart={shown.canStart}
        onStart={shown.onStart}
        onPulled={shown.onPulled}
        onChangeWithCoach={shown.onChangeWithCoach}
        // Bound to this opening, so a sheet still sliding away never closes the next one.
        onClose={() => setShown((current) => (current?.id === id ? { ...current, visible: false } : current))}
        onClosed={() => setShown((current) => (current?.id === id ? null : current))}
        testID={testID}
      />
    );
  }
  return { open, element };
}
