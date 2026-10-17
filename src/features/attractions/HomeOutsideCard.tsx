// @f4-stub (plan 3.0.3): Home's "Outside" top picks card, filled by ATTR-1; mounted by HOME-1.
//
// iOS `HomeOutsideCard`: the picks near you (or around Iceland without a
// fix, never claiming a proximity the app does not have), and "See all on
// the map". The card reads its own picks; Home owns where the taps go.
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until ATTR-1 lands.

export interface HomeOutsideCardProps {
  /** Open a sight's card (`AttractionDetail`). */
  readonly onOpenSight: (slug: string) => void;
  /** "See all on the map": Explore's map with the sights showing. */
  readonly onSeeAllOnMap: () => void;
}

export default function HomeOutsideCard(_props: HomeOutsideCardProps) {
  return null;
}
