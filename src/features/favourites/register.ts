// Session hooks for saved venues and reviews: what this phone must forget when
// the member signs out.
//
// Pre-created by F3 (plan 3.0, rule 7); filled by VENUE-2. Imported once at
// startup by src/app/registrations.ts, so the cleaners are in place before
// any sign-out can happen. Every sign-out, forced ones after a 401 included,
// runs them.
//
// - The favourites store holds the member's saved venues and classes, and
//   writes still on their way: the next member on the phone must never see
//   the hearts of the one who left (iOS drops them with the view models it
//   tears down).
// - The reviews cache (src/features/venue/reviews) is public reviews, but each
//   answer also says which review is the member's own (`ownReviewId`), which
//   hides "Report review" on it. VENUE-1 owns src/features/venue/register.ts,
//   so the reviews cleaner is registered here, next to its sibling.
//
// Nothing is kept on disk, so there is nothing to claim at sign-in.
import { registerSignOutCleaner } from '../../app/signOut';
import { resetVenueReviews } from '../venue/reviews';
import { favouritesStore } from './store';

registerSignOutCleaner('favourites.store', () => favouritesStore.getState().reset());
registerSignOutCleaner('venue.reviews', () => resetVenueReviews());
