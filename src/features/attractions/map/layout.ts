/**
 * Where the Explore map's sights sit on screen: the port of the map half of
 * iOS Models/AttractionRanking.swift (`AttractionHitTarget`, `MapScreen`,
 * `AttractionMapLayout`).
 *
 * Pure on purpose: no React, no Mapbox, no stores. The map reports its camera
 * at the end of a move (the visible box, its heading and pitch) and its size;
 * these rules turn that into which rings a venue photo leaves out, which rings
 * answer only to a tap on the ring itself, and where the top picks' names go.
 *
 * Why the phone decides these and not Mapbox: the venue photos are native
 * views over the map (MarkerViews), and Mapbox's own label collision only
 * sees other labels. Left to Mapbox, a top pick's name would run under a venue
 * photo or across a neighbouring ring, which is what iOS found MapKit doing
 * and replaced with these same rules.
 */
import type { AttractionMarker, AttractionTier } from '../../../api/attractions';
import type { Coordinate } from '../../../lib/geo';
import { ringDiameter } from '../rules';

// MARK: - The map on screen

/** A rectangle in screen points (dp), top-left origin, as CGRect. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The camera as the map reports it at the end of a move (rnmapbox `MapState.properties`). */
export interface MapCameraReport {
  /** North-east and south-west corners, [longitude, latitude]. */
  readonly bounds: { readonly ne: readonly number[]; readonly sw: readonly number[] };
  readonly heading: number;
  readonly pitch: number;
}

/** The part of the world in view, in degrees. */
export interface ViewRegion {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** The latitude span on screen: the measure every zoom rule uses (iOS `span.latitudeDelta`). */
export function latitudeSpan(region: ViewRegion): number {
  return region.north - region.south;
}

/** The reported camera's box, or null when it is not a box at all. */
export function regionOfCamera(camera: MapCameraReport): ViewRegion | null {
  const [east, north] = camera.bounds.ne;
  const [west, south] = camera.bounds.sw;
  if (![east, north, west, south].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (!(north > south)) return null;
  return { south, west, north, east };
}

/** A region stated as a centre and a span, as a box (iOS `cameraPosition.region`). */
export function regionOfSpan(region: {
  readonly center: Coordinate;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}): ViewRegion {
  return {
    south: region.center.latitude - region.latitudeDelta / 2,
    north: region.center.latitude + region.latitudeDelta / 2,
    west: region.center.longitude - region.longitudeDelta / 2,
    east: region.center.longitude + region.longitudeDelta / 2,
  };
}

/** Web Mercator, as a fraction of the world's width: x grows east, y grows south (MKMapPoint's axes). */
export function mercator(coordinate: Coordinate): { readonly x: number; readonly y: number } {
  const x = (coordinate.longitude + 180) / 360;
  const phi = (Math.max(-85.05112878, Math.min(85.05112878, coordinate.latitude)) * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
  return { x, y };
}

/**
 * Where the Explore map is looking, in the terms the on-screen rules need
 * (iOS `MapScreen`): the visible box in map units, the map's size in points,
 * and whether the camera is flat and facing north. Only a flat, north-up
 * camera gives a coordinate a known place on screen; turned or tilted, the
 * reported box is merely a box around the view.
 */
export interface MapScreen {
  readonly minX: number;
  readonly minY: number;
  readonly rectWidth: number;
  readonly rectHeight: number;
  readonly size: Size;
  readonly isFlatNorthUp: boolean;
}

/** Within a degree of north and of looking straight down. */
export function isFlatNorthUp(heading: number, pitch: number): boolean {
  const turned = heading % 360;
  const normalised = turned < 0 ? turned + 360 : turned;
  return Math.abs(pitch) < 1 && Math.min(normalised, 360 - normalised) < 1;
}

/** The screen for a reported camera and the map's size, or null before both are known. */
export function mapScreenOf(camera: MapCameraReport | null, size: Size): MapScreen | null {
  if (!camera) return null;
  const region = regionOfCamera(camera);
  if (!region) return null;
  const ne = mercator({ latitude: region.north, longitude: region.east });
  const sw = mercator({ latitude: region.south, longitude: region.west });
  const rectWidth = ne.x - sw.x;
  const rectHeight = sw.y - ne.y;
  if (!(rectWidth > 0) || !(rectHeight > 0) || !(size.width > 0) || !(size.height > 0)) return null;
  return {
    minX: sw.x,
    minY: ne.y,
    rectWidth,
    rectHeight,
    size,
    isFlatNorthUp: isFlatNorthUp(camera.heading, camera.pitch),
  };
}

/**
 * Screen points per map unit. Exact on a flat, north-up camera; otherwise the
 * box is a bounding box and the smaller ratio can only understate a distance
 * on screen, which leaves out a ring too many rather than one too few.
 */
export function pointsPerMapUnit(screen: MapScreen): number {
  return Math.min(screen.size.width / screen.rectWidth, screen.size.height / screen.rectHeight);
}

/** Where a coordinate lands, in points from the map's top-left. Meaningful only when flat and north-up. */
export function screenPoint(screen: MapScreen, coordinate: Coordinate): { readonly x: number; readonly y: number } {
  const p = mercator(coordinate);
  return {
    x: ((p.x - screen.minX) * screen.size.width) / screen.rectWidth,
    y: ((p.y - screen.minY) * screen.size.height) / screen.rectHeight,
  };
}

/** How far apart two coordinates are on screen, for any camera. */
export function screenDistance(screen: MapScreen, a: Coordinate, b: Coordinate): number {
  const p = mercator(a);
  const q = mercator(b);
  return Math.hypot(p.x - q.x, p.y - q.y) * pointsPerMapUnit(screen);
}

// MARK: - Taps near venues

/**
 * Keeps a sight's ring from stealing a tap meant for a venue (iOS
 * `AttractionHitTarget`).
 *
 * A ring is 13 to 22 pt, but its tap target is widened to 34 pt (40 for a top
 * pick) because a thumb is not 16 pt. Beside a venue photo that generosity
 * backfires: the widened circle overlaps the photo, and a tap aimed at the
 * pool opens a waterfall. The venue is what a pass opens, so near one the
 * ring gives the space back and answers only to taps on the ring itself.
 *
 * "Near" is 300 m, or the ground distance the overlap covers at the current
 * zoom when that is larger: zoomed out, 300 m is a fraction of a point and
 * would protect nothing.
 */
export const HIT_TARGET = {
  minimumConflictMetres: 300,
  /** Half the widened ring (17 pt) plus half a venue photo (22 pt), with slack for a thumb between the two. */
  conflictPoints: 44,
  metresPerDegreeLatitude: 111_320,
  /** The widened targets, in points across. */
  topPick: 40,
  other: 34,
} as const;

export function conflictRadiusMetres(latitudeSpanDegrees: number, mapHeightPoints: number): number {
  if (!(latitudeSpanDegrees > 0) || !(mapHeightPoints > 0)) return HIT_TARGET.minimumConflictMetres;
  const metresPerPoint = (latitudeSpanDegrees * HIT_TARGET.metresPerDegreeLatitude) / mapHeightPoints;
  return Math.max(HIT_TARGET.minimumConflictMetres, HIT_TARGET.conflictPoints * metresPerPoint);
}

/**
 * Equirectangular: exact enough at the scale of a fingertip, and cheap enough
 * to run for every ring on every camera change.
 */
export function distanceMetres(a: Coordinate, b: Coordinate): number {
  const k = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  const dy = (a.latitude - b.latitude) * HIT_TARGET.metresPerDegreeLatitude;
  const dx = (a.longitude - b.longitude) * HIT_TARGET.metresPerDegreeLatitude * k;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Slugs of the sights that must keep a tight tap target. */
export function tightTargets(
  sights: readonly Pick<AttractionMarker, 'slug' | 'latitude' | 'longitude'>[],
  venues: readonly Coordinate[],
  radiusMetres: number,
): Set<string> {
  const tight = new Set<string>();
  if (venues.length === 0 || !(radiusMetres > 0)) return tight;
  for (const sight of sights) {
    if (venues.some((venue) => distanceMetres(sight, venue) < radiusMetres)) tight.add(sight.slug);
  }
  return tight;
}

/** The ring's tap target in points across: the ring itself when tight, else widened. */
export function hitSize(tier: AttractionTier, isSelected: boolean, tight: boolean): number {
  if (tight) return ringDiameter(tier, isSelected);
  return tier === 'top' ? HIT_TARGET.topPick : HIT_TARGET.other;
}

// MARK: - Rings and names on screen

/**
 * The measures the layout works in (iOS `AttractionMapLayout`), in points.
 * The venue photo is EXPL-2's 44 dp pin, centred on the venue's coordinate;
 * its name sits under it in about 11.5 pt semibold, wrapping past 128.
 */
export const MAP_LAYOUT = {
  venuePhotoDiameter: 44,
  venueTitleMaxWidth: 128,
  venueTitleLineHeight: 14,
  venueTitleTextSize: 11.5,
  /** Room between shapes that would otherwise just touch (a shadow, a halo). */
  slack: 2,
  /** A top pick's name: one line, a point off its ring. */
  labelHeight: 15,
  labelGap: 1,
  labelMaxWidth: 132,
  labelTextSize: 11,
  /** Names keep this far inside the map's edge, so none is cut in half. */
  edgeInset: 4,
} as const;

/**
 * The venue photos on one screen, asked which rings they would sit on (iOS
 * `AttractionMapLayout.VenueCover`). Such a ring is left out rather than
 * stacked beneath: it comes back once the member zooms in far enough for the
 * two to part, and the caller never leaves out the ring of the open card.
 */
export function venueCover(
  venues: readonly Coordinate[],
  screen: MapScreen,
): (sight: Pick<AttractionMarker, 'tier' | 'latitude' | 'longitude'>) => boolean {
  const photo = MAP_LAYOUT.venuePhotoDiameter;
  const centres: { x: number; y: number }[] = [];
  if (screen.isFlatNorthUp) {
    for (const venue of venues) {
      const centre = screenPoint(screen, venue);
      // Only photos that can reach the screen.
      if (centre.x >= -photo && centre.x <= screen.size.width + photo && centre.y >= -photo && centre.y <= screen.size.height + photo) {
        centres.push(centre);
      }
    }
  }
  return (sight) => {
    const reach = ringDiameter(sight.tier, false) / 2 + photo / 2 + MAP_LAYOUT.slack;
    if (!screen.isFlatNorthUp) {
      // The photo is centred on its coordinate, so the test needs only a
      // distance, and that holds at any heading.
      return venues.some((venue) => screenDistance(screen, sight, venue) < reach);
    }
    const ring = screenPoint(screen, sight);
    return centres.some((centre) => Math.hypot(ring.x - centre.x, ring.y - centre.y) < reach);
  };
}

/** Which side of its ring a top pick's name sits on, in the order tried. */
export type LabelPlacement = 'below' | 'trailing' | 'leading' | 'above';
export const LABEL_PLACEMENTS: readonly LabelPlacement[] = ['below', 'trailing', 'leading', 'above'];

/** A name's rectangle on screen, a point off its ring on the given side, centred on the ring along that side. */
export function labelRect(placement: LabelPlacement, ring: Rect, width: number): Rect {
  const midX = ring.x + ring.width / 2;
  const midY = ring.y + ring.height / 2;
  const { labelGap, labelHeight } = MAP_LAYOUT;
  switch (placement) {
    case 'below':
      return { x: midX - width / 2, y: ring.y + ring.height + labelGap, width, height: labelHeight };
    case 'above':
      return { x: midX - width / 2, y: ring.y - labelGap - labelHeight, width, height: labelHeight };
    case 'trailing':
      return { x: ring.x + ring.width + labelGap, y: midY - labelHeight / 2, width, height: labelHeight };
    case 'leading':
      return { x: ring.x - labelGap - width, y: midY - labelHeight / 2, width, height: labelHeight };
  }
}

/** CGRect.insetBy: negative values grow the rectangle. */
export function inset(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width - 2 * dx, height: rect.height - 2 * dy };
}

/** Whether two rectangles share some area (CGRect.intersects: touching edges do not). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Whether `inner` lies wholly inside `outer` (CGRect.contains). */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** A venue on the map: where, and its name's size as the map sets it under the photo. */
export interface VenueMark {
  readonly coordinate: Coordinate;
  readonly titleSize: Size;
}

/**
 * Where each top pick's name goes at this zoom, for the picks whose name fits
 * somewhere (iOS `AttractionMapLayout.labelled`).
 *
 * A name sits a point off its ring, and only where it overlaps nothing: no
 * other ring, no venue photo or venue name, no name already placed, and not
 * past the map's edge. Below the ring first, then trailing, leading and
 * above: a crowded coast has room beside a ring far more often than under it.
 * Venues and every drawn ring claim their space before any name does. Names
 * are placed in the order `sights` arrives in, the map's (top picks, best
 * score first), so in a crowd the best-known place keeps its name.
 *
 * Only on a flat, north-up camera, where a name's place is known. Turned or
 * tilted, the rings stay and the names wait.
 */
export function labelled(
  sights: readonly Pick<AttractionMarker, 'slug' | 'tier' | 'latitude' | 'longitude'>[],
  venues: readonly VenueMark[],
  screen: MapScreen,
  selectedSlug: string | null,
  labelWidth: (slug: string) => number,
): Map<string, LabelPlacement> {
  const placements = new Map<string, LabelPlacement>();
  if (!screen.isFlatNorthUp) return placements;
  const { edgeInset, slack, venuePhotoDiameter, labelMaxWidth } = MAP_LAYOUT;
  const bounds = inset({ x: 0, y: 0, width: screen.size.width, height: screen.size.height }, edgeInset, edgeInset);

  const rings = sights.map((sight) => {
    const diameter = ringDiameter(sight.tier, sight.slug === selectedSlug);
    const centre = screenPoint(screen, sight);
    return { slug: sight.slug, rect: { x: centre.x - diameter / 2, y: centre.y - diameter / 2, width: diameter, height: diameter } };
  });

  const taken: Rect[] = [];
  const photoRadius = venuePhotoDiameter / 2;
  for (const venue of venues) {
    const centre = screenPoint(screen, venue.coordinate);
    const photo = { x: centre.x - photoRadius, y: centre.y - photoRadius, width: venuePhotoDiameter, height: venuePhotoDiameter };
    const title = {
      x: centre.x - venue.titleSize.width / 2,
      y: centre.y + photoRadius,
      width: venue.titleSize.width,
      height: venue.titleSize.height,
    };
    for (const rect of [photo, title]) {
      if (intersects(rect, bounds)) taken.push(rect);
    }
  }

  sights.forEach((sight, index) => {
    if (sight.tier !== 'top') return;
    const ring = rings[index].rect;
    const width = Math.min(labelMaxWidth, labelWidth(sight.slug));
    for (const placement of LABEL_PLACEMENTS) {
      const label = labelRect(placement, ring, width);
      if (!contains(bounds, label)) continue;
      const clearance = inset(label, -slack, -slack);
      // Other rings are measured with no room on the side the name hangs
      // from: with room there too, a neighbour of the same size level with
      // this ring would always count as touched, and two top picks side by
      // side would both lose their names, the better one included.
      const ringClearance = placement === 'below' || placement === 'above' ? inset(label, -slack, 0) : inset(label, 0, -slack);
      if (taken.some((rect) => intersects(rect, clearance))) continue;
      if (rings.some((other) => other.slug !== sight.slug && intersects(other.rect, ringClearance))) continue;
      taken.push(label);
      placements.set(sight.slug, placement);
      break;
    }
  });
  return placements;
}

// MARK: - Measuring names

/**
 * A text's advance width in ems, estimated. React Native cannot measure text
 * synchronously and Mapbox draws the names itself, so the layout works from
 * a per-letter table for a semibold sans, set a little wide: as on iOS (which
 * measures in the system face, wider than Inter Tight), an overestimate can
 * only drop a name that would have fitted, never overlap one that did not.
 */
export function textWidthEms(text: string): number {
  let ems = 0;
  for (const char of Array.from(text)) ems += charEms(char);
  return ems;
}

const NARROW = new Set(Array.from("iljíìïîI|.,:;!'`·"));
const SEMI_NARROW = new Set(Array.from('ftr()[]-/ '));
const WIDE_LOWER = new Set(Array.from('mwæœ'));
const WIDE_UPPER = new Set(Array.from('MWÆŒ'));

function charEms(char: string): number {
  if (NARROW.has(char)) return 0.3;
  if (SEMI_NARROW.has(char)) return 0.4;
  if (WIDE_LOWER.has(char)) return 0.88;
  if (WIDE_UPPER.has(char)) return 0.95;
  if (/[0-9]/.test(char)) return 0.6;
  if (char !== char.toLowerCase()) return 0.7;
  return 0.6;
}

/** The width a top pick's name is placed by (iOS `AttractionMapLabel.width(of:)`): measured plus room for the halo, capped. */
export function labelWidth(name: string): number {
  return Math.min(MAP_LAYOUT.labelMaxWidth, Math.ceil(textWidthEms(name) * MAP_LAYOUT.labelTextSize) + 4);
}

/**
 * The name as drawn: one line, cut with an ellipsis where it would run past
 * the label's width (iOS `lineLimit(1)` with tail truncation). Mapbox wraps
 * rather than truncates, so the cut is made here.
 */
export function labelText(name: string): string {
  const room = MAP_LAYOUT.labelMaxWidth - 4;
  const size = MAP_LAYOUT.labelTextSize;
  if (textWidthEms(name) * size <= room) return name;
  const chars = Array.from(name);
  const ellipsis = textWidthEms('…');
  let ems = ellipsis;
  let cut = 0;
  while (cut < chars.length && (ems + charEms(chars[cut])) * size <= room) {
    ems += charEms(chars[cut]);
    cut += 1;
  }
  return `${chars.slice(0, cut).join('').trimEnd()}…`;
}

/**
 * A venue's name as the map sets it under the photo (iOS `venueTitleSize`):
 * about 11.5 pt, wrapping once past 128. Measured a little wide, so a sight's
 * name keeps clear of it.
 */
export function venueTitleSize(name: string): Size {
  const width = Math.ceil(textWidthEms(name) * MAP_LAYOUT.venueTitleTextSize) + 4;
  const lines = width > MAP_LAYOUT.venueTitleMaxWidth ? 2 : 1;
  return { width: Math.min(width, MAP_LAYOUT.venueTitleMaxWidth), height: lines * MAP_LAYOUT.venueTitleLineHeight };
}
