// @f4-stub (plan 3.0.2): route `VenueReviews`, filled by VENUE-2.
//
// All of a venue's reviews.
// Keep the default export and its props type; replace the body (and this
// marker). Until then a development build shows a placeholder and a release
// build shows nothing.
import { StubScreen } from '../../../navigation/stubs';
import type { SharedRouteProps } from '../../../navigation/types';

export default function VenueReviewsScreen({ route }: SharedRouteProps<'VenueReviews'>) {
  return <StubScreen route={route.name} owner="VENUE-2" />;
}
