/**
 * What a photo scan ended in, as the photo card shows it: the port of iOS
 * `MealPhotoError`, `MealScanCoordinator.photoError` and the error card's
 * buttons (Views/Meals/PhotoCaptureMode.swift, ios-ux.md 12.4).
 *
 *   too_large    "That photo is too large to send..."   [Retake, Search]
 *   too_small    "That photo is too small to read..."   [Choose another photo, Retake]
 *   unsupported  "That photo format isn't supported."   [Choose another photo, Retake]
 *   limit        429 meal-scan-daily-limit/rate_limited [Search, Barcode]
 *   paused       503 meal_scan_paused                   [Search, Barcode]
 *   upstream     502 coach_upstream_error, 5xx, timeout [Try again, Search] + scans left + the cost line
 *   deleted      409 health_meal_deleted                [Retake, Search]
 *   no food      the answer found no food               [Retake, Search]
 *   offline      no network                             [Try again]
 *
 * A 403, a consent 409, a pending deletion and a minor are NOT photo errors:
 * they follow the shared health rules (null here).
 */
import { ApiError, TransportError } from '../../../api';

export type MealPhotoError = 'tooLarge' | 'tooSmall' | 'unsupported' | 'limit' | 'paused' | 'upstream' | 'deleted' | 'offline' | 'noFood' | 'other';

export function photoErrorCopyKey(failure: MealPhotoError): string {
  switch (failure) {
    case 'tooLarge':
      return 'meal.photo.err.too_large';
    case 'tooSmall':
      return 'meal.photo.err.too_small';
    case 'unsupported':
      return 'meal.photo.err.unsupported';
    case 'limit':
      return 'meal.photo.err.limit';
    case 'paused':
      return 'meal.photo.err.paused';
    case 'upstream':
      return 'meal.photo.err.upstream';
    case 'deleted':
      return 'meal.photo.err.deleted';
    case 'offline':
      return 'meal.photo.err.offline';
    case 'noFood':
      return 'meal.photo.err.no_food';
    case 'other':
      return 'common.error_body';
  }
}

/** `meal_scan_result.outcome`. */
export function photoErrorOutcome(failure: MealPhotoError): string {
  switch (failure) {
    case 'tooLarge':
      return 'too_large';
    case 'tooSmall':
      return 'too_small';
    case 'unsupported':
      return 'unsupported';
    case 'limit':
      return 'limit';
    case 'paused':
      return 'paused';
    case 'upstream':
    case 'other':
      return 'upstream';
    case 'deleted':
      return 'deleted';
    case 'offline':
      return 'offline';
    case 'noFood':
      return 'no_food';
  }
}

/** A button on the error card. */
export type PhotoErrorAction = 'retake' | 'search' | 'barcode' | 'tryAgain' | 'chooseOther';

/** The card's buttons, the first one primary. */
export function photoErrorActions(failure: MealPhotoError): readonly PhotoErrorAction[] {
  switch (failure) {
    case 'tooLarge':
    case 'deleted':
    case 'noFood':
      return ['retake', 'search'];
    // Only a picked photo can be this small, so the first offer is another one from the library.
    case 'unsupported':
    case 'tooSmall':
      return ['chooseOther', 'retake'];
    case 'limit':
    case 'paused':
      return ['search', 'barcode'];
    case 'upstream':
    case 'other':
      return ['tryAgain', 'search'];
    case 'offline':
      return ['tryAgain'];
  }
}

export function photoErrorActionKey(action: PhotoErrorAction): string {
  switch (action) {
    case 'retake':
      return 'meal.photo.retake';
    case 'search':
      return 'meal.mode.search';
    case 'barcode':
      return 'meal.mode.barcode';
    case 'tryAgain':
      return 'health.retry';
    case 'chooseOther':
      return 'meal.photo.choose_other';
  }
}

/** Upstream says what a retry costs (scans left, and "Trying again uses one of today's photo scans."). */
export function showsRetryCost(failure: MealPhotoError): boolean {
  return failure === 'upstream';
}

/**
 * The card for an OP-32 failure, or null for a refusal the shared health
 * rules answer (iOS `MealScanCoordinator.photoError`).
 */
export function photoErrorFor(error: ApiError): MealPhotoError | null {
  if (error.isOffline) {
    // The 20 s ceiling passed: the estimate is the slow part, not the phone.
    if (error instanceof TransportError && error.transport === 'timeout') return 'upstream';
    return 'offline';
  }
  if (error.isProblem('meal_image_too_large')) return 'tooLarge';
  if (error.isProblem('meal_image_unsupported')) return 'unsupported';
  if (error.isProblem('meal-scan-daily-limit')) return 'limit';
  if (error.isProblem('meal_scan_paused')) return 'paused';
  if (error.isProblem('health_meal_deleted')) return 'deleted';
  if (error.isProblem('coach_upstream_error')) return 'upstream';
  if (error.isProblem('no_active_plan_or_pass', 'health_consent_required', 'account_pending_deletion', 'health_minor_blocked')) {
    return null;
  }
  if ((error.status ?? 0) >= 500) return 'upstream';
  if (error.isProblem('rate_limited')) return 'limit';
  return 'other';
}
