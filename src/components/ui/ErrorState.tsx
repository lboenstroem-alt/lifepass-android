// A read failed and there is no cache to fall back on (iOS HealthErrorState):
// a retry glyph, "Something went wrong. Please try again." and a "Try again"
// capsule. Shared by every screen so a failure looks the same everywhere.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '../../i18n';
import { colors, radius } from '../../theme';
import LPText from './LPText';

export type ErrorStateProps = {
  onRetry: () => void;
  /** Overrides the default `common.error_body` message. */
  message?: string;
  testID?: string;
};

export default function ErrorState({ onRetry, message, testID }: ErrorStateProps) {
  const { t } = useT();
  const retry = t('health.retry');
  return (
    <View style={styles.container} testID={testID}>
      <Ionicons name="refresh" size={28} color={colors.paper4} accessibilityElementsHidden importantForAccessibility="no" />
      <LPText size={15} color={colors.paper2} align="center">
        {message ?? t('common.error_body')}
      </LPText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retry}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <LPText size={13} weight="semibold" color={colors.paper}>
          {retry}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 14, paddingHorizontal: 32, paddingVertical: 40, alignSelf: 'stretch' },
  button: {
    minHeight: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { opacity: 0.7 },
});
