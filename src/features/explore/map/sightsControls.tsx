// The sights' controls over the Explore map: the seam ATTR-2 fills.
//
// iOS SearchMapView draws, with the sights layer: the Sights toggle leading
// in the controls row (`sightsToggle`), the legend's sight and trail entries
// (`AttractionMapLegend(showsSights:showsTrails:)`), and under the legend the
// ODbL credit plate and the failed-load notice (`sightsRetryNotice`). The
// layer itself is ATTR-2's `SightsLayer` (plan 3.0.3); these are the parts
// that sit OVER the map, in EXPL-2's overlay stack (`MapTopOverlay`).
//
// CONTRACT (plan 3.0 rule 2): this file passes to ATTR-2 when EXPL-2 merges.
// ATTR-2 replaces the body of `useSightsMapControls` and keeps its signature;
// ExploreMap calls it once per render with the layer's state and the map's
// zoom, and places what it returns. Nothing in ExploreMap.tsx needs editing.
// Until then it returns nothing to draw and keeps the legend's sight entries
// off: the stub layer draws no sights, and a legend entry for something the
// map is not drawing teaches the member to look for it (iOS
// `trailsDrawnAtThisZoom`).
import type { ReactNode } from 'react';

export interface SightsMapControlsInput {
  /** The sights layer is on (D8: on when the map opens). */
  readonly showSights: boolean;
  /** The Sights toggle switches the layer. */
  readonly setShowSights: (on: boolean) => void;
  /** The map's zoom (trails draw only close in). */
  readonly zoom: number;
}

export interface SightsMapControls {
  /** The Sights toggle, leading in the controls row. */
  readonly toggle: ReactNode;
  /** Under the legend: the ODbL credit plate and the failed-load notice. */
  readonly belowLegend: ReactNode;
  /** The legend lists the sights (iOS: whenever the layer is on and drawing). */
  readonly legendShowsSights: boolean;
  /** The legend lists trails: only while the map draws them at this zoom. */
  readonly legendShowsTrails: boolean;
}

export const NO_SIGHTS_CONTROLS: SightsMapControls = {
  toggle: null,
  belowLegend: null,
  legendShowsSights: false,
  legendShowsTrails: false,
};

/** What the sights put over the map. A hook, so ATTR-2 can keep state (the retry schedule) in it. */
export function useSightsMapControls(_input: SightsMapControlsInput): SightsMapControls {
  return NO_SIGHTS_CONTROLS;
}
