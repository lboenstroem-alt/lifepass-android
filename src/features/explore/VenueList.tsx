// Explore's list view (iOS SearchMapView `listContent`): the editorial
// banner, a header with the count and the sort label, then the venues.
//
// THE ORDER is the browse order (src/lib/browseOrder.ts) ordered whole and
// THEN filtered, so a chip or a search only removes cards (the screen hands
// the list over already ordered). The sort label says what the order really
// is: "Nearest first" only with a real fix, "Mixed for you" otherwise
// (`sortLabelKey`), never a proximity the phone does not have.
//
// The order changes on its own only when the visit does (the first fix
// arrives, the member moves a kilometre, a new visit starts): then the cards
// glide to their places instead of jumping, unless Remove animations is on.
// A filter or a search is not animated.
//
// Venues without a position are listed too (only the map needs one).
import { useEffect } from 'react';
import { FlatList, LayoutAnimation, StyleSheet, View } from 'react-native';

import { Kicker } from '../../components/ui';
import { reduceMotionNow } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';
import { sortLabelKey, useBrowseSession, type BrowseSessionStore } from '../../stores/browseSession';
import { colors } from '../../theme';
import type { Venue } from '../../types/venue';
import EditorialBanner from './EditorialBanner';
import ExploreListRow from './ExploreListRow';

/** How long the cards take to glide to a new order (iOS `.easeInOut(duration: 0.3)`). */
const REORDER_MS = 300;

/** The room below the last card (iOS `Spacer(minLength: 140)`), at least the tab bar's. */
const FOOTER_MIN = 140;

export interface VenueListProps {
  /** The venues to show, ordered and filtered. */
  readonly venues: readonly Venue[];
  /** The browse session the order follows (its origin drives the sort label). */
  readonly session: BrowseSessionStore;
  readonly onOpenVenue: (venue: Venue) => void;
  /** Explore is on screen (the banner's video plays). */
  readonly visible: boolean;
  /** The tab bar's height, kept clear below the last card. */
  readonly bottomInset: number;
}

export default function VenueList({ venues, session, onOpenVenue, visible, bottomInset }: VenueListProps) {
  const { t } = useT();
  const origin = useBrowseSession((state) => state.origin, session);

  // Glide only when the VISIT changes the order (a new fix or a new visit),
  // never for a filter or a search, which change the venues, not the session.
  useEffect(
    () =>
      session.subscribe((state, previous) => {
        if (state.revision === previous.revision || reduceMotionNow()) return;
        LayoutAnimation.configureNext(LayoutAnimation.create(REORDER_MS, 'easeInEaseOut', 'opacity'));
      }),
    [session],
  );

  return (
    <FlatList
      data={venues}
      keyExtractor={(venue) => venue.id}
      renderItem={({ item }) => <ExploreListRow venue={item} onPress={onOpenVenue} />}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <View style={styles.header}>
          <EditorialBanner playing={visible} />
          <View style={styles.counts}>
            <Kicker text={t('explore.venues_count', { count: venues.length })} color={colors.paper3} testID="explore.list.count" />
            <Kicker text={t(sortLabelKey(origin))} color={colors.paper2} testID="explore.list.sort" />
          </View>
        </View>
      }
      ListFooterComponent={<View style={{ height: Math.max(FOOTER_MIN, bottomInset + 20) }} />}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      style={styles.list}
      testID="explore.list"
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.ink },
  content: { paddingTop: 6, paddingHorizontal: 20 },
  header: { gap: 16, paddingBottom: 16 },
  // iOS pads the header row 24 against the list's 20.
  counts: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  separator: { height: 10 },
});
