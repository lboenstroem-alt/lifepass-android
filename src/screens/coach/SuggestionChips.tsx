/* eslint lifepass/no-literal-copy: "error" */
// The empty state's chips (iOS CoachView.swift `suggestionChips`): a 2x2 grid
// of the free, model-less paths, then two full-width chips.
//
//   What's nearby? / After work / Something new   the category strip
//   Lagoon enthusiast                             the lagoon wizard, directly
//   Plan my day                                   the day-plan wizard
//   Get a 4-week plan                             the programme wizard; reads
//                                                 "Adjust my plan" while a plan
//                                                 runs on a server that revises;
//                                                 hidden for a member under 18
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';

export type SuggestionChipAction =
  | { readonly kind: 'categoryPicker'; readonly labelKey: string }
  | { readonly kind: 'search'; readonly categoryKey: string; readonly labelKey: string }
  | { readonly kind: 'plan'; readonly labelKey: string }
  | { readonly kind: 'program' }
  | { readonly kind: 'adjust' };

interface ChipDef {
  readonly id: string;
  readonly labelKey: string;
  readonly action: SuggestionChipAction;
}

/** The grid, in iOS order. */
export const GRID_CHIPS: readonly ChipDef[] = [
  { id: 'c1', labelKey: 'coach.chip.nearby', action: { kind: 'categoryPicker', labelKey: 'coach.chip.nearby' } },
  { id: 'c2', labelKey: 'coach.chip.after_work', action: { kind: 'categoryPicker', labelKey: 'coach.chip.after_work' } },
  {
    id: 'c3',
    labelKey: 'coach.chip.lagoon',
    action: { kind: 'search', categoryKey: 'lagoon', labelKey: 'coach.chip.lagoon' },
  },
  {
    id: 'c4',
    labelKey: 'coach.chip.something_new',
    action: { kind: 'categoryPicker', labelKey: 'coach.chip.something_new' },
  },
];

const PLAN_CHIP: ChipDef = {
  id: 'c5',
  labelKey: 'coach.chip.plan_day',
  action: { kind: 'plan', labelKey: 'coach.chip.plan_day' },
};
const PROGRAM_CHIP: ChipDef = { id: 'c6', labelKey: 'coach.chip.program', action: { kind: 'program' } };
const ADJUST_CHIP: ChipDef = { id: 'adjust', labelKey: 'coach.chip.adjust_plan', action: { kind: 'adjust' } };

/**
 * The full-width chips: "Plan my day", then the programme chip unless the
 * member is under 18 (no plan feature to offer), as "Adjust my plan" when
 * `programChipAdjusts`.
 */
export function fullWidthChips(options: { readonly isMinor: boolean; readonly programChipAdjusts: boolean }): ChipDef[] {
  if (options.isMinor) return [PLAN_CHIP];
  return [PLAN_CHIP, options.programChipAdjusts ? ADJUST_CHIP : PROGRAM_CHIP];
}

type Props = {
  isMinor: boolean;
  programChipAdjusts: boolean;
  onAction: (action: SuggestionChipAction) => void;
};

export default function SuggestionChips({ isMinor, programChipAdjusts, onAction }: Props) {
  const { t } = useT();
  const chip = (def: ChipDef, fullWidth: boolean) => (
    <Pressable
      key={def.id}
      onPress={() => onAction(def.action)}
      style={({ pressed }) => [styles.chip, fullWidth ? styles.full : styles.half, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={t(def.labelKey)}
      testID={`coach.chip.${def.id}`}
    >
      <LPText size={15} weight="medium" color="#FFFFFF" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {t(def.labelKey)}
      </LPText>
    </Pressable>
  );
  return (
    <View style={styles.root}>
      <View style={styles.grid}>{GRID_CHIPS.map((def) => chip(def, false))}</View>
      {fullWidthChips({ isMinor, programChipAdjusts }).map((def) => chip(def, true))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: coachPalette.tile,
    borderWidth: 1,
    borderColor: coachPalette.chipStroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two columns with a 12 dp gap.
  half: { flexBasis: '47%', flexGrow: 1 },
  full: { alignSelf: 'stretch' },
  pressed: { opacity: 0.8 },
});
