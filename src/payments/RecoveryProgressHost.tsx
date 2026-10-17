/**
 * Draws "Confirming your payment…" while the recovery confirms a payment the
 * app lost behind the page (./recoveryProgress says when). The look is iOS
 * PlansView's `verificationOverlay`: the page washed with ink at 92 %, a
 * spinner, the serif title, the sans subtitle and a Cancel capsule that hides
 * it while the check keeps running.
 *
 * The app shell mounts ONE, beside the UI kit's DialogHost (F4 contract
 * request), above the navigator, so it shows over whichever tab the app
 * landed on. Hardware back is Cancel. TalkBack hears the title when it
 * appears and stays inside it.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { announce } from '../components/ui/a11y';
import LPText from '../components/ui/LPText';
import { useT } from '../i18n';
import { colors } from '../theme';

import { attachRecoveryProgressHost, dismissRecoveryProgress, useRecoveryProgress } from './recoveryProgress';

/** iOS `Color.lpInk.opacity(0.92)` (lpInk is #F8F6F1). */
const WASH = 'rgba(248,246,241,0.92)';

export default function RecoveryProgressHost() {
  const progress = useRecoveryProgress();
  const { t } = useT();
  useEffect(() => attachRecoveryProgressHost(), []);
  const visible = progress !== null;
  useEffect(() => {
    if (visible) announce(t('plans.confirming'));
  }, [visible, t]);
  if (!progress) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismissRecoveryProgress}
      testID="payments.recoveryProgress"
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
          onPress={dismissRecoveryProgress}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          hitSlop={8}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          testID="payments.recoveryProgress.cancel"
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
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { opacity: 0.6 },
});
