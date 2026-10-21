/* eslint lifepass/no-literal-copy: "error" */
/**
 * Route `WorkoutHistory`: workouts and past plans (iOS `WorkoutHistoryView`,
 * PlanHistory.swift, `ios-ux.md` 3.13).
 *
 *   Workouts | Past plans          (opens on the segment it was asked for)
 *   Workouts: grouped by ISO week, "Week of {Monday}", newest first; each
 *     row the day, "Extra workout" over an extra, the title, "{minutes} min
 *     · {feeling}", where it was counted from, and the status mark; a row
 *     opens the workout.
 *   Past plans: title, dates and the status word (Not started, Updated,
 *     Completed, Ended early); a plan opens the programme overview in past
 *     mode.
 *   Each list pages on by cursor (`GET /health/sessions`, `GET /health/programs`,
 *   20 at a time, in the account language) as its end comes into view.
 *
 * Both lists are read once, workouts first, when the screen opens. As on
 * iOS a read that fails leaves the list as it was (empty, its empty line);
 * the next end-of-list tries again.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Kicker, LPText, SegmentedControl, TopBar } from '../../../components/ui';
import { fetchProgramHistory, fetchSessionHistory, type ProgramSummary, type SessionHistoryItem } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import type { SharedRouteProps, WorkoutHistorySegment } from '../../../navigation/types';
import { colors, hairline } from '../../../theme';
import { dateRange } from '../overview/planCopy';
import StatusMark from '../week/StatusMark';

import { rememberHistoryItems, retainHistoryItems } from './historyCache';
import {
  planStatusKey,
  showsExtraKicker,
  sourceLine,
  weekGroups,
  workoutMetaLine,
  workoutRowLabel,
  type WeekGroup,
} from './historyRules';

const PAGE = 20;
/** iOS leaves 140 pt under the page: the tab bar floats over it, plus room to breathe. */
const BOTTOM_ROOM = 64;

interface Paged<T> {
  readonly items: readonly T[];
  /** The next page's cursor; null when the server has no more (or before the first read). */
  readonly cursor: string | null;
}

const EMPTY = { items: [], cursor: null } as const;

export default function WorkoutHistoryScreen({ route, navigation }: SharedRouteProps<'WorkoutHistory'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const initialSegment = route.params?.segment ?? 'workouts';
  const [segment, setSegment] = useState<WorkoutHistorySegment>(initialSegment);
  const [workouts, setWorkouts] = useState<Paged<SessionHistoryItem>>(EMPTY);
  const [plans, setPlans] = useState<Paged<ProgramSummary>>(EMPTY);
  const [isLoading, setLoading] = useState(false);
  // Synchronous mirrors: the end of a list can be reached twice in one frame.
  const loading = useRef(false);
  const workoutsRef = useRef<Paged<SessionHistoryItem>>(EMPTY);
  const plansRef = useRef<Paged<ProgramSummary>>(EMPTY);
  const alive = useRef(true);

  // The workouts this list read are what its detail screen draws, while it is here.
  useEffect(() => {
    alive.current = true;
    const release = retainHistoryItems();
    return () => {
      alive.current = false;
      release();
    };
  }, []);

  const loadWorkouts = useCallback(async () => {
    const current = workoutsRef.current;
    if (loading.current || (current.items.length > 0 && current.cursor === null)) return;
    loading.current = true;
    setLoading(true);
    try {
      const page = await fetchSessionHistory({ cursor: current.cursor, limit: PAGE, language });
      if (!alive.current) return;
      rememberHistoryItems(page.data);
      const next = { items: [...current.items, ...page.data], cursor: page.hasMore ? page.nextCursor : null };
      workoutsRef.current = next;
      setWorkouts(next);
    } catch {
      // As on iOS: the list stays as it was.
    } finally {
      loading.current = false;
      if (alive.current) setLoading(false);
    }
  }, [language]);

  const loadPlans = useCallback(async () => {
    const current = plansRef.current;
    if (loading.current || (current.items.length > 0 && current.cursor === null)) return;
    loading.current = true;
    setLoading(true);
    try {
      const page = await fetchProgramHistory({ cursor: current.cursor, limit: PAGE, language });
      if (!alive.current) return;
      const next = { items: [...current.items, ...page.data], cursor: page.hasMore ? page.nextCursor : null };
      plansRef.current = next;
      setPlans(next);
    } catch {
      // As on iOS: the list stays as it was.
    } finally {
      loading.current = false;
      if (alive.current) setLoading(false);
    }
  }, [language]);

  // Read once, workouts then plans (iOS `.task`). A language change puts the
  // segment back where it was asked to open, and reads nothing new.
  const loadedOnce = useRef(false);
  useEffect(() => {
    setSegment(initialSegment);
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void (async () => {
      await loadWorkouts();
      await loadPlans();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per language, as iOS's `.task(id: language)`
  }, [language]);

  const openWorkout = (item: SessionHistoryItem) => navigation.navigate('WorkoutDetail', { sessionId: item.id });
  const openPlan = (plan: ProgramSummary) => {
    track('past_plan_opened');
    navigation.navigate('ProgramOverview', { programId: plan.id, mode: 'past' });
  };

  const groups = weekGroups(workouts.items);
  const showingWorkouts = segment === 'workouts';
  const isEmpty = showingWorkouts ? workouts.items.length === 0 : plans.items.length === 0;

  const header = (
    <View style={styles.segments}>
      <SegmentedControl
        segments={[
          { value: 'workouts', label: t('history.segment.workouts'), testID: 'history.segment.workouts' },
          { value: 'pastPlans', label: t('history.past_plans'), testID: 'history.segment.pastPlans' },
        ]}
        value={segment}
        onChange={setSegment}
        testID="history.segments"
      />
    </View>
  );

  const footer = (
    <>
      {isEmpty && !isLoading ? (
        <LPText size={14} color={colors.paper2} style={styles.empty} testID="history.empty">
          {t(showingWorkouts ? 'history.workouts.empty' : 'history.plans.empty')}
        </LPText>
      ) : null}
      {isLoading ? (
        <View style={styles.spinner}>
          <ActivityIndicator color={colors.rust} accessibilityLabel={t('a11y.loading')} />
        </View>
      ) : null}
    </>
  );

  const endReached = () => void (showingWorkouts ? loadWorkouts() : loadPlans());
  const listProps = {
    ListHeaderComponent: header,
    ListFooterComponent: footer,
    onEndReached: endReached,
    onEndReachedThreshold: 0.5,
    contentContainerStyle: [styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }],
    showsVerticalScrollIndicator: false,
  };

  return (
    <View style={styles.screen} testID="history.screen">
      <TopBar title={t('history.workouts.title')} onBack={() => navigation.goBack()} testID="history.topBar" />
      {showingWorkouts ? (
        <FlatList
          key="workouts"
          data={groups}
          keyExtractor={(group) => group.week}
          renderItem={({ item }) => <WeekSection group={item} onOpen={openWorkout} />}
          testID="history.workouts"
          {...listProps}
        />
      ) : (
        <FlatList
          key="plans"
          data={plans.items}
          keyExtractor={(plan) => plan.id}
          renderItem={({ item, index }) => (
            <PlanRow plan={item} first={index === 0} last={index === plans.items.length - 1} onOpen={openPlan} />
          )}
          testID="history.plans"
          {...listProps}
        />
      )}
    </View>
  );
}

/** "Week of {Monday}" and that week's workouts in one card. */
function WeekSection({ group, onOpen }: { group: WeekGroup; onOpen: (item: SessionHistoryItem) => void }) {
  const { t, language } = useT();
  return (
    <View style={styles.week}>
      <LPText size={12} weight="semibold" color={colors.paper2} accessibilityRole="header" style={styles.weekTitle}>
        {t('history.week_of', { date: shortDay(group.week, language) })}
      </LPText>
      <Card style={styles.card}>
        {group.items.map((item, index) => (
          <WorkoutRow key={item.id} item={item} divider={index > 0} onOpen={onOpen} />
        ))}
      </Card>
    </View>
  );
}

function WorkoutRow({ item, divider, onOpen }: { item: SessionHistoryItem; divider: boolean; onOpen: (item: SessionHistoryItem) => void }) {
  const { t, language } = useT();
  const source = sourceLine(item, t);
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={workoutRowLabel(item, t, language)}
      style={({ pressed }) => [styles.workout, divider && styles.divider, pressed && styles.pressed]}
      testID={`history.workout.${item.id}`}
    >
      <LPText size={10} color={colors.paper3} style={styles.workoutDay}>
        {item.date ? shortDay(item.date, language) : ''}
      </LPText>
      <View style={styles.workoutTexts}>
        {showsExtraKicker(item, t) ? <Kicker text={t('history.workout.extra')} /> : null}
        <LPText size={15} color={colors.paper}>
          {item.title ?? ''}
        </LPText>
        <LPText size={12} color={colors.paper2}>
          {workoutMetaLine(item, t, language)}
        </LPText>
        {source ? (
          <LPText size={11} color={colors.paper3}>
            {source}
          </LPText>
        ) : null}
      </View>
      <View style={styles.mark}>
        <StatusMark status={item.status ?? 'done'} />
      </View>
    </Pressable>
  );
}

function PlanRow({
  plan,
  first,
  last,
  onOpen,
}: {
  plan: ProgramSummary;
  first: boolean;
  last: boolean;
  onOpen: (plan: ProgramSummary) => void;
}) {
  const { t, language } = useT();
  const dates = dateRange(plan, t, language);
  const status = t(planStatusKey(plan));
  return (
    <Pressable
      onPress={() => onOpen(plan)}
      accessibilityRole="button"
      accessibilityLabel={[plan.summaryTitle ?? '', dates ?? '', status].filter((part) => part.length > 0).join(', ')}
      style={({ pressed }) => [styles.plan, first && styles.planFirst, last && styles.planLast, !first && styles.divider, pressed && styles.pressed]}
      testID={`history.plan.${plan.id}`}
    >
      <LPText size={15} color={colors.paper}>
        {plan.summaryTitle ?? ''}
      </LPText>
      {dates ? (
        <LPText size={12} color={colors.paper2}>
          {dates}
        </LPText>
      ) : null}
      <LPText size={12} weight="semibold" color={colors.paper3}>
        {status}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  // No gap: a past plan's rows are one card the list draws in pieces.
  content: { paddingTop: 16 },
  segments: { paddingHorizontal: 20, marginBottom: 18 },
  empty: { paddingHorizontal: 24, paddingVertical: 24 },
  spinner: { paddingVertical: 20, alignItems: 'center' },
  week: { gap: 10, marginBottom: 18 },
  weekTitle: { paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  workout: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  workoutDay: { width: 72, paddingTop: 2 },
  workoutTexts: { flex: 1, gap: 3 },
  mark: { paddingTop: 3 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  plan: {
    marginHorizontal: 20,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    backgroundColor: colors.ink2,
    borderLeftWidth: hairline,
    borderRightWidth: hairline,
    borderColor: colors.line,
  },
  planFirst: { borderTopWidth: hairline, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  planLast: { borderBottomWidth: hairline, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  pressed: { opacity: 0.7 },
});
