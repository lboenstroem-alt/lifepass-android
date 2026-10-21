// The Explore map (plan 3.0.3 slot, filled by EXPL-2; mounted by EXPL-1's
// Explore screen): the Android port of the map half of iOS SearchMapView
// (Views/Search/SearchMapView.swift, 2.5.5).
//
// WHAT IS ON IT
//  - Mapbox Light, opening on central Reykjavík (or, for Home's "See all on
//    the map", on all of Iceland with the sights on).
//  - Every venue the list shows that has a position, as its photo inside a
//    ring that says its type (`VenuePin`, `classify`), with its name under
//    it (`VenueNamesLayer`). Rings are classified once per list.
//  - The sights layer (ATTR-2's `SightsLayer`, on by default, D8).
//  - The member's dot while location is allowed, and a locate button.
//  - Over the top (`MapTopOverlay`): the controls row, the legend (only the
//    types on the map, folded on a phone) and "Location is off".
//  - The pinned venue's card (`VenuePinCard`), a fixed distance above the
//    bottom.
//
// TWO TAPS (`pinPreview`, iOS `VenuePinPreview`). The first tap on a pin pins
// its card, the second (or a tap on the card) opens the venue; another pin
// moves the card; the map, the close button, a sight (on the map or from the
// search group, `openedSight`), a filter or search that takes the venue off
// the map, the Map/List switch and a Venues/Classes change (both arrive as
// `active` turning false) close it, and so does Android's back button while
// the card is up. An accessibility activation (TalkBack's double tap, Switch
// Access's select) opens the venue at once, as VoiceOver and Switch Control
// do on iOS: "Tap again" is a step such a member cannot see. A map tap is
// held 80 ms, and a pin tap on the same touch wins. The pinned pin is
// selected, which Mapbox draws on top of its neighbours. The card slides in
// from below and out again (not under Remove animations).
//
// THE REVEAL (`revealMove`, iOS `VenuePinReveal`). A pin pinned in about the
// lower third of the map would sit under its own card, so once the card has
// laid out the map slides (keeping its zoom, heading and pitch) until the
// pin and its name clear the card, if there is room between the overlay
// stack and the card; on a map too short for that nothing moves, and the
// card drops "Tap again" if the pin is under it. No slide under Remove
// animations.
//
// The member's precise position never leaves the phone: Mapbox's telemetry
// is off (./mapbox.ts) and the dot is drawn on the phone, only while the map
// is on screen (iOS drops `UserAnnotation` with the map under the list or the
// classes feed), so location updates stop while the map is covered.
//
// NO TOKEN, NO MAP. A build without the Mapbox token (`hasMapboxToken`)
// draws a plain area instead: a Mapbox view without a token throws on the UI
// thread, so the Mapbox component is never rendered then.
//
// CONTRACTS. `openedSight` (for EXPL-1's search group, iOS
// `openSearchedSight`) and the sights' controls (`useSightsMapControls`,
// ./sightsControls, ATTR-2's on merge).
import { Camera, LocationPuck, MapView, MarkerView } from '@rnmapbox/maps';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { fixtureArg, hasFixture } from '../../../dev/fixtures';
import { useReduceMotion } from '../../../hooks/useReduceMotion';
import { useT } from '../../../i18n';
import { coordinateOf, type Coordinate } from '../../../lib/geo';
import {
  accessibilityLabel as pinLabel,
  classifyAll,
  classifyVenue,
  legendEntries,
  type Classification,
} from '../../../lib/venueMarkerType';
import { useHardwareBack } from '../../../navigation/guards';
import { locationStore, selectGrantedLocation, useLocationStore, type LocationStore } from '../../../stores/locationStore';
import { colors } from '../../../theme';
import type { Venue } from '../../../types/venue';
import SightsLayer from '../../attractions/map/SightsLayer';
import { hasMapboxToken, MAP_STYLE_URL } from './mapbox';
import MapTopOverlay from './MapTopOverlay';
import { LEGEND_FOLD_BELOW_WIDTH } from './MapLegend';
import {
  deliversMapTap,
  INITIAL_PIN_PREVIEW,
  MAP_TAP_HOLD_MS,
  samePinPreview,
  sendPinPreview,
  type PinPreviewEvent,
  type PinPreviewState,
} from './pinPreview';
import { revealMove, venueNameHeight } from './pinReveal';
import { ICELAND_REGION, regionBounds, regionZoom, REYKJAVIK_REGION, type MapRegion } from './regions';
import { useSightsMapControls } from './sightsControls';
import { useScreenReaderOn } from './useScreenReader';
import VenueNamesLayer from './VenueNamesLayer';
import VenuePin from './VenuePin';
import VenuePinCard from './VenuePinCard';

export interface ExploreMapProps {
  /** The venues the list shows, in its order (filters and search applied). */
  readonly venues: readonly Venue[];
  /** The card's second tap: open the venue's page. */
  readonly onOpenVenue: (venue: Venue) => void;
  /** A sight's card (ATTR-1's `AttractionDetail`). */
  readonly onOpenSight: (slug: string) => void;
  /** Home's "See all on the map": open with the sights showing and all of Iceland in view. */
  readonly showSightsOnOpen?: boolean;
  /** Room to keep clear at the bottom (the tab bar). */
  readonly bottomInset?: number;
  /**
   * The map is what the member sees (not covered by the list, the classes
   * feed or the error state). Turning false closes a pinned card, as iOS
   * does on the Map/List switch and on a Venues/Classes change. Default true.
   */
  readonly active?: boolean;
  /**
   * A sight opened from outside the map: the search group's sights (iOS
   * `openSearchedSight`). Each new `key` closes the venue's card (one thing
   * open at a time, iOS `.onChange(of: selectedAttractionSlug)`) and, while
   * the map is on screen and the opener knows where the sight is, turns the
   * sights layer on and brings the sight into view, so closing its page
   * leaves the member looking at it. The value the map mounts with is not a
   * new opening.
   */
  readonly openedSight?: OpenedSight | null;
  /** The location store (tests pass their own). */
  readonly locationStore?: LocationStore;
}

/** One opening of a sight from outside the map (`ExploreMapProps.openedSight`). */
export interface OpenedSight {
  readonly slug: string;
  /** Where the sight is; null when the opener does not know (the card still closes). */
  readonly coordinate: Coordinate | null;
  /** New for every opening, so the same sight opened twice counts twice. */
  readonly key: number;
}

/** What the map shows of a sight opened from search (iOS span 0.25 by 0.5 around it). */
export function openedSightRegion(coordinate: Coordinate): MapRegion {
  return { center: coordinate, latitudeDelta: 0.25, longitudeDelta: 0.5 };
}

/** The camera's move to an opened sight (iOS animates it 0.3 s; none under Remove animations). */
export const SIGHT_CAMERA_MS = 300;

/**
 * The card's gap above the tab bar. iOS keeps the card 120 pt above the
 * bottom of the map, under which its 76 pt tab bar floats: 44 pt clear of
 * the bar. Android's map runs under its bar too, so the card sits that far
 * above `bottomInset` (the bar and the system's navigation bar).
 */
export const CARD_GAP_ABOVE_BAR = 44;

/** The locate button brings the dot into view at least this close in. */
export const LOCATE_ZOOM = 13;

/** The card's bottom edge, measured up from the bottom of the map. */
export function venueCardBottom(bottomInset: number): number {
  return Math.max(0, bottomInset) + CARD_GAP_ABOVE_BAR;
}

export default function ExploreMap(props: ExploreMapProps) {
  // Read per render, but fixed for the build: the same branch every time.
  if (!hasMapboxToken()) return <View style={[styles.area, styles.noMap]} testID="explore.map.unavailable" />;
  return <LiveExploreMap {...props} />;
}

function LiveExploreMap({
  venues,
  onOpenVenue,
  onOpenSight,
  showSightsOnOpen = false,
  bottomInset = 0,
  active = true,
  openedSight = null,
  locationStore: store = locationStore,
}: ExploreMapProps) {
  const { t, language } = useT();
  const [debugAids] = useState(readDebugAids);
  const reduceMotion = useReduceMotion();
  // An accessibility activation opens a pin's venue at once (the pin's
  // `onAssistiveActivate`). TalkBack on is the fallback for a tap that
  // arrives as a touch instead. A development build can act as if it were on
  // (`debugAssistiveTech`, iOS -LPDebugAssistiveTech).
  const screenReaderOn = useScreenReaderOn() || debugAids.assistiveTech;
  const { width: windowWidth } = useWindowDimensions();

  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<ComponentRef<typeof Camera>>(null);

  // MARK: The rings and the legend

  // The venues ON the map: those with a position (iOS `venuesWithCoordinates`,
  // filtered). The legend, the names and the card all follow these.
  const located = useMemo(() => venues.filter((venue) => coordinateOf(venue) !== null), [venues]);
  const rings = useMemo(() => classifyAll(located), [located]);
  const ringOf = useCallback((venue: Venue): Classification => rings.get(venue.id) ?? classifyVenue(venue), [rings]);
  const legend = useMemo(() => legendEntries(located.map(ringOf)), [located, ringOf]);

  // MARK: The camera and the layers

  // Where the map opens, fixed for this map's life (the screen remounts it
  // for Home's "See all on the map").
  const [initialRegion] = useState(() => (showSightsOnOpen ? ICELAND_REGION : REYKJAVIK_REGION));
  // Applied once, when the map is made (the camera's default stop).
  const [cameraDefaults] = useState(() => ({ bounds: regionBounds(initialRegion), animationDuration: 0 }));
  // The sights layer starts ON (D8); ATTR-2's toggle switches it.
  const [showSights, setShowSights] = useState(true);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [reportedZoom, setReportedZoom] = useState<number | null>(null);
  const zoom = reportedZoom ?? regionZoom(initialRegion, mapSize.width, mapSize.height);
  // The toggle, the legend's sight entries and what hangs under the legend
  // (ATTR-2's, through ./sightsControls).
  const sights = useSightsMapControls({ showSights, setShowSights, zoom });

  // MARK: Location

  const permission = useLocationStore((state) => state.permission, store);
  // Only while the map is what the member sees: the dot asks for continuous
  // fixes (and lights Android's location indicator) while it is drawn.
  const showsDot = permission === 'granted' && active;
  const showsLocate = permission !== 'denied';

  // MARK: The two taps

  const [preview, setPreview] = useState<PinPreviewState>(INITIAL_PIN_PREVIEW);
  const previewRef = useRef(preview);
  const venuesRef = useRef(located);
  venuesRef.current = located;
  const onOpenVenueRef = useRef(onOpenVenue);
  onOpenVenueRef.current = onOpenVenue;
  /** When a pin was last tapped, so the map's own tap can tell the same touch from open ground. */
  const lastPinTapAt = useRef<number | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  /** Every change to the card goes through the reducer; an open pushes the venue. */
  const dispatch = useCallback((event: PinPreviewEvent, at: number = Date.now()) => {
    const { state, effect } = sendPinPreview(previewRef.current, event, at);
    if (!samePinPreview(state, previewRef.current)) {
      previewRef.current = state;
      setPreview(state);
    }
    if (effect) {
      const venue = venuesRef.current.find((item) => item.id === effect.open);
      if (venue) onOpenVenueRef.current(venue);
    }
  }, []);

  /** Runs `work` after `ms`, unless the map is gone by then. */
  const later = useCallback((ms: number, work: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      work();
    }, ms);
    timers.current.add(timer);
  }, []);

  /**
   * A tap on the map, held a moment so a pin's tap on the same touch that
   * arrives just after is seen first, and dropped if one arrived just
   * before. A pin tap later than the hold still counts: the reducer takes a
   * tap on the pin this map tap closed, inside the window, as its second tap.
   */
  const onMapPress = useCallback(() => {
    const at = Date.now();
    later(MAP_TAP_HOLD_MS, () => {
      if (!deliversMapTap(at, lastPinTapAt.current)) return;
      dispatch({ kind: 'mapTap' }, at);
    });
  }, [dispatch, later]);

  const handlePinTap = useCallback(
    (id: string) => {
      const at = Date.now();
      lastPinTapAt.current = at;
      dispatch(screenReaderOn ? { kind: 'assistiveActivate', id } : { kind: 'pinTap', id }, at);
    },
    [dispatch, screenReaderOn],
  );

  /** An accessibility activation (TalkBack, Switch Access): opens the venue at once. */
  const onPinActivate = useCallback((id: string) => dispatch({ kind: 'assistiveActivate', id }), [dispatch]);

  /** A pin's tap: the first pins the card, the second opens the venue. */
  const onPinPress = useCallback(
    (id: string) => {
      // `debugMapTapFirst=<seconds>` (iOS -LPDebugMapTapFirst): the pin's
      // touch reaches the map's own tap handler first and the pin's action
      // lands that much later, as it may on some phones.
      const mapFirst = debugAids.mapTapFirstMs;
      if (mapFirst !== null) {
        onMapPress();
        later(mapFirst, () => handlePinTap(id));
        return;
      }
      handlePinTap(id);
    },
    [debugAids, handlePinTap, later, onMapPress],
  );

  // `mapPinned=<slug>` (iOS -LPScreenshotMapPinned): a development build pins
  // that venue's card once it is on the map, to check the card and the reveal.
  const pinnedAtLaunch = useRef(false);
  useEffect(() => {
    const slug = debugAids.pinnedSlug;
    if (pinnedAtLaunch.current || slug === null) return;
    const venue = located.find((item) => item.slug === slug);
    if (!venue) return;
    pinnedAtLaunch.current = true;
    later(400, () => dispatch({ kind: 'pinTap', id: venue.id }));
  }, [debugAids, located, dispatch, later]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // A search, a class chip or a category that takes the pinned venue off the
  // map closes its card with it.
  const visibleKey = located.map((venue) => venue.id).join('|');
  useEffect(() => {
    dispatch({ kind: 'visibleChanged', ids: new Set(venuesRef.current.map((venue) => venue.id)) });
  }, [visibleKey, dispatch]);

  // The list, the classes feed or the error state over the map: the card
  // must not be back, unasked, when the map returns.
  useEffect(() => {
    if (!active) dispatch({ kind: 'close' });
  }, [active, dispatch]);

  // One deliberate thing open at a time: a sight's card closes the venue's.
  const onSelectSight = useCallback(
    (slug: string) => {
      dispatch({ kind: 'sightOpened' });
      onOpenSight(slug);
    },
    [dispatch, onOpenSight],
  );

  // A sight opened from the search group: the same rule, and the map brings
  // it into view with the sights showing (iOS `openSearchedSight`).
  const openedKey = openedSight?.key ?? null;
  const openedSightRef = useRef(openedSight);
  openedSightRef.current = openedSight;
  const handledOpening = useRef(openedKey);
  const activeRef = useRef(active);
  activeRef.current = active;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  useEffect(() => {
    if (openedKey === null || openedKey === handledOpening.current) return;
    handledOpening.current = openedKey;
    dispatch({ kind: 'sightOpened' });
    const coordinate = openedSightRef.current?.coordinate ?? null;
    if (!coordinate || !activeRef.current) return;
    setShowSights(true);
    const still = reduceMotionRef.current;
    cameraRef.current?.setCamera({
      bounds: regionBounds(openedSightRegion(coordinate)),
      animationDuration: still ? 0 : SIGHT_CAMERA_MS,
      animationMode: still ? 'none' : 'easeTo',
    });
  }, [openedKey, dispatch]);

  // Android's back closes the card first, while Explore is the screen in front
  // (F4's guard asks the newest focused subscriber first).
  const pinnedId = preview.pinnedId;
  useHardwareBack(() => {
    dispatch({ kind: 'close' });
    return true;
  }, pinnedId !== null && active);

  // MARK: The card and the reveal

  const pinnedVenue = pinnedId === null ? null : (located.find((venue) => venue.id === pinnedId) ?? null);
  // The card on screen: the pinned venue's, or the last one's while it slides
  // away (iOS animates removal too). Settled during render, so the card is
  // never dropped for a frame between the two.
  const [lastPinned, setLastPinned] = useState<Venue | null>(null);
  const [leaving, setLeaving] = useState<Venue | null>(null);
  if (pinnedVenue !== lastPinned) {
    setLastPinned(pinnedVenue);
    setLeaving(pinnedVenue === null && !reduceMotion ? lastPinned : null);
  }
  const cardVenue = pinnedVenue ?? leaving;
  const onCardHidden = useCallback(() => setLeaving(null), []);
  const cardBottom = venueCardBottom(bottomInset);
  const [cardHeight, setCardHeight] = useState(0);
  const [mapTop, setMapTop] = useState(0);
  const [pinCovered, setPinCovered] = useState(false);

  // What the reveal reads but does not restart for (iOS keys it on the pin
  // and the card's height only).
  const revealInputs = useRef({ mapHeight: 0, mapTop: 0, cardBottom, reduceMotion });
  revealInputs.current = { mapHeight: mapSize.height, mapTop, cardBottom, reduceMotion };

  useEffect(() => {
    if (pinnedId === null || cardHeight <= 0) return undefined;
    let cancelled = false;
    // Let the card settle first: its height decides how far to go.
    const timer = setTimeout(() => {
      void (async () => {
        const map = mapRef.current;
        const venue = venuesRef.current.find((item) => item.id === pinnedId);
        const position = venue ? coordinateOf(venue) : null;
        const inputs = revealInputs.current;
        if (!map || !venue || !position || inputs.mapHeight <= 0) return;
        try {
          const [, pinY] = await map.getPointInView([position.longitude, position.latitude]);
          if (cancelled) return;
          const bottomEdge = inputs.mapHeight - inputs.cardBottom;
          const move = revealMove({
            pinY,
            nameHeight: venueNameHeight(venue.name),
            cardTop: bottomEdge - cardHeight,
            cardBottom: bottomEdge,
            mapTop: inputs.mapTop,
          });
          setPinCovered(move.pinStillCovered);
          if (move.shift <= 0) return;
          // The pin rises by `shift` when the camera's centre moves the same
          // distance down the screen. Measured through the map, so it holds
          // for a turned or tilted camera too.
          const centre = await map.getCenter();
          const [x, y] = await map.getPointInView(centre);
          const target = await map.getCoordinateFromView([x, y + move.shift]);
          if (cancelled) return;
          cameraRef.current?.setCamera({
            centerCoordinate: target,
            animationDuration: inputs.reduceMotion ? 0 : 250,
            animationMode: inputs.reduceMotion ? 'none' : 'easeTo',
          });
        } catch {
          // The map is not ready to answer: the pin stays where it is.
        }
      })();
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pinnedId, cardHeight]);

  // MARK: The locate button

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onLocate = useCallback(async () => {
    const location = store.getState();
    let fix = selectGrantedLocation(location);
    if (fix) {
      void location.refreshIfAuthorized();
    } else {
      // Not decided yet: this is where the member asked for it.
      await location.requestLocation();
      fix = selectGrantedLocation(store.getState());
    }
    if (!fix) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [fix.longitude, fix.latitude],
      zoomLevel: Math.max(zoomRef.current, LOCATE_ZOOM),
      animationDuration: revealInputs.current.reduceMotion ? 0 : 600,
      animationMode: revealInputs.current.reduceMotion ? 'none' : 'easeTo',
    });
  }, [store]);

  // MARK: Drawing

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMapSize((current) => (current.width === width && current.height === height ? current : { width, height }));
  };

  return (
    <View style={styles.area} onLayout={onLayout} testID="explore.map.area">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLE_URL}
        scaleBarEnabled={false}
        compassEnabled={false}
        logoPosition={{ bottom: Math.max(0, bottomInset) + 4, left: 8 }}
        attributionPosition={{ bottom: Math.max(0, bottomInset) + 4, left: 92 }}
        onPress={onMapPress}
        onMapIdle={(state) => setReportedZoom(state.properties.zoom)}
        testID="explore.map.view"
      >
        <Camera ref={cameraRef} defaultSettings={cameraDefaults} />
        <SightsLayer visible={showSights} zoom={zoom} onSelectSight={onSelectSight} />
        <VenueNamesLayer venues={located} pinnedId={pinnedId} />
        {/* In the list's order, always: a reordered marker is a native view
            torn down and added again. The pinned one is `isSelected`, which
            Mapbox stacks above the rest. */}
        {located.map((venue) => {
          const ring = ringOf(venue);
          return (
            <VenueMarker
              key={venue.id}
              venue={venue}
              ring={ring}
              pinned={venue.id === pinnedId}
              label={pinLabel(ring.type, venue.name, ring.comingSoon, language)}
              hint={t('map.pin_hint')}
              onPressVenue={onPinPress}
              onActivateVenue={onPinActivate}
              reduceMotion={reduceMotion}
            />
          );
        })}
        {showsDot ? <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: !reduceMotion }} /> : null}
      </MapView>

      <MapTopOverlay
        legendEntries={legend}
        legendFolds={windowWidth < LEGEND_FOLD_BELOW_WIDTH}
        showsSights={sights.legendShowsSights}
        showsTrails={sights.legendShowsTrails}
        sightsToggle={sights.toggle}
        belowLegend={sights.belowLegend}
        showsLocate={showsLocate}
        onLocate={() => void onLocate()}
        onBottom={setMapTop}
        initialLegendOpen={debugAids.legendOpen}
        locationStore={store}
      />

      {cardVenue ? (
        <VenuePinCard
          venue={cardVenue}
          ring={ringOf(cardVenue)}
          visible={pinnedVenue !== null}
          onHidden={onCardHidden}
          showsTapAgain={!pinCovered}
          onOpen={() => dispatch({ kind: 'cardTap' })}
          onClose={() => dispatch({ kind: 'close' })}
          onHeight={setCardHeight}
          bottom={cardBottom}
          reduceMotion={reduceMotion}
        />
      ) : null}
    </View>
  );
}

/**
 * The map's development aids, the Android twins of iOS's DEBUG launch
 * arguments (src/dev/fixtures.ts): read once when the map mounts, and all
 * empty in a release build.
 */
function readDebugAids() {
  const late = Number.parseFloat(fixtureArg('debugMapTapFirst') ?? '');
  return {
    assistiveTech: hasFixture('debugAssistiveTech'),
    mapTapFirstMs: Number.isFinite(late) && late >= 0 ? late * 1000 : null,
    pinnedSlug: fixtureArg('mapPinned') || null,
    legendOpen: hasFixture('mapLegendOpen'),
  };
}

/** A pin's anchor: the ring's centre on the venue's coordinate. */
const CENTRE_ANCHOR = { x: 0.5, y: 0.5 };

interface VenueMarkerProps {
  readonly venue: Venue;
  readonly ring: Classification;
  readonly pinned: boolean;
  readonly label: string;
  readonly hint: string;
  readonly onPressVenue: (id: string) => void;
  readonly onActivateVenue: (id: string) => void;
  readonly reduceMotion: boolean;
}

/**
 * One venue's marker, memoised so a camera that settles (or a card that
 * opens elsewhere) sends nothing new to the other native markers.
 */
const VenueMarker = memo(function VenueMarker({
  venue,
  ring,
  pinned,
  label,
  hint,
  onPressVenue,
  onActivateVenue,
  reduceMotion,
}: VenueMarkerProps) {
  const { id, latitude, longitude } = venue;
  const coordinate = useMemo<[number, number]>(() => [longitude ?? 0, latitude ?? 0], [latitude, longitude]);
  const onPress = useCallback(() => onPressVenue(id), [onPressVenue, id]);
  const onAssistiveActivate = useCallback(() => onActivateVenue(id), [onActivateVenue, id]);
  return (
    <MarkerView coordinate={coordinate} anchor={CENTRE_ANCHOR} allowOverlap allowOverlapWithPuck isSelected={pinned}>
      <VenuePin
        imageUrl={venue.imageUrl}
        ring={ring}
        pinned={pinned}
        accessibilityLabel={label}
        accessibilityHint={hint}
        onPress={onPress}
        onAssistiveActivate={onAssistiveActivate}
        reduceMotion={reduceMotion}
        testID={`explore.map.pin.${venue.slug}`}
      />
    </MarkerView>
  );
});

const styles = StyleSheet.create({
  area: { flex: 1 },
  // No token, no map: a plain area where the map would be.
  noMap: { backgroundColor: colors.ink2 },
});
