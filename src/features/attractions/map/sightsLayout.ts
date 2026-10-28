/**
 * What the Explore map's sights layer draws for one camera (iOS
 * SearchMapView `visibleSights`, `visibleTrailRuns`, `trailsDrawnAtThisZoom`,
 * `tightTargetSlugs`, `sightNamePlacements` and `layOutSights`).
 *
 * Laid out again only when what it reads changes: the camera (at the end of a
 * move), the map's size, the layer, the data, the open sight, the venues on
 * the map and the language. Never on a pin tap: the caller memoises on
 * exactly those inputs, as iOS keys `layOutSights` on `SightsLayerKey`.
 */
import type { AttractionMarker, AttractionTrail } from '../../../api/attractions';
import type { Lang } from '../../../i18n';
import type { Coordinate } from '../../../lib/geo';
import { sightDisplayName } from '../model';
import { mapShows, mapShowsTrails, visibleTrails } from '../rules';
import {
  conflictRadiusMetres,
  labelled,
  labelWidth,
  latitudeSpan,
  tightTargets,
  venueCover,
  type LabelPlacement,
  type MapScreen,
  type VenueMark,
  type ViewRegion,
} from './layout';

/**
 * The most rings drawn at once. A backstop, not the design: the tier rules
 * keep the count down, and because the markers arrive top picks first,
 * whatever the cap cuts comes from the quietest tier. (iOS needs it because
 * SwiftUI builds a view per ring; Mapbox draws rings itself, but the same
 * rings show on both phones.)
 */
export const MAX_VISIBLE_SIGHTS = 220;
/** The most trails drawn at once, the ones covering most of the screen. */
export const MAX_VISIBLE_TRAILS = 80;

/** Where the map is looking, as the layout needs it. */
export interface SightsViewport {
  /**
   * The box in view: the camera as last reported, or before the first report
   * the region the map opened on. Null only for a camera that cannot be read.
   */
  readonly region: ViewRegion | null;
  /** Where coordinates land on screen, once the map has reported a camera and its size. */
  readonly screen: MapScreen | null;
  /** The map's height in points: turns the span into metres per point. */
  readonly mapHeight: number;
}

/** A venue drawn on the map: what a ring must keep clear of. */
export interface MapVenue {
  readonly coordinate: Coordinate;
  readonly mark: VenueMark;
}

export interface SightsLayout {
  /** The rings to draw, in map order (top picks first). */
  readonly sights: readonly AttractionMarker[];
  /** Rings near a venue: they answer only to a tap on the ring itself. */
  readonly tight: ReadonlySet<string>;
  /** Top picks whose name fits beside their ring, and on which side. */
  readonly names: ReadonlyMap<string, LabelPlacement>;
  /** The trails to draw. */
  readonly trails: readonly AttractionTrail[];
}

export const EMPTY_SIGHTS_LAYOUT: SightsLayout = { sights: [], tight: new Set(), names: new Map(), trails: [] };

/**
 * The rings worth drawing: inside the view, allowed at this zoom by their
 * tier, not under a venue photo, capped (iOS `visibleSights`).
 *
 * Tier first: top picks at every zoom, notable ones once most of the country
 * is out of view, the rest at about one region (`mapShows`). That keeps the
 * venue map the venue map, with the few places worth a detour on it. A ring a
 * venue photo would sit on is left out too: the venue is what a pass opens.
 * The open card's ring stays at any zoom and beside any venue: zooming out
 * behind the card must not make the place it describes vanish.
 */
export function visibleSights(
  ranked: readonly AttractionMarker[],
  viewport: SightsViewport,
  selectedSlug: string | null,
  venues: readonly Coordinate[],
): AttractionMarker[] {
  const { region, screen } = viewport;
  if (!region) {
    // A camera that cannot be read: the priority order alone, without the
    // quietest tier.
    return ranked.filter((sight) => sight.tier !== 'standard').slice(0, MAX_VISIBLE_SIGHTS);
  }
  const span = latitudeSpan(region);
  // Built once per pass: where the drawn venue photos sit on this screen.
  const covers = screen ? venueCover(venues, screen) : null;
  const drawn: AttractionMarker[] = [];
  for (const sight of ranked) {
    if (drawn.length >= MAX_VISIBLE_SIGHTS) break;
    const inView =
      sight.latitude >= region.south &&
      sight.latitude <= region.north &&
      sight.longitude >= region.west &&
      sight.longitude <= region.east;
    if (!inView) continue;
    if (sight.slug === selectedSlug || (mapShows(sight.tier, span) && !(covers?.(sight) ?? false))) drawn.push(sight);
  }
  return drawn;
}

/**
 * The trails worth drawing: only below about the island's height on screen
 * (at country zoom a hundred routes are a tangle over the rings people tap),
 * ranked by how much of the screen each covers, then capped (iOS
 * `visibleTrailRuns`).
 */
export function trailsInView(trails: readonly AttractionTrail[], region: ViewRegion | null): AttractionTrail[] {
  if (trails.length === 0 || !region || !mapShowsTrails(latitudeSpan(region))) return [];
  return visibleTrails(trails, region, MAX_VISIBLE_TRAILS);
}

/**
 * Whether trail lines can be on the map at this zoom: the legend lists them
 * only then, since an entry for something absent teaches the member to look
 * for it (iOS `trailsDrawnAtThisZoom`).
 */
export function trailsDrawnAtThisZoom(showSights: boolean, trailCount: number, region: ViewRegion | null): boolean {
  if (!showSights || trailCount === 0) return false;
  if (!region) return true;
  return mapShowsTrails(latitudeSpan(region));
}

export interface SightsLayoutInput {
  readonly showSights: boolean;
  /** Every marker, in map order (`rankedForMap`). */
  readonly ranked: readonly AttractionMarker[];
  readonly trails: readonly AttractionTrail[];
  readonly viewport: SightsViewport;
  readonly venues: readonly MapVenue[];
  readonly selectedSlug: string | null;
  readonly language: Lang;
}

/** The layer as drawn for one camera (iOS `layOutSights`). */
export function layOutSights({ showSights, ranked, trails, viewport, venues, selectedSlug, language }: SightsLayoutInput): SightsLayout {
  if (!showSights) return EMPTY_SIGHTS_LAYOUT;
  const venueCoordinates = venues.map((venue) => venue.coordinate);
  const sights = visibleSights(ranked, viewport, selectedSlug, venueCoordinates);

  let tight: ReadonlySet<string> = new Set();
  if (sights.length > 0 && viewport.region) {
    const radius = conflictRadiusMetres(latitudeSpan(viewport.region), viewport.mapHeight);
    tight = tightTargets(sights, venueCoordinates, radius);
  }

  let names: ReadonlyMap<string, LabelPlacement> = new Map();
  if (viewport.screen && sights.some((sight) => sight.tier === 'top')) {
    const widths = new Map(sights.map((sight) => [sight.slug, labelWidth(sightDisplayName(sight, language))]));
    names = labelled(
      sights,
      venues.map((venue) => venue.mark),
      viewport.screen,
      selectedSlug,
      (slug) => widths.get(slug) ?? 0,
    );
  }

  return { sights, tight, names, trails: trailsInView(trails, viewport.region) };
}
