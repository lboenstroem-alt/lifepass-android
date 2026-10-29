// The Home tab: the Android port of iOS `HomeView` (Views/Home/HomeView.swift).
//
// Top to bottom, as iOS draws it:
//   - the staff-proof banner after a recent check-in (CHECKIN-1's);
//   - the hero (a featured venue's photo, the avatar, the pass chip, the
//     weather, the greeting and the upcoming card), or a 260 dp header while
//     there are no venues;
//   - today's plan row (PLAN-2's slot);
//   - "Want to try something new?", which needs no venue data and renders
//     while the shelves load;
//   - "Get offers by email" until the member answers it (./offersCard: the
//     website dashboard's card, owner 29 Oct 2026, "Card in the apps"), the
//     referral card, "A short walk from here", the Outside card (ATTR-1's
//     slot), "Most Popular Now", and the spinner or the error state while
//     there are no venues.
//
// WHEN IT READS. iOS rebuilds Home at every tab switch and re-runs its reads
// whenever it appears (also coming back from a pushed page). Android keeps the
// screen mounted, so at every focus it reads the venues, the weather, the
// bookings and the profile again (the spinner only shows while there are no
// venues at all). The featured venue rolls again for every new tab visit
// (./useHomeVisit.ts), at the moment Home is left, so a visit never opens on
// the last one's hero; a page pushed on Home or a modal over the tabs keeps
// it. A pull to refresh reads the venues (the hero holds still), then the
// bookings and the profile. Both tell the cards other packages draw here to
// read again too (the Outside card's sights, ./homeReads.ts).
//
// THE KEYBOARD. The page keeps the Coach ask field above the keyboard
// (./useKeyboardLift.ts: the app is edge to edge, so the window never
// shrinks for it), and puts the keyboard away on a drag or a tap elsewhere.
//
// WHERE TAPS GO. Profile (the avatar, the person button, "View") is pushed on
// Home's own stack; so are a venue and Account (the referral card). The Coach,
// Explore and Plan are tabs: Home parks what it wants (a Coach prompt, a Plan
// action, the sights map) in the intent store and asks the tabs shell for
// the tab, as iOS sets `pendingCoachPrompt` and `selectedTab`.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Keyboard, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HomeOutsideCard from '../attractions/HomeOutsideCard';
import HomeTodayRow from '../plan/HomeTodayRow';
import { useWeather } from '../../hooks/useWeather';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { useAppNavigation } from '../../navigation/hooks';
import { selectActivePasses, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import {
  locationStore,
  selectEffectiveLocation,
  selectGrantedLocation,
  useLocationStore,
} from '../../stores/locationStore';
import { useOrderedVenues, useVenueList, venuesStore } from '../../stores/venuesStore';
import type { Coordinate } from '../../lib/geo';
import { colors } from '../../theme';
import type { Venue } from '../../types/venue';
import { firstNameOf, greetingKey } from './greeting';
import { HomeHeaderOnly, HomeHero } from './HomeHeader';
import { signalHomeReads } from './homeReads';
import HomeProofBanner from './HomeProofBanner';
import { HomeVenuesStatus, NearbyShelf, PopularShelf, ReferralCard } from './HomeShelves';
import HomeOffersCard from './offersCard/HomeOffersCard';
import { soonestPass } from './passChip';
import { pickHero, resolveHero } from './pickHero';
import { nearbyShelf, popularExclusions, popularShelf } from './shelves';
import TryNewSection, { type TryNewSectionHandle } from './TryNewSection';
import { useHomeVisit } from './useHomeVisit';
import { useKeyboardLift } from './useKeyboardLift';
import { useProfileMovedHint } from './useProfileMovedHint';
import { useUpcomingBookings } from './useUpcomingBookings';

/** iOS `Spacer(minLength: 120)`: room above the floating tab bar. */
const BOTTOM_ROOM = 120;
/** What iOS's 120 pt leaves free above its own bar (about 83 pt with the home indicator). */
const ROOM_ABOVE_BAR = 37;

/** iOS HomeView's gutter around the Today row (`.padding(.horizontal, 20).padding(.top, 20)`). */
const TODAY_ROW_GUTTER = 20;

/** Where Profile was opened from on Home (iOS `profile_opened.entry`). */
type HomeProfileEntry = 'home_avatar' | 'home_upcoming';

/** The featured venue and what it was picked from. */
interface HeroPick {
  readonly id: string | null;
  readonly venues: readonly Venue[];
  readonly fix: Coordinate | null;
  readonly visit: number;
}

export default function HomeScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const { t } = useT();
  const visit = useHomeVisit(navigation);

  // Venues, in the visit's browse order.
  const venues = useOrderedVenues(venuesStore);
  const venuesLoading = useVenueList((state) => state.isLoading);
  const venuesFailed = useVenueList((state) => state.error !== null);

  // Where the member is: a granted fix for the hero, the last fix or
  // Reykjavík centre for the 5 km filter (never shown as a distance).
  const grantedFix = useLocationStore(selectGrantedLocation);
  const shelfOrigin = useLocationStore(selectEffectiveLocation);

  const profile = useAppStore((state) => state.profile);
  const passes = useAppStore(selectActivePasses);
  const { weather, reload: reloadWeather } = useWeather();
  const { bookings, reload: reloadBookings } = useUpcomingBookings();
  const hint = useProfileMovedHint();

  // MARK: The featured venue

  // Picked while rendering, the moment the venues, the fix or the visit
  // change (iOS picks in the same task that loads the venues), so no frame is
  // ever drawn with a stand-in hero: not the first venue in the list, which
  // can be a coming-soon one, and not the shelves built around it.
  const [heroPick, setHeroPick] = useState<HeroPick>(() => ({
    id: pickHero(venues, { grantedFix, currentId: null }),
    venues,
    fix: grantedFix,
    visit,
  }));
  let heroId = heroPick.id;
  if (heroPick.venues !== venues || heroPick.fix !== grantedFix || heroPick.visit !== visit) {
    // A new tab visit starts without a hero (iOS builds Home afresh); within a
    // visit, a reload or a new fix keeps it unless the fix finds one nearby.
    heroId = pickHero(venues, { grantedFix, currentId: heroPick.visit !== visit ? null : heroPick.id });
    setHeroPick({ id: heroId, venues, fix: grantedFix, visit });
  }

  const hero = resolveHero(venues, heroId);
  const heroVenueId = hero?.id ?? null;
  const nearby = useMemo(() => nearbyShelf(venues, heroVenueId, shelfOrigin), [venues, heroVenueId, shelfOrigin]);
  const popular = useMemo(() => popularShelf(venues, popularExclusions(heroVenueId, nearby)), [venues, heroVenueId, nearby]);

  // MARK: Reads

  const loadProfile = useCallback(async () => {
    await useAppStore.getState().loadProfile();
    await hint.evaluate(useAppStore.getState().profile?.id);
    // `hint.evaluate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      // The cards other packages draw inside Home (the Outside card's sights)
      // read again with Home (./homeReads.ts).
      signalHomeReads();
      void (async () => {
        await venuesStore.getState().load();
        // Prompts only while the member has not decided (the store's rule).
        await locationStore.getState().requestLocation();
      })();
      void reloadWeather();
      void reloadBookings();
      void loadProfile();
    }, [reloadWeather, reloadBookings, loadProfile]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    signalHomeReads();
    try {
      await venuesStore.getState().load();
      await reloadBookings();
      await useAppStore.getState().loadProfile();
    } finally {
      setRefreshing(false);
    }
  }, [reloadBookings]);

  // MARK: Where taps go

  const openProfile = (entry: HomeProfileEntry) => {
    const profileId = useAppStore.getState().profile?.id;
    hint.profileOpened(profileId);
    track('profile_opened', { entry });
    navigation.navigate('Profile', { initialTab: 'bookings' });
  };
  const openVenue = (venue: Venue) => navigation.navigate('VenueDetail', { slug: venue.slug });
  const openExplore = () => useIntentStore.getState().requestTab('Explore');
  const openCoach = (prompt: string) => {
    Keyboard.dismiss();
    const intents = useIntentStore.getState();
    intents.parkCoachPrompt(prompt);
    intents.requestTab('Coach');
  };
  const openPlan = () => useIntentStore.getState().requestTab('Plan');
  const startWorkout = (sessionId: string) => {
    const intents = useIntentStore.getState();
    intents.parkPlanAction({ kind: 'startWorkout', sessionId });
    intents.requestTab('Plan');
  };
  const openSight = (slug: string) => navigation.navigate('AttractionDetail', { slug });
  const openSightsMap = () => {
    const intents = useIntentStore.getState();
    intents.requestExploreSights();
    intents.requestTab('Explore');
  };

  // MARK: The keyboard (2.5.4)

  const page = useRef<ScrollView>(null);
  const tryNew = useRef<TryNewSectionHandle>(null);
  const keyboard = useKeyboardLift(page, tryNew, insets.bottom);
  // A tap anywhere outside the ask field puts the keyboard away; the card or
  // button under the tap still works (the scroll view lets handled taps
  // through). The field's own row says first when a touch starts inside it.
  const onContentTouchStart = () => {
    const section = tryNew.current;
    if (!section) return;
    const inside = section.touchStartedInInput();
    if (!inside && section.isInputFocused()) Keyboard.dismiss();
  };

  // MARK: Words

  const firstName = firstNameOf(profile?.fullName) ?? t('home.name_fallback');
  const greeting = t(greetingKey(new Date().getHours()));
  const pass = soonestPass(passes);
  const upcoming = bookings[0] ?? null;

  return (
    <ScrollView
      ref={page}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onScroll={keyboard.onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={keyboard.onContentSizeChange}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.rust]}
          progressBackgroundColor={colors.ink2}
          progressViewOffset={insets.top}
        />
      }
      testID="home.scroll"
    >
      <View onTouchStart={onContentTouchStart} testID="home.content">
        <HomeProofBanner />

        {hero ? (
          <HomeHero
            venue={hero}
            topInset={insets.top}
            firstName={firstName}
            greeting={greeting}
            weather={weather}
            pass={pass}
            booking={upcoming}
            showProfileHint={hint.visible}
            onOpenProfile={() => openProfile('home_avatar')}
            onViewBooking={() => openProfile('home_upcoming')}
            onDismissHint={() => hint.dismiss(useAppStore.getState().profile?.id)}
            onExplore={openExplore}
          />
        ) : (
          <HomeHeaderOnly
            showProfileHint={hint.visible}
            onOpenProfile={() => openProfile('home_avatar')}
            onDismissHint={() => hint.dismiss(useAppStore.getState().profile?.id)}
          />
        )}

        {/* Today's plan, one row under the hero, with iOS's spacing around
            it (20 dp at the sides and above). The row draws no outer spacing
            of its own and renders nothing at all when there is no plan,
            consent or membership (iOS HomeTodayRow: an EmptyView). The top
            20 dp is the gap between the empty first child and the row, so it
            exists only while the row does: a hidden row leaves no gap.
            The booking id is the server's own (lowercase) UUID string. iOS
            hands over `uuidString`, which Swift upper-cases, and compares it
            with `==` to the plan's raw id, so shipped iOS never matches; the
            row is meant to skip the class this card already shows, which a
            plain comparison of the server's ids does. */}
        <View style={styles.today} testID="home.today">
          <View />
          <HomeTodayRow upcomingBookingId={upcoming?.id ?? null} onOpenPlan={openPlan} onStart={startWorkout} />
        </View>

        <View style={styles.tryNew}>
          <TryNewSection ref={tryNew} onPrompt={openCoach} />
        </View>

        <View style={styles.list}>
          {/* First among the cards, as on iOS: the referral card is always
              there, this one only until it is answered (it draws nothing
              while it is not offered, so it leaves no gap). */}
          <HomeOffersCard visit={visit} />
          <ReferralCard onPress={() => navigation.navigate('Account')} />
          {nearby.length > 0 ? <NearbyShelf venues={nearby} onOpenVenue={openVenue} onSeeAll={openExplore} /> : null}
          {/* After the venues near you: Home is about what the pass opens, and
              the sights are what to do around it. */}
          <HomeOutsideCard onOpenSight={openSight} onSeeAllOnMap={openSightsMap} />
          {popular.length > 0 ? <PopularShelf venues={popular} onOpenVenue={openVenue} /> : null}
          <HomeVenuesStatus
            loading={venuesLoading && venues.length === 0}
            failed={!venuesLoading && venues.length === 0 && venuesFailed}
            onRetry={() => void venuesStore.getState().load()}
          />
          <View style={{ height: Math.max(BOTTOM_ROOM, tabBarHeight + ROOM_ABOVE_BAR) }} />
        </View>
        {/* Room for the page to lift the ask field above the keyboard (outside
            the list, whose gap would otherwise add to it when it is 0). */}
        <View style={{ height: keyboard.keyboardRoom }} testID="home.keyboardRoom" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1 },
  today: { paddingHorizontal: TODAY_ROW_GUTTER, gap: TODAY_ROW_GUTTER },
  tryNew: { paddingTop: 24, paddingBottom: 8 },
  list: { paddingTop: 12, gap: 32 },
});
