// "Load more" under the last day (iOS ClassesDiscoveryView `loadMoreButton`):
// shown while the feed has a next cursor. A failed page keeps the cursor, so
// the same button retries. While a page loads it spins and refuses presses.
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';

export interface LoadMoreButtonProps {
  readonly loading: boolean;
  readonly onPress: () => void;
}

export default function LoadMoreButton({ loading, onPress }: LoadMoreButtonProps) {
  const { t } = useT();
  return (
    <Pressable
      testID="classes.load_more"
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading, busy: loading }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.paper3} /> : null}
      <LPText size={13} weight="semibold" color={colors.paper2}>
        {t('classes.load_more')}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.8 },
});
