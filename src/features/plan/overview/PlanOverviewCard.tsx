/* eslint lifepass/no-literal-copy: "error" */
/**
 * "This plan": the month at a glance, and the three decisions a member can
 * make about it (iOS PlanOverviewCard.swift, `ios-ux.md` 3.9.1).
 *
 *   This plan / {summary title}
 *   17 September to 14 October
 *   Days: Mon, Wed, Fri                                     Change
 *   About 1,800 to 2,100 kcal a day, 120 g protein  [Estimate]
 *     (or the withheld line, the gentle-plan line, or "Add weight and
 *      height for calorie targets", which opens the body sheet)
 *   See all 4 weeks                                              >
 *   Pause plan (Resume plan)    End plan
 *   This needs a connection.  (offline only)
 *
 * Pause, resume and end sit here rather than behind a menu because a plan
 * you cannot stop is a plan that nags you. All three (and Change, and the
 * targets invitation) are refused offline or read only, and for a finished
 * block; See all weeks never is. The host asks before pause and end;
 * resume undoes a pause and needs no ceremony.
 *
 * A plan the member wrote, or one a chat edit made repeat as a cycle
 * (`program.custom`), says how often it repeats ("Repeats every 4 days")
 * instead of its padded weekdays, and offers no Change days and no Adjust
 * my plan: the server refuses both on such a plan (COACH-6, as iOS).
 *
 * "Adjust my plan" is a row here once the Coach's chip reads "Change my
 * plan" (the server changes plans from words), so Adjust keeps a way in
 * (`onAdjust`; absent hides it).
 *
 * Pure presentation: the section (../sections/Overview.tsx) wires the taps.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, EstimateChip, hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { isCustomProgram, type ProgramSummary } from '../../../health';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';

import { cycleDaysLine, dateRange, targetsLine, targetsText, weekdayList } from './planCopy';

export type PlanOverviewCardProps = {
  program: ProgramSummary;
  isOffline: boolean;
  /** Read only, or a finished block (its rows offer what they always did, greyed). */
  isReadOnly: boolean;
  onSeeAll: () => void;
  onChangeDays: () => void;
  onSetTargets: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  /** Adjust my plan in the Coach (COACH-6): offered once the Coach's chip is "Change my plan". Absent hides it. */
  onAdjust?: () => void;
  testID?: string;
};

export default function PlanOverviewCard({
  program,
  isOffline,
  isReadOnly,
  onSeeAll,
  onChangeDays,
  onSetTargets,
  onPause,
  onResume,
  onEnd,
  onAdjust,
  testID = 'plan.overview',
}: PlanOverviewCardProps) {
  const { t, language } = useT();
  const actionsDisabled = isOffline || isReadOnly;
  const dates = dateRange(program, t, language);
  const paused = program.status === 'paused';
  const targets = targetsLine(program);

  const rows: ReactNode[] = [];
  if (dates) {
    rows.push(
      <LPText key="dates" size={14} color={colors.paper} testID={`${testID}.dates`}>
        {dates}
      </LPText>,
    );
  }
  const custom = isCustomProgram(program);
  rows.push(
    <View key="days" style={styles.inline}>
      <LPText size={14} color={colors.paper} style={styles.grow} testID={`${testID}.days`}>
        {custom
          ? cycleDaysLine(program, t, language)
          : t('plan.overview.days', { days: weekdayList(program.trainingDays, language) })}
      </LPText>
      {!custom ? (
        <TextButton
          title={t('plan.overview.change_days')}
          onPress={onChangeDays}
          disabled={actionsDisabled}
          testID={`${testID}.changeDays`}
        />
      ) : null}
    </View>,
  );
  rows.push(
    targets.kind === 'none' ? (
      <ChevronButton
        key="targets"
        title={targetsText(targets, t, language)}
        color={colors.rust}
        onPress={onSetTargets}
        disabled={actionsDisabled}
        testID={`${testID}.setTargets`}
      />
    ) : targets.kind === 'targets' ? (
      <View key="targets" style={styles.targets}>
        <LPText size={14} color={colors.paper} style={styles.shrink} testID={`${testID}.targets`}>
          {targetsText(targets, t, language)}
        </LPText>
        <EstimateChip />
      </View>
    ) : (
      <LPText key="targets" size={14} color={colors.paper2} testID={`${testID}.targets`}>
        {targetsText(targets, t, language)}
      </LPText>
    ),
  );
  if (onAdjust && !custom) {
    rows.push(
      <ChevronButton
        key="adjust"
        title={t('coach.chip.adjust_plan')}
        weight="semibold"
        color={colors.paper}
        onPress={onAdjust}
        disabled={actionsDisabled}
        testID={`${testID}.adjust`}
      />,
    );
  }
  rows.push(
    <ChevronButton
      key="seeAll"
      title={t('plan.overview.see_all', { weeks: String(program.weeks ?? 4) })}
      weight="semibold"
      color={colors.paper}
      onPress={onSeeAll}
      testID={`${testID}.seeAll`}
    />,
  );
  rows.push(
    <View key="decisions" style={styles.decisions}>
      <TextButton
        title={t(paused ? 'plan.overview.resume' : 'plan.overview.pause')}
        onPress={paused ? onResume : onPause}
        disabled={actionsDisabled}
        testID={`${testID}.${paused ? 'resume' : 'pause'}`}
      />
      <TextButton
        title={t('plan.overview.end')}
        color={colors.destructive}
        onPress={onEnd}
        disabled={actionsDisabled}
        testID={`${testID}.end`}
      />
    </View>,
  );
  if (isOffline) {
    rows.push(
      <LPText key="offline" size={12} color={colors.paper3}>
        {t('health.offline.action_hint')}
      </LPText>,
    );
  }

  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <Kicker text={t('plan.overview.kicker')} />
        <LPText serif size={22} color={colors.paper} accessibilityRole="header">
          {program.summaryTitle ?? t('plan.overview.title')}
        </LPText>
      </View>
      <Card style={styles.card}>
        {rows.map((row, index) => (
          <View key={index} style={[styles.row, index > 0 && styles.divider]}>
            {row}
          </View>
        ))}
      </Card>
    </View>
  );
}

/** A quiet text button (13 semibold), 44 dp tall; dimmed when refused. */
function TextButton({
  title,
  onPress,
  disabled = false,
  color = colors.paper2,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.textButton, disabled && styles.disabled, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={color}>
        {title}
      </LPText>
    </Pressable>
  );
}

/** A full-width row with a trailing chevron (See all weeks, the targets invitation). */
function ChevronButton({
  title,
  onPress,
  disabled = false,
  color,
  weight = 'regular',
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
  weight?: 'regular' | 'semibold';
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.chevronRow, disabled && styles.disabled, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={14} weight={weight} color={color} style={styles.shrink}>
        {title}
      </LPText>
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
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  targets: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  decisions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  chevronRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
