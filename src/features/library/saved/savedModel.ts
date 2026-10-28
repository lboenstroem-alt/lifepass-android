/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Saved lists' rules, pure: the "For you" suggestions of iOS LibraryView
 * (Profile's Saved half) and FavouritesView (the Coach's Saved sheet).
 *
 * SUGGESTIONS are the first three venues of `GET /venues`, in the server's
 * order, that the member has not saved. Nothing smarter: the copy says
 * "Based on your saved spots", and iOS shows exactly this.
 *
 * THE LINE UNDER A SUGGESTION differs between the two surfaces, as on iOS:
 *   - Profile: the venue's first category as the API spells it, else
 *     "Wellness";
 *   - the Saved sheet: a reason. A premium venue (outside the bundle) reads
 *     "Similar to your premium spots", one with a category "You liked
 *     {Category}" (capitalised as Swift's `capitalized` does), else "Near
 *     your saved spots". The first Android build's luxury reasons ("Similar
 *     to your lagoons") are gone with luxury.
 */
import { isPremium, type Venue } from '../../../types/venue';

/** How many suggestions a shelf shows. */
export const SUGGESTION_LIMIT = 3;

/** `t`, or a `useT().t`. */
type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/**
 * The venues the suggestions leave out: the saved rows of the last read, as
 * iOS reads `venuesFavourites` (a just-unsaved venue is not among them). A
 * venue whose save is still on its way stays a suggestion, its heart
 * spinning, until the read after the save brings its row.
 */
export function savedVenueIds(saved: { readonly venues: readonly { readonly venueId: string }[] }): string[] {
  return saved.venues.map((venue) => venue.venueId);
}

/** The first `SUGGESTION_LIMIT` venues not in `savedVenueIds`, in the list's order. */
export function suggestionsFor(
  allVenues: readonly Venue[],
  savedVenueIds: readonly string[],
  limit: number = SUGGESTION_LIMIT,
): Venue[] {
  const saved = new Set(savedVenueIds.map((id) => id.toLowerCase()));
  return allVenues.filter((venue) => !saved.has(venue.id.toLowerCase())).slice(0, limit);
}

/** Profile's line: `venue.category?.first ?? t("library.wellness")`. */
export function suggestionCategory(venue: Pick<Venue, 'categories'>, translate: Translate): string {
  return venue.categories?.[0] ?? translate('library.wellness');
}

/** The Saved sheet's reason (iOS FavouritesView `suggestionReason`). */
export function suggestionReason(venue: Pick<Venue, 'inBundle' | 'categories'>, translate: Translate): string {
  if (isPremium(venue)) return translate('saved.reason_premium');
  const first = venue.categories?.[0];
  if (first !== undefined) return translate('saved.reason_liked', { category: capitalizedWords(first) });
  return translate('saved.reason_near');
}

/**
 * Foundation's `String.capitalized`: every word's first letter upper case and
 * the rest lower case ("hot yoga" reads "Hot Yoga"). A word is a run of
 * letters, digits and apostrophes, so "spa-and-sauna" reads "Spa-And-Sauna",
 * as Swift writes it.
 */
export function capitalizedWords(value: string): string {
  // By character rather than with `\p{L}`: a cased letter is one whose upper
  // and lower forms differ, which needs no Unicode tables from the engine.
  let out = '';
  let inWord = false;
  for (const character of Array.from(value)) {
    const wordCharacter =
      character === "'" || /[0-9]/.test(character) || character.toLowerCase() !== character.toUpperCase();
    if (wordCharacter) {
      out += inWord ? character.toLowerCase() : character.toUpperCase();
      inWord = true;
    } else {
      out += character;
      inWord = false;
    }
  }
  return out;
}
