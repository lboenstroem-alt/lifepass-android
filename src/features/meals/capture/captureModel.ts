/**
 * Everything the meal capture page holds while it is open: the mode, the
 * slot and date, the tray, and the save. The Android port of iOS
 * `MealCaptureModel` (Views/Meals/MealCaptureView.swift, ios-ux.md 12 and
 * 16.6).
 *
 * ONE MODEL PER PAGE. iOS keeps it in the page's `@State`; a meal editor's
 * "Add food" opens a SECOND page over the first (origin `editor`), so this is
 * not a singleton. The page creates its model when it mounts and registers
 * it under its own stack's key (./capturePages.ts); the screens pushed inside
 * the same page (MEAL-4's Review and Draft, MEAL-3's camera modes) find it
 * with `useCaptureModel()`.
 *
 * MONEY-LIKE RULES OF THE SAVE (OP-34):
 * - ONE Idempotency-Key per Save tap, reused only by the retry of that same
 *   save (the consent sheet's retry), so a meal is never logged twice. A
 *   `422 idempotency_key_reused` (the key was spent on another body) is
 *   retried ONCE with a fresh key.
 * - Offline, the meal goes to the outbox with that key and the member is told
 *   it will sync: a logged meal is never lost. With ten already waiting the
 *   tray is kept and the line says so (`meal.outbox.full`).
 * - The meal-level `source` is where the FIRST item came from.
 * - `loggedAt` is the time picked in the review when it is on the meal's
 *   date, else now (today) or this time of day on a past date.
 *
 * THE TRAY is written to `tray.json` on every change (items, slot, date,
 * source) and offered back within a day; never for the `editor` origin,
 * whose items go back to the meal that opened the page.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { ApiError, newIdempotencyKey } from '../../../api';
import { currentLanguage, translate } from '../../../i18n';
import { addServerDays, dateFromServerDay, serverDay, todayServerDay } from '../../../i18n/format';
import { useHealthStore } from '../../../health/store';
import type { HealthAccess } from '../../../health/models';
import { track } from '../../../lib/analytics';
import type { MealCaptureMode, MealCaptureOrigin, MealSlot } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { mealApi } from '../api/mealApi';
import { refreshMineFoods } from '../foodsCache/foodsCache';
import { autoSlot, loggedAtFor, mealTotals } from '../math/itemMath';
import { enqueueMeal } from '../outbox/mealOutbox';
import { clearTray, restoreTray, saveTray } from '../tray/trayStore';
import type { MealItemDraft } from '../types/draft';
import { draftInput } from '../types/draftFactory';
import {
  MEAL_ENTRY_SOURCES,
  type MealCreateBody,
  type MealDayTotals,
  type MealEntrySource,
  type MealRecord,
  type MealSlotChoice,
} from '../types/models';

import { mealCountBand } from './mealAnalytics';
import { mealSavedFeedback, showMealToast } from './saveFeedback';

/** The five slots a member can pick, in the diary's order (iOS `MealSlot.editable`). */
export const EDITABLE_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];

/** Every mode, in the switcher's order (iOS `MealCaptureMode.allCases`). */
export const CAPTURE_MODES: readonly MealCaptureMode[] = ['photo', 'barcode', 'search'];

/** OP-32 and OP-56 take the last 30 days (C21); Barcode and Search reach back a year. */
export const PHOTO_PAST_DAYS = 30;
export const SEARCH_PAST_DAYS = 365;

export function isEditableSlot(value: string | null | undefined): value is MealSlot {
  return (EDITABLE_SLOTS as readonly string[]).includes(value ?? '');
}

export function isEntrySource(value: string | null | undefined): value is MealEntrySource {
  return (MEAL_ENTRY_SOURCES as readonly string[]).includes(value ?? '');
}

/** A camera mode (Photo, Barcode): black page, hidden status bar, the torch. */
export function modeUsesCamera(mode: MealCaptureMode): boolean {
  return mode !== 'search';
}

/**
 * Whether a photo (and a description) can be estimated for `date`: the last
 * 30 days only (iOS `MealCaptureModel.photoAllowed(on:)`). A date that is not
 * a day does not block anything.
 */
export function photoAllowed(date: string, today: string = todayServerDay()): boolean {
  const limit = addServerDays(today, -PHOTO_PAST_DAYS);
  if (!limit || !dateFromServerDay(date)) return true;
  return date >= limit;
}

/** The slot the page opens with: the phone's clock for `auto`. */
export function resolveSlot(choice: MealSlotChoice, now: Date = new Date()): MealSlot {
  if (choice.kind === 'fixed' && isEditableSlot(choice.slot)) return choice.slot;
  const slot = autoSlot(now);
  return isEditableSlot(slot) ? slot : 'snack';
}

/** The in-page toast sits clear of the tray bar (iOS `mealToastOverlay(bottomPadding: tray.isEmpty ? 40 : 100)`). */
export function pageToastOffset(trayCount: number): number {
  return trayCount === 0 ? 40 : 100;
}

/** What Save led to (iOS `SaveOutcome`). */
export type SaveOutcome = { readonly kind: 'saved'; readonly meal: MealRecord } | { readonly kind: 'queued' } | { readonly kind: 'failed' };

/** How the page closed, for `meal_capture_closed`. */
export type CaptureCloseTray = 'kept' | 'empty' | 'discarded';

export interface CaptureState {
  readonly mode: MealCaptureMode;
  readonly slot: MealSlot;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly tray: readonly MealItemDraft[];
  /** Where the first item came from: the meal-level `source` (6.5). */
  readonly traySource: MealEntrySource | null;
  /**
   * A time the member picked in the review's When row; otherwise the meal is
   * logged now (or at this time of day on a past date).
   */
  readonly chosenLoggedAt: Date | null;
  readonly isSaving: boolean;
  /** A copy key shown under the tray when a save failed and nothing else can be done about it here. */
  readonly saveErrorKey: string | null;
  /** Drafts a scan or a description returned, by id, for the pushed editor. */
  readonly drafts: Readonly<Record<string, MealRecord>>;
  /** The camera modes' light (MEAL-3 says whether there is one and reads whether it is on). */
  readonly torchAvailable: boolean;
  readonly torchOn: boolean;
}

/** What the page wires in when it mounts (iOS sets these in the page's `.task`). */
export interface CapturePageBindings {
  /** Close the page. */
  readonly close: (tray: CaptureCloseTray) => void;
  /** A membership wall (403): close and show the gate over whatever is underneath. */
  readonly showGate: (access: HealthAccess) => void;
  /** Consent is needed (409 while entitled): the sheet, then `retry` once it is granted. */
  readonly askConsent: (retry: () => Promise<void>) => void;
  /** Push the draft editor for this meal inside the page. */
  readonly openDraftRoute: (mealId: string) => void;
}

const NO_BINDINGS: CapturePageBindings = {
  close: () => undefined,
  showGate: () => undefined,
  askConsent: () => undefined,
  openDraftRoute: () => undefined,
};

export interface CaptureModelOptions {
  readonly origin: MealCaptureOrigin;
  readonly mode: MealCaptureMode;
  readonly slot: MealSlotChoice;
  readonly date: string;
  /** `editor` origin: hand the tray to the meal that opened the page. */
  readonly onAddToMeal?: ((items: readonly MealItemDraft[]) => void) | null;
  readonly now?: Date;
}

/** The member the tray file and the outbox belong to (iOS `appState.profile?.id`). */
function currentProfileId(): string | null {
  return useAppStore.getState().profile?.id ?? null;
}

export class MealCaptureModel {
  readonly origin: MealCaptureOrigin;
  readonly store: StoreApi<CaptureState>;
  /** `editor` origin: where the tray's items go instead of a new meal. */
  onAddToMeal: ((items: readonly MealItemDraft[]) => void) | null;

  private bindings: CapturePageBindings = NO_BINDINGS;
  /** One key per Save tap, reused only by the retry of that same save. */
  private saveKey: string | null = null;
  private lastAddedIds: readonly string[] = [];
  /** False once the page has gone: a late answer changes nothing on screen. */
  private alive = true;

  constructor(options: CaptureModelOptions) {
    this.origin = options.origin;
    this.onAddToMeal = options.onAddToMeal ?? null;
    let mode = options.mode;
    // OP-32 takes the last 30 days only (C21).
    if (mode === 'photo' && !photoAllowed(options.date, todayServerDay(options.now))) mode = 'search';
    this.store = createStore<CaptureState>()(() => ({
      mode,
      slot: resolveSlot(options.slot, options.now),
      date: options.date,
      tray: [],
      traySource: null,
      chosenLoggedAt: null,
      isSaving: false,
      saveErrorKey: null,
      drafts: {},
      torchAvailable: false,
      torchOn: false,
    }));
  }

  get state(): CaptureState {
    return this.store.getState();
  }

  private set(patch: Partial<CaptureState>): void {
    if (!this.alive) return;
    this.store.setState(patch);
  }

  // -------------------------------------------------------------------------
  // The page

  bind(bindings: CapturePageBindings): void {
    this.bindings = bindings;
  }

  /** The page has gone: nothing it started may change it or call back into it. */
  dispose(): void {
    this.alive = false;
    this.bindings = NO_BINDINGS;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Close the page; `tray` says how, for `meal_capture_closed` (default: whether anything is left). */
  close(tray?: CaptureCloseTray): void {
    this.bindings.close(tray ?? (this.state.tray.length === 0 ? 'empty' : 'kept'));
  }

  /** Whatever was underneath gets the gate (the page cannot show it: it is on its way out). */
  showGate(access: HealthAccess): void {
    this.bindings.showGate(access);
  }

  // -------------------------------------------------------------------------
  // Derived

  get photoAvailable(): boolean {
    return photoAllowed(this.state.date);
  }

  /** OP-56 takes the same 30 days as OP-32: an older day gets no Describe entry. */
  get describeAvailable(): boolean {
    return photoAllowed(this.state.date);
  }

  get isToday(): boolean {
    return this.state.date === todayServerDay();
  }

  get trayTotals(): MealDayTotals {
    return mealTotals(this.state.tray);
  }

  // -------------------------------------------------------------------------
  // Mode, slot, date

  setMode(mode: MealCaptureMode): void {
    if (mode === this.state.mode) return;
    if (mode === 'photo' && !this.photoAvailable) return;
    this.set({ mode, torchOn: modeUsesCamera(mode) ? this.state.torchOn : false });
  }

  setSlot(slot: MealSlot): void {
    this.set({ slot });
    this.persistTray();
  }

  /** A new date; Photo gives way to Search when the day is older than 30 days. */
  setDate(date: string): void {
    this.set({ date });
    if (this.state.mode === 'photo' && !this.photoAvailable) this.set({ mode: 'search', torchOn: false });
    this.persistTray();
  }

  setChosenLoggedAt(at: Date | null): void {
    this.set({ chosenLoggedAt: at });
  }

  setTorch(on: boolean): void {
    this.set({ torchOn: on });
  }

  setTorchAvailable(available: boolean): void {
    this.set({ torchAvailable: available, torchOn: available ? this.state.torchOn : false });
  }

  // -------------------------------------------------------------------------
  // Tray

  add(items: readonly MealItemDraft[], source: MealEntrySource): void {
    if (items.length === 0) return;
    const { tray, traySource } = this.state;
    this.set({ tray: [...tray, ...items], traySource: tray.length === 0 ? source : traySource });
    this.lastAddedIds = items.map((item) => item.localId);
    this.persistTray();
  }

  /** The "Added" toast's Undo: the last batch goes. */
  undoLastAdd(): void {
    const added = new Set(this.lastAddedIds);
    const tray = this.state.tray.filter((item) => !added.has(item.localId));
    this.lastAddedIds = [];
    this.set({ tray, traySource: tray.length === 0 ? null : this.state.traySource });
    this.persistTray();
  }

  replace(item: MealItemDraft): void {
    const index = this.state.tray.findIndex((entry) => entry.localId === item.localId);
    if (index < 0) return;
    const tray = [...this.state.tray];
    tray[index] = item;
    this.set({ tray });
    this.persistTray();
  }

  remove(itemId: string): void {
    const tray = this.state.tray.filter((item) => item.localId !== itemId);
    this.set({ tray, traySource: tray.length === 0 ? null : this.state.traySource });
    this.persistTray();
  }

  /** Writes the tray (or removes the file when it is empty). Never for the `editor` origin. */
  persistTray(): void {
    const profileId = currentProfileId();
    if (!profileId || this.origin === 'editor' || !this.alive) return;
    const { tray, slot, date, traySource } = this.state;
    if (tray.length === 0) {
      void clearTray(profileId);
    } else {
      void saveTray({ items: tray, slot, date, source: traySource, savedAt: new Date() }, profileId);
    }
  }

  /**
   * A tray younger than a day comes back with its slot and date (R8). True
   * when it did (the page then says so).
   */
  async restoreTray(): Promise<boolean> {
    const profileId = currentProfileId();
    if (!profileId || this.origin === 'editor' || this.state.tray.length > 0) return false;
    const snapshot = await restoreTray(profileId);
    // The member may have added something (or left) while the file was read.
    if (!snapshot || !this.alive || this.state.tray.length > 0) return false;
    this.set({
      tray: snapshot.items,
      slot: isEditableSlot(snapshot.slot) ? snapshot.slot : this.state.slot,
      date: snapshot.date,
      traySource: isEntrySource(snapshot.source) ? snapshot.source : null,
    });
    if (this.state.mode === 'photo' && !this.photoAvailable) this.set({ mode: 'search', torchOn: false });
    return true;
  }

  discardTray(): void {
    this.set({ tray: [], traySource: null });
    const profileId = currentProfileId();
    if (profileId && this.origin !== 'editor') void clearTray(profileId);
  }

  /**
   * Open a draft the server just saved in the result editor, on top of this
   * page. Items already in the tray join it there (12.4). `meal` is null when
   * only its id is known (a description's draft): the editor reads it.
   */
  openDraft(mealId: string, meal: MealRecord | null = null): void {
    if (!this.alive) return;
    if (meal) this.set({ drafts: { ...this.state.drafts, [mealId]: meal } });
    this.bindings.openDraftRoute(mealId);
  }

  // -------------------------------------------------------------------------
  // Save (OP-34, 16.6)

  /**
   * The tray's button: save a new meal and close, or, opened from a meal that
   * already exists, hand the items back to it.
   */
  async commitTray(): Promise<SaveOutcome> {
    if (this.origin === 'editor') {
      this.onAddToMeal?.(this.state.tray);
      this.set({ tray: [], traySource: null });
      this.close();
      return { kind: 'failed' };
    }
    const outcome = await this.save();
    if (outcome.kind !== 'failed') this.close();
    return outcome;
  }

  /** The body Save sends for the tray as it is now. */
  createBody(now: Date = new Date()): MealCreateBody {
    const { slot, date, chosenLoggedAt, traySource, tray } = this.state;
    const chosen = chosenLoggedAt !== null && serverDay(chosenLoggedAt) === date ? chosenLoggedAt : null;
    return {
      slot,
      loggedAt: chosen ?? loggedAtFor(date, now),
      logDate: date,
      source: traySource ?? 'search',
      items: tray.map(draftInput),
    };
  }

  /**
   * Save the tray as a new meal. Offline, it goes to the meal outbox and the
   * member is told it will sync: a logged meal is never lost.
   */
  async save(): Promise<SaveOutcome> {
    const { tray, isSaving } = this.state;
    if (tray.length === 0 || isSaving) return { kind: 'failed' };
    return this.post(this.createBody(), currentProfileId(), false);
  }

  private async post(body: MealCreateBody, profileId: string | null, retriedKey: boolean): Promise<SaveOutcome> {
    this.set({ isSaving: true, saveErrorKey: null });
    const key = this.saveKey ?? newIdempotencyKey();
    this.saveKey = key;
    try {
      const result = await mealApi().createMeal(body, key);
      this.saveKey = null;
      track('meal_logged', { source: body.source, items: mealCountBand(body.items.length), edited: false });
      track('meal_tray_saved', { items: mealCountBand(body.items.length) });
      this.discardTray();
      refreshMineFoods();
      mealSavedFeedback(result.meal);
      return { kind: 'saved', meal: result.meal };
    } catch (error) {
      if (!(error instanceof ApiError)) {
        this.set({ saveErrorKey: 'common.error_body' });
        return { kind: 'failed' };
      }
      if (error.isCancellation) return { kind: 'failed' };
      if (error.isOffline) {
        if (!profileId) return { kind: 'failed' };
        if (await enqueueMeal(body, key, profileId)) {
          this.saveKey = null;
          this.discardTray();
          showMealToast(translate('health.saved_offline', currentLanguage()));
          return { kind: 'queued' };
        }
        this.set({ saveErrorKey: 'meal.outbox.full' });
        return { kind: 'failed' };
      }
      if (error.isProblem('idempotency_key_reused') && !retriedKey) {
        this.saveKey = newIdempotencyKey();
        return this.post(body, profileId, true);
      }
      switch (useHealthStore.getState().handle(error, { foreground: true })) {
        case 'presentConsent':
          this.bindings.askConsent(async () => {
            await this.save();
          });
          break;
        case 'gate':
          this.showGate(useAppStore.getState().healthAccess);
          break;
        case 'pendingDeletion':
          this.set({ saveErrorKey: 'health.err.pending_deletion' });
          break;
        case 'rateLimited':
          this.set({ saveErrorKey: 'health.err.rate_limited' });
          break;
        case 'minor':
        case 'reconciling':
        case 'wiped':
          this.close();
          break;
        default:
          this.set({ saveErrorKey: 'common.error_body' });
      }
      return { kind: 'failed' };
    } finally {
      this.set({ isSaving: false });
    }
  }
}
