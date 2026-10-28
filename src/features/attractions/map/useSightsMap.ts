/**
 * The Explore map's sights layer state: loading, the retry schedule, the
 * trails, the open sight, and the layout for the camera (iOS SearchMapView's
 * sights state and MapViewModel's sights half).
 *
 * LOADING. The layer is ON when the map appears (D8, the owner's call, not
 * persisted), so the markers load then, through the shared feed
 * (../markersStore.ts: a second caller joins the request already out, and a
 * failure keeps the last good markers). A failed load asks again at 0, 5, 15
 * and 60 seconds while the map stays up: soon enough to ride out a dropped
 * connection or a cold function while the member is looking, and finite, so
 * a phone left on the map offline does not ask forever. The schedule runs
 * only while the layer is on and the map is on screen (not under the list,
 * the classes feed, or a page pushed over Explore; iOS's task ends with the
 * map's view), and starts over each time that becomes true again, and on the
 * notice's "Try again". Switching the layer off ends the waiting schedule,
 * but a request already out completes, for next time.
 *
 * Each map reads the markers once in its life (iOS builds a view model per
 * visit), drawing whatever the shared feed already holds meanwhile. A search
 * group read that lands after the map appeared counts as the map's own
 * (./exploreFeed.ts; on iOS both go through one view model): the schedule
 * ends at its next step instead of asking again. The quiet notice shows only
 * while the last load failed AND no marker is held: a layer that is on but
 * empty always has a way back, and one with rings on it does not claim they
 * "did not load". Its spinner follows any Explore read, the search group's
 * included.
 *
 * TRAILS load once the schedule is over with markers held (rings on the
 * map), and only while the layer is still on: lines alone would draw walks
 * with no ring to tap. Rings drawn from a feed another surface read (Home)
 * while the map's own reads fail still get their trails (./trailsFeed.ts
 * holds the ten-minute wait after a failure).
 *
 * Under the `mapPins` fixture the fixture's sights and trail stand in and
 * nothing is asked (./mapPinsFixture.ts, iOS `MapPinsScreenshotFixtures`).
 *
 * THE OPEN SIGHT. A ring tapped, or a sight opened from the search group, is
 * the open sight until Explore is back in front (its card closed): its ring
 * grows and stays at any zoom.
 */
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import type { AttractionTrail } from '../../../api/attractions';
import { isCancellation } from '../../../api';
import { useT, type Lang } from '../../../i18n';
import { coordinateOf, type Coordinate } from '../../../lib/geo';
import { attractionMarkersStore } from '../markersStore';
import { sightDisplayName } from '../model';
import { rankedForMap } from '../rules';
import { exploreSightsFeed, loadExploreMarkers, readMark, readSince } from './exploreFeed';
import { NO_SIGHTS, NO_TRAILS, sightFeatures, trailFeatures, type SightsCollection, type TrailsCollection } from './features';
import {
  HIT_TARGET,
  hitSize,
  latitudeSpan,
  mapScreenOf,
  regionOfCamera,
  regionOfSpan,
  venueTitleSize,
  type MapCameraReport,
  type Size,
} from './layout';
import { mapPinsFixture } from './mapPinsFixture';
import { layOutSights, trailsDrawnAtThisZoom, type MapVenue, type SightsViewport } from './sightsLayout';
import { loadTrailsFeed } from './trailsFeed';
import { sightAccessibilityLabel } from './words';

/** When the map asks again for markers that failed: at once, then after 5, 15 and 60 seconds. */
export const MARKER_RETRY_DELAYS_MS: readonly number[] = [0, 5_000, 15_000, 60_000];

/** A venue on the map, as the layer needs it. */
export interface SightsMapVenue {
  readonly name: string;
  readonly latitude: number | null | undefined;
  readonly longitude: number | null | undefined;
}

/** A region as a centre and a span (the map's opening region). */
export interface SpanRegion {
  readonly center: Coordinate;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface SightsMapInput {
  /** The Sights toggle (D8: on when the map opens). */
  readonly showSights: boolean;
  readonly setShowSights: (on: boolean) => void;
  /** The map is what the member sees (not covered by the list or the classes feed). Default true. */
  readonly active?: boolean;
  /** The camera as last reported at the end of a move; null before the first report. */
  readonly camera?: MapCameraReport | null;
  /** Where the map opened: the view until the camera first reports. */
  readonly openingRegion?: SpanRegion | null;
  /** The map's size in points. */
  readonly mapSize?: Size;
  /** The venues drawn on the map (the list's, with a position). */
  readonly venues?: readonly SightsMapVenue[];
  /** A sight opened from the search group: each new key makes it the open sight. */
  readonly openedSight?: { readonly slug: string; readonly key: number } | null;
  /** TalkBack is on: each drawn ring gets an accessible element too. */
  readonly screenReaderOn?: boolean;
}

/** A drawn ring as TalkBack reaches it. */
export interface AccessibleSight {
  readonly slug: string;
  /** [longitude, latitude]. */
  readonly coordinate: readonly [number, number];
  /** The tap target, in points across. */
  readonly size: number;
  /** "{name}, Top pick, Trailhead" as applicable. */
  readonly label: string;
}

/** What the layer draws (SightsLayer's `content`). */
export interface SightsLayerContent {
  readonly sights: SightsCollection;
  readonly trails: TrailsCollection;
  /** Filled only while a screen reader is on. */
  readonly accessible: readonly AccessibleSight[];
  /** A ring was chosen: it becomes the open sight. */
  readonly select: (slug: string) => void;
  /**
   * Ground metres per screen point at the camera the rings were laid out
   * for, so a tap can tell a drawn ring from an invisible target; null
   * before the map has a size.
   */
  readonly metresPerPoint?: number | null;
}

export interface SightsMap {
  readonly showSights: boolean;
  readonly toggle: () => void;
  /** An Explore read of the markers is out (this map's, or the search group's). */
  readonly loading: boolean;
  /** The quiet "Sights did not load." notice. */
  readonly showsRetryNotice: boolean;
  /** Start the retry schedule over, at once. */
  readonly retry: () => void;
  /** The ODbL notice that travels with the data, for its plate. */
  readonly attribution: string | null;
  readonly legendShowsSights: boolean;
  readonly legendShowsTrails: boolean;
  readonly layer: SightsLayerContent;
}

const NO_VENUES: readonly SightsMapVenue[] = [];
const NO_TRAIL_LIST: readonly AttractionTrail[] = [];
const NO_SIZE: Size = { width: 0, height: 0 };

export function useSightsMap({
  showSights,
  setShowSights,
  active = true,
  camera = null,
  openingRegion = null,
  mapSize = NO_SIZE,
  venues = NO_VENUES,
  openedSight = null,
  screenReaderOn = false,
}: SightsMapInput): SightsMap {
  const { t, language } = useT();
  // The `mapPins` fixture's sights, read once for this map's life.
  const [fixture] = useState(mapPinsFixture);
  const heldPage = useStore(attractionMarkersStore, (state) => state.page);
  const page = fixture?.page ?? heldPage;
  const focused = useScreenFocused();
  const onScreen = active && focused;

  // MARK: Loading

  const loading = useStore(exploreSightsFeed, (state) => state.loading);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [trails, setTrails] = useState<readonly AttractionTrail[]>(() => fixture?.trails ?? NO_TRAIL_LIST);
  /** The language this map has read the markers in (iOS `attractionsLoaded`, per map). */
  const loadedIn = useRef<Lang | null>(null);
  const trailsLoaded = useRef(fixture !== null);
  // Where Explore's reads stood when this map appeared: one that lands later
  // (the search group's) is this map's read too.
  const [mark] = useState(readMark);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One read of the markers (joining one already out). True once this map has them. */
  const attempt = useCallback(
    async (locale: Lang): Promise<boolean> => {
      if (loadedIn.current === locale) return true;
      // The search group read them since this map appeared (iOS: the same
      // view model's `attractionsLoaded`): nothing to ask.
      if (readSince(mark, locale)) {
        loadedIn.current = locale;
        setFailed(false);
        return true;
      }
      const result = await loadExploreMarkers(locale);
      if (!mounted.current) return result.ok;
      if (result.ok) {
        loadedIn.current = locale;
        setFailed(false);
      } else if (!isCancellation(result.error)) {
        // Keep what is drawn; the notice and the schedule get another go.
        setFailed(true);
      }
      return result.ok;
    },
    [mark],
  );

  useEffect(() => {
    // The fixture's sights and trail are in hand: nothing to ask.
    if (!showSights || !onScreen || fixture) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timer = null;
          resolve();
        }, ms);
      });
    void (async () => {
      for (const delay of MARKER_RETRY_DELAYS_MS) {
        if (delay > 0) await wait(delay);
        if (cancelled) return;
        if (await attempt(language)) break;
      }
      // A layer switched off (or a map gone) meanwhile has no use for the
      // heavier request, and a layer with no markers held must not draw walks
      // with no ring to tap. Rings drawn from a feed another surface read
      // (Home) get their trails even when this map's own reads failed.
      if (cancelled || trailsLoaded.current || attractionMarkersStore.getState().page === null) return;
      const feed = await loadTrailsFeed();
      if (!feed || !mounted.current) return;
      trailsLoaded.current = true;
      setTrails(feed.trails);
    })();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [showSights, onScreen, retryNonce, language, attempt, fixture]);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);
  const toggle = useCallback(() => setShowSights(!showSights), [setShowSights, showSights]);

  // MARK: The open sight

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation) return undefined;
    // Back in front: the sight's card has closed.
    return navigation.addListener('focus', () => setSelectedSlug(null));
  }, [navigation]);

  const openedKey = openedSight?.key ?? null;
  const openedSlug = openedSight?.slug ?? null;
  const handledOpening = useRef(openedKey);
  useEffect(() => {
    if (openedKey === null || openedKey === handledOpening.current) return;
    handledOpening.current = openedKey;
    setSelectedSlug(openedSlug);
  }, [openedKey, openedSlug]);

  const select = useCallback((slug: string) => setSelectedSlug(slug), []);

  // MARK: The layout

  const markers = page?.attractions;
  const ranked = useMemo(() => rankedForMap(markers ?? []), [markers]);

  const mapVenues = useMemo<MapVenue[]>(() => {
    const drawn: MapVenue[] = [];
    for (const venue of venues) {
      const coordinate = coordinateOf(venue);
      if (coordinate) drawn.push({ coordinate, mark: { coordinate, titleSize: venueTitleSize(venue.name) } });
    }
    return drawn;
  }, [venues]);

  // Keyed on the numbers, so a camera reported again where it was lays
  // nothing out again (iOS `SightsLayerKey`).
  // (Read defensively: a report without its box lays out from the opening region.)
  const [ne0, ne1] = camera?.bounds?.ne ?? [];
  const [sw0, sw1] = camera?.bounds?.sw ?? [];
  const heading = camera?.heading ?? 0;
  const pitch = camera?.pitch ?? 0;
  const hasCamera = camera !== null && ne0 !== undefined && sw0 !== undefined;
  const { width, height } = mapSize;
  const viewport = useMemo<SightsViewport>(() => {
    const reported: MapCameraReport | null = hasCamera ? { bounds: { ne: [ne0, ne1], sw: [sw0, sw1] }, heading, pitch } : null;
    const region = (reported && regionOfCamera(reported)) ?? (openingRegion ? regionOfSpan(openingRegion) : null);
    return { region, screen: mapScreenOf(reported, { width, height }), mapHeight: height };
  }, [hasCamera, ne0, ne1, sw0, sw1, heading, pitch, width, height, openingRegion]);

  const layout = useMemo(
    () => layOutSights({ showSights, ranked, trails, viewport, venues: mapVenues, selectedSlug, language }),
    [showSights, ranked, trails, viewport, mapVenues, selectedSlug, language],
  );

  const sights = useMemo(() => sightFeatures(layout, selectedSlug, language), [layout, selectedSlug, language]);
  const trailShapes = useMemo(() => trailFeatures(layout.trails), [layout.trails]);

  const accessible = useMemo<readonly AccessibleSight[]>(() => {
    if (!screenReaderOn) return [];
    return layout.sights.map((sight) => ({
      slug: sight.slug,
      coordinate: [sight.longitude, sight.latitude] as const,
      size: hitSize(sight.tier, sight.slug === selectedSlug, layout.tight.has(sight.slug)),
      label: sightAccessibilityLabel(sight, sightDisplayName(sight, language), t),
    }));
  }, [screenReaderOn, layout, selectedSlug, language, t]);

  // How far a point on screen reaches on the ground, at the camera laid out
  // for: a tap on a drawn ring wins over an invisible target (`pickSight`).
  const metresPerPoint =
    viewport.region && height > 0 ? (latitudeSpan(viewport.region) * HIT_TARGET.metresPerDegreeLatitude) / height : null;

  const layer = useMemo<SightsLayerContent>(
    () => ({
      sights: showSights ? sights : NO_SIGHTS,
      trails: showSights ? trailShapes : NO_TRAILS,
      accessible,
      select,
      metresPerPoint,
    }),
    [showSights, sights, trailShapes, accessible, select, metresPerPoint],
  );

  return {
    showSights,
    toggle,
    loading,
    showsRetryNotice: showSights && failed && page === null,
    retry,
    attribution: showSights ? (page?.attribution ?? null) : null,
    legendShowsSights: showSights,
    legendShowsTrails: trailsDrawnAtThisZoom(showSights, trails.length, viewport.region),
    layer,
  };
}

/** Whether the screen around this is in front; true outside a navigator. */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}
