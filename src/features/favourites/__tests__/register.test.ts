/**
 * Sign-out forgets the member's saved venues (and the reviews cache), so the
 * next member on the phone never sees the hearts of the one who left.
 */
import { loadRegistrations, registeredHookIds, runSignOutCleaners } from '../../../app/signOut';
import { venueReviewsStore } from '../../venue/reviews';
import { favouritesStore } from '../store';

it('registers its sign-out cleaners when the register files load', () => {
  loadRegistrations();
  expect(registeredHookIds().signOut).toEqual(expect.arrayContaining(['favourites.store', 'venue.reviews']));
});

it('a sign-out empties the shared favourites store', async () => {
  loadRegistrations();
  favouritesStore.setState({ savedIds: ['aaaaaaaa-0000-4000-8000-000000000001'], loaded: true, status: 'loaded' });
  await runSignOutCleaners({ memberId: 'member-1' });
  expect(favouritesStore.getState()).toMatchObject({ savedIds: [], loaded: false, status: 'idle' });
});

it('a sign-out forgets the reviews cache, which names the member’s own review', async () => {
  loadRegistrations();
  venueReviewsStore.setState({
    byVenue: {
      v: { status: 'loaded', loaded: true, reviews: [], ownReviewId: 'r-1', error: null, readAt: 0 },
    },
  });
  await runSignOutCleaners({ memberId: 'member-1' });
  expect(venueReviewsStore.getState().byVenue).toEqual({});
});
