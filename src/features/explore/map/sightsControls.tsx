// The sights' controls over the Explore map: the seam EXPL-2 left for ATTR-2
// (plan 3.0 rule 2: this file passed to ATTR-2 when EXPL-2 merged).
//
// iOS SearchMapView draws, with the sights layer: the Sights toggle leading
// in the controls row (`sightsToggle`), the legend's sight and trail entries
// (`AttractionMapLegend(showsSights:showsTrails:)`), and under the legend the
// ODbL credit plate and the failed-load notice (`sightsRetryNotice`). The
// layer itself is ATTR-2's `SightsLayer` (plan 3.0.3), drawn from `layer`.
//
// ExploreMap calls `useSightsMapControls` once per render with the layer's
// state, the map's camera and size and the venues on it, places the toggle
// and what hangs under the legend in its overlay stack (`MapTopOverlay`), and
// hands `layer` to `SightsLayer`. The state itself (loading, the retry
// schedule, trails, the open sight, the layout) is
// src/features/attractions/map/useSightsMap.ts.
//
// The legend lists the sights whenever the layer is on (iOS passes
// `showsSights: showSights`), and trails only while the map draws them at
// this zoom: a legend entry for something absent teaches the member to look
// for it (iOS `trailsDrawnAtThisZoom`).
import type { ReactNode } from 'react';

import {
  SightsCreditPlate,
  SightsRetryNotice,
  SightsToggle,
  useSightsMap,
  type MapCameraReport,
  type SightsLayerContent,
  type SightsMapVenue,
  type Size,
  type SpanRegion,
} from '../../attractions/map';
import { useScreenReaderOn } from './useScreenReader';

export interface SightsMapControlsInput {
  /** The sights layer is on (D8: on when the map opens). */
  readonly showSights: boolean;
  /** The Sights toggle switches the layer. */
  readonly setShowSights: (on: boolean) => void;
  /** The map's zoom (trails draw only close in). */
  readonly zoom: number;
  /** The map is what the member sees (the retry schedule runs only then). Default true. */
  readonly active?: boolean;
  /** The camera as last reported at the end of a move (the map's `onMapIdle`); null before. */
  readonly camera?: MapCameraReport | null;
  /** Where the map opened: the view until the camera first reports. */
  readonly openingRegion?: SpanRegion | null;
  /** The map's size in points. */
  readonly mapSize?: Size;
  /** The venues drawn on the map: rings keep clear of their photos and names. */
  readonly venues?: readonly SightsMapVenue[];
  /** A sight opened from the search group (its ring is the open one). */
  readonly openedSight?: { readonly slug: string; readonly key: number } | null;
}

export interface SightsMapControls {
  /** The Sights toggle, leading in the controls row. */
  readonly toggle: ReactNode;
  /** Under the legend: the ODbL credit plate and the failed-load notice. */
  readonly belowLegend: ReactNode;
  /** The legend lists the sights (iOS: whenever the layer is on). */
  readonly legendShowsSights: boolean;
  /** The legend lists trails: only while the map draws them at this zoom. */
  readonly legendShowsTrails: boolean;
  /** What `SightsLayer` draws for this camera. */
  readonly layer?: SightsLayerContent;
}

export const NO_SIGHTS_CONTROLS: SightsMapControls = {
  toggle: null,
  belowLegend: null,
  legendShowsSights: false,
  legendShowsTrails: false,
};

/** What the sights put over the map, and what the layer draws. */
export function useSightsMapControls({ zoom: _zoom, ...input }: SightsMapControlsInput): SightsMapControls {
  const screenReaderOn = useScreenReaderOn();
  const sights = useSightsMap({ ...input, screenReaderOn });

  const credit = sights.attribution ? <SightsCreditPlate text={sights.attribution} /> : null;
  const notice = sights.showsRetryNotice ? <SightsRetryNotice loading={sights.loading} onRetry={sights.retry} /> : null;

  return {
    toggle: <SightsToggle on={sights.showSights} onToggle={sights.toggle} />,
    belowLegend: credit || notice ? (
      <>
        {credit}
        {notice}
      </>
    ) : null,
    legendShowsSights: sights.legendShowsSights,
    legendShowsTrails: sights.legendShowsTrails,
    layer: sights.layer,
  };
}
