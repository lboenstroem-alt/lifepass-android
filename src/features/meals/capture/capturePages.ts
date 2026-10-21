/**
 * Which capture model belongs to which open meal page.
 *
 * The meal page is a root modal with its own stack (Capture, then MEAL-4's
 * Review and Draft pushed inside it, src/navigation/MealCaptureNavigator.tsx).
 * Two pages can be open at once: a meal editor's "Add food" opens a second
 * page (origin `editor`) over the first (iOS presents a second
 * `MealCaptureView`). Every screen of one page shares one navigator, so the
 * navigator's state key names the page: the Capture screen registers its
 * model under it, and any screen inside the same page reads it back.
 *
 *   const model = useCaptureModel();            // in Review, Draft, a camera mode
 *   const tray = useCapture(model, (s) => s.tray);
 *
 * THE EDITOR HANDOFF. Route params carry no callbacks, so the meal that opens
 * a page for "Add food" parks where the items go first, then opens the page:
 *
 *   openMealCaptureForEditor({ slot, date, onAddToMeal: (items) => ... });
 *
 * The next page that opens with origin `editor` takes it.
 */
import { NavigationContext, StackActions } from '@react-navigation/native';
import { useContext } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { navigationRef } from '../../../navigation/navigationRef';
import type { MealCaptureParams, MealSlot } from '../../../navigation/types';
import type { MealItemDraft } from '../types/draft';

import type { CaptureState, MealCaptureModel } from './captureModel';

const pages = new Map<string, MealCaptureModel>();

/** The Capture screen: its model, under its stack's key. Returns the removal. */
export function registerCapturePage(pageKey: string, model: MealCaptureModel): () => void {
  pages.set(pageKey, model);
  return () => {
    if (pages.get(pageKey) === model) pages.delete(pageKey);
  };
}

/** The model of the page whose stack has `pageKey`. */
export function capturePageFor(pageKey: string): MealCaptureModel | null {
  return pages.get(pageKey) ?? null;
}

interface KeyedNavigation {
  getState(): { readonly key?: string } | undefined;
}

/** The key of the stack the calling screen is in (the page's key inside a meal page). */
export function pageKeyOf(navigation: unknown): string | null {
  const state = (navigation as KeyedNavigation | undefined)?.getState?.();
  return typeof state?.key === 'string' ? state.key : null;
}

/**
 * The model of the meal page the calling screen sits in, or null outside one
 * (or before the page's Capture screen has mounted).
 */
export function useCaptureModel(): MealCaptureModel | null {
  const navigation = useContext(NavigationContext);
  const key = pageKeyOf(navigation);
  return key ? capturePageFor(key) : null;
}

/** A slice of a page's state, redrawn when it changes. */
export function useCapture<T>(model: MealCaptureModel, selector: (state: CaptureState) => T): T {
  return useStore(model.store, selector);
}

/** Stands in when there is no page (a sheet a meal editor opened): an empty tray that never changes. */
const NO_PAGE = createStore<CaptureState>()(() => ({
  mode: 'search',
  slot: 'snack',
  date: '',
  tray: [],
  traySource: null,
  chosenLoggedAt: null,
  isSaving: false,
  saveErrorKey: null,
  drafts: {},
  torchAvailable: false,
  torchOn: false,
}));

/** `useCapture` for a page that may not be there. */
export function useCaptureIfAny<T>(model: MealCaptureModel | null, selector: (state: CaptureState) => T): T {
  return useStore(model?.store ?? NO_PAGE, selector);
}

// ---------------------------------------------------------------------------
// The editor handoff

let pendingEditorHandoff: ((items: readonly MealItemDraft[]) => void) | null = null;

/** Park where the next `editor` page's items go. */
export function setEditorHandoff(onAddToMeal: ((items: readonly MealItemDraft[]) => void) | null): void {
  pendingEditorHandoff = onAddToMeal;
}

/** The parked handoff, taken once by the `editor` page that opens next. */
export function takeEditorHandoff(): ((items: readonly MealItemDraft[]) => void) | null {
  const handoff = pendingEditorHandoff;
  pendingEditorHandoff = null;
  return handoff;
}

/**
 * A meal that already exists asks for more food (iOS `MealEditorView`'s
 * "Add food" cover): Search, its slot and date, and the tray's button reads
 * "Add to meal" and hands the items to `onAddToMeal`. The tray is never
 * written to disk for it.
 *
 * PUSHED, never navigated to: from a draft editor inside a meal page, a
 * `navigate('MealCapture')` would go back to the page underneath (same route
 * name) instead of opening a second one over it. False when the app is not
 * ready (nothing opened, nothing parked).
 */
export function openMealCaptureForEditor(options: {
  readonly slot: MealSlot;
  readonly date: string;
  readonly onAddToMeal: (items: readonly MealItemDraft[]) => void;
}): boolean {
  if (!navigationRef.isReady()) return false;
  setEditorHandoff(options.onAddToMeal);
  const params: MealCaptureParams = { origin: 'editor', slot: options.slot, date: options.date, mode: 'search' };
  // At the root stack, where the root modals live.
  navigationRef.dispatch({ ...StackActions.push('MealCapture', params), target: navigationRef.getRootState().key });
  return true;
}

/** Tests: nothing open, nothing parked. */
export function resetCapturePagesForTests(): void {
  pages.clear();
  pendingEditorHandoff = null;
}
