/**
 * One barcode, looked up in two places at once (ios-ux.md 12.5): the port of
 * iOS `BarcodeLookupModel` (Views/Meals/BarcodeScanMode.swift).
 *
 * - The member's own foods and staff label rows on the server (OP-31, 8 s),
 *   and Open Food Facts from the phone (OP-41, 8 s), in parallel.
 * - THE SERVER'S ANSWER WINS: the member's own food ("Your food") or a staff
 *   label row ("From the label") replaces whatever Open Food Facts said.
 * - A product Open Food Facts found shows at once; "no nutrition", "not
 *   found" and "lookup failed" wait for the server too (it may know better).
 * - After three seconds with neither, the sheet opens in its looking state
 *   so Quick add and Create my food are already usable (R6).
 * - Every lookup has a token: an answer for an earlier code (or after the
 *   sheet closed) changes nothing.
 *
 * One model per Barcode mode; the mode disposes it when it goes.
 */
import { AccessibilityInfo } from 'react-native';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { translate, type Lang } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { mealApi } from '../api/mealApi';
import { foodFacts } from '../offClient/client';
import type { OFFLookupOutcome } from '../offClient/parse';
import type { FoodChoice, OFFSnapshot } from '../types/models';

/** What the result sheet shows (iOS `BarcodeLookupModel.Result`). */
export type BarcodeResult =
  | { readonly kind: 'looking' }
  /** The member's own food (`mine`) or a staff label row (`library`). */
  | { readonly kind: 'choice'; readonly food: FoodChoice; readonly origin: string }
  | { readonly kind: 'product'; readonly snapshot: OFFSnapshot; readonly liquid: boolean }
  | { readonly kind: 'noNutrition'; readonly name: string | null; readonly brand: string | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed' };

/** How the code arrived (`barcode_scanned.source`). */
export type BarcodeSource = 'camera' | 'typed';

export interface BarcodeLookupState {
  readonly code: string | null;
  readonly result: BarcodeResult | null;
  /** The bottom card while nothing has answered. */
  readonly isLooking: boolean;
  readonly sheetShown: boolean;
  readonly source: BarcodeSource;
}

/** The sheet opens in its looking state after this long with no answer. */
export const BARCODE_EARLY_OPEN_MS = 3_000;

const INITIAL: BarcodeLookupState = { code: null, result: null, isLooking: false, sheetShown: false, source: 'camera' };

export class BarcodeLookupModel {
  readonly store: StoreApi<BarcodeLookupState> = createStore<BarcodeLookupState>()(() => INITIAL);

  private token: object = {};
  private serverDone = false;
  private offOutcome: OFFLookupOutcome | null = null;
  private earlyTimer: ReturnType<typeof setTimeout> | null = null;

  get state(): BarcodeLookupState {
    return this.store.getState();
  }

  private set(patch: Partial<BarcodeLookupState>): void {
    this.store.setState(patch);
  }

  /** Look `code` up in both places. `language` is the account language. */
  start(code: string, source: BarcodeSource, language: Lang): void {
    const token = {};
    this.token = token;
    this.clearTimer();
    this.serverDone = false;
    this.offOutcome = null;
    this.set({ code, source, result: null, isLooking: true, sheetShown: false });
    track('barcode_scanned', { source });
    AccessibilityInfo.announceForAccessibility(translate('meal.barcode.looking', language));

    void mealApi()
      .barcode(code, language)
      .then(
        (answer) => answer,
        () => null,
      )
      .then((answer) => {
        if (token !== this.token) return;
        this.serverDone = true;
        if (answer?.food) {
          this.show({ kind: 'choice', food: answer.food, origin: answer.origin ?? 'mine' });
          track('barcode_result', { outcome: answer.origin === 'library' ? 'label_found' : 'mine_found' });
          return;
        }
        this.settle();
      });

    void foodFacts()
      .lookup(code, language)
      .catch((): OFFLookupOutcome => ({ kind: 'failed' }))
      .then((outcome) => {
        if (token !== this.token) return;
        this.offOutcome = outcome;
        this.settle();
      });

    this.earlyTimer = setTimeout(() => {
      this.earlyTimer = null;
      if (token !== this.token || this.state.sheetShown) return;
      if (this.state.result === null) {
        this.set({ result: { kind: 'looking' } });
        track('barcode_result', { outcome: 'early_open' });
      }
      this.set({ sheetShown: true });
    }, BARCODE_EARLY_OPEN_MS);
  }

  /** Try the whole lookup again (Lookup failed, Try again): the sheet stays up, looking. */
  retry(language: Lang): void {
    const { code, source } = this.state;
    if (!code) return;
    this.start(code, source, language);
    this.set({ sheetShown: true, result: { kind: 'looking' } });
  }

  private settle(): void {
    if (this.state.result?.kind === 'choice') return;
    const outcome = this.offOutcome;
    if (!outcome) return;
    switch (outcome.kind) {
      case 'found':
        this.show({ kind: 'product', snapshot: outcome.snapshot, liquid: outcome.liquid });
        track('barcode_result', { outcome: 'off_found' });
        return;
      case 'noNutrition':
        if (!this.serverDone) return;
        this.show({ kind: 'noNutrition', name: outcome.name, brand: outcome.brand });
        track('barcode_result', { outcome: 'no_nutrition' });
        return;
      case 'notFound':
        if (!this.serverDone) return;
        this.show({ kind: 'notFound' });
        track('barcode_result', { outcome: 'not_found' });
        return;
      case 'failed':
        if (!this.serverDone) return;
        this.show({ kind: 'failed' });
        track('barcode_result', { outcome: 'lookup_failed' });
        return;
    }
  }

  private show(result: BarcodeResult): void {
    this.set({ result, isLooking: false, sheetShown: true });
  }

  /** The sheet has gone: whatever is still on its way is ignored. */
  reset(): void {
    this.token = {};
    this.clearTimer();
    this.set({ code: null, result: null, isLooking: false, sheetShown: false });
  }

  /** The mode has gone. */
  dispose(): void {
    this.token = {};
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.earlyTimer) clearTimeout(this.earlyTimer);
    this.earlyTimer = null;
  }
}
