/**
 * Route `Measurements`: the weight history, every weigh-in the member has,
 * newest first, each one deletable (iOS `MeasurementsView`, `ios-ux.md` 10.3
 * card 2).
 *
 * - PAGED, NOT LOADED WHOLE: two years of daily weigh-ins is 700 rows, so the
 *   server answers 30 at a time and "Show older entries" asks for the next
 *   page with the cursor it sent.
 * - Each row: the weight, then "17 September · Weekly check-in".
 * - Delete: swipe the row left for Delete, or TalkBack's custom action on the
 *   row (a swipe is invisible to a screen reader), then "Delete this entry?"
 *   with Cancel and Delete. A weigh-in from a connected health app says it
 *   will not be added again.
 * - A delete reloads the profile: the server recomputed the targets in the
 *   same transaction, so the next Plan read must come from the server. A row
 *   that is already gone (`health_measurement_not_found`) IS what the member
 *   asked for and is just removed; any other failure reloads the first page.
 * - Loading: a skeleton card. Empty: "No weight entries yet.". A failed read:
 *   the error and Try again.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../api';
import { Dialog, LPText, SkeletonCard } from '../../components/ui';
import { useHealthStore, type Measurement } from '../../health';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import type { SharedRouteProps } from '../../navigation/types';
import { useAppStore } from '../../stores/appStore';
import { colors, hairline, radius } from '../../theme';
import { AccountRowDivider } from '../account';

import { deleteWeighIn, fetchMeasurementsPage } from './api';
import { deleteFailure, deleteMessageKey, measurementSubtitle, measurementTitle, withoutRow } from './measurements/model';
import { BodyTopBar, CardMessageRow } from './ui/parts';

interface HistoryState {
  readonly rows: readonly Measurement[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly errorKey: string | null;
}

const INITIAL: HistoryState = { rows: [], cursor: null, hasMore: false, isLoading: true, isLoadingMore: false, errorKey: null };

export default function MeasurementsScreen({ navigation }: SharedRouteProps<'Measurements'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [state, setState] = useState<HistoryState>(INITIAL);
  const [pendingDelete, setPendingDelete] = useState<Measurement | null>(null);
  const mounted = useRef(true);
  /**
   * Which first-page read is the current one: an older answer lands nowhere,
   * and neither does a next page asked for before it (its cursor belongs to
   * the list the reload replaces).
   */
  const generation = useRef(0);
  /**
   * Set before the first await, so a second tap on "Show older entries" that
   * lands before the re-render that disables the row asks for nothing (two
   * reads of one cursor would append the page twice). Cleared by the read
   * that set it, or by a reload, which owns the row from then on.
   */
  const loadingMore = useRef(false);
  /** A first-page read is running: the cursor on screen is about to be replaced. */
  const loadingFirst = useRef(false);

  const patch = useCallback((next: Partial<HistoryState>) => {
    if (mounted.current) setState((s) => ({ ...s, ...next }));
  }, []);

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    // A next page still in flight is now stale and returns without touching
    // the row, so the reload frees it here (iOS clears `isLoadingMore` on
    // every path of `loadMore`; a stale answer has no path of its own here).
    loadingMore.current = false;
    loadingFirst.current = true;
    patch({ isLoading: true, isLoadingMore: false, errorKey: null });
    try {
      const page = await fetchMeasurementsPage(null);
      if (mine !== generation.current) return;
      loadingFirst.current = false;
      patch({ rows: page.data, cursor: page.nextCursor, hasMore: page.hasMore, isLoading: false });
    } catch (error) {
      if (mine !== generation.current) return;
      loadingFirst.current = false;
      patch({ isLoading: false });
      if (error instanceof ApiError) {
        if (error.isCancellation) return;
        useHealthStore.getState().handle(error, { foreground: true });
      }
      patch({ errorKey: 'common.error_body' });
    }
  }, [patch]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const loadMore = async () => {
    const { cursor } = state;
    if (!cursor || loadingMore.current || loadingFirst.current) return;
    loadingMore.current = true;
    const mine = generation.current;
    patch({ isLoadingMore: true });
    try {
      const page = await fetchMeasurementsPage(cursor);
      // Overtaken by a reload: it has already freed the row and owns the list.
      if (mine !== generation.current) return;
      loadingMore.current = false;
      if (!mounted.current) return;
      setState((s) => ({ ...s, rows: [...s.rows, ...page.data], cursor: page.nextCursor, hasMore: page.hasMore, isLoadingMore: false }));
    } catch (error) {
      // A stale failure says nothing over the fresh first page.
      if (mine !== generation.current) return;
      loadingMore.current = false;
      patch({ isLoadingMore: false });
      if (error instanceof ApiError && error.isCancellation) return;
      patch({ errorKey: 'common.error_body' });
    }
  };

  const remove = (id: string) => {
    if (mounted.current) setState((s) => ({ ...s, rows: withoutRow(s.rows, id) }));
  };

  const confirmDelete = async (row: Measurement) => {
    try {
      await deleteWeighIn(row.id);
      remove(row.id);
      track('measurement_deleted');
      await useAppStore.getState().loadProfile();
    } catch (error) {
      switch (deleteFailure(error)) {
        case 'silent':
          return;
        case 'removed':
          remove(row.id);
          return;
        case 'reload':
          if (error instanceof ApiError) useHealthStore.getState().handle(error, { foreground: true });
          await reload();
      }
    }
  };

  const { rows, hasMore, isLoading, isLoadingMore, errorKey } = state;
  const messageKey = deleteMessageKey(pendingDelete);

  return (
    <View style={styles.root}>
      <BodyTopBar title={t('bodygoals.history')} onBack={() => navigation.goBack()} testID="measurements.bar" />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 40 }]}
        renderItem={({ item, index }) => (
          <Slice isFirst={index === 0} isLast={index === rows.length - 1 && !hasMore}>
            <MeasurementRow row={item} onDelete={() => setPendingDelete(item)} />
          </Slice>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View accessible accessibilityLabel={t('a11y.loading')} testID="measurements.loading">
              <SkeletonCard rows={4} showsHeader={false} />
            </View>
          ) : errorKey === null ? (
            <LPText size={14} color={colors.paper2} style={styles.empty} testID="measurements.empty">
              {t('bodygoals.history.empty')}
            </LPText>
          ) : null
        }
        ListFooterComponent={
          <>
            {rows.length > 0 && hasMore ? (
              <Slice isFirst={false} isLast>
                <LoadMoreRow busy={isLoadingMore} onPress={() => void loadMore()} />
              </Slice>
            ) : null}
            {errorKey ? (
              <View style={styles.error}>
                <CardMessageRow
                  message={t(errorKey)}
                  actionLabel={t('health.retry')}
                  onAction={() => void reload()}
                  divider={false}
                  testID="measurements.error"
                />
              </View>
            ) : null}
          </>
        }
        testID="measurements.list"
      />

      <Dialog
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('bodygoals.delete_row_title')}
        message={messageKey ? t(messageKey) : undefined}
        buttons={[
          { label: t('common.cancel'), role: 'cancel', testID: 'measurements.delete.cancel' },
          {
            label: t('common.delete'),
            role: 'destructive',
            onPress: () => {
              if (pendingDelete) void confirmDelete(pendingDelete);
            },
            testID: 'measurements.delete.confirm',
          },
        ]}
        testID="measurements.delete"
      />
    </View>
  );
}

/**
 * One row dressed as a slice of a card (iOS `card`): the page's 20 pt gutter
 * is the list's, ink2, rounded at the top of the first and the bottom of the
 * last, the hairline only round the outside, and the card's own inset divider
 * between rows rather than a rule from edge to edge.
 */
function Slice({ isFirst, isLast, children }: { readonly isFirst: boolean; readonly isLast: boolean; readonly children: ReactNode }) {
  return (
    <View style={[styles.slice, isFirst && styles.sliceFirst, isLast && styles.sliceLast]}>
      {isFirst ? null : <AccountRowDivider />}
      {children}
    </View>
  );
}

function MeasurementRow({ row, onDelete }: { readonly row: Measurement; readonly onDelete: () => void }) {
  const { t, language } = useT();
  const swipeable = useRef<SwipeableMethods>(null);
  const title = measurementTitle(language, row);
  const subtitle = measurementSubtitle(t, language, row);
  const deleteLabel = t('common.delete');

  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'delete') onDelete();
  };

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            swipeable.current?.close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          style={({ pressed }) => [styles.swipeDelete, pressed && styles.pressed]}
          testID={`measurements.row.${row.id}.swipeDelete`}
        >
          <LPText size={14} weight="semibold" color={colors.onAccent}>
            {deleteLabel}
          </LPText>
        </Pressable>
      )}
    >
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`${title}, ${subtitle}`}
        accessibilityActions={[{ name: 'delete', label: deleteLabel }]}
        onAccessibilityAction={onAction}
        testID={`measurements.row.${row.id}`}
      >
        <LPText size={14} weight="medium" color={colors.paper}>
          {title}
        </LPText>
        <LPText size={11} color={colors.paper3}>
          {subtitle}
        </LPText>
      </View>
    </ReanimatedSwipeable>
  );
}

function LoadMoreRow({ busy, onPress }: { readonly busy: boolean; readonly onPress: () => void }) {
  const { t } = useT();
  const label = t('bodygoals.history.load_more');
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
      testID="measurements.loadMore"
    >
      <LPText size={14} weight="medium" color={colors.accentText} style={styles.loadMoreText}>
        {label}
      </LPText>
      {busy ? <ActivityIndicator size="small" color={colors.rust} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  slice: {
    backgroundColor: colors.ink2,
    borderLeftWidth: hairline,
    borderRightWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  sliceFirst: {
    borderTopWidth: hairline,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  sliceLast: {
    borderBottomWidth: hairline,
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
  row: { gap: 2, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.ink2 },
  swipeDelete: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, backgroundColor: colors.destructive },
  pressed: { opacity: 0.7 },
  loadMore: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, minHeight: 48 },
  loadMoreText: { flex: 1 },
  empty: { paddingHorizontal: 4, paddingVertical: 12 },
  error: { marginTop: 4 },
});
