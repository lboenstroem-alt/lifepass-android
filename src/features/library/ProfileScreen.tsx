/* eslint lifepass/no-literal-copy: "error" */
/**
 * Profile ("Library"): bookings and saved. The port of iOS `LibraryView`
 * (Views/Profile/LibraryView.swift), route `Profile { initialTab }` (plan
 * 3.0.2), pushed from the Home avatar and every person button so the tab bar
 * stays under it, as on iOS 2.5.x.
 *
 * Top to bottom:
 *   top bar      back, "Library" / "Bookings & saved", and the gear into
 *                Account (Account is one tap further than Profile)
 *   member card  ./LibraryMemberCard (its badge opens Plans; the card itself
 *                is not a button)
 *   tabs         "Bookings {count}" and "Saved {count}" with a rust underline
 *   body         ./bookings/BookingsTab or ./saved/SavedTab
 *
 * ON EVERY APPEARANCE (iOS `.onAppear`, which re-fires when the member comes
 * back from Account, a venue or another tab) the bookings load, then the
 * saved lists; a pull to refresh reloads the bookings. A booking just made or
 * cancelled elsewhere is therefore here the next time Profile shows.
 *
 * LEAVING FOR EXPLORE. "Book Now" and "Find venues" pop Profile FIRST and only
 * then switch to the Explore tab: switching from inside Profile would change
 * the tab behind it and leave the member looking at Profile, wondering what
 * their tap did (iOS `leaveProfile`). Profile opened over a modal (the
 * shared sheet) closes the same way.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';

import { LPText, TopBar } from '../../components/ui';
import { useT } from '../../i18n';
import { openSharedRoute } from '../../navigation/sharedSheet';
import type { ProfileTab, SharedRouteProps } from '../../navigation/types';
import { selectUsage, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { colors, hairline } from '../../theme';

import BookingsTab, { LoadingSpinner } from './bookings/BookingsTab';
import { createMyBookingsStore } from './bookings/myBookings';
import LibraryMemberCard from './LibraryMemberCard';
import SavedTab from './saved/SavedTab';
import { useSavedLoad } from './saved/useSavedLoad';

/** iOS ends both halves with `Spacer(minLength: 140)`, room for the floating tab bar. */
const MIN_BOTTOM_SPACE = 140;

export default function ProfileScreen({ navigation, route }: SharedRouteProps<'Profile'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page (src/navigation/CustomTabBar); in the
  // shared sheet there is none and the system bar's inset is answered.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const bottomSpace = Math.max(MIN_BOTTOM_SPACE, tabBarHeight + 24);

  const requestedTab = route.params?.initialTab;
  const [topTab, setTopTab] = useState<ProfileTab>(requestedTab ?? 'bookings');
  // Profile already on screen and opened again on the other half (the Coach's
  // Saved): the half follows the newest request.
  useEffect(() => {
    if (requestedTab) setTopTab(requestedTab);
  }, [requestedTab]);

  const profile = useAppStore((s) => s.profile);
  const subscription = useAppStore((s) => s.subscription);
  const usage = useAppStore(selectUsage);

  const [bookings] = useState(() => createMyBookingsStore());
  const bookingsCount = useStore(bookings, (s) => s.upcoming.length + s.past.length);
  const saved = useSavedLoad();
  const loadSaved = saved.load;

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await bookings.getState().load();
        await loadSaved();
      })();
    }, [bookings, loadSaved]),
  );

  const leaveForExplore = useCallback(() => {
    navigation.goBack();
    useIntentStore.getState().requestTab('Explore');
  }, [navigation]);

  const openVenue = useCallback((slug: string) => openSharedRoute(navigation, 'VenueDetail', { slug }), [navigation]);

  return (
    <View style={styles.root} testID="library.screen">
      <TopBar
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        onBack={() => navigation.goBack()}
        trailing={{ kind: 'gear', onPress: () => openSharedRoute(navigation, 'Account') }}
        testID="library.topBar"
      />

      <View style={styles.cardWrap}>
        <LibraryMemberCard
          profile={profile}
          subscription={subscription}
          usage={usage}
          onOpenPlans={() => navigation.navigate('Plans')}
        />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        <TopTabButton
          title={t('library.tab.bookings')}
          count={bookingsCount}
          active={topTab === 'bookings'}
          onPress={() => setTopTab('bookings')}
          testID="library.tab.bookings"
        />
        <TopTabButton
          title={t('library.tab.saved')}
          count={saved.venues.length}
          active={topTab === 'saved'}
          onPress={() => setTopTab('saved')}
          testID="library.tab.saved"
        />
      </View>

      {topTab === 'bookings' ? (
        <BookingsTab store={bookings} onBrowse={leaveForExplore} bottomSpace={bottomSpace} />
      ) : saved.isLoading ? (
        <View style={styles.loading} testID="library.saved.loading">
          <LoadingSpinner />
        </View>
      ) : (
        <SavedTab saved={saved} onOpenVenue={openVenue} onFindVenues={leaveForExplore} bottomSpace={bottomSpace} />
      )}
    </View>
  );
}

function TopTabButton({
  title,
  count,
  active,
  onPress,
  testID,
}: {
  readonly title: string;
  readonly count: number;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={`${title}, ${count}`}
      accessibilityState={{ selected: active }}
      style={styles.tab}
      testID={testID}
    >
      <View style={styles.tabLabel}>
        <LPText size={14} weight="semibold" color={active ? colors.paper : colors.paper3}>
          {title}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {String(count)}
        </LPText>
      </View>
      <View style={[styles.underline, active && styles.underlineActive]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  cardWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
    backgroundColor: colors.ink,
  },
  // The row's top padding sits inside each tab, so the whole strip down to
  // the underline takes the touch: at least Android's 48 dp target.
  tab: { flex: 1, alignItems: 'flex-start', justifyContent: 'flex-end', paddingTop: 14, minHeight: 48 },
  tabLabel: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingBottom: 12 },
  underline: { alignSelf: 'stretch', height: 2, backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: colors.rust },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
