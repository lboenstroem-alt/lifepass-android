/* eslint lifepass/no-literal-copy: "error" */
/**
 * Profile's Saved half: the port of iOS `FavouritesContentView`
 * (Views/Profile/LibraryView.swift). What it loads is ./useSavedLoad.ts.
 *
 *   "Your spots" and "{count} saved"
 *   the saved venues: photo, name, city and the rust "♥ Saved"; a row opens
 *     the venue page. Empty: "No saved venues yet." with "Find venues",
 *     which leaves Profile and switches to Explore
 *   "For you": the first three venues not saved (./savedModel.ts), each
 *     opening its venue; its heart saves it and the half reloads
 *
 * ANDROID EXTRA (owner decision D4): each saved row keeps a filled heart that
 * unsaves the venue, as the first Android build had. The favourites store
 * takes it off the list at once and puts it back with the "Heads up" alert
 * if the server refuses. iOS rows have no unsave; the venue page's heart does
 * the same there.
 *
 * The suggestion heart fails silently, as iOS's `try?` does: the half reloads
 * either way and the venue simply stays a suggestion.
 *
 * HIKES AND SIGHTS (API 0.45.0): under the venues, Favourites' third section
 * (./SavedSightsSection.tsx), the places saved with a sight's heart; a row
 * opens the place's card.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EmptyState, Kicker, LPText, VenueImage } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { Venue } from '../../../types/venue';
import { favouritesStore, type FavouriteVenue } from '../../favourites';
import { colors, hairline } from '../../../theme';

import { savedVenueIds, suggestionCategory, suggestionsFor } from './savedModel';
import SavedSightsSection from './SavedSightsSection';
import type { SavedLoad } from './useSavedLoad';

export interface SavedTabProps {
  readonly saved: SavedLoad;
  readonly onOpenVenue: (slug: string) => void;
  /** Opens a saved hike's or sight's card. */
  readonly onOpenSight: (slug: string) => void;
  /** Leave Profile, then Explore's map with the sights showing ("Find hikes and sights"). */
  readonly onFindSights: () => void;
  /** Leave Profile, then switch to Explore ("Find venues"). */
  readonly onFindVenues: () => void;
  /** Room under the list for the floating tab bar. */
  readonly bottomSpace: number;
}

export default function SavedTab({ saved, onOpenVenue, onOpenSight, onFindSights, onFindVenues, bottomSpace }: SavedTabProps) {
  const { t } = useT();
  const suggestions = saved.allVenues.length > 0 ? suggestionsFor(saved.allVenues, savedVenueIds(saved)) : [];

  const saveSuggestion = async (venue: Venue) => {
    await favouritesStore.getState().add(venue.id, { alert: false });
    await saved.load();
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }]}
      testID="library.saved.scroll"
    >
      <View style={styles.header}>
        <LPText size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header">
          {t('library.your_spots')}
        </LPText>
        <Kicker
          text={t('library.saved_count', { count: String(saved.venues.length) })}
          color={colors.paper3}
          testID="library.saved.count"
        />
      </View>

      {saved.venues.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          message={t('library.no_saved')}
          actionLabel={t('library.find_venues')}
          onAction={onFindVenues}
          testID="library.saved.empty"
        />
      ) : (
        <View style={styles.list}>
          {saved.venues.map((favourite) => (
            <SavedVenueRow
              key={favourite.id}
              favourite={favourite}
              onOpen={() => onOpenVenue(favourite.slug)}
              onUnsave={() => void favouritesStore.getState().remove(favourite.venueId)}
            />
          ))}
        </View>
      )}

      <SavedSightsSection
        attractions={saved.attractions}
        loading={saved.favouritesLoading}
        onOpenSight={onOpenSight}
        onFindSights={onFindSights}
        testID="library.sights"
      />

      {suggestions.length > 0 ? (
        <View style={styles.shelf} testID="library.suggestions">
          <View style={styles.shelfKicker}>
            <Ionicons name="sparkles" size={12} color={colors.aurora} accessibilityElementsHidden importantForAccessibility="no" />
            <Kicker text={t('library.for_you')} color={colors.aurora} />
          </View>
          <LPText size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header">
            {t('library.based_on_saved')}
          </LPText>
          <View style={styles.shelfList}>
            {suggestions.map((venue) => (
              <View key={venue.id} style={styles.suggestion}>
                <Pressable
                  onPress={() => onOpenVenue(venue.slug)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestionOpen, pressed && styles.pressed]}
                  testID={`library.suggestion.${venue.id}`}
                >
                  <VenueImage uri={venue.imageUrl} recyclingKey={venue.id} style={styles.suggestionImage} />
                  <View style={styles.suggestionText}>
                    <LPText size={13.5} weight="semibold" color={colors.paper}>
                      {venue.name}
                    </LPText>
                    <LPText size={11} italic color={colors.paper3}>
                      {suggestionCategory(venue, t)}
                    </LPText>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void saveSuggestion(venue)}
                  accessibilityRole="button"
                  accessibilityLabel={t('lib1.a11y.save_venue', { name: venue.name })}
                  hitSlop={10}
                  style={({ pressed }) => [styles.suggestionHeart, pressed && styles.pressed]}
                  testID={`library.suggestion.${venue.id}.save`}
                >
                  <Ionicons name="heart-outline" size={13} color={colors.paper3} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function SavedVenueRow({
  favourite,
  onOpen,
  onUnsave,
}: {
  readonly favourite: FavouriteVenue;
  readonly onOpen: () => void;
  readonly onUnsave: () => void;
}) {
  const { t } = useT();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        style={({ pressed }) => [styles.rowOpen, pressed && styles.pressed]}
        testID={`library.saved.${favourite.venueId}`}
      >
        <VenueImage uri={favourite.imageUrl} recyclingKey={favourite.venueId} style={styles.rowImage} />
        <View style={styles.rowText}>
          <LPText size={15} weight="semibold" color={colors.paper}>
            {favourite.name}
          </LPText>
          <LPText size={12} color={colors.paper3}>
            {favourite.city ?? ''}
          </LPText>
          <View style={styles.savedMark}>
            <Ionicons name="heart" size={10} color={colors.rust} accessibilityElementsHidden importantForAccessibility="no" />
            <LPText size={11} weight="semibold" color={colors.rust}>
              {t('library.saved')}
            </LPText>
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onUnsave}
        accessibilityRole="button"
        accessibilityLabel={t('lib1.a11y.unsave_venue', { name: favourite.name })}
        hitSlop={8}
        style={({ pressed }) => [styles.unsave, pressed && styles.pressed]}
        testID={`library.saved.${favourite.venueId}.unsave`}
      >
        <Ionicons name="heart" size={14} color={colors.rust2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 28 },
  header: { gap: 4, paddingHorizontal: 4 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  rowOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowImage: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  rowText: { flex: 1, gap: 4 },
  savedMark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unsave: {
    width: 32,
    height: 32,
    marginLeft: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink3,
  },
  shelf: {
    gap: 14,
    padding: 20,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  shelfKicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shelfList: { gap: 12 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionImage: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
  suggestionText: { flex: 1, gap: 2 },
  suggestionHeart: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
