/**
 * A number the member can also type (iOS `RunnerNumberField`, 0.2 F10): the
 * reps, metres or kg between a set's `-` and `+`.
 *
 * Bound to a string. Every change is handed to `onCommit` while the field has
 * the keyboard (the model parses and clamps it, with the Icelandic comma), and
 * the text follows the model again whenever the field does not have it: after
 * a step, after the keyboard closes, after a swap. So "12," stays on screen
 * while it is typed, and "12,5" is what the field reads once it is done.
 *
 * Android has no keyboard toolbar: the keyboard's own action key says Done
 * and closes it (iOS's toolbar "Done").
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type KeyboardTypeOptions } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors, sans } from '../../../theme';

export interface RunnerNumberFieldProps {
  /** What the model holds, as the field shows it ("10", "12,5", "" for no kg). */
  readonly value: string;
  /** The unit under the number ("reps", "kg"), also the field's TalkBack label. */
  readonly unit: string;
  readonly placeholder: string;
  readonly keyboardType: KeyboardTypeOptions;
  /** At the accessibility text sizes the field takes the row's width, so "12.5" is never cut to "1...". */
  readonly wide: boolean;
  readonly onCommit: (text: string) => void;
  readonly testID?: string;
}

export default function RunnerNumberField({ value, unit, placeholder, keyboardType, wide, onCommit, testID }: RunnerNumberFieldProps) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);

  // The model changed while the member is not typing here: show it.
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  return (
    <Pressable
      style={[styles.box, wide && styles.wideBox]}
      onPress={() => input.current?.focus()}
      accessible={false}
      importantForAccessibility="no"
    >
      <TextInput
        ref={input}
        testID={testID}
        value={text}
        placeholder={placeholder}
        placeholderTextColor={colors.paper3}
        keyboardType={keyboardType}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        selectTextOnFocus
        accessibilityLabel={unit}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value);
        }}
        onChangeText={(next) => {
          setText(next);
          if (next !== value) onCommit(next);
        }}
        style={[styles.input, wide ? styles.wideInput : styles.narrowInput]}
      />
      <LPText
        size={11}
        weight="medium"
        color={colors.paper2}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessible={false}
        importantForAccessibility="no"
      >
        {unit}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideBox: {
    flexGrow: 1,
  },
  input: {
    ...sans(20, 'semibold'),
    color: colors.paper,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    minHeight: 28,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  narrowInput: {
    width: 52,
  },
  wideInput: {
    minWidth: 96,
    alignSelf: 'stretch',
  },
});
