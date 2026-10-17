// @f4-stub (plan 3.0.3): the "Sights" group in Explore's search, filled by ATTR-2; mounted by EXPL-1.
//
// Keep the default export and its props; replace the body (and this marker).
// Renders nothing until ATTR-2 lands.

export interface SightsSearchGroupProps {
  /** What the member typed (folded the Icelandic-aware way inside). */
  readonly query: string;
  /** Open a sight's card. */
  readonly onOpenSight: (slug: string) => void;
}

export default function SightsSearchGroup(_props: SightsSearchGroupProps) {
  return null;
}
