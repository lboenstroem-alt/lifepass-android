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
 * sight's ring sits on top, its name under it: iOS places the ring as
 * `Annotation(a.name, ...)` and never hides annotation titles on the card,
 * so MapKit labels the spot or trailhead. Mapbox has no such title, so the
 * name is drawn here, in the Explore map's sight-label style (iOS
 * `AttractionMapLabel`: 11 pt semibold, the dark attraction blue, a white
 * halo, one line).
 *
 * Mapbox stands in for MapKit (plan 5.6). A muted light style, as iOS's
 * `.standard(emphasis: .muted)`. A TextureView rather than a SurfaceView, so
 * the map moves with the page as it scrolls. Mapbox's logo and attribution
 * stay, as its terms require.
 *
 * NO TOKEN, NO MAP. MapKit needs no key, so iOS always draws these. Mapbox
 * does: a MapView built while the SDK has no token throws
 * MapboxConfigurationException on the UI thread, which crashes the app. So a
 * build without the runtime token (a local or dev build, or an EAS profile
 * missing EXPO_PUBLIC_MAPBOX_TOKEN) draws the band empty, as the Explore map
 * draws a plain area (explore/map/mapbox.ts `hasMapboxToken`, which this
 * cannot import across the feature boundary). `env.mapboxToken` already
 * reads a blank or placeholder token as none, so the two checks agree.
 */
import Mapbox, { Camera, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AttractionTier } from '../../../api/attractions';
import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { env } from '../../../config/env';
import type { Coordinate } from '../../../lib/geo';
import { colors } from '../../../theme';
import AttractionRing from '../AttractionRing';
import { regionCorners, type MapRegion } from '../model';

// The Explore map's setup (explore/map/mapbox.ts) hands Mapbox the token at
// app start and then switches telemetry off. Handing it the same token here
// too keeps this map drawable even if it is ever reached before that setup
// has loaded; setting it twice changes nothing, and telemetry stays off.
// Without a token there is nothing to hand over: no map is drawn.
const BUILD_TOKEN = env.mapboxToken;
if (BUILD_TOKEN) Mapbox.setAccessToken(BUILD_TOKEN);

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
  /** The sight's name, drawn under its ring. */
  readonly label?: string;
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

export default function SightMap(props: SightMapProps) {
  // Read per render, but fixed for the build: the same branch every time.
  if (!env.mapboxToken) {
    return <View {...hiddenFromAccessibility} pointerEvents="none" style={[styles.frame, props.style]} testID={props.testID} />;
  }
  return <LiveSightMap {...props} />;
}

function LiveSightMap({ region, lines, marker, label, style, testID }: SightMapProps) {
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
          {/* The ring must stay on the coordinate with the name under it, so
              an invisible copy of the name above balances the one below and
              the centre anchor stays the ring's centre at any font size. */}
          <View style={styles.marker}>
            {label ? <MarkerName text={label} balance /> : null}
            <AttractionRing tier={marker.tier} isSelected={marker.isSelected} isTrailhead={marker.isTrailhead} />
            {label ? <MarkerName text={label} /> : null}
          </View>
        </MarkerView>
      </MapView>
    </View>
  );
}

/** The sight's name on the map (iOS `AttractionMapLabel`). */
function MarkerName({ text, balance = false }: { readonly text: string; readonly balance?: boolean }) {
  return (
    <LPText
      size={11}
      weight="semibold"
      color={colors.attraction2}
      align="center"
      numberOfLines={1}
      ellipsizeMode="tail"
      // Part of the picture, like iOS's fixed-size map label: the card's
      // title above already names the place at the member's text size.
      maxScale={1}
      style={[styles.name, balance && styles.balance]}
      testID={balance ? undefined : 'attraction.map.name'}
    >
      {text}
    </LPText>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.ink3 },
  // iOS `AttractionMapLayout.labelGap`.
  marker: { alignItems: 'center', gap: 1 },
  // iOS `AttractionMapLayout.labelMaxWidth`, with room for the halo.
  name: {
    maxWidth: 136,
    paddingHorizontal: 2,
    textShadowColor: '#FFFFFF',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2.5,
  },
  balance: { opacity: 0 },
});
