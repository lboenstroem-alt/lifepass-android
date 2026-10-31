/* eslint lifepass/no-literal-copy: "error" */
/**
 * Route `WorkoutDetail`: one finished workout (iOS `WorkoutDetailView`,
 * PlanHistory.swift).
 *
 *   ("Extra workout") {title}
 *   Wed 15 Oct · 40 min · Just right
 *   Counted from your check-in at {venue}   (or a synced workout)
 *   {the member's note}                      (dormant: API 0.34.0 sends none)
 *   each exercise: its name, "Swapped for {name}", then "Skipped" or a line
 *   per set ("Set 1: 10 reps, 40 kg", "Set 2: 45 s", "Set 3: 50 m"), or
 *   "Logged without set details." when nothing was performed set by set.
 *
 * The workout is the one the history list read (`sessionId` is the history
 * item's id): there is no endpoint for one item. Opened without that list
 * (it has gone), the page has nothing to draw but its bar, as iOS draws
 * nothing for an id it no longer holds.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Kicker, LPText, TopBar } from '../../../components/ui';
import type { PerformedExercise, SessionHistoryItem } from '../../../health';
import { useT } from '../../../i18n';
import type { SharedRouteProps } from '../../../navigation/types';
import { colors, hairline } from '../../../theme';

import { historyItem } from './historyCache';
import { detailMetaLine, setLine, showsExtraKicker, sourceLine } from './historyRules';

const BOTTOM_ROOM = 64;

export default function WorkoutDetailScreen({ route, navigation }: SharedRouteProps<'WorkoutDetail'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const item = historyItem(route.params.sessionId);

  return (
    <View style={styles.screen} testID="workoutDetail.screen">
      <TopBar title={t('history.workouts.title')} onBack={() => navigation.goBack()} testID="workoutDetail.topBar" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
      >
        {item ? <Workout item={item} /> : null}
      </ScrollView>
    </View>
  );
}

function Workout({ item }: { item: SessionHistoryItem }) {
  const { t, language } = useT();
  const source = sourceLine(item, t);
  const note = item.note?.trim() ?? '';
  const performed = item.performed ?? [];
  return (
    <>
      <View style={styles.header}>
        {showsExtraKicker(item, t) ? <Kicker text={t('history.workout.extra')} /> : null}
        <LPText serif size={24} color={colors.paper} accessibilityRole="header">
          {item.title ?? ''}
        </LPText>
        <LPText size={13} color={colors.paper2}>
          {detailMetaLine(item, t, language)}
        </LPText>
        {source ? (
          <LPText size={12} color={colors.paper3}>
            {source}
          </LPText>
        ) : null}
        {note.length > 0 ? (
          // The member's own words, as plain text.
          <LPText size={14} color={colors.paper} style={styles.note}>
            {note}
          </LPText>
        ) : null}
      </View>

      {performed.length === 0 ? (
        <LPText size={14} color={colors.paper2} style={styles.noSets} testID="workoutDetail.noSets">
          {t('history.detail.no_sets')}
        </LPText>
      ) : (
        <Card style={styles.card}>
          {performed.map((exercise, index) => (
            <ExerciseBlock key={`${exercise.exerciseId ?? 'exercise'}-${index}`} exercise={exercise} divider={index > 0} />
          ))}
        </Card>
      )}
    </>
  );
}

function ExerciseBlock({ exercise, divider }: { exercise: PerformedExercise; divider: boolean }) {
  const { t, language } = useT();
  return (
    <View style={[styles.exercise, divider && styles.divider]}>
      <LPText size={15} weight="semibold" color={colors.paper}>
        {exercise.name ?? ''}
      </LPText>
      {exercise.swappedFromName ? (
        <LPText size={12} color={colors.paper3}>
          {t('history.detail.swapped', { name: exercise.swappedFromName })}
        </LPText>
      ) : null}
      {exercise.skipped === true ? (
        <LPText size={13} color={colors.paper2}>
          {t('history.detail.skipped')}
        </LPText>
      ) : (
        (exercise.sets ?? []).map((set, index) => (
          <LPText key={index} size={13} color={colors.paper2}>
            {setLine(set, index + 1, t, language)}
          </LPText>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 16, gap: 18 },
  header: { gap: 8, paddingHorizontal: 24 },
  note: { paddingTop: 4 },
  noSets: { paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  exercise: { gap: 5, paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
});
