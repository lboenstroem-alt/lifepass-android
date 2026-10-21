/**
 * The rules that decide which sights the Explore map, Home and search put in
 * front of someone: the port of iOS Models/AttractionRanking.swift (tiers,
 * zoom policy, map order, trail culling, Home's picks, search, labels).
 *
 * Pure on purpose: no React, no network, no stores. The three surfaces share
 * one idea of what a top pick is, and the phone never re-ranks: the tier and
 * score are the server's (computed over the whole country), and two copies of
 * a ranking rule drift apart.
 *
 * The map's own placement rules (hit targets near venues, top-pick names) are
 * ATTR-2's, beside the map layer (./map).
 */
import { foldSightName, type AttractionMarker, type AttractionTier, type AttractionTrail, type TrailBounds } from '../../api/attractions';
import { distanceMeters, type Coordinate } from '../../lib/geo';

export { foldSightName, tierOf } from '../../api/attractions';

// MARK: - Tier

/** Lower sorts first: drawn first, and first to survive the on-screen cap. */
export function tierPriority(tier: AttractionTier): number {
  switch (tier) {
    case 'top':
      return 0;
    case 'notable':
      return 1;
    case 'standard':
      return 2;
  }
}

/**
 * A ring's drawn diameter in points: a top pick larger, a standard sight
 * smaller and quieter (iOS `AttractionTier.ringDiameter`). With the rules
 * because the map measures rings too, and two copies of a size drift.
 */
export function ringDiameter(tier: AttractionTier, isSelected: boolean): number {
  switch (tier) {
    case 'top':
      return isSelected ? 28 : 22;
    case 'notable':
      return isSelected ? 22 : 16;
    case 'standard':
      return isSelected ? 19 : 13;
  }
}

// MARK: - When a tier appears

/**
 * What the Explore map shows at a zoom, measured as the latitude span on
 * screen (iOS `AttractionMapPolicy`). Iceland is a little over three degrees
 * of latitude, so: most of the country (2.5°), about one region (0.8°), and
 * just under the whole island for trail lines (3°). Top picks show at every
 * zoom: that is the reason to have them.
 */
export const ATTRACTION_MAP_POLICY = {
  notableBelowLatitudeSpan: 2.5,
  standardBelowLatitudeSpan: 0.8,
  trailsBelowLatitudeSpan: 3.0,
} as const;

export function mapShows(tier: AttractionTier, latitudeSpan: number): boolean {
  switch (tier) {
    case 'top':
      return true;
    case 'notable':
      return latitudeSpan < ATTRACTION_MAP_POLICY.notableBelowLatitudeSpan;
    case 'standard':
      return latitudeSpan < ATTRACTION_MAP_POLICY.standardBelowLatitudeSpan;
  }
}

export function mapShowsTrails(latitudeSpan: number): boolean {
  return latitudeSpan < ATTRACTION_MAP_POLICY.trailsBelowLatitudeSpan;
}

/** Tier, then score (none reads as 0), then feed order. */
function compareRank(
  l: { readonly marker: Pick<AttractionMarker, 'tier' | 'rankScore'>; readonly index: number },
  r: { readonly marker: Pick<AttractionMarker, 'tier' | 'rankScore'>; readonly index: number },
): number {
  const lp = tierPriority(l.marker.tier);
  const rp = tierPriority(r.marker.tier);
  if (lp !== rp) return lp - rp;
  const ls = l.marker.rankScore ?? 0;
  const rs = r.marker.rankScore ?? 0;
  if (ls !== rs) return rs - ls;
  return l.index - r.index;
}

/**
 * The order the map draws and caps in: tier, then score, then feed order, so
 * the surviving set does not reshuffle between two identical camera
 * positions (the explicit index keeps it stable, as on iOS).
 */
export function rankedForMap<M extends Pick<AttractionMarker, 'tier' | 'rankScore'>>(markers: readonly M[]): M[] {
  return markers
    .map((marker, index) => ({ marker, index }))
    .sort(compareRank)
    .map((entry) => entry.marker);
}

// MARK: - Which trails to draw

/** A viewport as the map reports it. */
export interface ViewBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * How much of the view a trail's box covers, with a floor of `minLatitude` by
 * `minLongitude` on its thickness: a trail running due north has a box with
 * no width, and a bare area would rank the longest walk on screen below a
 * car-park loop.
 */
export function trailOverlap(box: TrailBounds, view: ViewBounds, minLatitude: number, minLongitude: number): number {
  const latitude = Math.min(box.north, view.north) - Math.max(box.south, view.south);
  const longitude = Math.min(box.east, view.east) - Math.max(box.west, view.west);
  if (latitude < 0 || longitude < 0) return 0;
  return (latitude + minLatitude) * (longitude + minLongitude);
}

function intersects(box: TrailBounds, view: ViewBounds): boolean {
  return box.south <= view.north && box.north >= view.south && box.west <= view.east && box.east >= view.west;
}

/**
 * Trails worth drawing in a view, most on screen first, at most `limit` (iOS
 * `TrailViewport.visible`). The feed arrives sorted by slug, and capping in
 * that order would keep every trail beginning with "a" and drop the one the
 * member zoomed in to look at, so candidates are ranked BEFORE the cap. A
 * trail smaller than 1/150 of the view in both directions is skipped: until
 * the member zooms in it is a smudge under its own trailhead ring.
 */
export function visibleTrails<T extends Pick<AttractionTrail, 'slug' | 'bounds'>>(
  trails: readonly T[],
  view: ViewBounds,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  const minLatitude = (view.north - view.south) / 150;
  const minLongitude = (view.east - view.west) / 150;
  const candidates: { trail: T; overlap: number }[] = [];
  for (const trail of trails) {
    const box = trail.bounds;
    if (!intersects(box, view)) continue;
    if (!(box.north - box.south >= minLatitude || box.east - box.west >= minLongitude)) continue;
    candidates.push({ trail, overlap: trailOverlap(box, view, minLatitude, minLongitude) });
  }
  candidates.sort((l, r) => {
    if (l.overlap !== r.overlap) return r.overlap - l.overlap;
    return l.trail.slug < r.trail.slug ? -1 : l.trail.slug > r.trail.slug ? 1 : 0;
  });
  return candidates.slice(0, limit).map((c) => c.trail);
}

// MARK: - Home's picks

export const HOME_PICKS_LIMIT = 6;

/**
 * Whether a fix is somewhere "near you" can honestly mean a sight in Iceland:
 * the island and its offshore islands, with a margin. Sorted from London,
 * the "nearest" picks are simply those closest to Keflavík, 1,900 km away
 * under a heading that says near you; outside this box the card shows the
 * country-wide selection instead.
 */
export function isAroundIceland(location: Coordinate): boolean {
  const { latitude, longitude } = location;
  return latitude >= 62.8 && latitude <= 67.4 && longitude >= -25.2 && longitude <= -12.8;
}

/**
 * Up to `limit` top picks for Home's Outside card (iOS `AttractionPicks.forHome`).
 *
 * With an origin: nearest first in a straight line (score order breaks a tie,
 * so two picks at one car park keep their order between renders). Without
 * one: the best pick of each region in turn, one from every region before a
 * second from any, so someone planning a trip sees the country; ranked by
 * score alone, the south coast would take every slot.
 *
 * Only `top`. A server from before the ranking sends no tiers, every sight
 * reads as notable, and the card stays hidden rather than calling six
 * arbitrary places top picks.
 */
export function picksForHome<M extends Pick<AttractionMarker, 'tier' | 'rankScore' | 'region' | 'latitude' | 'longitude'>>(
  markers: readonly M[],
  origin: Coordinate | null,
  limit: number = HOME_PICKS_LIMIT,
): M[] {
  const tops = rankedForMap(markers.filter((marker) => marker.tier === 'top'));
  if (limit <= 0 || tops.length === 0) return [];

  if (origin) {
    return tops
      .map((marker, index) => ({ marker, index, metres: distanceMeters(origin, marker) }))
      .sort((l, r) => (l.metres !== r.metres ? l.metres - r.metres : l.index - r.index))
      .slice(0, limit)
      .map((entry) => entry.marker);
  }

  // Regions in the order of their best pick, each region's picks best first
  // (`tops` is already in score order, so the first sight wins both).
  const regions: string[] = [];
  const byRegion = new Map<string, M[]>();
  for (const marker of tops) {
    const list = byRegion.get(marker.region);
    if (list) list.push(marker);
    else {
      regions.push(marker.region);
      byRegion.set(marker.region, [marker]);
    }
  }

  const picks: M[] = [];
  for (let round = 0; picks.length < limit; round += 1) {
    let took = false;
    for (const region of regions) {
      const list = byRegion.get(region)!;
      if (round >= list.length) continue;
      picks.push(list[round]);
      took = true;
      if (picks.length === limit) break;
    }
    if (!took) break;
  }
  return picks;
}

// MARK: - Search

/** One letter matches half the country and tells nobody anything. */
export const MINIMUM_SIGHT_QUERY_LENGTH = 2;

/**
 * Sights whose Icelandic or English name contains the query, best first (iOS
 * `AttractionSearch.matches`): a name that starts with what was typed, then
 * the tier, then the score, then feed order. Someone typing "sko" wants
 * Skógafoss before a lake that merely contains those letters.
 */
export function matchSights<M extends Pick<AttractionMarker, 'searchKeys' | 'tier' | 'rankScore'>>(
  query: string,
  markers: readonly M[],
  limit: number,
): M[] {
  const folded = foldSightName(query);
  if (Array.from(folded).length < MINIMUM_SIGHT_QUERY_LENGTH || limit <= 0) return [];
  const hits: { marker: M; prefix: boolean; index: number }[] = [];
  markers.forEach((marker, index) => {
    const keys = marker.searchKeys;
    if (!keys.some((key) => key.includes(folded))) return;
    hits.push({ marker, prefix: keys.some((key) => key.startsWith(folded)), index });
  });
  hits.sort((l, r) => {
    if (l.prefix !== r.prefix) return l.prefix ? -1 : 1;
    return compareRank(l, r);
  });
  return hits.slice(0, limit).map((hit) => hit.marker);
}

// MARK: - Labels

/** A key lookup that answers the key itself when it has no value (`t`). */
export type Lookup = (key: string) => string;

/**
 * A kind's name from the app's dictionary, copied word for word from the
 * server's KIND_LABELS so Home's list and the card agree. An unknown kind from
 * a newer server reads as a plain "Sight" rather than leaking a key.
 */
export function kindLabel(kind: string, lookup: Lookup): string {
  const key = `attraction.kind.${kind}`;
  const value = lookup(key);
  return value === key ? lookup('attraction.kind.other') : value;
}

/** A region's name, or null for one this build does not know: better no region than a key. */
export function regionLabel(region: string, lookup: Lookup): string | null {
  const key = `attraction.region.${region}`;
  const value = lookup(key);
  return value === key ? null : value;
}

/** "Waterfall · South Iceland", or the kind alone when the region is unknown. */
export function kindRegionLine(sight: { readonly kind: string; readonly region: string }, lookup: Lookup): string {
  const kind = kindLabel(sight.kind, lookup);
  const region = regionLabel(sight.region, lookup);
  return region === null ? kind : `${kind} · ${region}`;
}
