// A typeable number with minus and plus buttons (iOS: the weekly check-in's
// weight field, the body sheet's weight and height, the runner's sets).
//
// The field holds TEXT, as on iOS, so what the member typed stays exactly as
// typed ("72,5") until they step it; the caller parses it with
// `parseDecimal` and shows its own error under the field. Stepping reads the
// field (or `fallback` when empty), adds the step, rounds, and refuses to leave
// [min, max] (numberInput.ts).
//
// TALKBACK. The two round buttons are fiddly by touch exploration, so the
// field itself is adjustable, as iOS makes it (`accessibilityAdjustableAction`,
// ios-ux.md 9.8): one swipe up or down is one step, the same arithmetic the
// buttons use. Its label says the unit as a WORD ("Weight, kilograms"),
// because TalkBack reads a printed "kg" as two letters (6.8). A double tap
// opens the keyboard to type a value.
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type AccessibilityActionEvent } from 'react-native';

import { useT } from '../../i18n';
import { colors, hairline, radius, sans } from '../../theme';
import LPText from './LPText';
import { sanitiseDecimalTyping, stepText } from './numberInput';

export type NumberStepperProps = {
  text: string;
  onChangeText: (text: string) => void;
  step: number;
  min: number;
  max: number;
  /** What a step starts from while the field is empty (iOS: the last weigh-in, else 70). */
  fallback: number;
  maxFractionDigits?: number;
  /** Printed after the number, e.g. "kg". */
  unit?: string;
  /** The field's name for TalkBack, e.g. t('body.weight'). */
  label: string;
  /** The unit as a word for TalkBack, e.g. t('a11y.unit.kg'). */
  spokenUnit?: string;
  /** e.g. t('a11y.decrease_weight'). */
  decreaseLabel: string;
  /** e.g. t('a11y.increase_weight'). */
  increaseLabel: string;
  /** Hide the round buttons (the body sheet's fields are adjustable without them). */
  showButtons?: boolean;
  /** 'large': the check-in's 28 pt centred number; 'regular': a 17 pt field. */
  size?: 'large' | 'regular';
  /** Whole numbers only (number pad, no separator). */
  integer?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** Drawn faded (a skipped weight), still tappable to bring it back. */
  dimmed?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  testID?: string;
};

export default function NumberStepper({
  text,
  onChangeText,
  step,
  min,
  max,
  fallback,
  maxFractionDigits,
  unit,
  label,
  spokenUnit,
  decreaseLabel,
  increaseLabel,
  showButtons = true,
  size = 'large',
  integer = false,
  invalid = false,
  disabled = false,
  dimmed = false,
  onFocus,
  onBlur,
  testID,
}: NumberStepperProps) {
  const { language } = useT();
  const input = useRef<TextInput>(null);

  const stepBy = (direction: 1 | -1) => {
    if (disabled) return;
    const next = stepText(text, direction, { step, min, max, fallback, maxFractionDigits, language });
    if (next !== null) onChangeText(next);
  };

  const onAction = (event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case 'increment':
        stepBy(1);
        break;
      case 'decrement':
        stepBy(-1);
        break;
      case 'activate':
        input.current?.focus();
        break;
    }
  };

  const spokenLabel = [label, spokenUnit ?? unit].filter(Boolean).join(', ');
  const spokenValue = text.trim() ? [text.trim(), spokenUnit ?? unit].filter(Boolean).join(' ') : undefined;
  const large = size === 'large';

  return (
    <View style={styles.row} testID={testID}>
      {showButtons ? <RoundButton icon="remove" label={decreaseLabel} onPress={() => stepBy(-1)} disabled={disabled} /> : null}
      <Pressable
        onPress={() => input.current?.focus()}
        disabled={disabled}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={spokenLabel}
        accessibilityValue={spokenValue ? { text: spokenValue } : undefined}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={onAction}
        style={[
          styles.field,
          large ? styles.fieldLarge : styles.fieldRegular,
          invalid && styles.invalid,
          dimmed && styles.dimmed,
        ]}
        testID={testID ? `${testID}.field` : undefined}
      >
        <TextInput
          ref={input}
          value={text}
          onChangeText={(next) => onChangeText(integer ? next.replace(/[^0-9]/g, '') : sanitiseDecimalTyping(next))}
          editable={!disabled}
          keyboardType={integer ? 'number-pad' : 'decimal-pad'}
          onFocus={onFocus}
          onBlur={onBlur}
          // The adjustable field around it is what TalkBack focuses.
          importantForAccessibility="no"
          selectTextOnFocus
          style={[
            styles.input,
            large ? sans(28, 'semibold') : sans(17),
            large ? styles.inputLarge : styles.inputRegular,
          ]}
          testID={testID ? `${testID}.input` : undefined}
        />
        {unit ? (
          <LPText size={15} color={colors.paper2} importantForAccessibility="no">
            {unit}
          </LPText>
        ) : null}
      </Pressable>
      {showButtons ? <RoundButton icon="add" label={increaseLabel} onPress={() => stepBy(1)} disabled={disabled} /> : null}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'add' | 'remove';
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.round, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.paper2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  fieldLarge: { minHeight: 64, justifyContent: 'center' },
  fieldRegular: { minHeight: 52 },
  invalid: { borderColor: colors.destructive, borderWidth: 1 },
  dimmed: { opacity: 0.45 },
  input: { color: colors.paper, paddingVertical: 0 },
  inputLarge: { textAlign: 'center', minWidth: 64 },
  inputRegular: { flex: 1 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
