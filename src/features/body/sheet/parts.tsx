/**
 * The pieces the body sheet and the target sheet share, drawn as iOS draws
 * them (Views/Health/BodySheet.swift `fieldBlock`, `privacyLine`, the refusal
 * box): a labelled number field with its error underneath, the lock line,
 * a note in an ink box, and the TalkBack announcement of a new error.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { announce, hiddenFromAccessibility, LPText, NumberStepper } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';

export type NumberFieldProps = {
  label: string;
  text: string;
  onChangeText: (text: string) => void;
  /** Printed after the number ("kg", "cm", "kcal"). */
  unit: string;
  /** The unit as a WORD for TalkBack (ios-ux.md 6.8 asks for "Weight, kilograms"). */
  spokenUnit?: string;
  /** One adjustable step, so a TalkBack user can change it with a swipe instead of the keypad. */
  step: number;
  min: number;
  max: number;
  fallback: number;
  integer?: boolean;
  /** The line under the field, already translated; null for none. */
  error: string | null;
  testID?: string;
};

/**
 * iOS `fieldBlock`: a 13 pt label, a 52 tall field with the unit after the
 * number (red outline on an error), and the error line under it. No round
 * buttons, as on iOS: the field itself is adjustable (NumberStepper).
 */
export function NumberField({
  label,
  text,
  onChangeText,
  unit,
  spokenUnit,
  step,
  min,
  max,
  fallback,
  integer = false,
  error,
  testID,
}: NumberFieldProps) {
  const { t } = useT();
  return (
    <View style={styles.field}>
      <LPText size={13} weight="semibold" color={colors.paper2} importantForAccessibility="no">
        {label}
      </LPText>
      <NumberStepper
        text={text}
        onChangeText={onChangeText}
        step={step}
        min={min}
        max={max}
        fallback={fallback}
        maxFractionDigits={integer ? 0 : 1}
        integer={integer}
        unit={unit}
        label={label}
        spokenUnit={spokenUnit}
        decreaseLabel={t('a11y.decrease_amount')}
        increaseLabel={t('a11y.increase_amount')}
        showButtons={false}
        size="regular"
        invalid={error !== null}
        testID={testID}
      />
      {error !== null ? (
        <LPText size={12} color={colors.destructive} testID={testID ? `${testID}.error` : undefined}>
          {error}
        </LPText>
      ) : null}
    </View>
  );
}

/** The lock line at the foot of both sheets: the numbers stay in the account, the AI never sees them. */
export function PrivacyLine({ text }: { text: string }) {
  return (
    <View style={styles.privacy}>
      <View {...hiddenFromAccessibility} style={styles.lock}>
        <Ionicons name="lock-closed-outline" size={12} color={colors.paper3} />
      </View>
      <LPText size={12} color={colors.paper2} style={styles.flex}>
        {text}
      </LPText>
    </View>
  );
}

/** A note in an ink box (the reached-target note, a refusal, "set a goal first"). */
export function NoteBox({ text, size = 13, testID }: { text: string; size?: number; testID?: string }) {
  return (
    <View style={styles.note} testID={testID}>
      <LPText size={size} color={colors.paper}>
        {text}
      </LPText>
    </View>
  );
}

/**
 * Speaks `text` when it changes to something new (iOS `.onChange(of:)` with an
 * announcement): a red line under a field says nothing to TalkBack, which is
 * looking at the button that just refused to work. Not on the first render.
 */
export function useAnnounceChange(text: string | null): void {
  const previous = useRef(text);
  useEffect(() => {
    if (text === previous.current) return;
    previous.current = text;
    if (text) announce(text);
  }, [text]);
}

/** A quiet text button (Cancel, Skip, Remove): 13 pt semibold, 44 tall. */
export function QuietButton({
  title,
  onPress,
  disabled = false,
  destructive = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={destructive ? colors.destructive : colors.paper2} align="center">
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quiet: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.7 },
  field: { gap: 6 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lock: { paddingTop: 2 },
  flex: { flex: 1 },
  note: {
    padding: 12,
    borderRadius: radius.field,
    backgroundColor: colors.ink3,
  },
});
