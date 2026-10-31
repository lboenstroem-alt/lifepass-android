// The Venues / Classes switch (iOS `ExploreModeToggle`): two capsules at the
// top of Explore's Filters panel, and in the Classes feed's own filter row
// (CLASS-1 mounts it there through ./index.ts), so the browse mode reads as
// the coarsest filter rather than a permanent segment at the top.
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, radius } from '../../theme';

/** What Explore browses: venues (map or list) or the classes feed. */
export type ExploreMode = 'venues' | 'classes';

export interface ExploreModeToggleProps {
  readonly mode: ExploreMode;
  readonly onChange: (mode: ExploreMode) => void;
}

const MODES: readonly { readonly mode: ExploreMode; readonly labelKey: string }[] = [
  { mode: 'venues', labelKey: 'classes.segment_venues' },
  { mode: 'classes', labelKey: 'classes.segment_classes' },
];

export default function ExploreModeToggle({ mode, onChange }: ExploreModeToggleProps) {
  const { t } = useT();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {MODES.map((item) => {
        const selected = item.mode === mode;
        return (
          <Pressable
            key={item.mode}
            onPress={() => onChange(item.mode)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={`explore.mode.${item.mode}`}
            hitSlop={4}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
          >
            <LPText size={13} weight="semibold" tracking={-0.1} color={selected ? colors.ink : colors.paper2}>
              {t(item.labelKey)}
            </LPText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  chipSelected: { backgroundColor: colors.paper, borderColor: colors.paper },
  pressed: { opacity: 0.85 },
});
