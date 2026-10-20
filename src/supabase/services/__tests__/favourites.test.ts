/**
 * The legacy favourites shim: a favourite in the first build's venue shape
 * reads its in-bundle marker the way iOS FavouriteVenue.isPremium does.
 */
import type { FavouriteVenue } from '../../../features/favourites';
import { adaptFavouriteVenue } from '../favourites';

const favourite = (inBundle: boolean | null): FavouriteVenue => ({
  id: '11111111-1111-4111-8111-000000000001',
  venueId: 'aaaaaaaa-0000-4000-8000-000000000001',
  slug: 'laugar',
  name: 'Laugar',
  description: null,
  city: 'Reykjavík',
  address: null,
  inBundle,
  imageUrl: null,
  categories: null,
  createdAt: null,
});

it.each([
  [true, true],
  [false, false],
  // No marker: in the bundle (iOS `!(inBundle ?? true)`), never premium.
  [null, true],
] as const)('inBundle %p reads as in the bundle: %p', (marker, inBundle) => {
  const legacy = adaptFavouriteVenue(favourite(marker));
  expect(legacy.inBundle).toBe(inBundle);
  expect(legacy.id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
});
