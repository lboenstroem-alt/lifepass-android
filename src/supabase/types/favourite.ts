/**
 * @deprecated The first build read favourites straight from a Supabase table,
 * which the v1 backend refuses; they come from the LifePass API now
 * (`GET /favourites`, src/features/favourites/api.ts). Nothing imports the old
 * table row shapes any more; the API's shapes are re-exported here for any
 * legacy import that is left.
 */
export type { FavouriteActivity, FavouriteVenue, FavouritesPayload } from '../../features/favourites/api';
