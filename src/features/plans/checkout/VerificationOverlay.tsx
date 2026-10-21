/**
 * "Confirming your payment…" while the return from the checkout page is
 * verified: iOS PlansView's `verificationOverlay`. The screen washed with ink
 * at 92 %, a spinner, the serif title, the subtitle, and a Cancel capsule:
 * the escape hatch. Cancel (and hardware back) only hides the overlay; the
 * check keeps running and still lands its welcome, its alert or the "check
 * again" chip.
 *
 * Drawn in its own window (an RN Modal), so it covers the whole Plans screen
 * edge to edge and TalkBack stays inside it; it hears the title as it
 * appears.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { announce, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

import { withOpacity } from '../tint';

/** iOS `Color.lpInk.opacity(0.92)`. */
const WASH = withOpacity(colors.ink, 0.92);

export interface VerificationOverlayProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
}

export default function VerificationOverlay({ visible, onCancel }: VerificationOverlayProps) {
  const { t } = useT();
  useEffect(() => {
    if (visible) announce(t('plans.confirming'));
  }, [visible, t]);
  if (!visible) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
      testID="plans.confirming"
    >
      <View style={styles.wash} accessibilityViewIsModal>
        <ActivityIndicator size="large" color={colors.rust} />
        <LPText serif size={20} color={colors.paper} align="center" accessibilityRole="header">
          {t('plans.confirming')}
        </LPText>
        <LPText size={13} color={colors.paper3} align="center">
          {t('plans.confirming_sub')}
        </LPText>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          // iOS's capsule is about 34 tall; the slop makes the target Android's 48.
          hitSlop={8}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          testID="plans.confirming.cancel"
        >
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wash: {
    flex: 1,
    backgroundColor: WASH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 18,
  },
  cancel: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { opacity: 0.6 },
});
