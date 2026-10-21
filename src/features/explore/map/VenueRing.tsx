// A venue ring around its content: the photo on a pin, the grey stand-in on
// a legend or card swatch (iOS `VenueRingView`). The layers come from
// `ringGeometry`; this draws them with react-native-svg and clips the
// content to a circle on top.
//
// Coming soon also washes the content out: grey, a little flatter and a
// little brighter, but OPAQUE, so the dashes do not show through it (the
// web's grayscale(1) contrast(.85) brightness(1.1)). Android draws the
// filter on Android 12 and later; an older phone keeps the photo's colour,
// and the dashed grey ring still says coming soon.
//
// Decorative: the pin or legend entry it sits in says what it means.
import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
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
      </View>
    </View>
  );
}

export default memo(VenueRing);

const styles = StyleSheet.create({
  content: { position: 'absolute', overflow: 'hidden' },
  swatch: { flex: 1, backgroundColor: mapRing.swatchFill },
});
