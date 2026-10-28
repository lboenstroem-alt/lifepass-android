// A checkbox row (iOS LPCheckboxRow, ios-ux.md 20): at least 44 tall, ONE
// element to TalkBack with the checkbox role and its checked state, rather
// than a box and a label as two unrelated controls. `outlined` draws a red
// outline round a box that has to be ticked before going on (the consent
// sheets' refusal).
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../../theme';
import LPText from './LPText';

export type CheckboxRowProps = {
  /** The label; a string, or rendered text (with markup) for the legal rows. */
  title: ReactNode;
  /** What TalkBack reads when `title` is not a plain string. */
  accessibilityLabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  outlined?: boolean;
  disabled?: boolean;
  testID?: string;
};

export default function CheckboxRow({ title, accessibilityLabel, checked, onChange, outlined = false, disabled = false, testID }: CheckboxRowProps) {
  const label = accessibilityLabel ?? (typeof title === 'string' ? title : undefined);
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [
        styles.row,
        outlined && styles.outlined,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.box}>
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.rust : colors.line2} />
      </View>
      <View style={styles.label}>
        {typeof title === 'string' ? (
          <LPText size={14} color={colors.paper}>
            {title}
          </LPText>
        ) : (
          title
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  outlined: { borderColor: colors.destructive },
  box: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
