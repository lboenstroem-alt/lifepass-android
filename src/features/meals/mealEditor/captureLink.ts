/**
 * The meal page an editor is pushed inside (iOS `MealEditorView(mode:
 * .tray(model))` and its `capture:` parameter): the capture page's model,
 * as much of it as the Review and Draft screens use.
 *
 * MEAL-2 owns the model (src/features/meals/capture/captureModel.ts,
 * `MealCaptureModel`) and keeps one per open page, registered under the
 * page's stack key (capture/capturePages.ts, `useCaptureModel()`). Its
 * public surface is a structural superset of `MealCaptureLink` below, so the
 * Review and Draft screens take it as it is.
 */
import { useSyncExternalStore } from 'react';

import { useCaptureModel } from '../capture/capturePages';
import type { MealCaptureMode, MealCaptureOrigin, MealSlot } from '../../../navigation/types';
import type { MealItemDraft } from '../types/draft';
import type { MealEntrySource, MealRecord } from '../types/models';

/** The part of the page's state the editors read. */
export interface MealCaptureLinkState {
  readonly mode: MealCaptureMode;
  readonly slot: MealSlot;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly tray: readonly MealItemDraft[];
  /** A time the member picked in the review's When row. */
  readonly chosenLoggedAt: Date | null;
  /** Why the last save failed, when nothing else can be done about it here. */
  readonly saveErrorKey: string | null;
  /** Drafts a scan or a description returned, by id, for the Draft screen. */
  readonly drafts: Readonly<Record<string, MealRecord>>;
}

/** What a save of the tray led to (iOS `MealCaptureModel.SaveOutcome`). */
export type MealCaptureSaveOutcome =
  | { readonly kind: 'saved'; readonly meal: MealRecord }
  | { readonly kind: 'queued' }
  | { readonly kind: 'failed' };

export interface MealCaptureLink {
  /** Who opened the page (`scanTab`, `plan`, `diary`, `editor`). */
  readonly origin: MealCaptureOrigin;
  readonly store: {
    getState(): MealCaptureLinkState;
    subscribe(listener: () => void): () => void;
  };
  /** The tray item with this `localId` changed. */
  replace(item: MealItemDraft): void;
  /** Items join the tray (the review's Add food lands in Search instead). */
  add(items: readonly MealItemDraft[], source: MealEntrySource): void;
  remove(itemId: string): void;
  setSlot(slot: MealSlot): void;
  setDate(date: string): void;
  setChosenLoggedAt(at: Date | null): void;
  setMode(mode: MealCaptureMode): void;
  /** OP-34, or the outbox offline (the page's save path, toasts included). */
  save(): Promise<MealCaptureSaveOutcome>;
  /** Close the whole page. */
  close(): void;
  /** Empty the tray (and its file): a confirmed draft took its items. */
  discardTray(): void;
}

/** The meal page the calling screen sits in, or null outside one. */
export function useMealCaptureLink(): MealCaptureLink | null {
  return useCaptureModel();
}

const NO_STATE_STORE = {
  getState: (): MealCaptureLinkState | null => null,
  subscribe: (): (() => void) => () => undefined,
};

/** The page's state, redrawn when it changes (null without a page). */
export function useMealCaptureState(link: MealCaptureLink | null): MealCaptureLinkState | null {
  const store = link?.store ?? NO_STATE_STORE;
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
