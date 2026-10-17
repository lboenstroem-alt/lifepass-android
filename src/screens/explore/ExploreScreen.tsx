import { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VenueMap from '../../components/VenueMap';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ExploreStackParamList } from '../../navigation/types';
import { colors, fonts } from '../../theme';
import { useVenues } from '../../supabase/hooks/useVenues';
import {
  categoryFilters,
  matchesCategory,
  GYM_GROUP_IDS,
  MARTIAL_ARTS_GROUP_IDS,
  WELLNESS_GROUP_IDS,
  SPORTS_GROUP_IDS,
  PILATES_YOGA_GROUP_IDS,
  ALL_GROUP_IDS,
} from '../../data/categories';
import PricePill from '../../components/PricePill';
import Kicker from '../../components/Kicker';
import Wordmark from '../../components/Wordmark';
import type { LegacyVenue as Venue } from '../../types/venue';
import { isPremium, isBoutique } from '../../types/venue';

type Nav = NativeStackNavigationProp<ExploreStackParamList>;
type Presentation = 'map' | 'list';
// v1 access model: a venue is either inside the tier bundle ("In your plan",
// free within the monthly cap) or premium (à-la-carte surcharge). Replaces the
// old Basic/Luxury + credit-range filters — mirrors the iOS ClassFilter.
type PlanFilter = 'all' | 'inPlan' | 'premium';

const PLAN_FILTERS: { id: PlanFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inPlan', label: 'In your plan' },
  { id: 'premium', label: 'Premium' },
];

// The venue map is Mapbox (@rnmapbox/maps), rendered by components/VenueMap. It
// needs a public token at runtime (EXPO_PUBLIC_MAPBOX_TOKEN) and a download token
// at build time (MAPBOX_DOWNLOAD_TOKEN, see app.config.js). Mapbox on Android
// degrades to a blank map if the runtime token is missing rather than crashing,
// so this is safe to leave on. Set to false to hide the map toggle entirely.
const MAPS_ENABLED = true;

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { venues, loading } = useVenues();

  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // Filter rows are collapsed by default behind the "Filters" toggle (iOS parity).
  const [showFilters, setShowFilters] = useState(false);
  const [gymGroupOpen, setGymGroupOpen] = useState(false);
  const [martialArtsOpen, setMartialArtsOpen] = useState(false);
  const [wellnessOpen, setWellnessOpen] = useState(false);
  const [sportsOpen, setSportsOpen] = useState(false);
  const [pilatesYogaOpen, setPilatesYogaOpen] = useState(false);
  const [presentation, setPresentation] = useState<Presentation>('list');
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  function openVenue(venueId: string) {
    navigation.navigate('VenueDetail', { venueId });
  }

  function closeAllGroups() {
    setGymGroupOpen(false);
    setMartialArtsOpen(false);
    setWellnessOpen(false);
    setSportsOpen(false);
    setPilatesYogaOpen(false);
  }

  // Client-side filtering — venues list is small enough
  // Boutique is the venue access category (primaryCategory), not a display tag,
  // so it can't go through matchesCategory — special-case it via isBoutique.
  const catMatches = (v: Venue, filterId: string) =>
    filterId === 'boutique' ? isBoutique(v) : matchesCategory(v.category, filterId);

  const filtered = useMemo(() => {
    return venues.filter((v) => {
      if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (planFilter === 'inPlan' && !v.inBundle) return false;
      if (planFilter === 'premium' && !isPremium(v)) return false;
      if (categoryFilter && !catMatches(v, categoryFilter)) return false;
      return true;
    });
  }, [venues, search, planFilter, categoryFilter]);

  function planCount(f: PlanFilter) {
    return venues.filter((v) =>
      f === 'all' ? true : f === 'inPlan' ? v.inBundle : isPremium(v)
    ).length;
  }

  // Count of non-default filters — drives the "Filters" badge and Clear action.
  const activeFilterCount = (planFilter !== 'all' ? 1 : 0) + (categoryFilter !== null ? 1 : 0);

  function clearFilters() {
    setPlanFilter('all');
    setCategoryFilter(null);
    closeAllGroups();
  }

  function categoryCount(filterId: string) {
    return venues.filter((v) => catMatches(v, filterId)).length;
  }

  const selectedVenue = selectedVenueId
    ? venues.find((v) => v.id === selectedVenueId) ?? null
    : null;

  // Shared filter panel — rendered inline (list) or as overlay (map)
  const filterPanel = (
    <>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Wordmark height={17} />
        <View style={styles.topBarCenter}>
          <Kicker text="Explore" color={colors.paper2} />
          <Kicker text={`${filtered.length} venues`} color={colors.paper3} />
        </View>
        {/* Spacer keeps the centered label balanced now the credit pill is gone. */}
        <View style={{ width: 40 }} />
      </View>

      {/* Search + map + filters — all in one row */}
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={16} color={colors.paper3} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search venues..."
            placeholderTextColor={colors.paper3}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {MAPS_ENABLED && (
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setPresentation(presentation === 'map' ? 'list' : 'map')}
          >
            <Ionicons
              name={presentation === 'map' ? 'list-outline' : 'map-outline'}
              size={20}
              color={colors.paper}
            />
          </TouchableOpacity>
        )}

        {/* Filters — toggles the plan + category rows (iOS parity) */}
        <TouchableOpacity
          style={[styles.filterButton, (showFilters || activeFilterCount > 0) && styles.filterButtonActive]}
          onPress={() => setShowFilters((s) => !s)}
          activeOpacity={0.85}
        >
          <Ionicons
            name="options-outline"
            size={15}
            color={showFilters || activeFilterCount > 0 ? colors.ink : colors.paper2}
          />
          <Text
            style={[
              styles.filterButtonText,
              (showFilters || activeFilterCount > 0) && styles.filterButtonTextActive,
            ]}
          >
            Filters
          </Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeFilterCount > 0 && (
        <View style={styles.clearRow}>
          <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
            <Text style={styles.clearText}>Clear filters</Text>
          </TouchableOpacity>
        </View>
      )}

      {showFilters && (
        <>
      {/* Plan: All / In your plan / Premium */}
      <View style={styles.classChips}>
        {PLAN_FILTERS.map((f) => {
          const selected = planFilter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setPlanFilter(f.id)}
            >
              {f.id === 'premium' && <View style={styles.luxuryDot} />}
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.label}</Text>
              <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>
                {planCount(f.id)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Category group dropdowns + flat chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryChips}
        style={styles.categoryScroll}
      >
        {/* All */}
        <TouchableOpacity
          style={[styles.chip, !categoryFilter && styles.chipSelected]}
          onPress={() => { setCategoryFilter(null); closeAllGroups(); }}
        >
          <Text style={[styles.chipText, !categoryFilter && styles.chipTextSelected]}>All</Text>
          <Text style={[styles.chipCount, !categoryFilter && styles.chipTextSelected]}>
            {venues.length}
          </Text>
        </TouchableOpacity>

        {/* Gym & Fitness */}
        {(() => {
          const active = categoryFilter !== null && GYM_GROUP_IDS.includes(categoryFilter);
          return (
            <TouchableOpacity
              style={[styles.chip, (gymGroupOpen || active) && styles.chipSelected]}
              onPress={() => {
                const next = !gymGroupOpen;
                closeAllGroups();
                setGymGroupOpen(next);
                if (active) setCategoryFilter(null);
              }}
            >
              <Text style={[styles.chipText, (gymGroupOpen || active) && styles.chipTextSelected]}>
                Gym & Fitness
              </Text>
              <Text style={[styles.chipText, (gymGroupOpen || active) && styles.chipTextSelected]}>
                {gymGroupOpen ? ' ▲' : ' ▼'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Martial Arts */}
        {(() => {
          const active = categoryFilter !== null && MARTIAL_ARTS_GROUP_IDS.includes(categoryFilter);
          return (
            <TouchableOpacity
              style={[styles.chip, (martialArtsOpen || active) && styles.chipSelected]}
              onPress={() => {
                const next = !martialArtsOpen;
                closeAllGroups();
                setMartialArtsOpen(next);
                if (active) setCategoryFilter(null);
              }}
            >
              <Text style={[styles.chipText, (martialArtsOpen || active) && styles.chipTextSelected]}>
                Martial Arts
              </Text>
              <Text style={[styles.chipText, (martialArtsOpen || active) && styles.chipTextSelected]}>
                {martialArtsOpen ? ' ▲' : ' ▼'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Wellness */}
        {(() => {
          const active = categoryFilter !== null && WELLNESS_GROUP_IDS.includes(categoryFilter);
          return (
            <TouchableOpacity
              style={[styles.chip, (wellnessOpen || active) && styles.chipSelected]}
              onPress={() => {
                const next = !wellnessOpen;
                closeAllGroups();
                setWellnessOpen(next);
                if (active) setCategoryFilter(null);
              }}
            >
              <Text style={[styles.chipText, (wellnessOpen || active) && styles.chipTextSelected]}>
                Wellness
              </Text>
              <Text style={[styles.chipText, (wellnessOpen || active) && styles.chipTextSelected]}>
                {wellnessOpen ? ' ▲' : ' ▼'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Sports */}
        {(() => {
          const active = categoryFilter !== null && SPORTS_GROUP_IDS.includes(categoryFilter);
          return (
            <TouchableOpacity
              style={[styles.chip, (sportsOpen || active) && styles.chipSelected]}
              onPress={() => {
                const next = !sportsOpen;
                closeAllGroups();
                setSportsOpen(next);
                if (active) setCategoryFilter(null);
              }}
            >
              <Text style={[styles.chipText, (sportsOpen || active) && styles.chipTextSelected]}>
                Sports
              </Text>
              <Text style={[styles.chipText, (sportsOpen || active) && styles.chipTextSelected]}>
                {sportsOpen ? ' ▲' : ' ▼'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Pilates & Yoga */}
        {(() => {
          const active = categoryFilter !== null && PILATES_YOGA_GROUP_IDS.includes(categoryFilter);
          return (
            <TouchableOpacity
              style={[styles.chip, (pilatesYogaOpen || active) && styles.chipSelected]}
              onPress={() => {
                const next = !pilatesYogaOpen;
                closeAllGroups();
                setPilatesYogaOpen(next);
                if (active) setCategoryFilter(null);
              }}
            >
              <Text style={[styles.chipText, (pilatesYogaOpen || active) && styles.chipTextSelected]}>
                Pilates & Yoga
              </Text>
              <Text style={[styles.chipText, (pilatesYogaOpen || active) && styles.chipTextSelected]}>
                {pilatesYogaOpen ? ' ▲' : ' ▼'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Remaining ungrouped categories */}
        {categoryFilters
          .filter((f) => !ALL_GROUP_IDS.includes(f.id))
          .map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => { setCategoryFilter(selected ? null : f.id); closeAllGroups(); }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {f.displayName}
                </Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>
                  {categoryCount(f.id)}
                </Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      {/* Sub-row — Gym & Fitness */}
      {gymGroupOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChips} style={styles.gymSubRow}>
          {categoryFilters.filter((f) => GYM_GROUP_IDS.includes(f.id)).map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity key={f.id}
                style={[styles.chip, styles.chipSub, selected && styles.chipSubSelected]}
                onPress={() => setCategoryFilter(selected ? null : f.id)}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.displayName}</Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{categoryCount(f.id)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Sub-row — Martial Arts */}
      {martialArtsOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChips} style={styles.gymSubRow}>
          {categoryFilters.filter((f) => MARTIAL_ARTS_GROUP_IDS.includes(f.id)).map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity key={f.id}
                style={[styles.chip, styles.chipSub, selected && styles.chipSubSelected]}
                onPress={() => setCategoryFilter(selected ? null : f.id)}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.displayName}</Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{categoryCount(f.id)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Sub-row — Wellness */}
      {wellnessOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChips} style={styles.gymSubRow}>
          {categoryFilters.filter((f) => WELLNESS_GROUP_IDS.includes(f.id)).map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity key={f.id}
                style={[styles.chip, styles.chipSub, selected && styles.chipSubSelected]}
                onPress={() => setCategoryFilter(selected ? null : f.id)}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.displayName}</Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{categoryCount(f.id)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Sub-row — Sports */}
      {sportsOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChips} style={styles.gymSubRow}>
          {categoryFilters.filter((f) => SPORTS_GROUP_IDS.includes(f.id)).map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity key={f.id}
                style={[styles.chip, styles.chipSub, selected && styles.chipSubSelected]}
                onPress={() => setCategoryFilter(selected ? null : f.id)}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.displayName}</Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{categoryCount(f.id)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Sub-row — Pilates & Yoga */}
      {pilatesYogaOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryChips} style={styles.gymSubRow}>
          {categoryFilters.filter((f) => PILATES_YOGA_GROUP_IDS.includes(f.id)).map((f) => {
            const selected = categoryFilter === f.id;
            return (
              <TouchableOpacity key={f.id}
                style={[styles.chip, styles.chipSub, selected && styles.chipSubSelected]}
                onPress={() => setCategoryFilter(selected ? null : f.id)}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.displayName}</Text>
                <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{categoryCount(f.id)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
        </>
      )}
    </>
  );

  if (MAPS_ENABLED && presentation === 'map') {
    // Full-screen map — tiles bleed edge to edge behind the status bar.
    // The filter overlay sits on top and pushes its own content below the notch.
    return (
      <View style={styles.mapFull}>
        <VenueMap
          venues={filtered}
          selectedVenueId={selectedVenueId}
          onSelect={setSelectedVenueId}
        />

        {/* Filter panel floats over the map, padded below the notch */}
        <View style={[styles.mapOverlay, { paddingTop: insets.top }]}>
          {filterPanel}
        </View>

        {selectedVenue && (
          <TouchableOpacity
            style={styles.venuePopup}
            activeOpacity={0.85}
            onPress={() => openVenue(selectedVenue.id)}
          >
            <Image source={{ uri: selectedVenue.imageUrl }} style={styles.popupImage} />
            <View style={styles.popupInfo}>
              <Text style={styles.popupName} numberOfLines={1}>{selectedVenue.name}</Text>
              <Text style={styles.popupCity}>{selectedVenue.city}</Text>
            </View>
            <PricePill venue={selectedVenue} compact />
            <Text style={styles.popupArrow}>→</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {loading ? (
        <>
          {filterPanel}
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.blue} />
          </View>
        </>
      ) : (
        // LIST MODE — filter panel stacked above the list
        <>
          {filterPanel}
          <FlatList
            data={filtered}
            keyExtractor={(v) => v.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={<EditorialBanner />}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={0.85} onPress={() => openVenue(item.id)}>
                <ExploreListRow venue={item} />
              </TouchableOpacity>
            )}
            ListFooterComponent={<View style={{ height: 120 }} />}
          />
        </>
      )}
    </View>
  );
}

function EditorialBanner() {
  const player = useVideoPlayer(
    require('../../../assets/lp-video-search-page.mp4'),
    (p) => {
      p.loop = true;
      p.muted = true;
      p.play();
    }
  );
  return (
    <View style={bannerStyles.container}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <LinearGradient
        colors={['rgba(15,23,42,0.05)', 'rgba(15,23,42,0.85)']}
        locations={[0.3, 1.0]}
        style={StyleSheet.absoluteFill}
      />
      <View style={bannerStyles.copy}>
        <Kicker text="Feel Great Everyday" color="#A8D8F0" />
        <Text style={bannerStyles.title}>
          Gym, Spa, Pool, Lagoon-{' '}
          <Text style={bannerStyles.italic}> all at one pass</Text>
        </Text>
      </View>
    </View>
  );
}

function ExploreListRow({ venue }: { venue: Venue }) {
  return (
    <View style={rowStyles.row}>
      <Image source={{ uri: venue.imageUrl }} style={rowStyles.image} />
      <View style={rowStyles.info}>
        <View style={rowStyles.nameRow}>
          {venue.classification === 'luxury' && <View style={rowStyles.luxuryDot} />}
          <Text style={rowStyles.name}>{venue.name}</Text>
        </View>
        <Text style={rowStyles.city}>
          {venue.city}{venue.walkInsAllowed ? ' · Walk-ins' : ''}
        </Text>
        {venue.category.length > 0 && (
          <View style={rowStyles.chips}>
            {venue.category.slice(0, 2).map((cat) => (
              <View key={cat} style={rowStyles.chip}>
                <Text style={rowStyles.chipText}>{cat}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <PricePill venue={venue} compact />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 8,
    backgroundColor: colors.ink,
  },
  topBarCenter: { alignItems: 'center', gap: 2 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
  },
  clearRow: { alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 8 },
  filterButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 44, paddingHorizontal: 14,
    backgroundColor: colors.ink2, borderRadius: 999,
    borderWidth: 1, borderColor: colors.line,
  },
  filterButtonActive: { backgroundColor: colors.paper, borderColor: colors.paper },
  filterButtonText: { fontSize: 12.5, fontWeight: '600', color: colors.paper2, letterSpacing: -0.1 },
  filterButtonTextActive: { color: colors.ink },
  filterBadge: {
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  clearText: { fontSize: 12, fontWeight: '500', color: colors.blue },
  searchField: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 44, paddingHorizontal: 14,
    backgroundColor: colors.ink2, borderRadius: 12,
    borderWidth: 0.5, borderColor: colors.line,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.paper },
  toggleButton: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.ink2, borderRadius: 12,
    borderWidth: 0.5, borderColor: colors.line,
  },
  classChips: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingBottom: 4 },
  categoryScroll: { minHeight: 44, marginBottom: 4 },
  // Center chips vertically and let the row grow with the chip height (a fixed
  // height clipped taller chips — e.g. with a larger system font — in half).
  categoryChips: { paddingHorizontal: 20, paddingVertical: 4, gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.ink2, borderRadius: 999,
    borderWidth: 1, borderColor: colors.line,
  },
  chipSelected: { backgroundColor: colors.paper, borderColor: colors.paper },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.paper2, letterSpacing: -0.1 },
  chipTextSelected: { color: colors.ink },
  chipCount: { fontSize: 11, color: colors.paper3, opacity: 0.8 },
  luxuryDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.skyBlue },
  gymSubRow: { minHeight: 44, marginBottom: 4 },
  chipSub: {},
  chipSubSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Full-screen map root — no safe-area padding, tiles bleed to all edges
  mapFull: { flex: 1 },
  mapOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.ink,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.line,
  },
  venuePopup: {
    position: 'absolute', bottom: 120, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: colors.ink2,
    borderRadius: 14, borderWidth: 0.5, borderColor: colors.line2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  popupImage: { width: 56, height: 56, borderRadius: 8 },
  popupInfo: { flex: 1 },
  popupName: { fontSize: 14, fontWeight: '600', color: colors.paper },
  popupCity: { fontSize: 12, color: colors.paper3 },
  popupArrow: { fontSize: 14, color: colors.paper3 },
  list: { paddingTop: 6, paddingHorizontal: 20 },
});

const bannerStyles = StyleSheet.create({
  container: { height: 180, borderRadius: 16, overflow: 'hidden', marginBottom: 16, justifyContent: 'flex-end' },
  image: { ...StyleSheet.absoluteFillObject },
  copy: { padding: 16, gap: 4 },
  // Sits over the dark hero video, so the title stays light.
  title: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '400', color: '#F1F5F9', letterSpacing: -0.4 },
  italic: { fontFamily: fonts.serifItalic, fontStyle: 'italic' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 10, backgroundColor: colors.ink2,
    borderRadius: 14, borderWidth: 0.5, borderColor: colors.line,
  },
  image: { width: 88, height: 88, borderRadius: 10 },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  luxuryDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.skyBlue },
  name: { fontSize: 15, fontWeight: '600', color: colors.paper },
  city: { fontSize: 12, color: colors.paper3 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 2 },
  chip: { backgroundColor: colors.ink3, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: '500', color: colors.paper2, letterSpacing: 0.3 },
});
