// The one banner row at the top of a screen (iOS StatusBanner): offline, a
// payment problem, or a save that has not gone through. One at a time, in
// that priority (the caller picks), so a member is never told three things
// at once. An optional action pill on the right, an optional quieter second
// action under the message.
//
// Android: the banner is a polite live region, so TalkBack reads it when it
// appears without moving the member's focus.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, hairline, radius } from '../../theme';
import LPText from './LPText';

export type StatusBannerProps = {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
};

export default function StatusBanner({
  icon,
  message,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  testID,
}: StatusBannerProps) {
  return (
    <View style={styles.banner} testID={testID} accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name={icon} size={14} color={colors.paper2} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <View style={styles.body}>
          <LPText size={13} color={colors.paper}>
            {message}
          </LPText>
          {secondaryLabel && onSecondary ? (
            <Pressable
              onPress={onSecondary}
              accessibilityRole="button"
              accessibilityLabel={secondaryLabel}
              hitSlop={8}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <LPText size={13} weight="semibold" color={colors.paper2}>
                {secondaryLabel}
              </LPText>
            </Pressable>
          ) : null}
        </View>
        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            hitSlop={5}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <LPText size={13} weight="semibold" color={colors.onAccent}>
              {actionLabel}
            </LPText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.ink3,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 18, height: 18, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 6 },
  secondary: { alignSelf: 'flex-start' },
  action: {
    minHeight: 34,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.rust,
    borderRadius: radius.pill,
  },
  pressed: { opacity: 0.75 },
});
