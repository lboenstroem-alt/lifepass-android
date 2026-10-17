// LEGACY hooks for the screens written before the parity build (deleted by
// QA-1). New code reads src/stores/venuesStore.ts (`useOrderedVenues`), and
// the venue page reads by slug (src/api/venues.ts) and the walk-in preview
// (src/api/walkInPreview.ts).
import { useCallback, useEffect, useState } from 'react';

import { errorMessage } from '../../api/errorFormatter';
import type { LegacyActivity, LegacyVenue, LegacyVenueReview } from '../../types/venue';
import { fetchActivities, fetchVenueById, fetchVenueReviews, fetchVenues } from '../services/venues';

type VenuesState = {
  venues: LegacyVenue[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

/** @deprecated Use `useOrderedVenues` (src/stores/venuesStore.ts). */
export function useVenues(opts?: { search?: string; city?: string }): VenuesState {
  const [venues, setVenues] = useState<LegacyVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const search = opts?.search;
  const city = opts?.city;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchVenues({ search, city })
      .then(setVenues)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [search, city]);

  useEffect(() => {
    load();
  }, [load]);

  return { venues, loading, error, refetch: load };
}

type VenueByIdState = {
  venue: LegacyVenue | null;
  loading: boolean;
  error: string | null;
};

/** @deprecated The venue page is reached by slug (`fetchVenueBySlug`). */
export function useVenueById(id: string): VenueByIdState {
  const [venue, setVenue] = useState<LegacyVenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchVenueById(id)
      .then(setVenue)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  return { venue, loading, error };
}

type ActivitiesState = {
  activities: LegacyActivity[];
  loading: boolean;
  error: string | null;
};

/** @deprecated Activities come from the walk-in preview's `slotActivities`. */
export function useActivities(venueId: string): ActivitiesState {
  const [activities, setActivities] = useState<LegacyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchActivities(venueId)
      .then(setActivities)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [venueId]);

  return { activities, loading, error };
}

type ReviewsState = {
  reviews: LegacyVenueReview[];
  loading: boolean;
  error: string | null;
};

/** @deprecated VENUE-2 owns reviews. */
export function useVenueReviews(venueId: string): ReviewsState {
  const [reviews, setReviews] = useState<LegacyVenueReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchVenueReviews(venueId)
      .then(setReviews)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [venueId]);

  return { reviews, loading, error };
}
