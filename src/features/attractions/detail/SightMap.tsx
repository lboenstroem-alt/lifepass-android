/**
 * A still map on a sight's card: the walk's route ("The route"), or where the
 * place is when the server sent no picture at all (iOS AttractionDetailView
 * `routeSection` and `locationPreview`).
 *
 * NON-INTERACTIVE on purpose: inside a scroll view a pannable map steals the
 * scroll gesture, and this is a picture of where the place is, not a second
 * map to operate. Every gesture is off and the map takes no touches.
 *
 * The route is drawn with the Explore map's recipe (iOS `TrailStroke`): a
 * 6 dp white casing under a 3 dp light-blue line, round caps and joins, so
 * the card and the map show one trail rather than two styles of it. The
 * sight's ring sits on top.
 *
 * Mapbox stands in for MapKit (plan 5.6). A muted light style, as iOS's
 * `.standard(emphasis: .muted)`. A TextureView rather than a SurfaceView, so
 * the map moves with the page as it scrolls. Mapbox's logo and attribution
 * stay, as its terms require.
 */
import Mapbox, { Camera, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AttractionTier } from '../../../api/attractions';
import { hiddenFromAccessibility } from '../../../components/ui';
import { env } from '../../../config/env';
import type { Coordinate } from '../../../lib/geo';
import { colors } from '../../../theme';
import AttractionRing from '../AttractionRing';
import { regionCorners, type MapRegion } from '../model';

Mapbox.setAccessToken(env.mapboxToken);

/** iOS `TrailStroke`: the casing and the line. */
export const TRAIL_STROKE = {
  casing: { lineColor: '#FFFFFF', lineWidth: 6, lineCap: 'round', lineJoin: 'round' },
  line: { lineColor: colors.attraction, lineWidth: 3, lineCap: 'round', lineJoin: 'round' },
} as const;

export interface SightMapProps {
  readonly region: MapRegion;
  /** The walk, when there is one. */
  readonly lines?: readonly (readonly Coordinate[])[];
  /** The sight's ring. */
  readonly marker: {
    readonly coordinate: Coordinate;
    readonly tier?: AttractionTier;
    readonly isSelected?: boolean;
    readonly isTrailhead?: boolean;
  };
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** The walk as GeoJSON, positions in [longitude, latitude] order. */
export function routeFeature(lines: readonly (readonly Coordinate[])[]): GeoJSON.Feature<GeoJSON.MultiLineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiLineString',
      coordinates: lines.map((run) => run.map((point) => [point.longitude, point.latitude])),
    },
  };
}

export default function SightMap({ region, lines, marker, style, testID }: SightMapProps) {
  const corners = regionCorners(region);
  const shape = useMemo(() => (lines && lines.length > 0 ? routeFeature(lines) : null), [lines]);
  return (
    <View {...hiddenFromAccessibility} pointerEvents="none" style={[styles.frame, style]} testID={testID}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Light}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        surfaceView={false}
      >
        <Camera defaultSettings={{ bounds: corners }} animationDuration={0} />
        {shape ? (
          <ShapeSource id="sight-route" shape={shape}>
            <LineLayer id="sight-route-casing" style={TRAIL_STROKE.casing} />
            <LineLayer id="sight-route-line" style={TRAIL_STROKE.line} aboveLayerID="sight-route-casing" />
          </ShapeSource>
        ) : null}
        <MarkerView
          coordinate={[marker.coordinate.longitude, marker.coordinate.latitude]}
          anchor={{ x: 0.5, y: 0.5 }}
          allowOverlap
        >
          <AttractionRing tier={marker.tier} isSelected={marker.isSelected} isTrailhead={marker.isTrailhead} />
        </MarkerView>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.ink3 },
});
