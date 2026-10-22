/**
 * The sights layer as Mapbox draws it: GeoJSON for the rings and the trails,
 * the layer styles, and which ring a tap meant.
 *
 * Every ring is a feature of ONE source drawn by GL layers (a ShapeSource with
 * CircleLayers and a SymbolLayer), never a native view per sight: a few
 * hundred React Native views on the map would stutter on an Android phone,
 * where Mapbox draws thousands of circles without effort. What iOS draws per
 * annotation (`AttractionMapMarker`, `AttractionMapLabel`) is carried as
 * feature properties and read by data-driven styles.
 *
 * THE RING (iOS `AttractionMapMarker`). A HOLLOW LIGHT-BLUE RING over white,
 * never a filled photo marker: a filled marker means the pass opens it. The
 * tier changes the size and nothing else; a top pick has a light-blue centre
 * dot, a trailhead a dark one. SwiftUI strokes a circle on its path (half in,
 * half out), Mapbox strokes outside the radius, so the radius is drawn half a
 * stroke smaller to land on the same pixels. A soft shadow under each ring
 * stands in for SwiftUI's `.shadow` (radius 4 for a top pick, else 3; lighter
 * for a standard sight).
 *
 * THE NAME (iOS `AttractionMapLabel`). Top picks only, where the layout found
 * room (./layout.ts `labelled`), in the dark attraction blue with a white
 * halo, 11 pt, one line, a point off the ring on the chosen side. Mapbox is
 * told to draw it where it was placed and to leave other labels alone: the
 * placement already kept it off every ring, photo and venue name.
 *
 * THE TAP TARGET. An invisible circle per ring, 34 pt across (40 for a top
 * pick), or the ring itself beside a venue (`hitSize`). The source answers a
 * tap only where one of its layers is drawn under the finger: the target, the
 * ring, or the name (a name is part of its sight's button on iOS too). The
 * shadows, which reach past the ring, are drawn from a source that takes no
 * taps (`SIGHT_SHADOWS_SOURCE_ID`).
 */
import type { CircleLayerStyle, LineLayerStyle, SymbolLayerStyle } from '@rnmapbox/maps';

import type { AttractionTier, AttractionTrail } from '../../../api/attractions';
import type { Lang } from '../../../i18n';
import { colors } from '../../../theme';
import { ringDotColor, ringDotDiameter, ringLineWidth } from '../AttractionRing';
import { isHike, sightDisplayName } from '../model';
import { ringDiameter, tierPriority } from '../rules';
import { hitSize, labelText, MAP_LAYOUT, type LabelPlacement } from './layout';
import type { SightsLayout } from './sightsLayout';

/** The source and layer ids on the Explore map. */
export const SIGHTS_SOURCE_ID = 'lifepass-sights';
/**
 * The rings' shadows, from the same features through a source of their own
 * that takes no taps: a shadow reaches past its ring, and a tap on it must
 * not open a sight whose target is the ring alone (beside a venue).
 */
export const SIGHT_SHADOWS_SOURCE_ID = 'lifepass-sight-shadows';
export const TRAILS_SOURCE_ID = 'lifepass-trails';
export const SIGHT_LAYER_IDS = {
  hit: 'lifepass-sight-hit',
  shadow: 'lifepass-sight-shadow',
  ring: 'lifepass-sight-ring',
  dot: 'lifepass-sight-dot',
  name: 'lifepass-sight-name',
  trailCasing: 'lifepass-trail-casing',
  trailLine: 'lifepass-trail-line',
} as const;

/** Mapbox anchors for each side a name can hang on. */
type TextAnchor = 'top' | 'bottom' | 'left' | 'right';

export interface SightFeatureProperties {
  readonly slug: string;
  readonly tier: AttractionTier;
  /** Draw order: the open sight on top, then top picks, notable, standard. */
  readonly sort: number;
  /** The ring's radius to the middle of its inner edge (Mapbox strokes outside it). */
  readonly radius: number;
  readonly stroke: number;
  /** The centre dot's radius, 0 for none. */
  readonly dot: number;
  readonly dotColor: string;
  /** The tap target's radius. */
  readonly hit: number;
  readonly shadowRadius: number;
  readonly shadowBlur: number;
  readonly shadowOpacity: number;
  /** The name to draw beside the ring, '' for none. */
  readonly name: string;
  readonly anchor: TextAnchor;
  /** The name's offset from the ring's centre, in ems of its text size. */
  readonly offset: readonly [number, number];
}

export type SightsCollection = GeoJSON.FeatureCollection<GeoJSON.Point, SightFeatureProperties>;
export type TrailsCollection = GeoJSON.FeatureCollection<GeoJSON.MultiLineString, { readonly slug: string }>;

export const NO_SIGHTS: SightsCollection = { type: 'FeatureCollection', features: [] };
export const NO_TRAILS: TrailsCollection = { type: 'FeatureCollection', features: [] };

/**
 * Mapbox sets a text line 1.2 ems tall; iOS centres the name in a 15 pt box.
 * Half the difference keeps the glyphs where iOS draws them.
 */
const LINE_CENTRING = (MAP_LAYOUT.labelHeight - MAP_LAYOUT.labelTextSize * 1.2) / 2;

/** Where the name hangs for a placement, as a Mapbox anchor and an offset in ems. */
export function nameAnchor(placement: LabelPlacement, diameter: number): { anchor: TextAnchor; offset: [number, number] } {
  const size = MAP_LAYOUT.labelTextSize;
  const along = (diameter / 2 + MAP_LAYOUT.labelGap + LINE_CENTRING) / size;
  const beside = (diameter / 2 + MAP_LAYOUT.labelGap) / size;
  switch (placement) {
    case 'below':
      return { anchor: 'top', offset: [0, along] };
    case 'above':
      return { anchor: 'bottom', offset: [0, -along] };
    case 'trailing':
      return { anchor: 'left', offset: [beside, 0] };
    case 'leading':
      return { anchor: 'right', offset: [-beside, 0] };
  }
}

/** The rings as GeoJSON, positions in [longitude, latitude] order. */
export function sightFeatures(layout: SightsLayout, selectedSlug: string | null, language: Lang): SightsCollection {
  if (layout.sights.length === 0) return NO_SIGHTS;
  const features = layout.sights.map((sight): GeoJSON.Feature<GeoJSON.Point, SightFeatureProperties> => {
    const selected = sight.slug === selectedSlug;
    const diameter = ringDiameter(sight.tier, selected);
    const stroke = ringLineWidth(sight.tier, selected);
    const dotColor = ringDotColor(sight.tier, isHike(sight));
    const shadow = sight.tier === 'top' ? 4 : 3;
    const outer = diameter / 2 + stroke / 2;
    const placement = layout.names.get(sight.slug);
    const name = placement ? labelText(sightDisplayName(sight, language)) : '';
    const { anchor, offset } = placement ? nameAnchor(placement, diameter) : { anchor: 'top' as const, offset: [0, 0] as [number, number] };
    return {
      type: 'Feature',
      id: sight.slug,
      geometry: { type: 'Point', coordinates: [sight.longitude, sight.latitude] },
      properties: {
        slug: sight.slug,
        tier: sight.tier,
        sort: selected ? 3 : 2 - tierPriority(sight.tier),
        radius: diameter / 2 - stroke / 2,
        stroke,
        dot: dotColor ? ringDotDiameter(sight.tier, selected) / 2 : 0,
        dotColor: dotColor ?? colors.attraction,
        hit: hitSize(sight.tier, selected, layout.tight.has(sight.slug)) / 2,
        shadowRadius: outer + shadow,
        shadowBlur: (2 * shadow) / (outer + shadow),
        shadowOpacity: sight.tier === 'standard' ? 0.18 : 0.25,
        name,
        anchor,
        offset,
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** The trails as GeoJSON, one feature per walk with every run of it. */
export function trailFeatures(trails: readonly AttractionTrail[]): TrailsCollection {
  if (trails.length === 0) return NO_TRAILS;
  return {
    type: 'FeatureCollection',
    features: trails.map((trail) => ({
      type: 'Feature',
      id: trail.slug,
      geometry: {
        type: 'MultiLineString',
        coordinates: trail.lines.map((run) => run.map((point) => [point.longitude, point.latitude])),
      },
      properties: { slug: trail.slug },
    })),
  };
}

// MARK: - Styles

/** The fonts the names are set in: the basemap's own, as the venue names (Mapbox has no Inter Tight glyphs). */
const NAME_FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular'];

export const SIGHT_STYLES: {
  readonly hit: CircleLayerStyle;
  readonly shadow: CircleLayerStyle;
  readonly ring: CircleLayerStyle;
  readonly dot: CircleLayerStyle;
  readonly name: SymbolLayerStyle;
} = {
  hit: {
    circleRadius: ['get', 'hit'],
    circleColor: '#000000',
    // Invisible, and still under the finger: a query reads geometry, not paint.
    circleOpacity: 0,
    circleStrokeWidth: 0,
  },
  shadow: {
    circleRadius: ['get', 'shadowRadius'],
    circleColor: '#000000',
    circleOpacity: ['get', 'shadowOpacity'],
    circleBlur: ['get', 'shadowBlur'],
    circleTranslate: [0, 1],
    circleSortKey: ['get', 'sort'],
  },
  ring: {
    circleRadius: ['get', 'radius'],
    circleColor: '#FFFFFF',
    circleStrokeColor: colors.attraction,
    circleStrokeWidth: ['get', 'stroke'],
    circleSortKey: ['get', 'sort'],
  },
  dot: {
    circleRadius: ['get', 'dot'],
    circleColor: ['get', 'dotColor'],
    circleSortKey: ['get', 'sort'],
  },
  name: {
    textField: ['get', 'name'],
    textFont: NAME_FONT,
    textSize: MAP_LAYOUT.labelTextSize,
    textColor: colors.attraction2,
    textHaloColor: '#FFFFFF',
    textHaloWidth: 1.5,
    textHaloBlur: 0.5,
    textAnchor: ['get', 'anchor'],
    textOffset: ['get', 'offset'],
    textJustify: 'auto',
    // One line: the name was cut to fit already (`labelText`).
    textMaxWidth: 100,
    // Placed by the layout, which kept it off every ring, photo and venue
    // name: drawn where it was put, and in nobody else's way.
    textAllowOverlap: true,
    textIgnorePlacement: true,
  },
};

/** The filters: a dot only where there is one, a name only where it fits. */
export const SIGHT_FILTERS = {
  dot: ['>', ['get', 'dot'], 0],
  name: ['!=', ['get', 'name'], ''],
} as const;

/**
 * The trail recipe (iOS `TrailStroke`): a 6 pt white casing under a 3 pt
 * light-blue line, round caps and joins, so a trail reads on moss, snow and
 * lava alike. The sight card's route (../detail/SightMap.tsx `TRAIL_STROKE`)
 * draws the same, and a test holds the two equal, so the map and the card can
 * never draw one trail two ways. (Not imported from there: the card's module
 * brings the whole UI kit with it.) All casings draw before any line (two
 * layers over one source), so where two routes cross no white gap cuts
 * through the other's blue.
 */
export const TRAIL_STYLES: { readonly casing: LineLayerStyle; readonly line: LineLayerStyle } = {
  casing: { lineColor: '#FFFFFF', lineWidth: 6, lineCap: 'round', lineJoin: 'round' },
  line: { lineColor: colors.attraction, lineWidth: 3, lineCap: 'round', lineJoin: 'round' },
};

// MARK: - Taps

/** What a tap hands back: the features under the finger and where it landed. */
export interface SightTap {
  readonly features: readonly GeoJSON.Feature[];
  readonly coordinates: { readonly latitude: number; readonly longitude: number };
}

/**
 * The sight a tap meant, or null: among the rings under the finger, the top
 * tier first, then the nearest (the web map's `pickNearestPointTarget`).
 */
export function pickSight(tap: SightTap): string | null {
  let best: { slug: string; priority: number; distance: number } | null = null;
  for (const feature of tap.features) {
    const properties = feature.properties as Partial<SightFeatureProperties> | null;
    const slug = properties?.slug;
    if (typeof slug !== 'string' || feature.geometry?.type !== 'Point') continue;
    const [longitude, latitude] = feature.geometry.coordinates;
    const k = Math.cos((tap.coordinates.latitude * Math.PI) / 180);
    const distance = Math.hypot((longitude - tap.coordinates.longitude) * k, latitude - tap.coordinates.latitude);
    const priority = tierPriority(isTier(properties?.tier) ? properties.tier : 'notable');
    if (!best || priority < best.priority || (priority === best.priority && distance < best.distance)) {
      best = { slug, priority, distance };
    }
  }
  return best?.slug ?? null;
}

function isTier(value: unknown): value is AttractionTier {
  return value === 'top' || value === 'notable' || value === 'standard';
}
