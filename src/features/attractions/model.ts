/**
 * What a sight's card may say, decided from its data: the computed members of
 * iOS `AttractionDetail`, `AttractionNearby`, `AttractionImage`,
 * `AttractionSourceRef` and `AttractionTrailLink` (Models/Attraction.swift),
 * plus the card's route region and Directions link (AttractionDetailView).
 *
 * Pure: the screen (./AttractionDetailScreen.tsx) only draws what these say,
 * so the money and access rules can be tested without rendering.
 *
 * The rules that matter most:
 *   - A drive time shows ONLY for road access. A road time to a place no road
 *     reaches is the one figure that could strand somebody at a harbour, so a
 *     ferry, offshore or unknown sight never prints one, whatever the payload
 *     carries.
 *   - Soak pairings are drives on the sight's own island: every pairing for
 *     road access, every pairing for a ferry sight whose port is Landeyjahöfn
 *     (the server pairs Heimaey sights with Heimaey venues only), and none for
 *     offshore, other ferry islands (Grímsey, Hrísey) or an unknown value.
 *   - "Included" only when `inBundle` is true (./format.ts); the price is the
 *     server's, never worked out here.
 */
import {
  LANDEYJAHOFN,
  httpsLink,
  resolveAttractionAsset,
  trailBoundsOf,
  type AttractionDetail,
  type AttractionImage,
  type AttractionNearby,
  type AttractionPairing,
  type AttractionSourceRef,
  type TrailBounds,
} from '../../api/attractions';
import type { Lang } from '../../i18n';
import { printfFixed, roundHalfAwayFromZero } from '../../i18n/format';
import type { Coordinate } from '../../lib/geo';

export { LANDEYJAHOFN } from '../../api/attractions';

/** Closer than this, the walk from the road is the car park's business (the web's NEAREST_ROAD_NOTE_M). */
export const NEAREST_ROAD_NOTE_M = 1000;

type Access = Pick<AttractionDetail, 'roadAccess' | 'ferryPort'>;

/** The drive the card may print: road access only. */
export function roadDriveFromReykjavik(detail: Pick<AttractionDetail, 'roadAccess' | 'driveFromReykjavik'>) {
  return detail.roadAccess === 'road' ? detail.driveFromReykjavik : null;
}

/** Metres to the nearest road when the card should say so: road access and more than a kilometre. */
export function nearestRoadNoteMetres(detail: Pick<AttractionDetail, 'roadAccess' | 'nearestRoadM'>): number | null {
  if (detail.roadAccess !== 'road' || detail.nearestRoadM === null) return null;
  return detail.nearestRoadM > NEAREST_ROAD_NOTE_M ? detail.nearestRoadM : null;
}

/**
 * The key of the sentence that takes the drive line's place for a place the
 * road does not reach; null for road access and for a value this build does
 * not know. The sentences are the web's ROAD_ACCESS_COPY word for word.
 */
export function accessSentenceKey(detail: Access): string | null {
  switch (detail.roadAccess) {
    case 'ferry':
      return detail.ferryPort === LANDEYJAHOFN ? 'attraction.ferry_from_landeyjahofn' : 'attraction.ferry_no_port';
    case 'offshore':
      return 'attraction.offshore';
    default:
      return null;
  }
}

/** The soak venues the card may list (see the file comment). */
export function soakPairings(detail: Access & Pick<AttractionDetail, 'pairings'>): readonly AttractionPairing[] {
  switch (detail.roadAccess) {
    case 'road':
      return detail.pairings;
    case 'ferry':
      return detail.ferryPort === LANDEYJAHOFN ? detail.pairings : [];
    default:
      return [];
  }
}

export function isAfterPairing(pairing: Pick<AttractionPairing, 'tier'>): boolean {
  return pairing.tier === 'after';
}

/** "After this": the `after` tier, in the server's order. */
export function afterPairings(detail: Access & Pick<AttractionDetail, 'pairings'>): AttractionPairing[] {
  return soakPairings(detail).filter(isAfterPairing);
}

/** "On the way back": everything else, in the server's order. */
export function returnPairings(detail: Access & Pick<AttractionDetail, 'pairings'>): AttractionPairing[] {
  return soakPairings(detail).filter((pairing) => !isAfterPairing(pairing));
}

/**
 * "{km}" in the nearest-road sentence, by the web's formatDistance rule
 * (src/server/attractions/labels.ts): tenths under 10 km, whole kilometres
 * from 10, half up, no trailing ".0", a decimal comma in Icelandic. Worked out
 * in the web's order so a halfway value rounds the same way on both.
 */
export function roadKilometres(metres: number, language: Lang): string {
  const km = metres / 1000;
  const value = km >= 10 ? roundHalfAwayFromZero(km) : roundHalfAwayFromZero(km * 10) / 10;
  if (Number.isInteger(value)) return String(value);
  const text = printfFixed(value, 1);
  return language === 'is' ? text.replace('.', ',') : text;
}

/** Bathing safety reads as a warning whenever it is not `safe` (`unverified` included). */
export function isBathingWarning(bathing: { readonly level: string }): boolean {
  return bathing.level !== 'safe';
}

/** The sight's name by language: the Icelandic one for `is`, else the English one when there is one. */
export function sightDisplayName(item: { readonly name: string; readonly nameEn: string | null }, language: Lang): string {
  return language === 'is' ? item.name : (item.nameEn ?? item.name);
}

/** Hikes are drawn from their trailhead ring. */
export function isHike(item: { readonly kind: string }): boolean {
  return item.kind === 'hike';
}

// MARK: - Images

/** The plate route's canvas, 1200 x 630 (api/v1/attractions/plate/[slug]). */
export const PLATE_ASPECT_RATIO = 1200 / 630;
/** The plate's paper, MAP_PAPER (#F7F5F0) in the web's map-colors.ts. */
export const PLATE_PAPER = '#F7F5F0';

/** A plate is a map, never "Photo". */
export function isPlate(image: Pick<AttractionImage, 'isMapPlate'>): boolean {
  return image.isMapPlate === true;
}

/** The image's URL, resolved (./api `resolveAttractionAsset`). */
export function imageUrl(image: Pick<AttractionImage, 'src'>): string | null {
  return resolveAttractionAsset(image.src);
}

/** The licence link the credit line may open: https only. */
export function imageLicenseLink(image: Pick<AttractionImage, 'licenseUrl'>): string | null {
  return httpsLink(image.licenseUrl);
}

/** The hero's accessibility label: the Icelandic alt text in Icelandic when there is one. */
export function imageAlt(image: Pick<AttractionImage, 'altEn' | 'altIs'>, language: Lang): string {
  return language === 'is' ? (image.altIs ?? image.altEn) : image.altEn;
}

/**
 * A generated location plate, from a URL alone (the Coach's plan sights
 * carry `imageUrl`, not the card's `isMapPlate`): the plate lives under
 * `/attractions/plate/`.
 */
export function isPlateImageUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.includes('/attractions/plate/');
}

/**
 * What a Coach plan sight may draw (iOS `CoachPlanSight.drawableImageURL`):
 * the location plate, or a photograph that arrived with its photographer.
 * A photo without its credit is not shown at all: null, and the row draws
 * the ring. `imageCredit` is read as the Coach reads it (trimmed, blank is
 * none).
 */
export function drawableSightImageUrl(imageUrl: string | null | undefined, imageCredit: string | null | undefined): string | null {
  const credited = typeof imageCredit === 'string' && imageCredit.trim() !== '';
  if (!isPlateImageUrl(imageUrl) && !credited) return null;
  return resolveAttractionAsset(imageUrl);
}

// MARK: - Nearby

/**
 * `distanceM` in whole metres, or null when the figure is not a distance:
 * negative, non-finite, or past what an Int holds. The neighbour still shows,
 * just without a number that would be wrong anyway.
 */
export function wholeDistanceM(item: Pick<AttractionNearby, 'distanceM'>): number | null {
  const metres = item.distanceM;
  if (!Number.isFinite(metres) || metres < 0) return null;
  const rounded = roundHalfAwayFromZero(metres);
  return rounded < 2 ** 63 ? rounded : null;
}

/**
 * The thumbnail a nearby row may draw: a photograph that arrived with BOTH
 * its credit and its licence. A Commons photo shown without them breaks the
 * terms it was published under however small it is drawn, so anything else
 * gets the ring.
 */
export function creditedThumbUrl(item: Pick<AttractionNearby, 'thumb' | 'thumbCredit' | 'thumbLicense'>): string | null {
  if (item.thumbCredit === null || item.thumbLicense === null) return null;
  return resolveAttractionAsset(item.thumb);
}

// MARK: - Sources

/** The display name of a source; other sources by their raw name. */
export function sourceDisplayName(source: Pick<AttractionSourceRef, 'source'>): string {
  switch (source.source) {
    case 'osm':
      return 'OpenStreetMap';
    case 'wikidata':
      return 'Wikidata';
    case 'commons':
      return 'Wikimedia Commons';
    case 'wikipedia':
      return 'Wikipedia';
    default:
      return source.source;
  }
}

/** A source's link, under the same https-only rule as a licence link. */
export function sourceLink(source: Pick<AttractionSourceRef, 'sourceUrl'>): string | null {
  return httpsLink(source.sourceUrl);
}

// MARK: - Maps

/** A map region: a centre and how many degrees it spans. */
export interface MapRegion {
  readonly center: Coordinate;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

/** The no-image preview: the spot, 0.3° of latitude by 0.6° of longitude. */
export function locationPreviewRegion(detail: Pick<AttractionDetail, 'latitude' | 'longitude'>): MapRegion {
  return { center: { latitude: detail.latitude, longitude: detail.longitude }, latitudeDelta: 0.3, longitudeDelta: 0.6 };
}

/** The route's box, or null when the sight has no drawable route (then there is no route section). */
export function routeBounds(detail: Pick<AttractionDetail, 'routeLines'>): TrailBounds | null {
  return trailBoundsOf(detail.routeLines);
}

/**
 * The route map's region: the route's box padded ×1.4 so the line never
 * touches the edge, with a floor (0.01° by 0.02°) so a short loop does not
 * zoom in to the width of a car park.
 */
export function routeRegion(bounds: TrailBounds): MapRegion {
  return {
    center: { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 },
    latitudeDelta: Math.max((bounds.north - bounds.south) * 1.4, 0.01),
    longitudeDelta: Math.max((bounds.east - bounds.west) * 1.4, 0.02),
  };
}

/** A region as the corners Mapbox fits (`[longitude, latitude]`). */
export function regionCorners(region: MapRegion): { readonly ne: [number, number]; readonly sw: [number, number] } {
  const { center, latitudeDelta, longitudeDelta } = region;
  return {
    ne: [center.longitude + longitudeDelta / 2, center.latitude + latitudeDelta / 2],
    sw: [center.longitude - longitudeDelta / 2, center.latitude - latitudeDelta / 2],
  };
}

/**
 * "Open in Google Maps": the server's link when it is https, so the phone
 * and the website route to the identical point; otherwise the universal URL
 * built from coordinates, six decimals with a point whatever the language,
 * and never the name, which a geocoder can put on the wrong Kirkjufell.
 */
export function googleMapsUrl(detail: Pick<AttractionDetail, 'mapsLinks' | 'latitude' | 'longitude'>): string {
  const server = httpsLink(detail.mapsLinks?.google);
  if (server) return server;
  const destination = `${printfFixed(detail.latitude, 6)},${printfFixed(detail.longitude, 6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/**
 * "Open in another app" (Android's stand-in for Apple Maps): a `geo:` pin at
 * the coordinates, labelled with the card's name, which Android hands to the
 * member's maps app. Parentheses in the name are escaped, since maps apps end
 * the label at the first ")".
 */
export function geoUrl(detail: Pick<AttractionDetail, 'name' | 'latitude' | 'longitude'>): string {
  const at = `${printfFixed(detail.latitude, 6)},${printfFixed(detail.longitude, 6)}`;
  const label = encodeURIComponent(detail.name).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `geo:${at}?q=${at}(${label})`;
}
