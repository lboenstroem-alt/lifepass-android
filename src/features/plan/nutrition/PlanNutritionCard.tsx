/**
 * What was eaten against what the plan asks for (iOS PlanNutritionCard,
 * `ios-ux.md` 3.10): "Today's food" (or "Food on {date}" with "Back to
 * today"), then
 *
 *   the target      "Target: about 1,800 to 2,000 kcal, 120 g protein" and
 *                   its Estimate chip; or why targets are off; or a way to
 *                   get them (the body sheet, the calorie goal)
 *   target weight   today only: reached, outside a healthy range, or the
 *                   line (with a rough time estimate) that opens the sheet
 *   eaten           the shared day-energy line, the kcal and protein bars
 *                   (their numbers in their TalkBack labels) and the left /
 *                   within / over line, always neutral, never red
 *   meals           up to four saved meals, the ones waiting in the outbox
 *                   ("Waiting to sync"), "+N more meals" to the diary
 *   drafts          today only: estimates waiting for review
 *   actions         Scan a meal and Add food (entitled, online), Food diary
 *
 * Every rule is ./nutritionRules.ts; this file draws. Plan's section
 * (../sections/Nutrition.tsx) hands it the day and the doors.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, EstimateChip, hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { mealItemSummary, type HealthMealsBlock, type MealDraftBrief, type TargetWeightView } from '../../../health';
import { useT } from '../../../i18n';
import { dayEnergy, decimal, grams, integer, kcal, shortDay } from '../../../i18n/format';
import { colors, hairline, radius } from '../../../theme';

import {
  confirmedMeals,
  draftsRow,
  eatenParams,
  groupedParams,
  MEAL_ROWS_SHOWN,
  mealEnergyText,
  mealSlotKey,
  targetRow,
  targetWeightRow,
} from './nutritionRules';
import type { PlanQueuedMeal } from './queuedMeals';

export type PlanNutritionCardProps = {
  meals: HealthMealsBlock | null;
  /** Every estimate waiting for review (today's read), newest first. */
  drafts: readonly MealDraftBrief[];
  /** Meals waiting in the outbox for the date shown. */
  queued: readonly PlanQueuedMeal[];
  /** The date the card is showing (the week strip's, for a past date). */
  shownDate: string;
  isToday: boolean;
  hasLiveProgram: boolean;
  hasCalorieGoal: boolean;
  isOffline: boolean;
  isReadOnly: boolean;
  /** Today only, on a server with target weights; null hides every target weight line. */
  targetWeight: TargetWeightView | null;
  onBackToToday: () => void;
  onSetTargets: () => void;
  onSetGoal: () => void;
  onOpenMeal: (mealId: string) => void;
  onOpenDrafts: () => void;
  onScan: () => void;
  onAdd: () => void;
  onDiary: () => void;
  /** The target weight sheet. */
  onSetTarget: () => void;
  testID?: string;
};

const ZERO_TOTALS = { kcalLow: 0, kcalHigh: 0, proteinG: 0 };

export default function PlanNutritionCard(props: PlanNutritionCardProps) {
  const { meals, drafts, queued, shownDate, isToday, testID = 'plan.nutrition' } = props;
  const { t, tp, language } = useT();
  const saved = confirmedMeals(meals);
  const drafted = isToday ? draftsRow(drafts) : null;
  const weightRow = targetWeightRow(isToday, props.targetWeight, language);

  const rows: ReactNode[] = [];
  if (!isToday) rows.push(<BackToTodayChip key="back" onPress={props.onBackToToday} testID={`${testID}.back`} />);
  rows.push(<TargetRowView key="target" {...props} testID={testID} />);
  if (weightRow) rows.push(<TargetWeightRowView key="weight" row={weightRow} {...props} testID={testID} />);
  rows.push(<EatenRow key="eaten" meals={meals} testID={testID} />);

  if (saved.length === 0 && queued.length === 0) {
    rows.push(
      <LPText key="none" size={14} color={colors.paper2} testID={`${testID}.none`}>
        {t('plan.nutrition.none_yet')}
      </LPText>,
    );
  } else {
    for (const meal of saved.slice(0, MEAL_ROWS_SHOWN)) {
      const summary = mealItemSummary(meal);
      const energy = mealEnergyText(meal, t, language);
      rows.push(
        <Pressable
          key={`meal-${meal.id}`}
          onPress={() => props.onOpenMeal(meal.id)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.mealRow, pressed && styles.pressed]}
          testID={`${testID}.meal.${meal.id}`}
        >
          <View style={styles.mealText}>
            <Kicker text={t(mealSlotKey(meal.slot))} />
            <LPText size={15} color={colors.paper} numberOfLines={1} ellipsizeMode="tail">
              {summary}
            </LPText>
          </View>
          {energy ? (
            <LPText size={14} weight="semibold" color={colors.paper}>
              {energy}
            </LPText>
          ) : null}
        </Pressable>,
      );
    }
    for (const entry of queued) {
      rows.push(<QueuedMealRow key={`queued-${entry.id}`} entry={entry} testID={testID} />);
    }
    if (saved.length > MEAL_ROWS_SHOWN) {
      const extra = saved.length - MEAL_ROWS_SHOWN;
      const label = tp('plan.nutrition.more_meals', extra);
      rows.push(
        <Pressable
          key="more"
          onPress={props.onDiary}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.minRow, pressed && styles.pressed]}
          testID={`${testID}.more`}
        >
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {label}
          </LPText>
        </Pressable>,
      );
    }
  }

  if (drafted) {
    const label = tp(drafted.pluralBase, drafted.count);
    const seeAll = t('plan.nutrition.drafts_all');
    rows.push(
      <View key="drafts" style={styles.draftsRow}>
        <Pressable
          onPress={() => props.onOpenMeal(drafted.newestId)}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.draftsMain, pressed && styles.pressed]}
          testID={`${testID}.drafts`}
        >
          <View style={styles.icon} {...hiddenFromAccessibility}>
            <Ionicons name={drafted.allPhotos ? 'scan-outline' : 'chatbubble-ellipses-outline'} size={16} color={colors.rust} />
          </View>
          <LPText size={14} color={colors.paper} style={styles.flex}>
            {label}
          </LPText>
        </Pressable>
        {drafted.showsSeeAll ? (
          <Pressable
            onPress={props.onOpenDrafts}
            accessibilityRole="button"
            accessibilityLabel={seeAll}
            style={({ pressed }) => [styles.minRow, pressed && styles.pressed]}
            testID={`${testID}.drafts.all`}
          >
            <LPText size={13} weight="semibold" color={colors.paper2}>
              {seeAll}
            </LPText>
          </Pressable>
        ) : null}
      </View>,
    );
  }

  rows.push(<ActionRow key="actions" {...props} testID={testID} />);

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <Kicker text={t('plan.nutrition.kicker')} />
        <LPText serif size={22} color={colors.paper} accessibilityRole="header">
          {isToday ? t('plan.nutrition.title') : t('plan.nutrition.title_day', { date: shortDay(shownDate, language) })}
        </LPText>
      </View>
      <Card style={styles.card}>
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.row}>{row}</View>
          </View>
        ))}
      </Card>
    </View>
  );
}

// MARK: - Rows

function BackToTodayChip({ onPress, testID }: { onPress: () => void; testID: string }) {
  const { t } = useT();
  const label = t('plan.back_to_today');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={12} weight="semibold" color={colors.rust}>
        {label}
      </LPText>
    </Pressable>
  );
}

function TargetRowView({
  meals,
  hasLiveProgram,
  hasCalorieGoal,
  isReadOnly,
  isOffline,
  onSetTargets,
  onSetGoal,
  testID,
}: PlanNutritionCardProps & { testID: string }) {
  const { t, language } = useT();
  const row = targetRow(meals, hasLiveProgram, hasCalorieGoal);
  switch (row.kind) {
    case 'target':
      return (
        <View style={styles.stack4} testID={`${testID}.target`}>
          <View style={styles.lineWithChip}>
            <LPText size={14} color={colors.paper} style={styles.shrink}>
              {t('plan.nutrition.target', {
                low: integer(row.target.kcalLow, language),
                high: integer(row.target.kcalHigh, language),
                protein: decimal(row.target.proteinG, language, 0),
              })}
            </LPText>
            <EstimateChip />
          </View>
          {row.fromGoal ? (
            <LPText size={12} color={colors.paper2}>
              {t('plan.nutrition.basis_goal')}
            </LPText>
          ) : null}
        </View>
      );
    case 'withheld':
      return (
        <LPText size={14} color={colors.paper2} testID={`${testID}.withheld`}>
          {t('plan.targets.withheld')}
        </LPText>
      );
    case 'setBody':
    case 'setGoal': {
      const label = t(row.key);
      const disabled = isReadOnly || isOffline;
      return (
        <Pressable
          onPress={row.kind === 'setBody' ? onSetTargets : onSetGoal}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          // Disabled, not faded: iOS `targetButton` draws no dimming (only Scan fades).
          style={({ pressed }) => [styles.buttonRow, pressed && styles.pressed]}
          testID={`${testID}.set_${row.kind === 'setBody' ? 'targets' : 'goal'}`}
        >
          <LPText size={14} color={colors.rust} style={styles.flex}>
            {label}
          </LPText>
          <View {...hiddenFromAccessibility}>
            <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
          </View>
        </Pressable>
      );
    }
  }
}

function TargetWeightRowView({
  row,
  isReadOnly,
  isOffline,
  onSetTarget,
  testID,
}: PlanNutritionCardProps & { row: NonNullable<ReturnType<typeof targetWeightRow>>; testID: string }) {
  const { t } = useT();
  const disabled = isReadOnly || isOffline;
  if (row.kind === 'line') {
    const line = t(row.line.key, row.line.params);
    return (
      <Pressable
        onPress={onSetTarget}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.targetLine, pressed && styles.pressed]}
        testID={`${testID}.target_weight.line`}
      >
        <LPText size={12} color={colors.paper2}>
          {line}
        </LPText>
        {row.hasEta ? (
          <LPText size={11} color={colors.paper3}>
            {t('target.eta_note')}
          </LPText>
        ) : null}
      </Pressable>
    );
  }
  // The reached and the unhealthy notes: an inset panel with the way to a new target.
  const cta = t('target.reached.cta');
  return (
    <View style={styles.note} testID={`${testID}.target_weight.${row.kind}`}>
      {row.kind === 'reached' ? (
        <LPText size={14} weight="semibold" color={colors.paper}>
          {t('target.reached.title')}
        </LPText>
      ) : null}
      <LPText size={13} color={colors.paper2}>
        {t(row.kind === 'reached' ? 'target.reached.body' : 'target.unhealthy.body')}
      </LPText>
      <Pressable
        onPress={onSetTarget}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={cta}
        accessibilityState={{ disabled }}
        // As the line above: disabled without a fade, as iOS draws it.
        style={({ pressed }) => [styles.minRow, pressed && styles.pressed]}
        testID={`${testID}.target_weight.cta`}
      >
        <LPText size={13} weight="semibold" color={colors.rust}>
          {cta}
        </LPText>
      </Pressable>
    </View>
  );
}

function EatenRow({ meals, testID }: { meals: HealthMealsBlock | null; testID: string }) {
  const { t, language } = useT();
  const totals = meals?.totals ?? ZERO_TOTALS;
  const target = meals?.target ?? null;
  const energy = dayEnergy(totals, target);
  return (
    <View style={styles.stack8} testID={`${testID}.eaten`}>
      <View style={styles.lineWithChip}>
        <LPText size={14} color={colors.paper} style={styles.shrink}>
          {t(energy.eaten.key, eatenParams(energy.eaten.params, totals.proteinG, language))}
        </LPText>
        {energy.showsEstimateChip ? <EstimateChip /> : null}
      </View>
      {energy.kcalFill !== null && energy.proteinFill !== null && target && energy.targetMidKcal !== null ? (
        // The bars carry their numbers in their labels: a fill nobody can
        // see is information only sighted members get (3.18).
        <>
          <Bar
            fill={energy.kcalFill}
            label={`${kcal(energy.eatenMidKcal, language)} / ${kcal(energy.targetMidKcal, language)}`}
            testID={`${testID}.bar.kcal`}
          />
          <Bar
            fill={energy.proteinFill}
            label={`${grams(totals.proteinG, language)} / ${grams(target.proteinG, language)}`}
            testID={`${testID}.bar.protein`}
          />
        </>
      ) : null}
      {energy.status ? (
        <LPText size={12} color={colors.paper2} testID={`${testID}.status`}>
          {t(energy.status.key, groupedParams(energy.status.params, language))}
        </LPText>
      ) : null}
    </View>
  );
}

function Bar({ fill, label, testID }: { fill: number; label: string; testID: string }) {
  const width = `${Math.max(0, Math.min(1, fill)) * 100}%` as const;
  return (
    <View style={styles.bar} accessible accessibilityLabel={label} testID={testID}>
      <View style={[styles.barFill, { width }]} />
    </View>
  );
}

function QueuedMealRow({ entry, testID }: { entry: PlanQueuedMeal; testID: string }) {
  const { t } = useT();
  return (
    <View style={styles.mealRow} accessible testID={`${testID}.queued.${entry.id}`}>
      <View style={styles.mealText}>
        <Kicker text={t(mealSlotKey(entry.slot))} />
        <LPText size={15} color={colors.paper} numberOfLines={1} ellipsizeMode="tail">
          {entry.labels.join(', ')}
        </LPText>
      </View>
      <View style={styles.waiting}>
        <LPText size={10} weight="semibold" color={colors.signal}>
          {t('plan.waiting_sync')}
        </LPText>
      </View>
    </View>
  );
}

/** Scan and Add open the meal page; Food diary pushes the diary. A read-only member gets the diary only. */
function ActionRow({ isReadOnly, isOffline, onScan, onAdd, onDiary, testID }: PlanNutritionCardProps & { testID: string }) {
  const { t } = useT();
  const scan = t('plan.nutrition.scan');
  const add = t('plan.nutrition.add');
  const diary = t('plan.nutrition.diary');
  return (
    <View style={styles.stack10}>
      <View style={styles.actions}>
        {isReadOnly ? null : (
          <>
            <Pressable
              onPress={onScan}
              disabled={isOffline}
              accessibilityRole="button"
              accessibilityLabel={scan}
              accessibilityState={{ disabled: isOffline }}
              hitSlop={4}
              style={({ pressed }) => [styles.scan, isOffline && styles.disabled, pressed && styles.pressed]}
              testID={`${testID}.scan`}
            >
              <LPText size={13} weight="semibold" color={colors.onAccent}>
                {scan}
              </LPText>
            </Pressable>
            <Pressable
              onPress={onAdd}
              disabled={isOffline}
              accessibilityRole="button"
              accessibilityLabel={add}
              accessibilityState={{ disabled: isOffline }}
              style={({ pressed }) => [styles.minRow, pressed && styles.pressed]}
              testID={`${testID}.add`}
            >
              <LPText size={13} weight="semibold" color={colors.paper2}>
                {add}
              </LPText>
            </Pressable>
          </>
        )}
        <Pressable
          onPress={onDiary}
          accessibilityRole="button"
          accessibilityLabel={diary}
          style={({ pressed }) => [styles.minRow, pressed && styles.pressed]}
          testID={`${testID}.diary`}
        >
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {diary}
          </LPText>
        </Pressable>
      </View>
      {isOffline ? (
        <LPText size={12} color={colors.paper3} testID={`${testID}.offline`}>
          {t('health.offline.action_hint')}
        </LPText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  stack4: { gap: 4 },
  stack8: { gap: 8 },
  stack10: { gap: 10 },
  lineWithChip: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  shrink: { flexShrink: 1 },
  flex: { flex: 1 },
  chip: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.rust3,
  },
  buttonRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
  targetLine: { minHeight: 44, justifyContent: 'center', gap: 4 },
  note: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: colors.ink3 },
  minRow: { minHeight: 44, justifyContent: 'center' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.ink3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.rust },
  mealRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44 },
  mealText: { flex: 1, gap: 3 },
  waiting: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.rust3 },
  draftsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  draftsMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  icon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16 },
  scan: { minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.rust },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
