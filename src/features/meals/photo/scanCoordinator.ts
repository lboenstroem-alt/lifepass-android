/**
 * Runs OP-32 on behalf of Photo mode, and keeps running it when the member
 * taps Keep going and leaves (R5): the port of iOS `MealScanCoordinator`
 * (Views/Meals/PhotoCaptureMode.swift).
 *
 * ONE PER APP, outliving the page: the request a member left with Keep going
 * still answers, as an app-wide toast.
 *
 * THE PHOTO lives here only until the call returns: the JPEG is dropped the
 * moment the answer arrives. What is kept is the picture for the draft
 * editor's banner, in memory only, keyed by the draft it made (MEAL-4's
 * `rememberDraftThumbnail`, wiped with the health data and at sign-out).
 *
 * MONEY-LIKE RULES (each scan spends one of the day's allowance):
 * - the Idempotency-Key is minted on the Use photo tap and reused by Try
 *   again for the SAME photo, so a retry the server already answered is not
 *   bought twice;
 * - no automatic retry, except ONE at 768 px with the same key after a 413
 *   `meal_image_too_large`;
 * - Cancel turns the photo back at once; a draft that still arrives within
 *   60 s is deleted quietly (and a later retry of that key answers 409
 *   `health_meal_deleted`).
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import { ApiError } from '../../../api';
import { registerSignOutCleaner } from '../../../app/signOut';
import { useHealthStore } from '../../../health/store';
import { registerHealthWipeHook } from '../../../health/wipe';
import { currentLanguage, translate } from '../../../i18n';
import { track } from '../../../lib/analytics';
import type { MealSlot } from '../../../navigation/types';
import { useIntentStore } from '../../../stores/intentStore';
import { mealApi } from '../api/mealApi';
import { showMealToast } from '../capture/saveFeedback';
import { encodeMealImage, jpegDataUri, MEAL_IMAGE_RETRY_LONG_EDGE, type EncodedMealImage, type MealImagePipeline } from '../imageEncoder';
import { nativeMealImagePipeline, sweepMealPhotoFiles } from '../imageEncoder/pipeline';
import { loggedAtFor } from '../math/itemMath';
import { rememberDraftThumbnail } from '../mealEditor/draftThumbnails';
import type { MealRecord } from '../types/models';

import { photoErrorCopyKey, photoErrorFor, photoErrorOutcome, type MealPhotoError } from './photoErrors';

/** What a scan ended in, for the page (iOS `MealScanCoordinator.Outcome`). */
export type MealScanOutcome =
  | { readonly kind: 'draft'; readonly meal: MealRecord }
  | { readonly kind: 'failed'; readonly failure: MealPhotoError }
  /** A 403, a 409 consent or a pending deletion: the page answers it with the shared health rules. */
  | { readonly kind: 'refused'; readonly error: ApiError }
  | { readonly kind: 'cancelled' };

/** A draft that arrives this long after Cancel is still deleted. */
export const SCAN_CANCEL_WINDOW_MS = 60_000;
/** The Keep going toast stays this long (iOS `duration: 6`). */
export const SCAN_READY_TOAST_MS = 6_000;

interface CoordinatorState {
  /** Scans left today, from the last answer (OP-32) or the Today read. */
  readonly scansLeftToday: number | null;
}

const store = createStore<CoordinatorState>()(() => ({ scansLeftToday: null }));
const cancelledKeys = new Set<string>();
const keptGoingKeys = new Set<string>();
const cancelTimers = new Map<string, ReturnType<typeof setTimeout>>();

let pipeline: MealImagePipeline = nativeMealImagePipeline;

/** Scans left today, redrawn when it changes. */
export function useScansLeftToday(): number | null {
  return useStore(store, (s) => s.scansLeftToday);
}

export function scansLeftToday(): number | null {
  return store.getState().scansLeftToday;
}

/** A newer count (from an answer, or the Today read); null changes nothing. */
export function noteScansLeft(value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  store.setState({ scansLeftToday: value });
}

/**
 * Send the photo. `key` is minted on the Use photo tap and reused by Try
 * again for the same photo.
 */
export async function scanMealPhoto(photo: EncodedMealImage, slot: MealSlot, date: string, key: string): Promise<MealScanOutcome> {
  let dataBase64 = photo.base64;
  const loggedAt = loggedAtFor(date, new Date());
  let retriedSmaller = false;
  for (;;) {
    try {
      const result = await mealApi().scan({ image: { mediaType: 'image/jpeg', dataBase64 }, slot, logDate: date, loggedAt }, key);
      noteScansLeft(result.scansLeftToday);
      const meal = result.meal;
      if (!meal || result.noFood) return finish({ kind: 'failed', failure: 'noFood' }, key);
      if (cancelledKeys.has(key)) {
        // Cancelled while the answer was on its way: the draft is deleted quietly.
        forgetCancel(key);
        await mealApi()
          .deleteMeal(meal.id)
          .catch(() => undefined);
        return { kind: 'cancelled' };
      }
      // Only the picture for the draft's banner stays, in memory.
      rememberDraftThumbnail(meal.id, jpegDataUri(dataBase64));
      return finish({ kind: 'draft', meal }, key);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.isProblem('meal_image_too_large') && !retriedSmaller) {
          const smaller = await encodeSmaller(dataBase64);
          if (smaller) {
            // Once, at 768 px, with the same key.
            retriedSmaller = true;
            dataBase64 = smaller.base64;
            continue;
          }
        }
        if (forgetCancel(key)) return { kind: 'cancelled' };
        const failure = photoErrorFor(error);
        if (failure) return finish({ kind: 'failed', failure }, key);
        return finish({ kind: 'refused', error }, key);
      }
      if (forgetCancel(key)) return { kind: 'cancelled' };
      return finish({ kind: 'failed', failure: 'other' }, key);
    }
  }
}

async function encodeSmaller(base64: string): Promise<EncodedMealImage | null> {
  try {
    return await encodeMealImage({ kind: 'uri', uri: jpegDataUri(base64) }, { maxLongEdge: MEAL_IMAGE_RETRY_LONG_EDGE }, pipeline);
  } catch {
    return null;
  }
}

/** True (and forgotten) when `key` was cancelled. */
function forgetCancel(key: string): boolean {
  const timer = cancelTimers.get(key);
  if (timer) clearTimeout(timer);
  cancelTimers.delete(key);
  return cancelledKeys.delete(key);
}

/** Cancel: the photo goes back to its frozen state at once; an answer that still arrives in the next minute is deleted. */
export function cancelMealScan(key: string): void {
  cancelledKeys.add(key);
  const earlier = cancelTimers.get(key);
  if (earlier) clearTimeout(earlier);
  cancelTimers.set(
    key,
    setTimeout(() => {
      cancelledKeys.delete(key);
      cancelTimers.delete(key);
    }, SCAN_CANCEL_WINDOW_MS),
  );
}

/** Keep going: the page closes and the answer arrives as a toast. */
export function keepGoingWithScan(key: string): void {
  keptGoingKeys.add(key);
}

export function isKeptGoing(key: string): boolean {
  return keptGoingKeys.has(key);
}

/** The answer to a request whose page was left with Keep going goes to a toast; the page gets `cancelled`. */
function finish(outcome: MealScanOutcome, key: string): MealScanOutcome {
  if (!keptGoingKeys.delete(key)) return outcome;
  const language = currentLanguage();
  switch (outcome.kind) {
    case 'draft': {
      const mealId = outcome.meal.id;
      // App-wide (no page): the page it came from has gone.
      showMealToast(translate('meal.photo.ready', language), {
        durationMs: SCAN_READY_TOAST_MS,
        action: {
          label: translate('meal.photo.check', language),
          onPress: () => {
            const intents = useIntentStore.getState();
            intents.parkPlanAction({ kind: 'openDraft', mealId });
            intents.requestTab('Plan');
          },
        },
      });
      track('meal_scan_result', { outcome: 'ok' });
      break;
    }
    case 'failed':
      showMealToast(translate(photoErrorCopyKey(outcome.failure), language));
      track('meal_scan_result', { outcome: photoErrorOutcome(outcome.failure) });
      break;
    case 'refused':
      useHealthStore.getState().handle(outcome.error, { foreground: false });
      break;
    case 'cancelled':
      break;
  }
  return { kind: 'cancelled' };
}

/** Sign-out and the health wipe: no count, no pending job of the member who left reports to the next. */
export function resetMealScanCoordinator(): void {
  store.setState({ scansLeftToday: null });
  for (const timer of cancelTimers.values()) clearTimeout(timer);
  cancelTimers.clear();
  cancelledKeys.clear();
  keptGoingKeys.clear();
}

/** Tests: a fake image pipeline for the 768 px retry. */
export function setScanPipelineForTests(next: MealImagePipeline | null): void {
  pipeline = next ?? nativeMealImagePipeline;
}

// A member's photo scans are their health data: nothing of them outlives a
// health wipe or a sign-out (the count, the cancel window, a Keep going job
// that would otherwise toast to the next member, any photo file a crash left
// in the cache).
function forgetEverything(): void {
  resetMealScanCoordinator();
  sweepMealPhotoFiles();
}
registerHealthWipeHook('meals.photoScan', () => forgetEverything());
registerSignOutCleaner('meals.photoScan', () => forgetEverything());
