// A venue on the map: its photo inside the ring of its type, one button (iOS
// `VenueMapMarker` and `venueAnnotation`, Views/Search/SearchMapView.swift).
//
// Pinned (its card is up), it grows to 1.12 and wears the web's halo, from
// the ring outwards: a full-strength 1 pt ink line (so a white ring does not
// run into the white), 2 pt of white, a soft ink edge. The ring's colour
// never changes, so the type stays readable on the pin whose card is up.
// Without movement under Remove animations.
//
// TalkBack hears "{name}, {type}" (", coming soon"), "Opens the venue", and
// the selected state while pinned: the type is said, not only drawn.
//
// An accessibility activation (TalkBack's double tap, Switch Access's
// select, both the node's click action) arrives as `onAssistiveActivate`, not
// `onPress`: the map opens the venue on it at once, as iOS does under
// VoiceOver or Switch Control (`accessibilityActivate`). A finger's tap is
// still `onPress`. This reads the activation itself, so no other
// accessibility service (a password manager, say) takes the card away.
//
// No photo (or not yet, or a failed one): the grey stand-in with a white pin
// glyph, never another picture.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { hiddenFromAccessibility, normaliseImageUrl } from '../../../components/ui';
import type { Classification } from '../../../lib/venueMarkerType';
import { mapRing } from '../../../theme';
import { RING_DIAMETER } from './ringGeometry';
import VenueRing from './VenueRing';

/** The pinned pin's size (iOS `.scaleEffect(1.12)`). */
export const PINNED_SCALE = 1.12;
/** The halo's extent: 4 pt past the 44 pt ring all round. */
const HALO = RING_DIAMETER.pin + 8;
/**
 * The marker's box, centred on the venue's coordinate: room for the grown pin
 * and its halo (52 × 1.12 is just over 58).
 */
export const PIN_BOX = 60;
/** The tap target inside the box (Android's 48 dp, the 44 pt pin and a margin). */
const HIT = 48;
/** The node's click action, taken over so an accessibility activation is told from a tap. */
const ACTIVATE_ACTION = [{ name: 'activate' }] as const;

export interface VenuePinProps {
  readonly imageUrl: string | null;
  readonly ring: Classification;
  readonly pinned: boolean;
  /** "{name}, {type}" (", coming soon"). */
  readonly accessibilityLabel: string;
  /** "Opens the venue". */
  readonly accessibilityHint: string;
  readonly onPress: () => void;
  /** An accessibility service activated the pin (TalkBack, Switch Access). */
  readonly onAssistiveActivate: () => void;
  readonly reduceMotion: boolean;
  readonly testID?: string;
}

function VenuePin({
  imageUrl,
  ring,
  pinned,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  onAssistiveActivate,
  reduceMotion,
  testID,
}: VenuePinProps) {
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') onAssistiveActivate();
    },
    [onAssistiveActivate],
  );
  const scale = useRef(new Animated.Value(pinned ? PINNED_SCALE : 1)).current;
  useEffect(() => {
    const target = pinned ? PINNED_SCALE : 1;
    if (reduceMotion) {
      scale.setValue(target);
      return undefined;
    }
    const animation = Animated.timing(scale, {
      toValue: target,
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [pinned, reduceMotion, scale]);

  return (
    <View style={styles.box} pointerEvents="box-none" collapsable={false}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected: pinned }}
        accessibilityActions={ACTIVATE_ACTION}
        onAccessibilityAction={onAccessibilityAction}
        style={styles.hit}
        testID={testID}
      >
        <Animated.View style={[styles.grow, { transform: [{ scale }] }]} pointerEvents="none">
          {pinned ? <Halo /> : null}
          <VenueRing type={ring.type} comingSoon={ring.comingSoon} size="pin">
            <PinPhoto url={imageUrl} />
          </VenueRing>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export default memo(VenuePin);

/** Behind the ring: ink, white, a soft ink edge (iOS paddings -1, -3, -4). */
function Halo() {
  const centre = HALO / 2;
  const ring = RING_DIAMETER.pin / 2;
  return (
    <View style={styles.halo} {...hiddenFromAccessibility} testID="venuePin.halo">
      <Svg width={HALO} height={HALO}>
        <Circle cx={centre} cy={centre} r={ring + 4} fill={mapRing.ink} fillOpacity={0.3} />
        <Circle cx={centre} cy={centre} r={ring + 3} fill="#FFFFFF" />
        <Circle cx={centre} cy={centre} r={ring + 1} fill={mapRing.ink} />
      </Svg>
    </View>
  );
}

/** The photo, over the grey stand-in it falls back to. */
function PinPhoto({ url }: { readonly url: string | null }) {
  const source = normaliseImageUrl(url);
  // One record per URL: a new photo gets its own try.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showImage = source !== null && failedFor !== source;
  return (
    <View style={styles.standIn}>
      <Ionicons name="location-sharp" size={16} color="#FFFFFF" />
      {showImage ? (
        <Image
          source={{ uri: source }}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={0}
          onError={() => setFailedFor(source)}
          style={StyleSheet.absoluteFill}
          accessible={false}
          testID="venuePin.photo"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: PIN_BOX, height: PIN_BOX, alignItems: 'center', justifyContent: 'center' },
  hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  grow: { width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 8, color: 'rgba(0,0,0,0.35)' }],
  },
  standIn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mapRing.swatchFill,
  },
});
