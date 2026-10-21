/* eslint lifepass/no-literal-copy: "error" */
/**
 * Plan's History card (PLAN-4, mounted by PLAN-1 last on the page, under
 * the gate, the intro and the plan alike; iOS `PlanHistoryCard`): shown only
 * when the day's read has workouts or a day with a logged meal.
 *
 *   History / Workouts and meals
 *   Workouts        {the latest workout's day}   >   the workout history
 *   Meals           {n} meals (the logged days)  >   the meal calendar (MEAL-5)
 *
 * A lapsed member whose consent stands keeps this card: their plan is gone,
 * what they logged is not.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { colors, hairline } from '../../../theme';
import { historyCardContent } from '../history/historyRules';
import { pushPlanRoute, usePlanView } from '../shell';

export default function HistorySection() {
  const { t, tp, language } = useT();
  const { shownDay } = usePlanView();
  const content = historyCardContent(shownDay?.history ?? null);
  if (!content) return null;

  return (
    <View style={styles.section} testID="plan.history">
      <View style={styles.header}>
        <Kicker text={t('history.kicker')} />
        <LPText serif size={22} color={colors.paper} accessibilityRole="header">
          {t('history.title')}
        </LPText>
      </View>
      <Card style={styles.card}>
        <HistoryRow
          title={t('history.workouts.title')}
          detail={content.latestWorkoutDate ? shortDay(content.latestWorkoutDate, language) : null}
          onPress={() => {
            track('history_opened', { kind: 'workouts' });
            pushPlanRoute('WorkoutHistory', { segment: 'workouts' });
          }}
          testID="plan.history.workouts"
        />
        <HistoryRow
          title={t('history.meals.title')}
          detail={tp('history.meal.count', content.loggedDays)}
          divider
          onPress={() => {
            track('history_opened', { kind: 'meals' });
            pushPlanRoute('MealHistory');
          }}
          testID="plan.history.meals"
        />
      </Card>
    </View>
  );
}

function HistoryRow({
  title,
  detail,
  divider = false,
  onPress,
  testID,
}: {
  title: string;
  detail: string | null;
  divider?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={15} color={colors.paper} style={styles.title}>
        {title}
      </LPText>
      {detail ? (
        <LPText size={13} color={colors.paper2}>
          {detail}
        </LPText>
      ) : null}
      <View {...hiddenFromAccessibility}>
        <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 52 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  title: { flex: 1 },
  pressed: { opacity: 0.7 },
});
