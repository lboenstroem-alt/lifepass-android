// The booking flow's Back button (iOS BookingFlowView.secondaryButton): a
// muted fill, the foreground label, as tall as the Confirm beside it.
import { Pressable, StyleSheet } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors, radius } from '../../../theme';

export interface SecondaryButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export default function SecondaryButton({ title, onPress, disabled = false, testID }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
      testID={testID}
    >
      <LPText size={15} weight="semibold" align="center">
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
