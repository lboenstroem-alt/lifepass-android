// The primary button (iOS LPPrimaryButton): 52 tall, radius 14, an accent
// fill with a soft shadow, 15 pt semibold white label.
//
// `tone` picks the fill:
//   'accent'       lpRust, as LPPrimaryButton (most screens)
//   'action'       lpActionFill #2F6699, where iOS 2.5.4 needs AA contrast
//                  (booking flows, the venue page's bottom bar)
//   'destructive'  lpDestructive (ConfirmSheet's destructive confirm)
//
// `shape` picks the geometry:
//   'primary'      LPPrimaryButton: 52 tall, radius 14, soft shadow
//   'booking'      the booking flows' Confirm (BookingFlowView.primaryButton,
//                  ClassBookingSheet.confirmButton): 14 pt vertical padding
//                  (about 48 tall), radius 12, no shadow
//
// DISABLED. iOS callers dim a refused accent button to 40 % (the check-in's
// Save). The 'action' tone does NOT: iOS 2.5.4 draws a disabled booking
// Confirm as a readable grey button (lpInk3 fill, lpMutedTextStrong label,
// about 5.9:1), because the half-transparent blue one it replaced left its
// white label at 1.9:1. While `loading` an 'action' button keeps its blue
// fill with a white spinner, as iOS does while a booking is in flight.
//
// While `loading` the label gives way to a spinner and the button refuses
// presses; TalkBack still hears the label, with the busy state.
//
// SPOKEN NAME. `accessibilityLabel` replaces the visible title for TalkBack
// where iOS gives the button a fuller name than it prints: the class sheet's
// Confirm is read as "Confirm booking: {name}, {when}" plus the price line
// (ClassBookingSheet.confirmButton, classsheet.confirm_a11y), so a member who
// reaches Confirm by touch exploration hears what it charges BEFORE activating
// it. Never move that into `accessibilityHint`: TalkBack reads hints after a
// pause, and members can turn hints off.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '../../theme';
import LPText from './LPText';

export type PrimaryButtonTone = 'accent' | 'action' | 'destructive';
export type PrimaryButtonShape = 'primary' | 'booking';

export type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Stretch to the parent's width (iOS `block`, the default). */
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  tone?: PrimaryButtonTone;
  shape?: PrimaryButtonShape;
  /** What TalkBack reads instead of `title` (iOS `.accessibilityLabel`); default: the title. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const FILL: Record<PrimaryButtonTone, string> = {
  accent: colors.rust,
  action: colors.actionFill,
  destructive: colors.destructive,
};

/** The readable disabled pair of the booking flows (iOS 2.5.4, BookingContrastTests). */
export const READABLE_DISABLED = { fill: colors.ink3, label: colors.mutedTextStrong } as const;

export default function PrimaryButton({
  title,
  onPress,
  icon,
  block = true,
  loading = false,
  disabled = false,
  tone = 'accent',
  shape = 'primary',
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;
  // Only a refused 'action' button turns grey; one that is booking stays blue.
  const readableDisabled = tone === 'action' && disabled && !loading;
  const fill = readableDisabled ? READABLE_DISABLED.fill : FILL[tone];
  const labelColor = readableDisabled ? READABLE_DISABLED.label : colors.onAccent;
  const flat = shape === 'booking' || readableDisabled;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        shape === 'booking' && styles.booking,
        { backgroundColor: fill, shadowColor: fill },
        flat && styles.flat,
        block ? styles.block : styles.inline,
        disabled && !readableDisabled && styles.dimmed,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={14} color={labelColor} /> : null}
            <LPText size={15} weight="semibold" color={labelColor} tracking={-0.1} numberOfLines={2} align="center">
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
  // iOS: `.padding(.vertical, 14)` round a 15 pt label, RoundedRectangle 12.
  booking: { minHeight: 48, borderRadius: radius.field, paddingVertical: 14, paddingHorizontal: 16 },
  flat: { elevation: 0, shadowOpacity: 0 },
  block: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  // iOS callers dim a refused accent button to 40 % (the check-in's Save).
  dimmed: { opacity: 0.4, elevation: 0 },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
