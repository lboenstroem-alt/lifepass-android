// Venue reviews (VENUE-2): the data side, for the venue page (VENUE-1) and the
// session hooks.
//
//   // the venue page, next to its other reads (iOS reads them with the venue):
//   const [preview, reviews] = await Promise.allSettled([
//     fetchWalkInPreview(venue.id),
//     loadVenueReviews(venue.id),
//   ]);
//
//   // the block at the foot of the page (title, "Write one" / "See all", the
//   // quote card or the two latest reviews; every action opens the reviews
//   // page). Same feature folder, so the venue page imports the file itself:
//   import VenueReviewsBlock from './reviews/VenueReviewsBlock';
//   <VenueReviewsBlock venueId={venue.id} venueName={venue.name} />
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
  type VenueReviewsEntry,
  type VenueReviewsStatus,
  type VenueReviewsStore,
} from './store';
export type { VenueReview, ReviewSummary } from './model';
export { reviewSummary } from './model';
