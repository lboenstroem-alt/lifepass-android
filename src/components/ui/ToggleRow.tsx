// A labelled switch row (iOS `Toggle` in the reminder, feedback and plan
// settings): title, optional note under it, a switch in the accent colour.
// The whole row is one switch to TalkBack and toggles on a tap anywhere.
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { colors } from '../../theme';
import LPText from './LPText';

export type ToggleRowProps = {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

export default function ToggleRow({ title, subtitle, value, onValueChange, disabled = false, testID }: ToggleRowProps) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={styles.texts}>
        <LPText size={15} weight="medium" color={colors.paper}>
          {title}
        </LPText>
        {subtitle ? (
          <LPText size={13} color={colors.mutedTextStrong}>
            {subtitle}
          </LPText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.rust, false: colors.line2 }}
        thumbColor={colors.onAccent}
        // The row speaks for the switch; the switch alone would be a second stop.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  texts: { flex: 1, gap: 3 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
