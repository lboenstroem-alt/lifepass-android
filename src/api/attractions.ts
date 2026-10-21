/**
 * Iceland's public sights: the Android port of iOS `AttractionService`
 * (Services/AttractionService.swift) and the decoders of Models/Attraction.swift
 * and Models/AttractionTrail.swift.
 *
 *   GET /attractions?locale=en|is               every published sight, as a marker
 *   GET /attractions/trails                     every published walk, as a line
 *   GET /attractions/by-slug/{slug}?locale=     one sight's card
 *
 * Every call is auth OPTIONAL: the bearer goes along when a session exists and
 * is never required. A visitor deciding whether LifePass is worth buying has
 * no account yet, and requiring one would hide the section from exactly the
 * audience it exists to reach. The locale (the account language) goes with
 * the feed and the card because localisation happens on the SERVER: kind and
 * difficulty labels, the bathing sentence and the access rule arrive ready to
 * render, so the phone and the website cannot disagree on a safety string.
 *
 * THESE ARE NOT VENUES. Nothing here is bookable, checkable-in or covered by a
 * pass, and the two models stay apart on purpose: one "place" type would make
 * it far too easy to draw a sight with a check-in button.
 *
 * DECODING, as iOS decodes (a field iOS reads strictly is strict here, a field
 * iOS reads lossily is lossy here):
 *   - Marker feed: all or nothing, as iOS's `[AttractionMarker]`. Within a
 *     marker the ranking fields are lossy (a missing or unknown tier reads as
 *     `notable`, a non-finite score as none) and `nameEn` is trimmed, blank
 *     reading as none. Search keys are folded once, here.
 *   - Trails: lossy per trail. A broken trail is dropped and the rest kept;
 *     positions out of range are dropped, runs under two points are dropped,
 *     each run is simplified (Douglas-Peucker) and the trail boxed once.
 *   - Card: the fields of the endpoint's first release are strict (a wrong
 *     type is a decoding error, shown as such). Everything that came later is
 *     lossy, so a malformed neighbour, link or route never costs the member
 *     the card for the place they tapped: `nearby`, `mapsLinks`, `hasPage`,
 *     `routeGeojson`, `tier`, `rankScore`, `driveFromReykjavik`, `ferryOnly`,
 *     `roadAccess`, `ferryPort`, `nearestRoadM`, `outAndBack`,
 *     `forAttraction` and `relatedTrails` (one bad link costs that link only).
 *
 * Errors are the client's: a 503 problem with Retry-After when the sights
 * cannot be read (never an empty 200), 404 for an unknown slug, 429 past the
 * rate limit (by-slug 60 a minute per IP; the feeds share 300).
 */
import { env } from '../config/env';
import type { Lang } from '../i18n';
import type { Coordinate } from '../lib/geo';
import { normaliseImageUrl } from '../components/ui/imageUrl';
import { apiGet, type RequestOptions } from './client';

// MARK: - Types

/**
 * How much a sight stands out in its region, decided on the SERVER and never
 * recomputed here. The app only decides what a tier looks like and at which
 * zoom it appears (../features/attractions/rules.ts).
 */
export type AttractionTier = 'top' | 'notable' | 'standard';

/**
 * How a sight is reached from central Reykjavík, measured by the server:
 * `road` (a car gets there without a ferry), `ferry`, or `offshore` (neither
 * a road nor a ferry reaches it).
 */
export type AttractionRoadAccess = 'road' | 'ferry' | 'offshore';

/** A sight on the map, Home and search. */
export interface AttractionMarker {
  readonly slug: string;
  /** Icelandic, canonical: what the road signs say. */
  readonly name: string;
  /** Only where a genuinely different English exonym exists. */
  readonly nameEn: string | null;
  readonly kind: string;
  readonly region: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Informational: every published sight has a card. */
  readonly hasPage: boolean;
  readonly tier: AttractionTier;
  /** 0 to 100, for ordering within a region; null from an older server (ordered as 0). */
  readonly rankScore: number | null;
  /** Both names folded for search, once, at decode (`foldSightName`). */
  readonly searchKeys: readonly string[];
}

export interface AttractionMarkerPage {
  readonly attractions: readonly AttractionMarker[];
  /** The ODbL notice, which has to travel with the data. */
  readonly attribution: string | null;
}

/** A trail's bounding box, computed once so culling is four comparisons. */
export interface TrailBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** A walk as the line you actually walk (`GET /attractions/trails`). */
export interface AttractionTrail {
  readonly slug: string;
  readonly name: string;
  readonly lengthM: number | null;
  readonly durationMinutes: number | null;
  /** Passed through as sent; the card reads its words from the by-slug endpoint. */
  readonly difficulty: string | null;
  /** One run per GeoJSON line, each at least two points; never empty. */
  readonly lines: readonly (readonly Coordinate[])[];
  readonly bounds: TrailBounds;
}

export interface AttractionTrailPage {
  readonly trails: readonly AttractionTrail[];
  readonly attribution: string | null;
}

/** A picture on the card: a photograph, or the server's generated location plate. */
export interface AttractionImage {
  readonly src: string;
  readonly altEn: string;
  readonly altIs: string | null;
  /** Never optional: Commons requires author and licence per file. */
  readonly credit: string;
  readonly license: string;
  readonly licenseUrl: string | null;
  /** True for the location plate (a map, never "Photo"). */
  readonly isMapPlate: boolean | null;
}

export interface AttractionSourceRef {
  readonly source: string;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly license: string;
}

/** Another published sight near this one. `distanceM` is a STRAIGHT LINE, never a road. */
export interface AttractionNearby {
  readonly slug: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly kind: string;
  readonly distanceM: number;
  readonly thumb: string | null;
  /** Both sent for a photograph, neither for a plate; blank reads as none. */
  readonly thumbCredit: string | null;
  readonly thumbLicense: string | null;
}

/** Directions built by the server from coordinates (never a name). */
export interface AttractionMapsLinks {
  readonly google: string | null;
  readonly apple: string | null;
}

/** A walk linked to a sight, or the sight a walk leads to. Only slug and name are required. */
export interface AttractionTrailLink {
  readonly slug: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly lengthM: number | null;
  readonly durationMinutes: number | null;
  /** `lengthM` is one way and `durationMinutes` covers the return. False when the link does not say. */
  readonly outAndBack: boolean;
}

/** A measured ROAD trip from central Reykjavík, never a straight line. */
export interface AttractionDrive {
  /** Whole minutes, at least 1. */
  readonly minutes: number;
  readonly km: number;
}

/** "After this, warm up here." */
export interface AttractionPairing {
  readonly venueSlug: string;
  readonly venueName: string;
  readonly city: string;
  readonly driveMinutes: number;
  readonly driveMetres: number;
  /** "after" (up to 60 min) or "on_the_way_back" (60 to 120 min on a return corridor). */
  readonly tier: string;
  readonly corridor: string | null;
  /** True only when a pass covers it outright; premium venues are per visit. */
  readonly inBundle: boolean;
  readonly fromPriceIsk: number | null;
}

/** Bathing safety: `safe`, `unsafe` or `unverified` (a real answer, not a missing one). */
export interface AttractionBathing {
  readonly level: string;
  readonly text: string;
}

/** One sight's card (`GET /attractions/by-slug/{slug}`). */
export interface AttractionDetail {
  readonly slug: string;
  /** Already localised by the API. */
  readonly name: string;
  /** The Icelandic name, always. */
  readonly localName: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly region: string;
  readonly regionLabel: string;
  readonly nearestTown: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly summary: string | null;
  readonly body: string | null;
  readonly heightM: number | null;
  readonly elevationM: number | null;
  readonly lengthM: number | null;
  readonly ascentM: number | null;
  readonly durationMinutes: number | null;
  readonly difficulty: string | null;
  readonly difficultyLabel: string | null;
  readonly accessNotes: string | null;
  readonly parkingFeeIsk: number | null;
  readonly seasonalAccess: string | null;
  readonly requiresFourWheelDrive: boolean;
  readonly bathing: AttractionBathing | null;
  readonly images: readonly AttractionImage[];
  readonly sources: readonly AttractionSourceRef[];
  readonly pairings: readonly AttractionPairing[];
  /** Closest first. */
  readonly nearby: readonly AttractionNearby[];
  readonly mapsLinks: AttractionMapsLinks | null;
  readonly hasPage: boolean;
  /** The walk itself for hikes; empty otherwise. */
  readonly routeLines: readonly (readonly Coordinate[])[];
  readonly tier: AttractionTier;
  readonly rankScore: number | null;
  /** Read through `roadDriveFromReykjavik` (../features/attractions/model.ts), never directly. */
  readonly driveFromReykjavik: AttractionDrive | null;
  /** Null only for a value this build does not know: then no travel line, no drive and no soak. */
  readonly roadAccess: AttractionRoadAccess | null;
  /** Metres to the nearest road (whole, at least 0). */
  readonly nearestRoadM: number | null;
  readonly ferryOnly: boolean;
  readonly ferryPort: string | null;
  readonly forAttraction: AttractionTrailLink | null;
  readonly relatedTrails: readonly AttractionTrailLink[];
  readonly outAndBack: boolean;
  /** Public-access duties (Náttúruverndarlög art. 17 and 31); '' when not sent. */
  readonly accessRule: string;
  readonly attribution: string | null;
}

// MARK: - Calls

type CallOptions = Pick<RequestOptions, 'signal' | 'timeoutMs'>;

/** Filters `GET /attractions` takes. The app never sends them; kept for parity with iOS. */
export interface AttractionMarkerFilters {
  readonly kind?: string | null;
  readonly region?: string | null;
  /** `south,west,north,east`. */
  readonly bbox?: string | null;
}

/**
 * `GET /attractions?locale=`: every published sight as a marker. One request
 * for the whole country (a few thousand lean rows), not a cursor walk.
 */
export function fetchAttractionMarkers(
  locale: Lang,
  filters: AttractionMarkerFilters = {},
  options: CallOptions = {},
): Promise<AttractionMarkerPage> {
  return apiGet<AttractionMarkerPage>(
    '/attractions',
    { locale, kind: filters.kind || undefined, region: filters.region || undefined, bbox: filters.bbox || undefined },
    { ...options, auth: 'optional', decode: decodeMarkerPage },
  );
}

/** `GET /attractions/trails`: every walk as a drawable line. No locale: nothing in it is prose. */
export function fetchAttractionTrails(options: CallOptions = {}): Promise<AttractionTrailPage> {
  return apiGet<AttractionTrailPage>('/attractions/trails', undefined, {
    ...options,
    auth: 'optional',
    decode: decodeTrailPage,
  });
}

/** `GET /attractions/by-slug/{slug}?locale=`: one sight's card. */
export function fetchAttractionDetail(slug: string, locale: Lang, options: CallOptions = {}): Promise<AttractionDetail> {
  return apiGet<AttractionDetail>(
    `/attractions/by-slug/${encodeURIComponent(slug)}`,
    { locale },
    { ...options, auth: 'optional', decode: decodeAttractionDetail },
  );
}

// MARK: - Search folding

/** Letters and digits in any script (Swift `CharacterSet.alphanumerics`). */
const NOT_ALPHANUMERIC = /[^\p{L}\p{M}\p{N}]/gu;
/** Combining marks left by NFD: what a diacritic fold removes. */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * A place name reduced to what a person can type on any keyboard (iOS
 * `AttractionSearch.fold`): lower-cased; þ, ð and æ spelled out the way
 * Icelanders write them without an Icelandic keyboard (they are letters in
 * their own right, not accented variants, so no diacritic fold touches them);
 * then accents dropped; then everything that is not a letter or digit, so
 * "seljalands foss" and "Seljalandsfoss" meet.
 *
 * Here rather than in the rules because the decoder folds each name once.
 */
export function foldSightName(text: string): string {
  const spelled = text.toLowerCase().replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae');
  return spelled.normalize('NFD').replace(COMBINING_MARKS, '').replace(NOT_ALPHANUMERIC, '');
}

function searchKeysOf(name: string, nameEn: string | null): string[] {
  const keys: string[] = [];
  for (const raw of [name, nameEn]) {
    if (raw === null) continue;
    const key = foldSightName(raw);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// MARK: - Links and assets

/**
 * A link from feed data the card may open: https with a host, or nothing
 * (iOS `AttractionLink.https`). Licence URLs come from Commons file metadata,
 * which anyone can edit, and `Linking.openURL` opens any scheme the phone
 * knows, so a `tel:`, `sms:` or `javascript:` in upstream data must never
 * become a button. Characters a URL cannot carry raw (a Commons file name
 * with Icelandic letters) are percent-encoded.
 */
export function httpsLink(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  const encoded = normaliseImageUrl(trimmed);
  if (!encoded) return null;
  const authority = /^https:\/\/([^/?#]*)/i.exec(encoded)?.[1] ?? '';
  // The host is what is left once the user info and the port are taken off.
  const host = authority.replace(/^.*@/, '').replace(/:\d*$/, '');
  return host ? encoded : null;
}

/** Where a relative asset path resolves: the API's own origin (scheme, host and port). */
export const PRODUCTION_ASSET_ORIGIN = 'https://www.lifepass.is';

/** `https://host[:port]` of the API base, or production when it cannot be read. */
export function apiOrigin(base: string = env.apiBaseUrl): string {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(base.trim());
  return match ? match[1] : PRODUCTION_ASSET_ORIGIN;
}

/**
 * Where an image URL from the API points (iOS `AttractionAssetURL.resolve`):
 *   - `//host/x` is https;
 *   - `/path` (the generated plate, `/api/v1/attractions/plate/<slug>`)
 *     belongs to the server that sent it, so it resolves against the API's
 *     origin (production in every shipped build, a local server when a
 *     developer points the app at one);
 *   - otherwise only http and https load. Anything else in an image field is
 *     a data error, not something to hand an image loader.
 * Non-ASCII characters (Commons file names such as Æðahellir) are
 * percent-encoded.
 */
export function resolveAttractionAsset(raw: string | null | undefined, base: string = env.apiBaseUrl): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return normaliseImageUrl(`https:${trimmed}`);
  if (trimmed.startsWith('/')) return normaliseImageUrl(`${apiOrigin(base)}${trimmed}`);
  return normaliseImageUrl(trimmed);
}

// MARK: - Decoding helpers

/** Why a value did not decode; the client turns it into a `DecodingError`. */
export class AttractionDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'AttractionDecodeError';
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new AttractionDecodeError(path, 'an object');
  return value;
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function requiredString(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new AttractionDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new AttractionDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalBool(json: Json, key: string, path: string): boolean | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'boolean') throw new AttractionDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function requiredNumber(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || Number.isNaN(value)) throw new AttractionDecodeError(`${path}.${key}`, 'a number');
  return value;
}

/** Swift `decodeIfPresent(Int.self)`: a whole number, or a decoding error. */
function optionalInt(json: Json, key: string, path: string): number | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new AttractionDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

function requiredInt(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new AttractionDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

/** Swift `try?`: the value, or null when reading it failed. */
function lossy<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** A string trimmed, blank reading as none; anything but a string is none (lossy). */
function nonBlank(json: Json, key: string): string | null {
  const value = json[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Past this, Swift's `Int(exactly:)` fails rather than hold the number. */
const INT_LIMIT = 2 ** 63;

/** Swift `Int(exactly: x.rounded())`: half away from zero, null past Int's range. */
function wholeOrNull(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  if (Math.abs(rounded) >= INT_LIMIT) return null;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Lengths and times summed from geometry may arrive fractional: a metre
 * either way is not worth losing the link over. A broken figure (wrong type,
 * past Int's range) costs the figure only.
 */
function looseInt(json: Json, key: string): number | null {
  const value = present(json, key);
  if (typeof value !== 'number') return null;
  if (Number.isInteger(value)) return Math.abs(value) < INT_LIMIT ? value : null;
  return wholeOrNull(value);
}

function coordinatesOf(json: Json, path: string): { latitude: number; longitude: number } {
  const coords = object(json.coordinates, `${path}.coordinates`);
  return {
    latitude: requiredNumber(coords, 'latitude', `${path}.coordinates`),
    longitude: requiredNumber(coords, 'longitude', `${path}.coordinates`),
  };
}

/** A missing or unrecognised tier reads as `notable` (iOS `AttractionTier(wire:)`). */
export function tierOf(wire: unknown): AttractionTier {
  return wire === 'top' || wire === 'notable' || wire === 'standard' ? wire : 'notable';
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// MARK: - Markers

export function decodeAttractionMarker(value: unknown, path = 'attraction'): AttractionMarker {
  const json = object(value, path);
  const slug = requiredString(json, 'slug', path);
  const name = requiredString(json, 'name', path);
  const kind = requiredString(json, 'kind', path);
  const region = requiredString(json, 'region', path);
  const hasPage = optionalBool(json, 'hasPage', path) ?? false;
  // The wire nests coordinates as VenueSummary does; the model flattens them.
  const { latitude, longitude } = coordinatesOf(json, path);
  // The ranking fields came after this feed's first release: each is lossy,
  // so a malformed score costs a sight its place in the order, never its pin.
  const nameEn = nonBlank(json, 'nameEn');
  return {
    slug,
    name,
    nameEn,
    kind,
    region,
    latitude,
    longitude,
    hasPage,
    tier: tierOf(json.tier),
    rankScore: finiteOrNull(json.rankScore),
    searchKeys: searchKeysOf(name, nameEn),
  };
}

/** The marker feed, all or nothing (iOS `AttractionMarkerPage`). */
export function decodeMarkerPage(value: unknown): AttractionMarkerPage {
  const json = object(value, 'data');
  const list = json.attractions;
  if (!Array.isArray(list)) throw new AttractionDecodeError('data.attractions', 'a list');
  return {
    attractions: list.map((item, index) => decodeAttractionMarker(item, `data.attractions[${index}]`)),
    attribution: optionalString(json, 'attribution', 'data'),
  };
}

// MARK: - Geometry

/**
 * About 4 m of latitude: well under a screen point at any zoom a trail is
 * read at, and it removes most vertices of a densely mapped path.
 */
export const SIMPLIFY_TOLERANCE = 0.00004;

/**
 * Douglas-Peucker, iterative so a long route cannot overflow the stack (iOS
 * `TrailGeometry.simplify`). Distances are measured on a local
 * equirectangular projection: at 65°N a degree of longitude is about 42 % of
 * a degree of latitude, so raw degrees would keep every east-west wiggle.
 */
export function simplifyLine(points: readonly Coordinate[], tolerance: number = SIMPLIFY_TOLERANCE): Coordinate[] {
  if (points.length <= 2) return [...points];
  const k = Math.cos((points[0].latitude * Math.PI) / 180);
  const tolerance2 = tolerance * tolerance;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const ax = points[first].longitude * k;
    const ay = points[first].latitude;
    const dx = points[last].longitude * k - ax;
    const dy = points[last].latitude - ay;
    const length2 = dx * dx + dy * dy;

    let farthest = first;
    let farthest2 = -1;
    for (let i = first + 1; i < last; i += 1) {
      const px = points[i].longitude * k - ax;
      const py = points[i].latitude - ay;
      // Projected onto the segment, clamped, so a closed loop (first point
      // equal to the last) measures the distance to that point.
      const t = length2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > farthest2) {
        farthest2 = d2;
        farthest = i;
      }
    }
    if (farthest2 > tolerance2) {
      keep[farthest] = true;
      stack.push([first, farthest]);
      stack.push([farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function positionsOf(value: unknown, path: string): number[][] {
  if (!Array.isArray(value)) throw new AttractionDecodeError(path, 'a list of positions');
  return value.map((position, index) => {
    if (!Array.isArray(position) || !position.every((n) => typeof n === 'number')) {
      throw new AttractionDecodeError(`${path}[${index}]`, 'a position');
    }
    return position as number[];
  });
}

/**
 * GeoJSON `LineString` / `MultiLineString` as coordinate runs (iOS
 * `TrailGeometry`), shared by the trails feed and the card's route. Any
 * other type is no lines (the caller decides whether that is an error).
 * Positions are [longitude, latitude], the reverse of a coordinate: the
 * classic way to draw Iceland off the coast of Somalia.
 */
export function decodeTrailGeometry(value: unknown, path = 'geometry'): Coordinate[][] {
  const json = object(value, path);
  const type = requiredString(json, 'type', path);
  let raw: number[][][];
  if (type === 'LineString') {
    raw = [positionsOf(json.coordinates, `${path}.coordinates`)];
  } else if (type === 'MultiLineString') {
    const lines = json.coordinates;
    if (!Array.isArray(lines)) throw new AttractionDecodeError(`${path}.coordinates`, 'a list of lines');
    raw = lines.map((line, index) => positionsOf(line, `${path}.coordinates[${index}]`));
  } else {
    raw = [];
  }
  const runs: Coordinate[][] = [];
  for (const positions of raw) {
    const coordinates: Coordinate[] = [];
    for (const p of positions) {
      if (p.length < 2) continue;
      const [longitude, latitude] = p;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) continue;
      coordinates.push({ latitude, longitude });
    }
    const simplified = simplifyLine(coordinates);
    if (simplified.length >= 2) runs.push(simplified);
  }
  return runs;
}

/** The box around every point, or null when there is nothing to box (iOS `TrailBounds.init?`). */
export function trailBoundsOf(lines: readonly (readonly Coordinate[])[]): TrailBounds | null {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const run of lines) {
    for (const point of run) {
      south = Math.min(south, point.latitude);
      north = Math.max(north, point.latitude);
      west = Math.min(west, point.longitude);
      east = Math.max(east, point.longitude);
    }
  }
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return { south, west, north, east };
}

// MARK: - Trails

export function decodeAttractionTrail(value: unknown, path = 'trail'): AttractionTrail {
  const json = object(value, path);
  const slug = requiredString(json, 'slug', path);
  const name = optionalString(json, 'name', path) ?? slug;
  const lengthM = looseInt(json, 'lengthM');
  const durationMinutes = looseInt(json, 'durationMinutes');
  const difficulty = typeof json.difficulty === 'string' ? json.difficulty : null;
  if (json.geometry === undefined || json.geometry === null) throw new AttractionDecodeError(`${path}.geometry`, 'a geometry');
  const lines = decodeTrailGeometry(json.geometry, `${path}.geometry`);
  const bounds = trailBoundsOf(lines);
  // A trail with nothing drawable is dropped rather than a name with no line.
  if (!bounds) throw new AttractionDecodeError(`${path}.geometry`, 'a drawable line');
  return { slug, name, lengthM, durationMinutes, difficulty, lines, bounds };
}

/**
 * The trails feed, lossy per trail on purpose: OpenStreetMap is edited by
 * anyone, and one broken route must not cost every other trail in the country.
 */
export function decodeTrailPage(value: unknown): AttractionTrailPage {
  const json = object(value, 'data');
  const list = Array.isArray(json.trails) ? json.trails : [];
  const trails: AttractionTrail[] = [];
  list.forEach((item, index) => {
    const trail = lossy(() => decodeAttractionTrail(item, `data.trails[${index}]`));
    if (trail) trails.push(trail);
  });
  return { trails, attribution: typeof json.attribution === 'string' ? json.attribution : null };
}

// MARK: - The card's parts

function decodeImage(value: unknown, path: string): AttractionImage {
  const json = object(value, path);
  return {
    src: requiredString(json, 'src', path),
    altEn: requiredString(json, 'altEn', path),
    altIs: optionalString(json, 'altIs', path),
    credit: requiredString(json, 'credit', path),
    license: requiredString(json, 'license', path),
    licenseUrl: optionalString(json, 'licenseUrl', path),
    isMapPlate: optionalBool(json, 'isMapPlate', path),
  };
}

function decodeSource(value: unknown, path: string): AttractionSourceRef {
  const json = object(value, path);
  return {
    source: requiredString(json, 'source', path),
    sourceId: requiredString(json, 'sourceId', path),
    sourceUrl: optionalString(json, 'sourceUrl', path),
    license: requiredString(json, 'license', path),
  };
}

function decodePairing(value: unknown, path: string): AttractionPairing {
  const json = object(value, path);
  return {
    venueSlug: requiredString(json, 'venueSlug', path),
    venueName: requiredString(json, 'venueName', path),
    city: requiredString(json, 'city', path),
    driveMinutes: requiredInt(json, 'driveMinutes', path),
    driveMetres: requiredInt(json, 'driveMetres', path),
    tier: requiredString(json, 'tier', path),
    corridor: optionalString(json, 'corridor', path),
    inBundle: (() => {
      const flag = json.inBundle;
      if (typeof flag !== 'boolean') throw new AttractionDecodeError(`${path}.inBundle`, 'a boolean');
      return flag;
    })(),
    fromPriceIsk: optionalInt(json, 'fromPriceIsk', path),
  };
}

function decodeBathing(value: unknown, path: string): AttractionBathing {
  const json = object(value, path);
  return { level: requiredString(json, 'level', path), text: requiredString(json, 'text', path) };
}

export function decodeAttractionNearby(value: unknown, path = 'nearby'): AttractionNearby {
  const json = object(value, path);
  return {
    slug: requiredString(json, 'slug', path),
    name: requiredString(json, 'name', path),
    nameEn: optionalString(json, 'nameEn', path),
    kind: requiredString(json, 'kind', path),
    distanceM: requiredNumber(json, 'distanceM', path),
    thumb: optionalString(json, 'thumb', path),
    // Newer than the rest of the row, so lossy: a malformed or blank credit
    // costs the row its photograph, never the neighbour.
    thumbCredit: nonBlank(json, 'thumbCredit'),
    thumbLicense: nonBlank(json, 'thumbLicense'),
  };
}

function decodeMapsLinks(value: unknown, path: string): AttractionMapsLinks {
  const json = object(value, path);
  return { google: optionalString(json, 'google', path), apple: optionalString(json, 'apple', path) };
}

export function decodeAttractionTrailLink(value: unknown, path = 'trailLink'): AttractionTrailLink {
  const json = object(value, path);
  return {
    slug: requiredString(json, 'slug', path),
    name: requiredString(json, 'name', path),
    nameEn: nonBlank(json, 'nameEn'),
    lengthM: looseInt(json, 'lengthM'),
    durationMinutes: looseInt(json, 'durationMinutes'),
    outAndBack: json.outAndBack === true,
  };
}

/**
 * A drive time, or a decoding error (iOS `AttractionDrive`). A drive that
 * rounds to no minutes, or a negative or infinite one, is a data error and
 * not a drive time, so the card prints nothing rather than "0 min from
 * Reykjavík". Exported for the Coach's plan sights, which carry the same
 * object.
 */
export function decodeAttractionDrive(value: unknown, path = 'driveFromReykjavik'): AttractionDrive {
  const json = object(value, path);
  const rawMinutes = requiredNumber(json, 'minutes', path);
  const rawKm = requiredNumber(json, 'km', path);
  const minutes = wholeOrNull(rawMinutes);
  if (!Number.isFinite(rawKm) || rawKm < 0 || minutes === null || minutes < 1) {
    throw new AttractionDecodeError(`${path}.minutes`, 'a drive time');
  }
  return { minutes, km: rawKm };
}

/** A drive time, or null for anything that is not one (the lossy read every caller uses). */
export function parseAttractionDrive(value: unknown): AttractionDrive | null {
  if (value === undefined || value === null) return null;
  return lossy(() => decodeAttractionDrive(value));
}

/** `road`, `ferry` or `offshore`; anything else (a value this build does not know) is null. */
export function parseRoadAccess(value: unknown): AttractionRoadAccess | null {
  return value === 'road' || value === 'ferry' || value === 'offshore' ? value : null;
}

/** The port named in "Ferry from Landeyjahöfn", the only one the copy has a sentence for. */
export const LANDEYJAHOFN = 'Landeyjahöfn';

/**
 * Metres, whole or fractional on the wire. Negative, infinite, past Int's
 * range or malformed reads as not measured.
 */
function metresOf(json: Json, key: string): number | null {
  const value = present(json, key);
  if (typeof value !== 'number') return null;
  if (Number.isInteger(value)) return value >= 0 && value < INT_LIMIT ? value : null;
  if (!Number.isFinite(value) || value < 0) return null;
  return wholeOrNull(value);
}

/**
 * Road access and the ferry's port. A server from before the field sends no
 * key (or null): its `ferryOnly` was true on Heimaey and nowhere else, so that
 * reply reads as the Landeyjahöfn ferry or the road. A value that is present
 * but not one this build knows reads as unknown (null), never as road: a
 * guess about access is how somebody drives to a harbour for a place with no
 * ferry.
 */
function accessOf(json: Json, ferryOnly: boolean): { roadAccess: AttractionRoadAccess | null; ferryPort: string | null } {
  if (present(json, 'roadAccess') === undefined) {
    return { roadAccess: ferryOnly ? 'ferry' : 'road', ferryPort: ferryOnly ? LANDEYJAHOFN : null };
  }
  return { roadAccess: parseRoadAccess(json.roadAccess), ferryPort: nonBlank(json, 'ferryPort') };
}

/** One sight's card. */
export function decodeAttractionDetail(value: unknown): AttractionDetail {
  const path = 'data';
  const json = object(value, path);
  const slug = requiredString(json, 'slug', path);
  const name = requiredString(json, 'name', path);
  const kind = requiredString(json, 'kind', path);
  const region = requiredString(json, 'region', path);
  const { latitude, longitude } = coordinatesOf(json, path);

  const listOf = <T>(key: string, decode: (item: unknown, itemPath: string) => T): T[] => {
    const raw = present(json, key);
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new AttractionDecodeError(`${path}.${key}`, 'a list');
    return raw.map((item, index) => decode(item, `${path}.${key}[${index}]`));
  };

  const bathingRaw = present(json, 'bathing');
  const ferryOnly = json.ferryOnly === true;
  const { roadAccess, ferryPort } = accessOf(json, ferryOnly);

  // One malformed walk link is dropped on its own, not with the others.
  const relatedTrails: AttractionTrailLink[] = [];
  if (Array.isArray(json.relatedTrails)) {
    json.relatedTrails.forEach((item, index) => {
      const link = lossy(() => decodeAttractionTrailLink(item, `${path}.relatedTrails[${index}]`));
      if (link) relatedTrails.push(link);
    });
  }

  return {
    slug,
    name,
    localName: optionalString(json, 'localName', path) ?? name,
    kind,
    kindLabel: optionalString(json, 'kindLabel', path) ?? kind,
    region,
    regionLabel: optionalString(json, 'regionLabel', path) ?? region,
    nearestTown: optionalString(json, 'nearestTown', path),
    latitude,
    longitude,
    summary: optionalString(json, 'summary', path),
    body: optionalString(json, 'body', path),
    heightM: optionalInt(json, 'heightM', path),
    elevationM: optionalInt(json, 'elevationM', path),
    lengthM: optionalInt(json, 'lengthM', path),
    ascentM: optionalInt(json, 'ascentM', path),
    durationMinutes: optionalInt(json, 'durationMinutes', path),
    difficulty: optionalString(json, 'difficulty', path),
    difficultyLabel: optionalString(json, 'difficultyLabel', path),
    accessNotes: optionalString(json, 'accessNotes', path),
    parkingFeeIsk: optionalInt(json, 'parkingFeeIsk', path),
    seasonalAccess: optionalString(json, 'seasonalAccess', path),
    requiresFourWheelDrive: optionalBool(json, 'requiresFourWheelDrive', path) ?? false,
    bathing: bathingRaw === undefined ? null : decodeBathing(bathingRaw, `${path}.bathing`),
    images: listOf('images', decodeImage),
    sources: listOf('sources', decodeSource),
    pairings: listOf('pairings', decodePairing),
    accessRule: optionalString(json, 'accessRule', path) ?? '',
    attribution: optionalString(json, 'attribution', path),

    // Everything below came after the endpoint's first release: lossy, so a
    // courtesy gone missing never costs the member the card.
    nearby: lossy(() => listOf('nearby', decodeAttractionNearby)) ?? [],
    mapsLinks: present(json, 'mapsLinks') === undefined ? null : lossy(() => decodeMapsLinks(json.mapsLinks, `${path}.mapsLinks`)),
    hasPage: json.hasPage === true,
    routeLines:
      present(json, 'routeGeojson') === undefined
        ? []
        : (lossy(() => decodeTrailGeometry(json.routeGeojson, `${path}.routeGeojson`)) ?? []),
    tier: tierOf(json.tier),
    rankScore: finiteOrNull(json.rankScore),
    driveFromReykjavik: parseAttractionDrive(json.driveFromReykjavik),
    roadAccess,
    nearestRoadM: metresOf(json, 'nearestRoadM'),
    ferryOnly,
    ferryPort,
    forAttraction:
      present(json, 'forAttraction') === undefined
        ? null
        : lossy(() => decodeAttractionTrailLink(json.forAttraction, `${path}.forAttraction`)),
    relatedTrails,
    outAndBack: json.outAndBack === true,
  };
}
