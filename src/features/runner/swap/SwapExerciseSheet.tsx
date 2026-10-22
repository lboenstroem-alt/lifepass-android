/**
 * "Swap exercise" (iOS `SwapExerciseSheet`, Views/Workout/SwapExerciseSheet.swift,
 * `ios-ux.md` 7.5): what is on screen now, then one row per exercise the
 * runner can swap to, each with the dose it would run with ("Bodyweight ·
 * 3 × 10", "Back to the planned exercise · 2 × 30 s"), because a swap can
 * change how the exercise is measured, and its level relative to what is on
 * screen now. "Use this swap for the rest of the plan" shows only online
 * and only when a real alternative is offered; it starts off. Then Cancel.
 *
 * The rows are `controller.swapOptions()` and nothing else (./swapFlow.ts).
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { Card, hiddenFromAccessibility, LPText, Sheet, ToggleRow } from '../../../components/ui';
import { useT } from '../../../i18n';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { colors, hairline } from '../../../theme';
import type { RunnerSwapOption } from '../model/types';

export interface SwapExerciseSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onClosed?: () => void;
  /** The exercise on screen. */
  readonly currentName: string;
  /** The block's set count, which a swap keeps. */
  readonly setCount: number;
  readonly options: readonly RunnerSwapOption[];
  /** "Use this swap for the rest of the plan" needs the server, so it is hidden offline. */
  readonly canUseForRestOfPlan: boolean;
  /** A row was chosen; `forRestOfPlan` is already false for the way back and offline. */
  readonly onSelect: (option: RunnerSwapOption, forRestOfPlan: boolean) => void;
}

export default function SwapExerciseSheet({
  visible,
  onClose,
  onClosed,
  currentName,
  setCount,
  options,
  canUseForRestOfPlan,
  onSelect,
}: SwapExerciseSheetProps) {
  const { t } = useT();
  const titleRef = useRef<Text>(null);
  // A fresh sheet starts with the toggle off (iOS keeps it per presentation).
  const [forRestOfPlan, setForRestOfPlan] = useState(false);
  const showsToggle = canUseForRestOfPlan && options.some((option) => !option.isPlanned);

  /** "Bodyweight · 3 × 12", or "Back to the planned exercise · 2 × 30 s". */
  const detailLine = (option: RunnerSwapOption): string => {
    const dose = RunnerFormat.planLine(option.unit, option.target, setCount, option.perSide, t);
    const lead = option.isPlanned ? t('runner.swap_back') : (option.equipmentLabel ?? '');
    return lead ? `${lead} · ${dose}` : dose;
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        setForRestOfPlan(false);
        onClosed?.();
      }}
      initialFocusRef={titleRef}
      testID="swap.sheet"
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('runner.swap_title')}
          </LPText>
          <LPText size={14} color={colors.paper2} testID="swap.current">
            {t('runner.swap_current', { name: currentName })}
          </LPText>
        </View>

        <Card>
          {options.map((option, index) => {
            const detail = detailLine(option);
            const level = t(`runner.level.${option.level}`);
            return (
              <View key={option.exerciseId}>
                {index > 0 ? <View style={styles.rule} /> : null}
                <Pressable
                  testID={`swap.option.${option.exerciseId}`}
                  onPress={() => onSelect(option, forRestOfPlan && canUseForRestOfPlan && !option.isPlanned)}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.name}, ${detail}, ${level}`}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.rowTexts}>
                    <LPText size={15} weight="semibold" color={colors.paper}>
                      {option.name}
                    </LPText>
                    <LPText size={12} color={colors.paper2} testID={`swap.option.${option.exerciseId}.detail`}>
                      {detail}
                    </LPText>
                  </View>
                  <View style={styles.level}>
                    <LPText size={12} weight="semibold" color={colors.signal}>
                      {level}
                    </LPText>
                  </View>
                  <View {...hiddenFromAccessibility}>
                    <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Card>

        {showsToggle ? (
          <View style={styles.toggle}>
            <ToggleRow
              title={t('runner.swap_future')}
              value={forRestOfPlan}
              onValueChange={setForRestOfPlan}
              testID="swap.future"
            />
          </View>
        ) : null}

        <Pressable
          testID="swap.cancel"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <LPText size={14} weight="semibold" color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingTop: 8, paddingBottom: 8 },
  header: { gap: 6 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  rowTexts: { flex: 1, gap: 3 },
  level: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.rust3,
  },
  // The switch row's own padding, given back so its words line up with the sheet's.
  toggle: { marginHorizontal: -16 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
