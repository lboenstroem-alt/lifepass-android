/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Saved sheet: the port of iOS `FavouritesView`
 * (Views/Favourites/FavouritesView.swift), which the Coach drawer's "Saved"
 * presents as a full-height sheet. What it loads is ./useSavedLoad.ts (the
 * one favourites store, and `GET /venues` for the suggestions); it reloads
 * each time it is presented.
 *
 *   top bar      the wordmark, "Saved" / "Your shortlist", and the person
 *                button, which opens Profile on Bookings (`profile_opened`
 *                entry `favourites`): the person icon lands in the same place
 *                wherever it is tapped
 *   heading      "Studios & lagoons" and "{count} saved"
 *   venues       photo, name, city, the rust "♥ Saved", and a "Premium" tag
 *                for a venue outside the bundle; a row opens the venue page.
 *                Empty: "You haven't saved any venues yet." with "Find a
 *                venue", which closes the sheet and switches to Explore
 *   classes      "Saved classes", only when there are any: photo, name, the
 *                venue's name; a row opens that venue's page (by its slug)
 *   For you      "Based on where you've been": the first three venues not
 *                saved, each with its reason (./savedModel.ts), opening the
 *                venue; the heart saves it (a spinner meanwhile, one at a
 *                time, silent on a failure) and reloads, so the venue moves up
 *                into the saved list. None left: "We'll suggest venues here
 *                as you explore."
 *
 * LEAVING. A UI-kit sheet is drawn over every page, so a page opened while
 * it is up would open UNDER it. Every way out (a venue, Profile, Explore)
 * closes the sheet first and opens the page once it has gone (`onClosed`),
 * as iOS dismisses before switching tabs. iOS pushes a venue inside the sheet
 * instead; here back from the venue lands on the screen that presented the
 * sheet.
 *
 * NOT PORTED: iOS's pull to refresh. The kit's sheet scrolls its own content
 * and has no refresh control; the sheet reloads every time it opens, which
 * is what the pull was an escape hatch for.
 *
 * Mounted by whoever presents it (the Coach drawer): controlled, `visible`
 * and `onClose`, like every kit sheet.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, Kicker, LPText, Sheet, TopBar, VenueImage } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useAppNavigation } from '../../../navigation/hooks';
import { openProfile } from '../../../navigation/profile';
import { openSharedRoute } from '../../../navigation/sharedSheet';
import { useIntentStore } from '../../../stores/intentStore';
import type { Venue } from '../../../types/venue';
import { colors, hairline } from '../../../theme';
import { favouritesStore, isPremiumFavourite, type FavouriteActivity, type FavouriteVenue } from '../../favourites';

import { savedVenueIds, suggestionReason, suggestionsFor } from './savedModel';
import { useSavedLoad } from './useSavedLoad';

export interface SavedSheetProps {
  readonly visible: boolean;
  /** The member closed it (pan down, backdrop, back) or a row is leaving it: set `visible` to false. */
  readonly onClose: () => void;
}

/** iOS `lpSignal.opacity(0.12)`, the Premium tag's wash. */
const SIGNAL_WASH = 'rgba(42,77,111,0.12)';

export default function SavedSheet({ visible, onClose }: SavedSheetProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const saved = useSavedLoad();
  const [addingVenueId, setAddingVenueId] = useState<string | null>(null);
  /** What to open once the sheet has gone (see LEAVING). */
  const afterClose = useRef<(() => void) | null>(null);

  const load = saved.load;
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const leaveThen = useCallback(
    (open: () => void) => {
      afterClose.current = open;
      onClose();
    },
    [onClose],
  );

  const onClosed = useCallback(() => {
    const open = afterClose.current;
    afterClose.current = null;
    open?.();
  }, []);

  const openVenue = (slug: string) => leaveThen(() => openSharedRoute(navigation, 'VenueDetail', { slug }));

  const addSuggestion = async (venue: Venue) => {
    if (addingVenueId !== null) return;
    setAddingVenueId(venue.id);
    try {
      // Silent on a failure, as iOS: the heart simply stays un-pressed.
      const result = await favouritesStore.getState().add(venue.id, { alert: false });
      if (result !== 'failed' && result !== 'ignored') await load();
    } finally {
      setAddingVenueId(null);
    }
  };

  const suggestions = suggestionsFor(saved.allVenues, savedVenueIds(saved));

  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} fullHeight testID="saved.sheet">
      <TopBar
        title={t('saved.title')}
        subtitle={t('saved.subtitle')}
        safeAreaTop={false}
        trailing={{
          kind: 'person',
          labelKey: 'a11y.open_profile',
          onPress: () => leaveThen(() => openProfile(navigation, 'favourites')),
        }}
        testID="saved.topBar"
      />

      <View style={styles.content}>
        <View style={styles.header}>
          <LPText serif size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header">
            {t('saved.heading')}
          </LPText>
          <Kicker text={t('saved.count', { count: String(saved.venues.length) })} color={colors.paper3} testID="saved.count" />
        </View>

        {saved.venues.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState
              icon="heart-outline"
              message={t('saved.empty')}
              actionLabel={t('saved.find')}
              onAction={() => leaveThen(() => useIntentStore.getState().requestTab('Explore'))}
              testID="saved.empty"
            />
          </View>
        ) : (
          <View style={styles.list}>
            {saved.venues.map((favourite) => (
              <SavedVenueRow key={favourite.id} favourite={favourite} onOpen={() => openVenue(favourite.slug)} />
            ))}
          </View>
        )}

        {saved.activities.length > 0 ? (
          <View style={styles.classes} testID="saved.classes">
            <Kicker text={t('saved.classes')} color={colors.paper3} />
            <View style={styles.list}>
              {saved.activities.map((activity) => (
                <SavedClassRow key={activity.id} activity={activity} onOpen={() => openVenue(activity.venueSlug)} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.shelf} testID="saved.suggestions">
          <LinearGradient
            colors={[colors.ink2, colors.ink3]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.shelfKicker}>
            <Ionicons name="sparkles" size={12} color={colors.signal} accessibilityElementsHidden importantForAccessibility="no" />
            <Kicker text={t('saved.for_you')} color={colors.signal} />
          </View>
          <LPText serif size={22} tracking={-0.4} color={colors.paper} style={styles.shelfHeading} accessibilityRole="header">
            {t('saved.based_on')}
          </LPText>
          {suggestions.length === 0 ? (
            <LPText size={13} color={colors.paper3} testID="saved.suggestEmpty">
              {t('saved.suggest_empty')}
            </LPText>
          ) : (
            <View style={styles.shelfList}>
              {suggestions.map((venue) => (
                <View key={venue.id} style={styles.suggestion}>
                  <Pressable
                    onPress={() => openVenue(venue.slug)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.suggestionOpen, pressed && styles.pressed]}
                    testID={`saved.suggestion.${venue.id}`}
                  >
                    <VenueImage uri={venue.imageUrl} recyclingKey={venue.id} style={styles.suggestionImage} />
                    <View style={styles.suggestionText}>
                      <LPText size={13.5} weight="semibold" color={colors.paper}>
                        {venue.name}
                      </LPText>
                      <LPText serif italic size={11} color={colors.paper3} numberOfLines={1}>
                        {suggestionReason(venue, t)}
                      </LPText>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => void addSuggestion(venue)}
                    disabled={addingVenueId === venue.id}
                    accessibilityRole="button"
                    accessibilityLabel={t('lib1.a11y.save_venue', { name: venue.name })}
                    accessibilityState={{ disabled: addingVenueId === venue.id, busy: addingVenueId === venue.id }}
                    hitSlop={8}
                    style={({ pressed }) => [styles.heart, pressed && styles.pressed]}
                    testID={`saved.suggestion.${venue.id}.save`}
                  >
                    {addingVenueId === venue.id ? (
                      <ActivityIndicator size="small" color={colors.paper} />
                    ) : (
                      <Ionicons name="heart-outline" size={13} color={colors.paper} />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Sheet>
  );
}

function SavedVenueRow({ favourite, onOpen }: { readonly favourite: FavouriteVenue; readonly onOpen: () => void }) {
  const { t } = useT();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`saved.venue.${favourite.venueId}`}
    >
      <VenueImage uri={favourite.imageUrl} recyclingKey={favourite.venueId} style={styles.rowImage} />
      <View style={styles.rowText}>
        <LPText size={15} weight="semibold" color={colors.paper}>
          {favourite.name}
        </LPText>
        {favourite.city ? (
          <LPText size={12} color={colors.paper3}>
            {favourite.city}
          </LPText>
        ) : null}
        <View style={styles.savedMark}>
          <Ionicons name="heart" size={10} color={colors.rust2} accessibilityElementsHidden importantForAccessibility="no" />
          <LPText size={11} weight="semibold" color={colors.rust2}>
            {t('library.saved')}
          </LPText>
        </View>
      </View>
      {isPremiumFavourite(favourite) ? (
        <View style={styles.premium} testID={`saved.venue.${favourite.venueId}.premium`}>
          <LPText size={9} weight="bold" tracking={0.4} color={colors.signal}>
            {t('venue.premium')}
          </LPText>
        </View>
      ) : null}
    </Pressable>
  );
}

function SavedClassRow({ activity, onOpen }: { readonly activity: FavouriteActivity; readonly onOpen: () => void }) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`saved.class.${activity.activityId}`}
    >
      <VenueImage uri={activity.imageUrl} recyclingKey={activity.activityId} style={styles.classImage} />
      <View style={styles.rowText}>
        <LPText size={14} weight="semibold" color={colors.paper}>
          {activity.name}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {activity.venueName}
        </LPText>
      </View>
      <Ionicons name="heart" size={14} color={colors.rust2} accessibilityElementsHidden importantForAccessibility="no" />
      <Ionicons name="chevron-forward" size={11} color={colors.paper3} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 28 },
  header: { gap: 4, paddingHorizontal: 4 },
  empty: { paddingTop: 8 },
  list: { gap: 10 },
  classes: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  rowImage: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  classImage: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  rowText: { flex: 1, gap: 4 },
  savedMark: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 },
  premium: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: SIGNAL_WASH },
  shelf: {
    gap: 14,
    padding: 20,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  shelfKicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shelfHeading: { marginBottom: 4 },
  shelfList: { gap: 12 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionImage: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
  suggestionText: { flex: 1, gap: 1 },
  heart: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink3,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { opacity: 0.7 },
});
