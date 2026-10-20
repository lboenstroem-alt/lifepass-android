/* eslint lifepass/no-literal-copy: "error" */
/**
 * A venue's page, by slug (route `VenueDetail`, plan 3.0.2): the Android port
 * of iOS `VenueDetailView` (Views/Venues/VenueDetailView.swift).
 *
 * Reached from Explore's list and map, Home, Saved, the Coach's venue card,
 * Plan, a booking refusal's "Book a time" and an attraction's pairing, always
 * pushed onto the current tab's stack (or the shared sheet over a modal), so
 * the tab bar stays under it as on iOS.
 *
 * The page, top to bottom:
 *   - the hero (./components/Hero.tsx), drawn from the very top of the screen
 *     under the status bar, with back, the favourite heart and share;
 *   - the rating (opens the reviews) and Directions, the description in the
 *     account language, the amenity chips;
 *   - the content state: coming soon, walk-ins and/or bookable classes, or
 *     "Bookings not yet available" (./components/ActivitiesBlock.tsx);
 *   - this week's hours (only with hours), "Getting there" (only with an
 *     address, a phone or a position), the newest reviews;
 *   - the floating bar above the tab bar (./components/FloatingBar.tsx);
 *   - a band behind the status bar that fades in once the hero's title has
 *     scrolled up to it, so text never passes unbacked under the clock.
 *
 * While loading: a spinner. A failed load with no venue: the reason, or "Could
 * not load venue details.", and "Try again". A failure after the venue loaded
 * (its reviews): the "Heads up" alert, the page staying as it is, shown only
 * while the page is the one in front.
 *
 * Coming back to the page (from a booking, the scanner, a plan bought from a
 * refusal, another tab) reads it again, as iOS's `.task` does on reappear, so
 * the prices the server works out for the member are current. Coming back
 * from the reviews page reads only the reviews, since only they can have
 * changed there.
 *
 * Process death: the page holds nothing a restart must restore; it reloads
 * from its slug, which the navigation state keeps.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Share,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dialog, LPText, PrimaryButton, type DialogButton } from '../../components/ui';
import { useFavourite } from '../favourites';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import type { BookableActivity } from '../../api/walkInPreview';
import { venueDetailTarget, type SharedRouteProps } from '../../navigation/types';
import { colors } from '../../theme';
import type { Venue } from '../../types/venue';
import ActivitiesBlock from './components/ActivitiesBlock';
import { AmenitiesBlock, DescriptionBlock, MetaRow } from './components/Details';
import FloatingBar, { BAR_HEIGHT } from './components/FloatingBar';
import Hero from './components/Hero';
import { GettingThereBlock, OpeningHoursBlock } from './components/InfoBlocks';
import ReviewsBlock from './components/ReviewsBlock';
import { BAR_MATERIAL } from './components/shared';
import { openInGoogleMaps, openInOtherMapsApp } from './directions';
import { HERO_HEIGHT, STATUS_BAND_FADE, statusBarBandFullAt, venueShareMessage } from './model';
import { useVenueDetail, venueTargetKey, type VenueTarget } from './useVenueDetail';

/** The gap between the floating bar and the tab bar (iOS: 110 pt from the bottom, over a 96 pt bar). */
const BAR_GAP = 14;
/** Room under the last block beyond the bar itself, so the last review clears it. */
const CONTENT_TAIL = 34;
/** The failed and loading blocks' height (iOS `.frame(height: 400)`). */
const STATE_BLOCK_HEIGHT = 400;
/** "Book a class" puts the list a tenth of the way down the screen (iOS anchor y 0.1). */
const CLASSES_ANCHOR = 0.1;

export default function VenueDetailScreen({ navigation, route }: SharedRouteProps<'VenueDetail'>) {
  const params = route.params;
  // A first-build caller may still pass `{ venueId }` (looked up, ./resolveSlug.ts).
  const target = useMemo<VenueTarget>(() => venueDetailTarget(params), [params]);
  const targetKey = venueTargetKey(target);
  const model = useVenueDetail(target);
  const { refresh, reloadReviews } = model;
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; in the shared sheet there is none (the
  // layout then answers the system bar's inset). Outside both, nothing.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const reduceMotion = useReduceMotion();

  // The page always starts under the status bar on an edge-to-edge Android
  // screen, pushed or in the shared sheet, so the whole inset is covered.
  const coveredTop = insets.top;
  const barBottom = Math.max(tabBarHeight, insets.bottom) + BAR_GAP;

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const geometry = useRef({ viewport: 0, activities: 0, classes: 0 });
  // 420 as designed; taller only when large text grows the hero.
  const [heroHeight, setHeroHeight] = useState(HERO_HEIGHT);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // Whether this page is the one in front; the "Heads up" alert waits for it.
  const [isFocused, setIsFocused] = useState(() => navigation.isFocused());
  // The member left the page (another screen or tab came in front of it). A
  // page restored under another screen has not been seen yet: its first
  // focus is a return.
  const left = useRef(!isFocused);
  // iOS reloads the reviews when the reviews page reports a new one; here the
  // page reads them again when the member comes back from the reviews page.
  const reviewsOpened = useRef(false);
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => {
      left.current = true;
      setIsFocused(false);
    });
    const offFocus = navigation.addListener('focus', () => {
      setIsFocused(true);
      // The first focus is the arrival: the page's own load is running.
      if (!left.current) return;
      left.current = false;
      if (reviewsOpened.current) {
        reviewsOpened.current = false;
        reloadReviews();
        return;
      }
      refresh();
    });
    setIsFocused(navigation.isFocused());
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation, refresh, reloadReviews]);

  // Another venue in the same screen (params swapped in place) starts at its
  // top, with nothing measured or opened for the previous one.
  const shownTarget = useRef(targetKey);
  useEffect(() => {
    if (shownTarget.current === targetKey) return;
    shownTarget.current = targetKey;
    geometry.current = { viewport: geometry.current.viewport, activities: 0, classes: 0 };
    reviewsOpened.current = false;
    setDirectionsOpen(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [targetKey]);

  const venue = model.venue;

  const openReviews = useCallback(() => {
    if (!venue) return;
    reviewsOpened.current = true;
    navigation.navigate('VenueReviews', { venueId: venue.id, venueName: venue.name });
  }, [navigation, venue]);

  const book = useCallback(
    (activity: BookableActivity) => {
      if (!venue) return;
      navigation.navigate('BookingFlow', {
        venueId: venue.id,
        activity: { id: activity.id, name: activity.name, provider: activity.provider },
      });
    },
    [navigation, venue],
  );

  // Pushed, so the scanner shows the way back to this venue.
  const scan = useCallback(() => {
    if (venue) navigation.navigate('ScanPushed', { fromVenueSlug: venue.slug });
  }, [navigation, venue]);

  const scrollToClasses = useCallback(() => {
    const { viewport, activities, classes } = geometry.current;
    const y = heroHeight + activities + classes - viewport * CLASSES_ANCHOR;
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: !reduceMotion });
  }, [heroHeight, reduceMotion]);

  const share = useCallback(() => {
    if (!venue) return;
    Share.share({ message: venueShareMessage(venue, t), title: venue.name }, { dialogTitle: venue.name }).catch(() => {
      // The member closed the sheet, or no app could take it: nothing to say.
    });
  }, [t, venue]);

  const call = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      // No dialler (a tablet): the number is on the page to copy.
    });
  }, []);

  const directionsButtons: DialogButton[] = venue
    ? [
        { label: t('venue.maps_google'), onPress: () => void openInGoogleMaps(venue), testID: 'venue.directions.google' },
        { label: t('venue.page.maps_other'), onPress: () => void openInOtherMapsApp(venue), testID: 'venue.directions.other' },
        { label: t('common.cancel'), role: 'cancel' },
      ]
    : [];

  const fullAt = statusBarBandFullAt(coveredTop, heroHeight);
  const bandOpacity = scrollY.interpolate({
    inputRange: [fullAt - STATUS_BAND_FADE, fullAt],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.page} testID="venue.page">
      <Animated.ScrollView
        ref={scrollRef}
        testID="venue.scroll"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        onLayout={(event: LayoutChangeEvent) => {
          geometry.current.viewport = event.nativeEvent.layout.height;
        }}
        contentContainerStyle={venue && !model.isLoading ? { paddingBottom: barBottom + BAR_HEIGHT + CONTENT_TAIL } : null}
      >
        {model.isLoading ? (
          <View style={styles.stateBlock} accessibilityLabel={t('a11y.loading')} accessible testID="venue.loading">
            <ActivityIndicator color={colors.rust} />
          </View>
        ) : venue ? (
          <>
            <VenueHero
              venue={venue}
              topInset={coveredTop}
              onBack={() => navigation.goBack()}
              onShare={share}
              onHeight={setHeroHeight}
            />
            <View style={styles.content}>
              <MetaRow venue={venue} onOpenReviews={openReviews} onDirections={() => setDirectionsOpen(true)} />
              <DescriptionBlock venue={venue} />
              <AmenitiesBlock venue={venue} />
              <View
                onLayout={(event: LayoutChangeEvent) => {
                  geometry.current.activities = event.nativeEvent.layout.y;
                }}
              >
                <ActivitiesBlock
                  venue={venue}
                  slotActivities={model.slotActivities}
                  onBook={book}
                  onCall={call}
                  onClassesLayout={(y) => {
                    geometry.current.classes = y;
                  }}
                />
              </View>
              <OpeningHoursBlock venue={venue} />
              <GettingThereBlock venue={venue} onDirections={() => setDirectionsOpen(true)} />
              <ReviewsBlock reviews={model.reviews} onOpenReviews={openReviews} />
            </View>
          </>
        ) : (
          <LoadFailed message={model.error ?? t('venue.could_not_load')} onRetry={model.load} />
        )}
      </Animated.ScrollView>

      {venue && !model.isLoading ? (
        <View style={[styles.bar, { bottom: barBottom }]} pointerEvents="box-none">
          <FloatingBar
            venue={venue}
            slotActivities={model.slotActivities}
            onScan={scan}
            onBookAClass={scrollToClasses}
            onBook={book}
          />
        </View>
      ) : null}

      {coveredTop > 0 && venue && !model.isLoading ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.band, { height: coveredTop, opacity: bandOpacity }]}
          testID="venue.status_band"
        />
      ) : null}

      <Dialog
        visible={directionsOpen && venue !== null}
        onClose={() => setDirectionsOpen(false)}
        presentation="actionSheet"
        title={t('venue.get_directions')}
        buttons={directionsButtons}
        testID="venue.directions"
      />
      <Dialog
        visible={isFocused && model.error !== null && venue !== null && !model.isLoading}
        onClose={model.clearError}
        title={t('common.heads_up')}
        message={model.error ?? undefined}
        buttons={[{ label: t('common.ok'), onPress: model.clearError }]}
        testID="venue.heads_up"
      />
    </View>
  );
}

/** The hero with the venue's heart, read from the shared favourites store. */
function VenueHero({
  venue,
  topInset,
  onBack,
  onShare,
  onHeight,
}: {
  readonly venue: Venue;
  readonly topInset: number;
  readonly onBack: () => void;
  readonly onShare: () => void;
  readonly onHeight: (height: number) => void;
}) {
  const favourite = useFavourite(venue.id);
  const toggle = favourite.toggle;
  const onToggleFavourite = useCallback(() => {
    // The store flips the heart at once, reverts it and says so on a failure
    // (VENUE-2); nothing for the page to add.
    toggle().catch(() => undefined);
  }, [toggle]);
  return (
    <Hero
      venue={venue}
      topInset={topInset}
      isFavourite={favourite.isFavourite}
      onBack={onBack}
      onToggleFavourite={onToggleFavourite}
      onShare={onShare}
      onHeight={onHeight}
    />
  );
}

/** No venue: the reason and "Try again" (iOS loadFailedState). */
function LoadFailed({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  const { t } = useT();
  return (
    <View style={[styles.stateBlock, styles.failed]} testID="venue.load_failed">
      <MaterialCommunityIcons name="wifi-alert" size={40} color={colors.paper3} />
      <LPText size={14} color={colors.paper3} align="center" style={styles.failedText}>
        {message}
      </LPText>
      <PrimaryButton title={t('venue.try_again')} block={false} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 28 },
  stateBlock: { height: STATE_BLOCK_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  failed: { gap: 16 },
  failedText: { paddingHorizontal: 32 },
  bar: { position: 'absolute', left: 20, right: 20 },
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: BAR_MATERIAL,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
