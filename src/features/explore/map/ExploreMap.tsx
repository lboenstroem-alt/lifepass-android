// @f4-stub (plan 3.0.3): the Explore map, filled by EXPL-2; mounted by EXPL-1.
//
// iOS SearchMapView's map: venue rings by type, the legend, the two-tap card
// (first tap shows the card, second opens the page), the location dot, and
// the sights layer (ATTR-2's `SightsLayer`, mounted inside it).
// Keep the default export and its props; replace the body (and this marker).
// A filler may add OPTIONAL props. Renders nothing until EXPL-2 lands.
import type { Venue } from '../../../types/venue';

export interface ExploreMapProps {
  /** The venues the list shows, in its order (filters and search applied). */
  readonly venues: readonly Venue[];
  /** The card's second tap: open the venue's page. */
  readonly onOpenVenue: (venue: Venue) => void;
  /** A sight's card (ATTR-1's `AttractionDetail`). */
  readonly onOpenSight: (slug: string) => void;
  /** Home's "See all on the map": open with the sights showing and all of Iceland in view. */
  readonly showSightsOnOpen?: boolean;
  /** Room to keep clear at the bottom (the tab bar). */
  readonly bottomInset?: number;
}

export default function ExploreMap(_props: ExploreMapProps) {
  return null;
}
