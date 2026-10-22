/**
 * One choice of the Plan sheets' chip groups (iOS `LogWorkoutSheet.chip` and
 * the No energy sheet's reason chips): rust with white text when chosen, the
 * card colour with a hairline otherwise, radius 12 and at least 44 dp tall.
 *
 * A long label wraps inside the chip rather than running off the sheet (iOS
 * `LogWorkoutChipFlow` never lets a chip grow wider than its row). The
 * chosen state is spoken; `spoken` replaces the printed title for TalkBack
 * where iOS gives the chip a fuller name ("45 minutes" for "45 min").
 */
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors, hairline } from '../../../theme';

export type ChoiceChipProps = {
  readonly title: string;
  readonly spoken?: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

export default function ChoiceChip({ title, spoken, selected, disabled = false, onPress, style, testID }: ChoiceChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? title}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.on : styles.off,
        style,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}
    >
      <LPText size={14} weight={selected ? 'semibold' : 'medium'} color={selected ? colors.onAccent : colors.paper} align="center">
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    maxWidth: '100%',
    borderRadius: 12,
    borderWidth: hairline,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.rust, borderColor: colors.rust },
  off: { backgroundColor: colors.ink2, borderColor: colors.line },
  pressed: { opacity: 0.85 },
});
