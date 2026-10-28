// A labelled switch row (iOS BodyAndGoalsView.toggleRow, used by the
// reminder, feedback and plan settings): a 14 pt medium title over an 11 pt
// lpPaper3 note, 2 apart, 16 x 14 padding, a switch in the accent colour, and
// the whole row at 45 % while disabled.
//
// The whole row is one switch to TalkBack and toggles on a tap anywhere (on
// iOS only the switch takes the tap; a larger target is kinder to touch
// exploration and changes nothing else).
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
        <LPText size={14} weight="medium" color={colors.paper}>
          {title}
        </LPText>
        {subtitle ? (
          <LPText size={11} color={colors.paper3}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  texts: { flex: 1, gap: 2 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
