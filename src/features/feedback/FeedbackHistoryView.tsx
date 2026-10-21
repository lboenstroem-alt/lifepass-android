/**
 * Every monthly report the member has, newest first (iOS
 * Views/Plan/FeedbackHistoryView.swift, `SPEC` 9.4).
 *
 * Pushed on Plan's stack from the card and the report (route
 * `FeedbackHistory`), or drawn inside Body and goals' history sheet
 * (./FeedbackHistorySheet.tsx), where the reports open without their actions.
 *
 *   loading   a skeleton card ("Loading" to TalkBack)
 *   failed    the health error state with Try again (only with no rows)
 *   empty     "Your first monthly feedback arrives on the 1st of next month."
 *   list      title, "New" while unopened, the first highlight (two lines),
 *             and "Show more" while the server has more
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchFeedbackReports, type FeedbackReportSummary } from '../../api/feedback';
import { ApiError } from '../../api/errors';
import { Card, ErrorState, hiddenFromAccessibility, LPText, SkeletonCard, TopBar } from '../../components/ui';
import { useHealthStore } from '../../health/store';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { colors, hairline } from '../../theme';

import { supportsFeedback } from './feedbackStore';
import { FeedbackNewPill } from './parts';

export type FeedbackHistoryViewProps = {
  onBack?: () => void;
  onOpen: (reportId: string) => void;
  testID?: string;
};

type Phase = 'loading' | 'loaded' | 'failed';

const BOTTOM_ROOM = 64;

export default function FeedbackHistoryView({ onBack, onOpen, testID = 'feedback.history' }: FeedbackHistoryViewProps) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [rows, setRows] = useState<readonly FeedbackReportSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [isLoadingMore, setLoadingMore] = useState(false);
  const rowsRef = useRef<readonly FeedbackReportSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const setAllRows = (next: readonly FeedbackReportSummary[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const loadFirstPage = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const app = useAppStore.getState();
    if (!supportsFeedback(app) || !selectHasHealthConsent(app)) {
      setAllRows([]);
      setPhase('loaded');
      return;
    }
    if (rowsRef.current.length === 0) setPhase('loading');
    try {
      const page = await fetchFeedbackReports({ cursor: null, language, signal: abort.signal });
      if (abort.signal.aborted) return;
      setAllRows(page.reports);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setPhase('loaded');
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof ApiError) {
        if (error.isCancellation) return;
        if (error.isProblem('health_consent_required', 'health_minor_blocked')) {
          useHealthStore.getState().handle(error, { foreground: true });
        }
      }
      setPhase(rowsRef.current.length === 0 ? 'failed' : 'loaded');
    }
  }, [language]);

  // iOS `.task(id: appState.language)`.
  useEffect(() => {
    void loadFirstPage();
    return () => abortRef.current?.abort();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchFeedbackReports({ cursor, language });
      const known = new Set(rowsRef.current.map((row) => row.id));
      setAllRows([...rowsRef.current, ...page.reports.filter((row) => !known.has(row.id))]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // The button stays; another tap tries again.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, cursor, language]);

  return (
    <View style={styles.page} testID={testID}>
      <TopBar title={t('feedback.history.title')} onBack={onBack} testID={`${testID}.bar`} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
      >
        {phase === 'loading' ? (
          <View style={styles.skeleton} accessible accessibilityLabel={t('a11y.loading')} testID={`${testID}.loading`}>
            <SkeletonCard rows={3} />
          </View>
        ) : null}
        {phase === 'failed' ? <ErrorState onRetry={() => void loadFirstPage()} testID={`${testID}.error`} /> : null}
        {phase === 'loaded' && rows.length === 0 ? (
          <LPText size={14} color={colors.paper2} style={styles.empty} testID="feedback.history.empty">
            {t('feedback.history.empty')}
          </LPText>
        ) : null}
        {phase === 'loaded' && rows.length > 0 ? (
          <View style={styles.list}>
            <Card style={styles.card}>
              {rows.map((row, index) => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  divider={index > 0}
                  onPress={() => {
                    track('feedback_opened', { entry: 'history' });
                    onOpen(row.id);
                  }}
                />
              ))}
            </Card>
            {hasMore ? (
              <Pressable
                onPress={() => void loadMore()}
                disabled={isLoadingMore}
                accessibilityRole="button"
                accessibilityLabel={t('feedback.history.more')}
                accessibilityState={{ disabled: isLoadingMore, busy: isLoadingMore }}
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                testID="feedback.history.more"
              >
                {isLoadingMore ? <ActivityIndicator size="small" color={colors.rust} /> : null}
                <LPText size={13} weight="semibold" color={colors.paper2}>
                  {t('feedback.history.more')}
                </LPText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function HistoryRow({ row, divider, onPress }: { row: FeedbackReportSummary; divider: boolean; onPress: () => void }) {
  const { t } = useT();
  const title = row.title ?? row.periodMonth ?? '';
  const first = row.highlights[0] ?? null;
  const unseen = row.seenAt === null;
  const label = [title, unseen ? t('feedback.card.new') : null, first].filter((part): part is string => !!part).join(', ');
  return (
    <View>
      {divider ? <View style={styles.rule} /> : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID="feedback.history.row"
      >
        <View style={styles.rowTexts}>
          <View style={styles.rowTitle}>
            <LPText size={15} weight="medium" color={colors.paper} style={styles.shrink}>
              {title}
            </LPText>
            {unseen ? <FeedbackNewPill /> : null}
          </View>
          {first ? (
            <LPText size={13} color={colors.paper2} numberOfLines={2}>
              {first}
            </LPText>
          ) : null}
        </View>
        <View style={styles.chevron} {...hiddenFromAccessibility}>
          <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 16, gap: 16 },
  skeleton: { paddingHorizontal: 20 },
  empty: { paddingHorizontal: 24, paddingVertical: 24 },
  list: { gap: 12 },
  card: { marginHorizontal: 20 },
  rule: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowTexts: { flex: 1, gap: 4 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  chevron: { paddingTop: 4 },
  more: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pressed: { opacity: 0.75 },
});
