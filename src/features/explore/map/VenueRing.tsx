// A venue ring around its content: the photo on a pin, the grey stand-in on
// a legend or card swatch (iOS `VenueRingView`). The layers come from
// `ringGeometry`; this draws them with react-native-svg and clips the
// content to a circle on top.
//
// Coming soon also washes the content out: grey, a little flatter and a
// little brighter, but OPAQUE, so the dashes do not show through it (the
// web's grayscale(1) contrast(.85) brightness(1.1); iOS `SoonPhotoFilter`).
// Android draws grayscale and contrast only on Android 12 (API 31) and later,
// so an older phone lays a translucent grey wash over the photo instead: it
// still reads as not yet open, and stays opaque (`needsSoonWash`).
//
// Decorative: the pin or legend entry it sits in says what it means.
import { memo, useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { hiddenFromAccessibility } from '../../../components/ui';
import type { VenueMarkerType } from '../../../lib/venueMarkerType';
import { mapRing } from '../../../theme';
import { ringGeometry, wedgePath, type RingSize } from './ringGeometry';

export interface VenueRingProps {
  readonly type: VenueMarkerType;
  readonly comingSoon: boolean;
  readonly size: RingSize;
  /** What sits inside the ring; the grey stand-in when absent (a swatch). */
  readonly children?: ReactNode;
  readonly testID?: string;
}

/** The pin's and the legend's soft shadow; the card's swatch has none (iOS). */
const SHADOW: Readonly<Record<RingSize, ViewStyle | null>> = {
  pin: { boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(0,0,0,0.3)' }] },
  legend: { boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 1.5, color: 'rgba(0,0,0,0.25)' }] },
  card: null,
};

/** grayscale(1) contrast(.85) brightness(1.1). */
const SOON_FILTER: ViewStyle = { filter: [{ grayscale: 1 }, { contrast: 0.85 }, { brightness: 1.1 }] };

/** The first Android that draws `grayscale` and `contrast` (Android 12). */
export const SOON_FILTER_MIN_API = 31;

/**
 * A coming-soon photo needs the grey wash: Android below 12, where the
 * filter's grayscale and contrast are not drawn. `version` is Android's API
 * level (`Platform.Version`); unknown counts as new enough.
 */
export function needsSoonWash(comingSoon: boolean, version: unknown = Platform.Version): boolean {
  return comingSoon && typeof version === 'number' && version < SOON_FILTER_MIN_API;
}

function VenueRing({ type, comingSoon, size, children, testID }: VenueRingProps) {
  const geometry = useMemo(() => ringGeometry(type, comingSoon, size), [type, comingSoon, size]);
  const { outer, inner, layers } = geometry;
  const centre = outer / 2;

  return (
    <View
      style={[{ width: outer, height: outer, borderRadius: centre }, SHADOW[size]]}
      testID={testID}
      {...hiddenFromAccessibility}
    >
      <Svg width={outer} height={outer}>
        {layers.map((layer, index) =>
          layer.kind === 'disc' ? (
            <Circle key={index} cx={centre} cy={centre} r={layer.diameter / 2} fill={layer.fill} />
          ) : (
            <Path key={index} d={wedgePath(centre, layer.diameter / 2, layer.startDeg, layer.sweepDeg)} fill={layer.fill} />
          ),
        )}
      </Svg>
      <View
        style={[
          styles.content,
          { left: centre - inner / 2, top: centre - inner / 2, width: inner, height: inner, borderRadius: inner / 2 },
          comingSoon && SOON_FILTER,
        ]}
        testID={testID ? `${testID}.content` : undefined}
      >
        {children ?? <View style={styles.swatch} />}
        {needsSoonWash(comingSoon) ? (
          <View style={styles.soonWash} testID={testID ? `${testID}.soonWash` : undefined} />
        ) : null}
      </View>
    </View>
  );
}

export default memo(VenueRing);

const styles = StyleSheet.create({
  content: { position: 'absolute', overflow: 'hidden' },
  swatch: { flex: 1, backgroundColor: mapRing.swatchFill },
  // The coming-soon ring's own grey over most of the photo's colour: what
  // little shows through is too faint to read as an open venue.
  soonWash: { ...StyleSheet.absoluteFillObject, backgroundColor: mapRing.soon, opacity: 0.6 },
});
