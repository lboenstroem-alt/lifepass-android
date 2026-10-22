/* eslint lifepass/no-literal-copy: "error" */
/**
 * The sights and trails on the Explore map (plan 3.0.3 slot, filled by
 * ATTR-2; mounted inside EXPL-2's map). The Android port of the sights half
 * of iOS SearchMapView's `Map` content.
 *
 * Drawn by Mapbox itself, as GL layers over two sources (./features.ts),
 * never as a native view per sight:
 *   - trails: a white casing pass, then a light-blue line pass, under every
 *     ring and venue, and not tappable (the trailhead ring opens the walk);
 *   - the rings' soft shadows (a source that takes no taps);
 *   - sights: an invisible tap target, the hollow rings with their centre
 *     dots (one layer, so a ring on top covers the dot below it), and the top
 *     picks' names.
 * What is drawn for this camera (which rings, which names and where, which
 * trails) is worked out by ./useSightsMap.ts and handed in as `content`.
 *
 * THE ORDER IS FIXED AT MOUNT. Mapbox stacks a layer added later on top of
 * the ones before it, so every source is mounted with the map, empty until
 * there is something to draw, and stay mounted with the layer off. Trails
 * stay under the rings, and the rings under the venues' names (EXPL-2's
 * layer, after this one), whatever loads first.
 *
 * TAPS. Every ring opens its sight's card (the detail endpoint serves every
 * published sight, and a ring that ignores a tap reads as broken), and
 * opening a sight closes a pinned venue card (the map's `onSelectSight`).
 * The source answers only where one of its layers is under the finger: the
 * 34 pt target (40 for a top pick), the ring itself beside a venue, or the
 * name. A drawn ring under the finger wins over a neighbour's invisible
 * target (`pickSight`). A tap on a venue photo never reaches it: rnmapbox
 * gives a tap inside a marker's box to the marker alone. A finger's tap is
 * still handed to the map's `holdTouch` first, which drops it when the same
 * touch reached a venue pin (EXPL-2's "one touch, two handlers" rule), so a
 * tap on the pool can never open the waterfall as well.
 *
 * TALKBACK cannot reach GL features, so while a screen reader is on each
 * drawn ring also gets a transparent accessible button at its place, saying
 * "{name}, Top pick, Trailhead" as VoiceOver does on iOS. Only then: the
 * rings stay GL layers for everyone else. Each button is memoised on what it
 * shows, so a camera that settles sends nothing new to the rings that stayed.
 * Its activation opens the sight at once.
 */
import { CircleLayer, LineLayer, MarkerView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { memo, useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import {
  NO_SIGHTS,
  NO_TRAILS,
  pickSight,
  SIGHT_FILTERS,
  SIGHT_LAYER_IDS,
  SIGHT_SHADOWS_SOURCE_ID,
  SIGHT_STYLES,
  SIGHTS_SOURCE_ID,
  TRAIL_STYLES,
  TRAILS_SOURCE_ID,
  type SightTap,
} from './features';
import type { SightsLayerContent } from './useSightsMap';

export type { SightsLayerContent } from './useSightsMap';

export interface SightsLayerProps {
  /** The Sights toggle. */
  readonly visible: boolean;
  /** The map's zoom level (the layout reads the camera itself, through `content`). */
  readonly zoom: number;
  /** A ring was tapped: the map closes a pinned venue card and opens the sight. */
  readonly onSelectSight: (slug: string) => void;
  /** What to draw for this camera (./useSightsMap.ts); nothing without it. */
  readonly content?: SightsLayerContent;
  /**
   * A finger's tap on a ring passes through this before it opens anything:
   * the map holds it a moment and calls `deliver` only when no venue pin took
   * the same touch. Without it, a tap opens at once. Not used for an
   * accessibility activation, which opens at once.
   */
  readonly holdTouch?: (deliver: () => void) => void;
}

/** The smallest box Mapbox asks about: the layers' own shapes decide what is under the finger. */
const FINGER = { width: 1, height: 1 };
const CENTRE = { x: 0.5, y: 0.5 };

function SightsLayer({ visible, onSelectSight, content, holdTouch }: SightsLayerProps) {
  const sights = visible && content ? content.sights : NO_SIGHTS;
  const trails = visible && content ? content.trails : NO_TRAILS;

  // Read at the moment of the tap, so the handlers below stay the same across
  // renders (the accessible rings are memoised on them).
  const latest = useRef({ content, onSelectSight, holdTouch });
  latest.current = { content, onSelectSight, holdTouch };

  const choose = useCallback((slug: string) => {
    latest.current.content?.select(slug);
    latest.current.onSelectSight(slug);
  }, []);

  const onPress = useCallback(
    (event: SightTap) => {
      const slug = pickSight(event, latest.current.content?.metresPerPoint ?? null);
      if (!slug) return;
      const hold = latest.current.holdTouch;
      if (hold) hold(() => choose(slug));
      else choose(slug);
    },
    [choose],
  );

  return (
    <>
      <ShapeSource id={TRAILS_SOURCE_ID} shape={trails}>
        <LineLayer id={SIGHT_LAYER_IDS.trailCasing} style={TRAIL_STYLES.casing} />
        <LineLayer id={SIGHT_LAYER_IDS.trailLine} style={TRAIL_STYLES.line} />
      </ShapeSource>
      <ShapeSource id={SIGHT_SHADOWS_SOURCE_ID} shape={sights}>
        <CircleLayer id={SIGHT_LAYER_IDS.shadow} style={SIGHT_STYLES.shadow} filter={SIGHT_FILTERS.ring} />
      </ShapeSource>
      <ShapeSource id={SIGHTS_SOURCE_ID} shape={sights} onPress={onPress} hitbox={FINGER}>
        <CircleLayer id={SIGHT_LAYER_IDS.hit} style={SIGHT_STYLES.hit} filter={SIGHT_FILTERS.ring} />
        <CircleLayer id={SIGHT_LAYER_IDS.ring} style={SIGHT_STYLES.ring} />
        <SymbolLayer id={SIGHT_LAYER_IDS.name} style={SIGHT_STYLES.name} filter={SIGHT_FILTERS.name} />
      </ShapeSource>
      {visible && content
        ? content.accessible.map((sight) => (
            <AccessibleRing
              key={sight.slug}
              slug={sight.slug}
              longitude={sight.coordinate[0]}
              latitude={sight.coordinate[1]}
              size={sight.size}
              label={sight.label}
              onChoose={choose}
            />
          ))
        : null}
    </>
  );
}

interface AccessibleRingProps {
  readonly slug: string;
  readonly longitude: number;
  readonly latitude: number;
  /** The tap target, in points across. */
  readonly size: number;
  readonly label: string;
  readonly onChoose: (slug: string) => void;
}

/**
 * A drawn ring as TalkBack reaches it: a transparent button the size of its
 * tap target. Memoised on plain values, with its position held steady, so a
 * new layout that leaves this ring where it was touches nothing native.
 */
const AccessibleRing = memo(function AccessibleRing({ slug, longitude, latitude, size, label, onChoose }: AccessibleRingProps) {
  const coordinate = useMemo<[number, number]>(() => [longitude, latitude], [longitude, latitude]);
  const onPress = useCallback(() => onChoose(slug), [onChoose, slug]);
  const style = useMemo(() => [styles.target, { width: size, height: size, borderRadius: size / 2 }], [size]);
  return (
    <MarkerView coordinate={coordinate} anchor={CENTRE} allowOverlap>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={style}
        testID={`explore.map.sight.${slug}`}
      />
    </MarkerView>
  );
});

const styles = StyleSheet.create({
  target: { backgroundColor: 'transparent' },
});

export default memo(SightsLayer);
