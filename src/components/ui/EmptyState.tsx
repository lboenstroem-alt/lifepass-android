// An empty list or result (iOS LPEmptyState): a large faint icon, a centred
// message, and an optional outlined action whose glyph is a search (the
// default) or a retry arrow.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius } from '../../theme';
import LPText from './LPText';

export type EmptyStateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** iOS `actionIcon`: `magnifyingglass` by default, `arrow.clockwise` for a retry. */
  actionIcon?: 'search' | 'retry';
  testID?: string;
};

export default function EmptyState({ icon, message, actionLabel, onAction, actionIcon = 'search', testID }: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <Ionicons name={icon} size={44} color={colors.paper4} accessibilityElementsHidden importantForAccessibility="no" />
      <LPText size={15} weight="medium" color={colors.paper3} align="center">
        {message}
      </LPText>
      {onAction && actionLabel ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Ionicons name={actionIcon === 'retry' ? 'refresh' : 'search'} size={12} color={colors.paper2} />
          <LPText size={13} weight="medium" color={colors.paper2}>
            {actionLabel}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: 40, gap: 16 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radius.small,
  },
  pressed: { opacity: 0.7 },
});
