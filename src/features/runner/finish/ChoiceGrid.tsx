/**
 * Two columns of choice tiles: the finish sheet's "How did it feel?" and the
 * skip sheet's reasons (iOS `LazyVGrid` of two flexible columns, spacing 10,
 * in FinishWorkoutSheet.swift and SwapExerciseSheet.swift).
 *
 * A tile is 52 tall, rounded 12: rust with a check and white words when
 * chosen, the quiet fill with a hairline otherwise. Its words stay on one
 * line, shrinking to 80 % before they would wrap, as iOS's
 * `minimumScaleFactor(0.8)`. TalkBack hears a button and whether it is
 * selected (iOS `.isSelected`).
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { colors, hairline, radius } from '../../../theme';

export interface ChoiceGridOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly testID: string;
}

export interface ChoiceGridProps<Value extends string> {
  readonly options: readonly ChoiceGridOption<Value>[];
  readonly selected: Value | null;
  readonly onPress: (value: Value) => void;
  readonly disabled?: boolean;
}

export default function ChoiceGrid<Value extends string>({ options, selected, onPress, disabled = false }: ChoiceGridProps<Value>) {
  const rows: ChoiceGridOption<Value>[][] = [];
  for (let index = 0; index < options.length; index += 2) rows.push(options.slice(index, index + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row.map((option) => option.value).join('-')} style={styles.row}>
          {row.map((option) => {
            const isOn = option.value === selected;
            return (
              <Pressable
                key={option.value}
                testID={option.testID}
                onPress={() => onPress(option.value)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: isOn, disabled }}
                style={({ pressed }) => [styles.tile, isOn ? styles.on : styles.off, pressed && styles.pressed]}
              >
                {isOn ? (
                  <View {...hiddenFromAccessibility}>
                    <Ionicons name="checkmark" size={14} color={colors.onAccent} />
                  </View>
                ) : null}
                <LPText
                  size={15}
                  weight={isOn ? 'semibold' : 'medium'}
                  color={isOn ? colors.onAccent : colors.paper}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={styles.label}
                >
                  {option.label}
                </LPText>
              </Pressable>
            );
          })}
          {/* An odd last tile keeps its column's width. */}
          {row.length === 1 ? <View style={styles.spacer} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: radius.field,
    borderWidth: hairline,
  },
  on: { backgroundColor: colors.rust, borderColor: colors.rust },
  off: { backgroundColor: colors.ink2, borderColor: colors.line },
  label: { flexShrink: 1 },
  spacer: { flex: 1 },
  pressed: { opacity: 0.8 },
});
