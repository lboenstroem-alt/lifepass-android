// The Explore tab: the Android port of iOS SearchMapView's shell, search,
// filters and list (Views/Search/SearchMapView.swift). The map is EXPL-2's
// (`ExploreMap`), the classes feed CLASS-1's (`ClassesDiscovery`) and the
// sights search group ATTR-2's (`SightsSearchGroup`); this screen mounts them.
//
// THE SHELL. The top bar says "Explore" and "{count} venues" (what the search
// returned), and its person button opens Profile (bookings and saved), as on
// iOS since the Coach release. Below it, in Venues mode, one search row (the
// box, the Map/List switch, Filters) and the Filters panel when open: the
// Venues / Classes switch, the class chips, the category groups. The MAP is
// the default view. Classes mode shows the classes feed under the top bar,
// with the switch back in its own filter row.
//
// THE MAP STAYS MOUNTED. iOS keeps the map's camera and its sights layer in
// the screen's own state, so a trip to the list, to Classes or through a
// failed load and back finds the map as the member left it. Here the map
// keeps them itself, so it is never unmounted for those: the list, the
// classes feed and the error state are laid over it, and while covered it is
// hidden from touch and from TalkBack, and told it is not on screen
// (`active`, which closes a pinned card, as iOS does on the Map/List switch
// and on a mode change). It mounts afresh only for Home's "See all on the
// map" and when the member leaves the tab.
//
// THE LAUNCH. A cold launch opens on Explore (src/app/launchTab.ts) with the
// venues and the Filters panel open, ONCE, so a new member sees what they can
// narrow by (`exploreLaunchPresentation`, taken here on appear). Anything
// that took the member elsewhere first cancels it, so Explore never opens its
// filters later by itself. Home's "See all on the map" arrives the same way
// (`pendingExploreSights`): the map, with the sights and all of Iceland.
//
// EVERY APPEARANCE (the tab, or back from a venue page) reloads the list, as
// iOS's `.task` does, and asks for location (the dialog shows only while the
// member has not decided; after that it only refreshes the fix).
//
// EVERY VISIT TO THE TAB STARTS FRESH. iOS builds SearchMapView afresh each
// time the Explore tab is selected (MainTabView's `switch selectedTab`), so a
// member coming back finds the map, Venues mode, an empty search box, no
// filters and the panel closed, over the whole catalogue. Android keeps tab
// screens mounted, so Explore puts itself back that way when the member
// leaves the TAB. A page pushed on Explore's own stack (a venue, Profile, a
// sight) is not leaving: iOS keeps the screen's state under a push, and so
// does this one. Neither is a sheet or a modal over the tabs.
//
// The location never leaves the phone: the list is ordered on it here.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { EmptyState, hiddenFromAccessibility, TopBar, useSheetOpen } from '../../components/ui';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import { interleaveByBrand } from '../../lib/browseOrder';
import { coordinateOf } from '../../lib/geo';
import { useAppNavigation } from '../../navigation/hooks';
import { openProfile } from '../../navigation/profile';
import type { MainTab } from '../../navigation/types';
import { useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { locationStore } from '../../stores/locationStore';
import { useOrderedVenues, useVenueList } from '../../stores/venuesStore';
import { colors } from '../../theme';
import type { Venue } from '../../types/venue';
import SightsSearchGroup from '../attractions/SightsSearchGroup';
import ClassesDiscovery from '../classes/ClassesDiscovery';
import { useKenniSheetRequest } from '../kenni';
import ClearFiltersLink from './ClearFiltersLink';
import type { ExploreMode } from './ExploreModeToggle';
import { exploreVenues as defaultExploreVenues, type ExploreVenues } from './exploreVenues';
import FilterPanel from './FilterPanel';
import { activeFilterCount, applyFilters, clearFilters, NO_FILTERS, type ExploreFilters } from './filters';
import ExploreMap, { type ExploreMapProps } from './map/ExploreMap';
import { useMapToggleHint } from './mapToggleHint';
import SearchRow, { type Presentation } from './SearchRow';
import { useAppActive } from './useAppActive';
import VenueList from './VenueList';

/** The tab this screen is the first screen of (src/navigation/tabStacks.tsx). */
const EXPLORE_TAB: MainTab = 'Explore';

/**
 * What the map is handed: its props, plus `active` (the map is what the
 * member sees, not covered by the list, the classes feed or the error state).
 * EXPL-2 declares `active` as an optional prop when it fills the map, and
 * closes a pinned card when it turns false (iOS `dispatchPin(.close)` on the
 * Map/List switch and on `exploreMode` changing). Until then the stub ignores
 * it.
 */
type MapPropsWithActive = ExploreMapProps & { readonly active: boolean };

/**
 * How the map mounts: `key` remounts it (Home's "See all on the map", a new
 * visit to the tab), `sights` opens it on the sights and all of Iceland.
 */
interface MapOpening {
  readonly key: number;
  readonly sights: boolean;
}

export interface ExploreScreenProps {
  /** The list and its search (tests pass their own). */
  readonly venues?: ExploreVenues;
}

export default function ExploreScreen({ venues: explore = defaultExploreVenues }: ExploreScreenProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const isFocused = useIsFocused();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const reduceMotion = useReduceMotion();

  const [mode, setMode] = useState<ExploreMode>('venues');
  const [presentation, setPresentation] = useState<Presentation>('map');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ExploreFilters>(NO_FILTERS);
  const [searchText, setSearchText] = useState('');
  // The query a sight was last opened from: its group steps aside for it, so
  // coming back from the sight shows the map or the list, not results already
  // used. Typing again, or focusing the box, brings the group back.
  const [openedSightQuery, setOpenedSightQuery] = useState<string | null>(null);
  const [mapOpening, setMapOpening] = useState<MapOpening>({ key: 0, sights: false });

  const searchRef = useRef(searchText);
  searchRef.current = searchText;
  const searchInput = useRef<TextInput>(null);

  // MARK: The list

  const store = explore.store;
  /** The search results in the server's order (iOS `viewModel.venues`): the chips count over these. */
  const fetched = useVenueList((state) => state.fetched, store);
  const error = useVenueList((state) => state.error, store);
  const isLoading = useVenueList((state) => state.isLoading, store);
  const session = useVenueList((state) => state.session, store);
  const ordered = useOrderedVenues(store);

  /** The list: the browse order, THEN the chips, so a chip only removes cards. */
  const listVenues = useMemo(() => applyFilters(ordered, filters), [ordered, filters]);
  /**
   * The map: the results with a position, chains spread out (iOS gives the
   * map `interleavedByBrand` of the server's order), then the chips.
   */
  const mapVenues = useMemo(
    () =>
      applyFilters(
        interleaveByBrand(fetched, (venue) => venue.name).filter((venue) => coordinateOf(venue) !== null),
        filters,
      ),
    [fetched, filters],
  );
  const loadFailed = fetched.length === 0 && error !== null && !isLoading;

  // MARK: Appearing

  /** Takes what launch or Home parked for Explore (each once). */
  const takeIntents = useCallback(() => {
    const intents = useIntentStore.getState();
    if (intents.takeExploreLaunchPresentation()) {
      setMode('venues');
      setFiltersOpen(true);
    }
    if (intents.takeExploreSights()) {
      setMode('venues');
      setPresentation('map');
      setMapOpening((current) => ({ key: current.key + 1, sights: true }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      takeIntents();
      // Something parked while Explore is already showing is taken at once.
      const unsubscribe = useIntentStore.subscribe((state) => {
        if (state.exploreLaunchPresentation || state.pendingExploreSights) takeIntents();
      });
      const query = searchRef.current;
      void explore.loadNow(query.trim() ? query : null);
      void locationStore.getState().requestLocation();
      return unsubscribe;
    }, [explore, takeIntents]),
  );

  // MARK: Leaving the tab

  /** What iOS's fresh SearchMapView starts with (see the file comment). */
  const startOver = useCallback(() => {
    // Read by the next focus before this render lands, so set at once.
    searchRef.current = '';
    explore.forgetSearch();
    searchInput.current?.blur();
    setMode('venues');
    setPresentation('map');
    setFiltersOpen(false);
    setFilters(NO_FILTERS);
    setSearchText('');
    setOpenedSightQuery(null);
    // A new map: the default camera and the sights layer at its default.
    setMapOpening((current) => ({ key: current.key + 1, sights: false }));
  }, [explore]);

  useEffect(() => {
    // The Explore TAB's navigation (this screen's is its stack's). Its blur
    // comes with a switch to another tab, and also with a modal over the
    // tabs (Plans, a review, the meal capture), which leaves Explore
    // selected: only the first starts over.
    const tab = navigation.getParent();
    if (!tab) return undefined;
    return tab.addListener('blur', () => {
      const state = tab.getState();
      if (state.type !== 'tab') return;
      if (state.routes[state.index]?.name === EXPLORE_TAB) return;
      startOver();
    });
  }, [navigation, startOver]);

  // MARK: The Map/List emphasis

  const kennitalaPromptPending = useAppStore((state) => state.pendingKennitalaPrompt);
  const kenniSheetOpen = useKenniSheetRequest() !== null;
  const sheetOpen = useSheetOpen();
  const appActive = useAppActive();
  const hint = useMapToggleHint(
    {
      venuesOnScreen: mode === 'venues',
      kennitalaPromptPending: kennitalaPromptPending || kenniSheetOpen,
      // A sight's card and Profile are pushed pages here: Explore loses focus.
      sheetOrPushOpen: !isFocused || sheetOpen,
      appActive,
    },
    reduceMotion,
  );

  // MARK: Actions

  const openVenue = useCallback((venue: Venue) => navigation.navigate('VenueDetail', { slug: venue.slug }), [navigation]);
  const openSight = useCallback((slug: string) => navigation.navigate('AttractionDetail', { slug }), [navigation]);

  const onChangeSearch = (text: string) => {
    setSearchText(text);
    // A new query is a new search: a sight opened from the last one no longer
    // hides this one's results.
    setOpenedSightQuery(null);
    explore.search(text);
  };

  const sightQuery = searchText.trim();
  const openSearchedSight = (slug: string) => {
    searchInput.current?.blur();
    setOpenedSightQuery(sightQuery);
    openSight(slug);
  };

  const togglePresentation = () => {
    hint.onToggleTapped();
    setPresentation((current) => (current === 'map' ? 'list' : 'map'));
  };

  const retry = () => explore.search(searchText ? searchText : null);

  // MARK: Drawing

  const venuesMode = mode === 'venues';
  const filterCount = activeFilterCount(filters);
  /** The map is what the member sees (nothing laid over it). */
  const mapOnScreen = venuesMode && !loadFailed && presentation === 'map';
  const mapProps: MapPropsWithActive = {
    venues: mapVenues,
    onOpenVenue: openVenue,
    onOpenSight: openSight,
    showSightsOnOpen: mapOpening.sights,
    bottomInset: tabBarHeight,
    active: mapOnScreen,
  };

  // One tree for both modes, every part in a fixed place (a part that is not
  // shown leaves an empty slot), so the map below keeps its place, and with
  // it its state, whatever is shown around and over it.
  return (
    <View style={styles.screen} testID="explore.screen">
      <TopBar
        title={t('explore.title')}
        subtitle={t('explore.venues_count', { count: fetched.length })}
        trailing={{ kind: 'person', onPress: () => openProfile(navigation, 'explore'), labelKey: 'a11y.open_profile' }}
        testID="explore.topBar"
      />
      {venuesMode ? (
        <SearchRow
          ref={searchInput}
          text={searchText}
          onChangeText={onChangeSearch}
          onFocus={() => setOpenedSightQuery(null)}
          presentation={presentation}
          onTogglePresentation={togglePresentation}
          hintActive={hint.active}
          hintPulse={hint.pulse}
          reduceMotion={reduceMotion}
          filtersOpen={filtersOpen}
          activeFilterCount={filterCount}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
        />
      ) : null}
      {venuesMode && filterCount > 0 ? <ClearFiltersLink onPress={() => setFilters(clearFilters())} /> : null}
      {venuesMode && filtersOpen ? (
        <FilterPanel venues={fetched} filters={filters} onChangeFilters={setFilters} mode={mode} onChangeMode={setMode} />
      ) : null}

      <View style={styles.content}>
        {venuesMode && sightQuery.length > 0 && openedSightQuery !== sightQuery ? (
          <SightsSearchGroup query={sightQuery} onOpenSight={openSearchedSight} />
        ) : null}

        <View style={styles.content}>
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={mapOnScreen ? 'auto' : 'none'}
            {...(mapOnScreen ? {} : hiddenFromAccessibility)}
            testID="explore.map"
          >
            <ExploreMap key={`map-${mapOpening.key}`} {...mapProps} />
          </View>

          {mode === 'classes' ? (
            <View key="classes" style={[StyleSheet.absoluteFill, styles.cover]}>
              <ClassesDiscovery showsModeToggle onShowVenues={() => setMode('venues')} />
            </View>
          ) : loadFailed ? (
            // Not "0 venues" on an empty map: the load failed.
            <View key="error" style={[StyleSheet.absoluteFill, styles.cover, styles.error]} testID="explore.venues.error">
              <EmptyState
                icon="cloud-offline-outline"
                message={t('venues.load_failed')}
                actionLabel={t('venue.try_again')}
                onAction={retry}
                actionIcon="retry"
              />
            </View>
          ) : presentation === 'list' ? (
            <View key="list" style={[StyleSheet.absoluteFill, styles.cover]}>
              <VenueList
                venues={listVenues}
                session={session}
                onOpenVenue={openVenue}
                visible={isFocused}
                bottomInset={tabBarHeight}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { flex: 1 },
  // Opaque, so the map under it never shows through.
  cover: { backgroundColor: colors.ink },
  error: { justifyContent: 'center' },
});
