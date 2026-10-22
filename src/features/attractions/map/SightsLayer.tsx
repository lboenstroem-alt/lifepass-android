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
 *   - sights: an invisible tap target, a soft shadow, the hollow ring, the
 *     centre dot, and the top picks' names.
 * What is drawn for this camera (which rings, which names and where, which
 * trails) is worked out by ./useSightsMap.ts and handed in as `content`.
 *
 * THE ORDER IS FIXED AT MOUNT. Mapbox stacks a layer added later on top of
 * the ones before it, so both sources are mounted with the map, empty until
 * there is something to draw, and stay mounted with the layer off. Trails
 * stay under the rings, and the rings under the venues' names (EXPL-2's
 * layer, after this one), whatever loads first.
 *
 * TAPS. Every ring opens its sight's card (the detail endpoint serves every
 * published sight, and a ring that ignores a tap reads as broken), and
 * opening a sight closes a pinned venue card (the map's `onSelectSight`).
 * The source answers only where one of its layers is under the finger: the
 * 34 pt target (40 for a top pick), the ring itself beside a venue, or the
 * name. A tap on a venue photo never reaches it: Mapbox gives a tap on a
 * native marker to the marker.
 *
 * TALKBACK cannot reach GL features, so while a screen reader is on each
 * drawn ring also gets a transparent accessible button at its place, saying
 * "{name}, Top pick, Trailhead" as VoiceOver does on iOS. Only then: the
 * rings stay GL layers for everyone else.
 */
import { CircleLayer, LineLayer, MarkerView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import {
  NO_SIGHTS,
  NO_TRAILS,
  pickSight,
  SIGHT_FILTERS,
  SIGHT_LAYER_IDS,
  SIGHT_STYLES,
  SIGHTS_SOURCE_ID,
  TRAIL_STYLES,
  TRAILS_SOURCE_ID,
  type SightTap,
} from './features';
import type { AccessibleSight, SightsLayerContent } from './useSightsMap';

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
}

/** The smallest box Mapbox asks about: the layers' own shapes decide what is under the finger. */
const FINGER = { width: 1, height: 1 };
const CENTRE = { x: 0.5, y: 0.5 };

function SightsLayer({ visible, onSelectSight, content }: SightsLayerProps) {
  const sights = visible && content ? content.sights : NO_SIGHTS;
  const trails = visible && content ? content.trails : NO_TRAILS;
  const select = content?.select;

  const choose = useCallback(
    (slug: string) => {
      select?.(slug);
      onSelectSight(slug);
    },
    [select, onSelectSight],
  );

  const onPress = useCallback(
    (event: SightTap) => {
      const slug = pickSight(event);
      if (slug) choose(slug);
    },
    [choose],
  );

  return (
    <>
      <ShapeSource id={TRAILS_SOURCE_ID} shape={trails}>
        <LineLayer id={SIGHT_LAYER_IDS.trailCasing} style={TRAIL_STYLES.casing} />
        <LineLayer id={SIGHT_LAYER_IDS.trailLine} style={TRAIL_STYLES.line} />
      </ShapeSource>
      <ShapeSource id={SIGHTS_SOURCE_ID} shape={sights} onPress={onPress} hitbox={FINGER}>
        <CircleLayer id={SIGHT_LAYER_IDS.hit} style={SIGHT_STYLES.hit} />
        <CircleLayer id={SIGHT_LAYER_IDS.shadow} style={SIGHT_STYLES.shadow} />
        <CircleLayer id={SIGHT_LAYER_IDS.ring} style={SIGHT_STYLES.ring} />
        <CircleLayer id={SIGHT_LAYER_IDS.dot} style={SIGHT_STYLES.dot} filter={SIGHT_FILTERS.dot} />
        <SymbolLayer id={SIGHT_LAYER_IDS.name} style={SIGHT_STYLES.name} filter={SIGHT_FILTERS.name} />
      </ShapeSource>
      {visible && content
        ? content.accessible.map((sight) => <AccessibleRing key={sight.slug} sight={sight} onChoose={choose} />)
        : null}
    </>
  );
}

/** A drawn ring as TalkBack reaches it: a transparent button the size of its tap target. */
const AccessibleRing = memo(function AccessibleRing({
  sight,
  onChoose,
}: {
  readonly sight: AccessibleSight;
  readonly onChoose: (slug: string) => void;
}) {
  const { slug, size, label } = sight;
  return (
    <MarkerView coordinate={[sight.coordinate[0], sight.coordinate[1]]} anchor={CENTRE} allowOverlap>
      <Pressable
        onPress={() => onChoose(slug)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.target, { width: size, height: size, borderRadius: size / 2 }]}
        testID={`explore.map.sight.${slug}`}
      />
    </MarkerView>
  );
});

const styles = StyleSheet.create({
  target: { backgroundColor: 'transparent' },
});

export default memo(SightsLayer);
