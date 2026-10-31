// Everything over the top of the Explore map, stacked (iOS SearchMapView
// `mapContent`'s top VStack):
//   1. the controls row: the Sights toggle leading (ATTR-2's, through
//      `sightsToggle`) and the locate button trailing, where MapKit keeps its
//      location button;
//   2. the legend, centred, with what hangs under it (`belowLegend`: the
//      sights' ODbL credit plate and their retry notice, ATTR-2's);
//   3. "Location is off" (EXPL-1's banner) while location is off, 20 in from
//      the sides and 8 below the rest.
// Its bottom edge is measured (`onBottom`), so a pin the map slides clear of
// its card stops below it (`revealMove`'s `mapTop`). Touches between its
// parts go through to the map.
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { selectLocationOffReason, useLocationStore, type LocationStore, locationStore } from '../../../stores/locationStore';
import LocationDeniedBanner from '../LocationDeniedBanner';
import type { LegendEntry } from '../../../lib/venueMarkerType';
import LocateButton from './LocateButton';
import MapLegend from './MapLegend';

export interface MapTopOverlayProps {
  readonly legendEntries: readonly LegendEntry[];
  readonly legendFolds: boolean;
  readonly showsSights: boolean;
  readonly showsTrails: boolean;
  /** The locate button shows (location allowed or not decided yet). */
  readonly showsLocate: boolean;
  readonly onLocate: () => void;
  /** Where the stack ends, in the map's space. */
  readonly onBottom: (bottom: number) => void;
  /** The Sights toggle, leading in the controls row (ATTR-2). */
  readonly sightsToggle?: ReactNode;
  /** Under the legend: the sights' credit plate and retry notice (ATTR-2). */
  readonly belowLegend?: ReactNode;
  /** The phone legend's type list starts open (a development aid, `mapLegendOpen`). */
  readonly initialLegendOpen?: boolean;
  /** The location store (tests pass their own). */
  readonly locationStore?: LocationStore;
}

export default function MapTopOverlay({
  legendEntries,
  legendFolds,
  showsSights,
  showsTrails,
  showsLocate,
  onLocate,
  onBottom,
  sightsToggle,
  belowLegend,
  initialLegendOpen = false,
  locationStore: store = locationStore,
}: MapTopOverlayProps) {
  // The phone legend's type list is open (screen state only, as iOS).
  const [legendOpen, setLegendOpen] = useState(initialLegendOpen);
  const locationOff = useLocationStore(selectLocationOffReason, store) !== null;
  const showsLegend = showsSights || showsTrails || legendEntries.length > 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    onBottom(y + height);
  };

  return (
    <View style={styles.stack} pointerEvents="box-none" onLayout={onLayout} testID="explore.map.overlay">
      {sightsToggle || showsLocate ? (
        <View style={styles.controls} pointerEvents="box-none">
          {sightsToggle}
          <View style={styles.spacer} pointerEvents="none" />
          {showsLocate ? <LocateButton onPress={onLocate} /> : null}
        </View>
      ) : null}
      {showsLegend || belowLegend ? (
        <View style={styles.legend} pointerEvents="box-none">
          <MapLegend
            entries={legendEntries}
            folds={legendFolds}
            open={legendOpen}
            onChangeOpen={setLegendOpen}
            showsSights={showsSights}
            showsTrails={showsTrails}
          />
          {belowLegend}
        </View>
      ) : null}
      {locationOff ? (
        <View style={styles.banner} pointerEvents="box-none">
          <LocationDeniedBanner store={store} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', top: 0, left: 0, right: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  spacer: { flex: 1 },
  legend: { alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 8 },
  banner: { paddingHorizontal: 20, paddingTop: 8 },
});
