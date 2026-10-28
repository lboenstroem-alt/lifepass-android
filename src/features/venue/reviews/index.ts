// Venue reviews (VENUE-2): the data side, for the venue page (VENUE-1) and the
// session hooks.
//
//   // the venue page, next to its other reads (iOS reads them with the venue),
//   // on every load and every return; `signal` stops that caller waiting:
//   const [preview, reviews] = await Promise.allSettled([
//     fetchWalkInPreview(venue.id),
//     loadVenueReviews(venue.id, { signal }),
//   ]);
//
//   // The venue page MUST read its reviews through `loadVenueReviews`, not a
//   // reader of its own: the reviews page opens on the rows in this store (as
//   // iOS hands its sheet the view model's array). The rows carry every field
//   // of the page's own `VenueReviewItem` (id, venueId, rating, comment,
//   // authorInitial, createdAt), so a page reader can simply re-export it:
//   //   export { loadVenueReviews } from './reviews';
//   //   export type { VenueReview as VenueReviewItem } from './reviews';
//
//   // the block at the foot of the page (title, "Write one" / "See all", the
//   // quote card or the two latest reviews; every action opens the reviews
//   // page) is the venue page's own, ../components/ReviewsBlock.tsx.
//
//   // the meta row's tap (iOS opens the same reviews page):
//   navigation.navigate('VenueReviews', { venueId: venue.id, venueName: venue.name });
//
// The block, the reviews page and the write sheet share one store, so a
// review posted from the write sheet shows on all of them.
//
// This index stays free of screens and icons: the sign-out cleaners import it
// (src/features/favourites/register.ts), and they load before any screen.
export { useVenueReviews, type VenueReviewsHook } from './useVenueReviews';
export {
  createVenueReviewsStore,
  loadVenueReviews,
  resetVenueReviews,
  venueReviewsStore,
  type EnsureLoadedOptions,
  type LoadVenueReviewsOptions,
  type VenueReviewsEntry,
  type VenueReviewsStatus,
  type VenueReviewsStore,
} from './store';
export type { VenueReview, ReviewSummary } from './model';
export { reviewSummary } from './model';
