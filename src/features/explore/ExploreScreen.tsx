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
// The location never leaves the phone: the list is ordered on it here.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { EmptyState, TopBar, useSheetOpen } from '../../components/ui';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import { interleaveByBrand } from '../../lib/browseOrder';
import { coordinateOf } from '../../lib/geo';
import { useAppNavigation } from '../../navigation/hooks';
import { openProfile } from '../../navigation/profile';
import { useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { locationStore } from '../../stores/locationStore';
import { useOrderedVenues, useVenueList } from '../../stores/venuesStore';
import { colors } from '../../theme';
import type { Venue } from '../../types/venue';
import SightsSearchGroup from '../attractions/SightsSearchGroup';
import ClassesDiscovery from '../classes/ClassesDiscovery';
import { useKenniSheetRequest } from '../kenni';
import type { ExploreMode } from './ExploreModeToggle';
import { exploreVenues as defaultExploreVenues, type ExploreVenues } from './exploreVenues';
import FilterPanel from './FilterPanel';
import { activeFilterCount, applyFilters, clearFilters, NO_FILTERS, type ExploreFilters } from './filters';
import LocationDeniedBanner from './LocationDeniedBanner';
import ExploreMap from './map/ExploreMap';
import { useMapToggleHint } from './mapToggleHint';
import SearchRow, { type Presentation } from './SearchRow';
import ClearFiltersLink from './ClearFiltersLink';
import { useAppActive } from './useAppActive';
import VenueList from './VenueList';

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
  // Home's "See all on the map": the map mounts afresh (`sightsRequest` keys
  // it) with the sights and all of Iceland in view, until the member moves on.
  const [sightsRequest, setSightsRequest] = useState(0);
  const [sightsOnOpen, setSightsOnOpen] = useState(false);

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
      setSightsOnOpen(true);
      setSightsRequest((count) => count + 1);
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
    setSightsOnOpen(false);
    setPresentation((current) => (current === 'map' ? 'list' : 'map'));
  };

  const changeMode = (next: ExploreMode) => {
    setSightsOnOpen(false);
    setMode(next);
  };

  const retry = () => explore.search(searchText ? searchText : null);

  // MARK: Drawing

  const topBar = (
    <TopBar
      title={t('explore.title')}
      subtitle={t('explore.venues_count', { count: fetched.length })}
      trailing={{ kind: 'person', onPress: () => openProfile(navigation, 'explore'), labelKey: 'a11y.open_profile' }}
      testID="explore.topBar"
    />
  );

  if (mode === 'classes') {
    return (
      <View style={styles.screen} testID="explore.screen">
        {topBar}
        <View style={styles.content}>
          <ClassesDiscovery showsModeToggle onShowVenues={() => changeMode('venues')} />
        </View>
      </View>
    );
  }

  const filterCount = activeFilterCount(filters);

  return (
    <View style={styles.screen} testID="explore.screen">
      {topBar}
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
      {filterCount > 0 ? <ClearFiltersLink onPress={() => setFilters(clearFilters())} /> : null}
      {filtersOpen ? (
        <FilterPanel venues={fetched} filters={filters} onChangeFilters={setFilters} mode={mode} onChangeMode={changeMode} />
      ) : null}

      <View style={styles.content}>
        {sightQuery.length > 0 && openedSightQuery !== sightQuery ? (
          <SightsSearchGroup query={sightQuery} onOpenSight={openSearchedSight} />
        ) : null}

        {loadFailed ? (
          // Not "0 venues" on an empty map: the load failed.
          <View style={styles.error} testID="explore.venues.error">
            <EmptyState
              icon="cloud-offline-outline"
              message={t('venues.load_failed')}
              actionLabel={t('venue.try_again')}
              onAction={retry}
              actionIcon="retry"
            />
          </View>
        ) : presentation === 'map' ? (
          <View style={styles.content} testID="explore.map">
            <ExploreMap
              key={`map-${sightsRequest}`}
              venues={mapVenues}
              onOpenVenue={openVenue}
              onOpenSight={openSight}
              showSightsOnOpen={sightsOnOpen}
              bottomInset={tabBarHeight}
            />
            {/* EXPL-2: the map's overlay stack places this banner under its
                legend (plan EXPL-2 milestone 3). Until then it sits over the
                top of the map; remove this block once the map draws it. */}
            <View style={styles.bannerOverlay} pointerEvents="box-none">
              <LocationDeniedBanner />
            </View>
          </View>
        ) : (
          <VenueList
            venues={listVenues}
            session={session}
            onOpenVenue={openVenue}
            visible={isFocused}
            bottomInset={tabBarHeight}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { flex: 1 },
  error: { flex: 1, justifyContent: 'center' },
  bannerOverlay: { position: 'absolute', top: 8, left: 20, right: 20 },
});
