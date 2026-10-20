// Cross-venue class discovery: the Explore tab's "Classes" mode, and the
// classes sheet Plan opens (iOS ClassesDiscoveryView).
//
// Mirrors the web /browse Classes tab: search, featured category chips, an
// opt-in "Near me" distance filter, each class's distance whenever the
// member's real position is known (client-side: the location never leaves
// the phone, and OPENING THE FEED ASKS FOR NOTHING), and a day-grouped feed.
// Tapping a class opens the class sheet for THAT session (no date step, no
// timetable to find it in again).
//
// Mounted by EXPL-1 (with the Venues / Classes switch) and by the
// `ClassesDiscoveryModal` route (Plan's class session: a category and a day
// to open on, no switch). Each mount has its own state; the filters reset
// per visit, as on iOS.
//
// The fixed header stays slim: the search, the Filters chip and the mode
// switch, so the way back to the venues never scrolls away. The filter rows
// sit at the top of the list and scroll away with it.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AccessibilityInfo, AppState, FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import { useStore } from 'zustand';

import { announce, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { locationStore, useGrantedLocation } from '../../stores/locationStore';
import { colors } from '../../theme';
import {
  createClassesFeed,
  selectActiveFilterCount,
  selectDayGroups,
  selectNextMatchRequest,
  selectNextMatchState,
  selectUsingLocationFallback,
  TICK_MS,
  type ClassesFeedStore,
} from './feed/classesFeedStore';
import type { FeedEntry } from './feed/clientFilters';
import { circleDayNumber, customDateActive, pickerRange, quickDates, selectedOrToday, todayIso } from './feed/days';
import { nextMatchKey, nextMatchStateKey } from './feed/nextMatch';
import { accessibilityLabel as nextMatchAccessibilityLabel, headline, noneInWindowLines } from './feed/nextMatchCopy';
import type { ClassOccurrence } from './model/occurrence';
import { classFeedRowId } from './model/occurrence';
import { openClassSheet } from './sheet';
import ClassCard from './ui/ClassCard';
import DatePickerSheet from './ui/DatePickerSheet';
import { ErrorFeedState, LoadingState, NextMatchEmptyState, PlainEmptyState } from './ui/FeedStates';
import FiltersPanel from './ui/FiltersPanel';
import { dayHeader } from './ui/labels';
import LoadMoreButton from './ui/LoadMoreButton';
import ModeToggle from './ui/ModeToggle';
import SearchRow from './ui/SearchRow';
import { useScreenFocus } from './ui/useScreenFocus';

export interface ClassesDiscoveryProps {
  /** A `catalog_categories` slug to open on (Plan's class session). */
  readonly initialCategory?: string;
  /** A `YYYY-MM-DD` day to open on. */
  readonly initialDate?: string;
  /** The Venues / Classes switch belongs to Explore; presented from Plan there is nothing to switch to. */
  readonly showsModeToggle: boolean;
  /** Explore only: the switch's "Venues" side. */
  readonly onShowVenues?: () => void;
}

/** One line of the list: a day's header or a class. */
type Row =
  | { readonly kind: 'day'; readonly key: string; readonly dayIso: string; readonly first: boolean }
  | { readonly kind: 'class'; readonly key: string; readonly entry: FeedEntry; readonly lastOfDay: boolean };

/** Room under the last row, above the tab bar (iOS keeps 140 pt clear). */
const BOTTOM_ROOM = 24;

export default function ClassesDiscovery({ initialCategory, initialDate, showsModeToggle, onShowVenues }: ClassesDiscoveryProps) {
  const { t, language } = useT();
  // Read, never asked for: the granted fix, or null.
  const granted = useGrantedLocation();
  const [store] = useState<ClassesFeedStore>(() => {
    const feed = createClassesFeed({
      initialFix: granted,
      // Only the "Near me" tap asks (the system dialog while undecided).
      requestLocation: () => void locationStore.getState().requestLocation(),
    });
    // Applied before the first load, so no unfiltered feed is fetched and thrown away.
    feed.getState().applyInitialFilters(initialCategory, initialDate);
    return feed;
  });
  const state = useStore(store);
  const focused = useScreenFocus();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const listRef = useRef<FlatList<Row>>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Set when the class sheet booked something: the feed re-reads once the sheet has gone. */
  const bookedInSheet = useRef(false);

  /**
   * The re-read after a booking in the class sheet, once (iOS reloads in
   * `.sheet(item:onDismiss:)` when `bookedInSheet`). The sheet's `onDismiss`
   * is the normal way in; the screen coming back into focus and the app
   * returning to the front are a safety net, so a close path that never
   * reports cannot leave a booked class's chip and spots stale. True when it
   * re-read.
   */
  const rereadAfterBooking = useCallback((): boolean => {
    if (!bookedInSheet.current) return false;
    bookedInSheet.current = false;
    void store.getState().reload();
    return true;
  }, [store]);

  // One source of "where the member is" for the whole screen.
  useEffect(() => {
    store.getState().setFix(granted);
  }, [store, granted]);

  // The first load (again on a return, if it failed or never ran). A return
  // after a booking re-reads instead: one GET, not two.
  useEffect(() => {
    if (focused && !rereadAfterBooking()) void store.getState().loadInitial();
  }, [store, focused, rereadAfterBooking]);

  // The 30 s heartbeat while the screen is in front: started classes drop
  // off, the quick days roll at midnight, a stale day snaps back. A return
  // from the background ticks at once.
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => store.getState().tick(), TICK_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      // A tick's own reload (a stale day) is superseded by the re-read
      // before its fetch runs, so this still costs one GET.
      store.getState().tick();
      rereadAfterBooking();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [store, focused, rereadAfterBooking]);

  useEffect(() => () => store.getState().dispose(), [store]);

  // An empty selected day looks ahead for the next match. Keyed on everything
  // that decides the answer, so a filter change, a new radius, a location fix
  // or a retry cancels the old look-ahead and starts the right one.
  const nextMatchRequest = selectNextMatchRequest(state);
  const requestKey = nextMatchRequest ? nextMatchKey(nextMatchRequest) : null;
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    void store.getState().findNextMatch(selectNextMatchRequest(store.getState()), controller.signal);
    return () => controller.abort();
  }, [store, requestKey]);

  // The answer arrives after the empty state is on screen, so TalkBack hears
  // it rather than having to find it: the match, the "nothing" sentence, or
  // the error that replaced the hint.
  const nextMatchState = selectNextMatchState(state);
  const stateKey = nextMatchStateKey(nextMatchState);
  useEffect(() => {
    const current = store.getState();
    const request = selectNextMatchRequest(current);
    const answer = selectNextMatchState(current);
    if (!request || !answer) return;
    let text: string | null = null;
    if (answer.kind === 'found') {
      text = nextMatchAccessibilityLabel(headline(request, false, current.now, language), answer.item, language);
    } else if (answer.kind === 'noneInWindow') {
      text = noneInWindowLines(request, current.now, language).join(' ');
    } else if (answer.kind === 'failed') {
      text = t('classes.load_error');
    }
    if (!text) return;
    const spoken = text;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (on && live) announce(spoken);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Announce on a change of answer only (Swift `onChange(of: nextMatchState)`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  // A new day, category, radius or search is a new list: start it from the top.
  useEffect(() => {
    if (state.isLoading) listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [state.isLoading]);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [state.selectedDateIso]);

  const openSession = useCallback(
    (occurrence: ClassOccurrence) => {
      openClassSheet(occurrence, {
        onBooked: () => {
          bookedInSheet.current = true;
        },
        onDismiss: () => void rereadAfterBooking(),
      });
    },
    [rereadAfterBooking],
  );

  const groups = selectDayGroups(state);
  const showsClasses = !state.isLoading && !state.loadFailed;
  const rows = useMemo<Row[]>(() => {
    if (!showsClasses) return [];
    const out: Row[] = [];
    groups.forEach((group, groupIndex) => {
      out.push({ kind: 'day', key: `day-${group.dayIso}`, dayIso: group.dayIso, first: groupIndex === 0 });
      group.entries.forEach((entry, index) => {
        out.push({ kind: 'class', key: classFeedRowId(entry.item), entry, lastOfDay: index === group.entries.length - 1 });
      });
    });
    return out;
  }, [groups, showsClasses]);

  const now = state.now;
  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item: row }) => {
      if (row.kind === 'day') {
        return (
          <View style={[styles.dayHeader, row.first && styles.firstDay]}>
            <LPText serif size={19} accessibilityRole="header">
              {dayHeader(row.dayIso, language)}
            </LPText>
          </View>
        );
      }
      return (
        <View style={[styles.rowWrap, row.lastOfDay ? styles.lastOfDay : styles.betweenRows]}>
          <ClassCard entry={row.entry} now={now} onOpen={openSession} />
        </View>
      );
    },
    [language, now, openSession],
  );

  const activeFilterCount = selectActiveFilterCount(state);
  const today = todayIso(state.now);
  const range = pickerRange(state.now, state.selectedDateIso);

  const header = filtersExpanded ? (
    <FiltersPanel
      nearMeEnabled={state.nearMeEnabled}
      radiusKm={state.radiusKm}
      quickDates={quickDates(state.now)}
      selectedDateIso={state.selectedDateIso}
      customDateActive={customDateActive(state.now, state.selectedDateIso)}
      circleDayNumber={circleDayNumber(state.now, state.selectedDateIso)}
      category={state.category}
      usingLocationFallback={selectUsingLocationFallback(state)}
      onToggleNearMe={() => store.getState().toggleNearMe()}
      onSelectRadius={(km) => store.getState().setRadius(km)}
      onToggleDate={(day) => store.getState().toggleDate(day)}
      onOpenCalendar={() => setPickerOpen(true)}
      onClearDate={() => store.getState().clearDate()}
      onToggleCategory={(slug) => store.getState().toggleCategory(slug)}
    />
  ) : null;

  let empty: ReactElement;
  if (state.isLoading) {
    empty = <LoadingState />;
  } else if (state.loadFailed) {
    empty = <ErrorFeedState onRetry={() => void store.getState().reload()} />;
  } else if (nextMatchRequest && nextMatchState) {
    empty = (
      <NextMatchEmptyState
        request={nextMatchRequest}
        state={nextMatchState}
        now={state.now}
        nearMeEnabled={state.nearMeEnabled}
        onRetry={() => store.getState().retryNextMatch()}
        onShowDay={() => store.getState().showNextMatchDay()}
      />
    );
  } else {
    empty = <PlainEmptyState nearMeEnabled={state.nearMeEnabled} />;
  }

  const footer = (
    <View style={{ paddingBottom: tabBarHeight + BOTTOM_ROOM }}>
      {rows.length > 0 && state.nextCursor !== null ? (
        <View style={styles.loadMore}>
          <LoadMoreButton loading={state.isLoadingMore} onPress={() => void store.getState().loadMore()} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen} testID="classes.discovery">
      <SearchRow
        searchText={state.searchText}
        onChangeSearch={(text) => store.getState().setSearchText(text)}
        filtersExpanded={filtersExpanded}
        onToggleFilters={() => setFiltersExpanded((open) => !open)}
        activeFilterCount={activeFilterCount}
      />
      {showsModeToggle ? <ModeToggle onShowVenues={onShowVenues} /> : null}
      <FlatList
        ref={listRef}
        testID="classes.list"
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={11}
      />
      <DatePickerSheet
        visible={pickerOpen}
        initialDay={selectedOrToday(state.now, state.selectedDateIso)}
        range={range}
        today={today}
        onClose={() => setPickerOpen(false)}
        onDone={(day) => {
          setPickerOpen(false);
          store.getState().selectCustomDate(day);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  dayHeader: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  firstDay: { paddingTop: 12 },
  rowWrap: { paddingHorizontal: 20 },
  betweenRows: { paddingBottom: 8 },
  lastOfDay: { paddingBottom: 18 },
  loadMore: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18 },
});
