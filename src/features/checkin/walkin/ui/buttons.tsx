/* eslint lifepass/no-literal-copy: "error" */
/**
 * The walk-in sheets' two buttons, as CheckInView draws them: a full-width
 * primary whose label WRAPS at large text rather than being cut off ("no
 * charge" is the point of "Check in, no charge"), and the small underlined
 * secondary ("Bringing a guest?", "Don't register the class..."), at least
 * 44 dp tall.
 */
import { Pressable, StyleSheet } from 'react-native';

import { LPText } from '../../../../components/ui';
import { colors, minTouch, radius } from '../../../../theme';

export interface WalkInButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** iOS: white 16 pt semibold on lpPrimary, 16 pt vertical padding, corner 14. */
export function SolidButton({ title, onPress, accessibilityHint, testID }: WalkInButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.solid, pressed && styles.pressed]}
    >
      <LPText size={16} weight="semibold" color={colors.onAccent} align="center">
        {title}
      </LPText>
    </Pressable>
  );
}

/** iOS: muted, centred, 13 to 15 pt; underlined unless `underline` is false (the guest sheet's Just me). */
export function LinkButton({
  title,
  onPress,
  accessibilityHint,
  testID,
  size = 13,
  underline = true,
}: WalkInButtonProps & { size?: number; underline?: boolean }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <LPText size={size} weight={size >= 15 ? 'medium' : 'regular'} color={colors.mutedTextStrong} align="center" style={underline ? styles.underline : undefined}>
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  solid: {
    alignSelf: 'stretch',
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: radius.card,
    backgroundColor: colors.actionFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: {
    alignSelf: 'stretch',
    minHeight: minTouch,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underline: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.85 },
});
