// A segmented control (iOS `Picker` with `.pickerStyle(.segmented)`: Plan
// history's segments, the meal capture mode switch, the barcode result's
// per-100 g / per-serving). A recessed track with the chosen segment raised
// on white. TalkBack hears each segment as a tab, with its position and
// whether it is selected.
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../../theme';
import LPText from './LPText';

export type Segment<T extends string> = { value: T; label: string; testID?: string };

export type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the control as a whole for TalkBack. */
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[styles.track, style]}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            testID={segment.testID}
            onPress={() => {
              if (!selected) onChange(segment.value);
            }}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected, disabled }}
            style={[styles.segment, selected && styles.selected]}
          >
            <LPText size={13} weight={selected ? 'semibold' : 'medium'} color={colors.paper} align="center" numberOfLines={1}>
              {segment.label}
            </LPText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.ink3,
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    minHeight: 32,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  selected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
