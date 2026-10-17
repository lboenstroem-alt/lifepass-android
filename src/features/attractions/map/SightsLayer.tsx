// @f4-stub (plan 3.0.3): the sights and trails layer on the Explore map, filled by ATTR-2; mounted inside EXPL-2's map.
//
// Hollow light-blue rings sized by tier and gated by zoom, top-pick names,
// trail lines; on by default (D8). Keep the default export and its props;
// replace the body (and this marker). Renders nothing until ATTR-2 lands.

export interface SightsLayerProps {
  /** The Sights toggle. */
  readonly visible: boolean;
  /** The map's zoom level, for the tier gates. */
  readonly zoom: number;
  /** A ring was tapped. */
  readonly onSelectSight: (slug: string) => void;
}

export default function SightsLayer(_props: SightsLayerProps) {
  return null;
}
