/**
 * The big button of the runner's sheets: "Save workout" and "Skip workout"
 * (iOS: 60 tall, rounded 16, 17 pt semibold, a spinner in place of the words
 * while the request is in flight).
 *
 * Disabled reads as disabled AND stays legible: the quiet fill with the
 * secondary ink, not a faded rust (iOS `reason == nil ? lpInk3 : lpRust`).
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors } from '../../../theme';

export interface SheetActionButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  /** Cannot be pressed: greyed. */
  readonly disabled?: boolean;
  /** In flight: the spinner, and no second press. */
  readonly busy?: boolean;
  readonly testID?: string;
}

export default function SheetActionButton({ title, onPress, disabled = false, busy = false, testID }: SheetActionButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.button, disabled ? styles.off : styles.on, pressed && !inactive && styles.pressed]}
    >
      <View style={styles.inner}>
        <LPText
          size={17}
          weight="semibold"
          color={disabled ? colors.paper2 : colors.onAccent}
          align="center"
          numberOfLines={2}
          style={busy && styles.hidden}
        >
          {title}
        </LPText>
        {busy ? (
          <View style={styles.spinner} testID={testID ? `${testID}.spinner` : undefined}>
            <ActivityIndicator size="small" color={colors.onAccent} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignSelf: 'stretch',
  },
  on: { backgroundColor: colors.rust },
  off: { backgroundColor: colors.ink3 },
  inner: { alignItems: 'center', justifyContent: 'center' },
  // The words keep their room while the spinner shows, so the button does not jump.
  hidden: { opacity: 0 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
});
