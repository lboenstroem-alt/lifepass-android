/**
 * The photo a draft was estimated from, as a small in-memory picture for the
 * draft editor's banner (iOS `MealScanCoordinator.thumbnail(for:)`, 72 pt).
 *
 * MEMORY ONLY. No meal photo is ever written to disk (MEAL-3's rule): the
 * photo scan hands its downscaled image here as a `data:` URI, the editor
 * shows it while the draft is open, and it is forgotten once the draft is
 * confirmed or discarded, at a health wipe and at sign-out.
 *
 *   rememberDraftThumbnail(meal.id, `data:image/jpeg;base64,${base64}`);  // MEAL-3, after OP-32
 */
import { registerSignOutCleaner } from '../../../app/signOut';
import { registerHealthWipeHook } from '../../../health/wipe';

const thumbnails = new Map<string, string>();

/** At most this many are kept: a member rarely has more drafts open, and each is a picture. */
const MAX_THUMBNAILS = 8;

export function rememberDraftThumbnail(mealId: string, uri: string): void {
  thumbnails.delete(mealId);
  thumbnails.set(mealId, uri);
  while (thumbnails.size > MAX_THUMBNAILS) {
    const oldest = thumbnails.keys().next().value;
    if (oldest === undefined) break;
    thumbnails.delete(oldest);
  }
}

export function draftThumbnail(mealId: string): string | null {
  return thumbnails.get(mealId) ?? null;
}

export function forgetDraftThumbnail(mealId: string): void {
  thumbnails.delete(mealId);
}

export function forgetAllDraftThumbnails(): void {
  thumbnails.clear();
}

// A photo of a member's food is their health data: it goes with the rest.
registerHealthWipeHook('meals.draftThumbnails', () => forgetAllDraftThumbnails());
registerSignOutCleaner('meals.draftThumbnails', () => forgetAllDraftThumbnails());
