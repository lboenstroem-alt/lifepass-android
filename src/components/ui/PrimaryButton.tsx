// The primary button (iOS LPPrimaryButton): 52 tall, radius 14, an accent
// fill with a soft shadow, 15 pt semibold white label.
//
// `tone` picks the fill:
//   'accent'       lpRust, as LPPrimaryButton (most screens)
//   'action'       lpActionFill #2F6699, where iOS 2.5.4 needs AA contrast
//                  (booking flows, the venue page's bottom bar)
//   'destructive'  lpDestructive (ConfirmSheet's destructive confirm)
// While `loading` the label gives way to a spinner and the button refuses
// presses; TalkBack still hears the label, with the busy state.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '../../theme';
import LPText from './LPText';

export type PrimaryButtonTone = 'accent' | 'action' | 'destructive';

export type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Stretch to the parent's width (iOS `block`, the default). */
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  tone?: PrimaryButtonTone;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const FILL: Record<PrimaryButtonTone, string> = {
  accent: colors.rust,
  action: colors.actionFill,
  destructive: colors.destructive,
};

export default function PrimaryButton({
  title,
  onPress,
  icon,
  block = true,
  loading = false,
  disabled = false,
  tone = 'accent',
  accessibilityHint,
  style,
  testID,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;
  const fill = FILL[tone];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: fill, shadowColor: fill },
        block ? styles.block : styles.inline,
        disabled && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={14} color={colors.onAccent} /> : null}
            <LPText size={15} weight="semibold" color={colors.onAccent} tracking={-0.1} numberOfLines={2} align="center">
              {title}
            </LPText>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  block: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  // iOS callers dim a refused primary to 40 % (the check-in's Save).
  disabled: { opacity: 0.4, elevation: 0 },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
