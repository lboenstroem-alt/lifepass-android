/* eslint lifepass/no-literal-copy: "error" */
/**
 * The proof after a walk-in (iOS `CheckInView.successScreen`): a full-screen
 * cover holding `CheckInProofDisplay` (CHECKIN-1's view, the same one Home
 * re-offers, so reception reads one layout) with the pulsing green mark, and
 * Done.
 *
 * What it shows comes from the walk-in: the server's own check-in time, the
 * venue, the member's short name (never an email, never a placeholder; none
 * after the hosted page, whose answer is a payment session), the activity
 * (none for a venue-level walk-in), the party reception admits, and "Balance
 * after" from the check-in's own `coveredBy`. The live scan holds no
 * check-in id, so there is no confirmation code here.
 *
 * Done (and back) clears it and reads the profile again; with health consent
 * and not a minor, today's plan too (the check-in may have marked today's
 * session done, iOS C23).
 *
 * THE MARK GIVES UP ITS ROOM FIRST: 120 dp, 40 at the accessibility text
 * sizes, where the words below it need every point on the phone; its glyph
 * never scales with the text. Done's margins shrink there too, so the guest
 * receipt stays above it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hiddenFromAccessibility, PrimaryButton } from '../../../../components/ui';
import { balanceAfter } from '../../../../copy/passCopy';
import { useHealthStore } from '../../../../health';
import { useA11ySize } from '../../../../hooks/useA11ySize';
import { useReduceMotion } from '../../../../hooks/useReduceMotion';
import { useT } from '../../../../i18n';
import { selectHasHealthConsent, useAppStore } from '../../../../stores/appStore';
import { colors } from '../../../../theme';
import CheckInProofDisplay from '../../proof/CheckInProofDisplay';
import { useWalkIn, walkInActions } from '../useWalkIn';

/** iOS `Color.green` (the system green, light appearance). */
const SUCCESS_GREEN = '#34C759';

const PULSE_MS = 900;

/** The success screen's mark: a pulsing green check mark (decoration to TalkBack). */
export function SuccessCheckmark({ diameter }: { diameter: number }) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const outerScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const outerOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  const innerScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  const inner = diameter * 0.75;

  return (
    <View style={[styles.mark, { width: diameter, height: diameter }]} {...hiddenFromAccessibility} testID="walkin.success.mark">
      <Animated.View
        style={[
          styles.disc,
          { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: 'rgba(52,199,89,0.12)' },
          { opacity: outerOpacity, transform: [{ scale: outerScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.disc,
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: 'rgba(52,199,89,0.2)' },
          { transform: [{ scale: innerScale }] },
        ]}
      />
      <Ionicons name="checkmark-circle" size={diameter * 0.533} color={SUCCESS_GREEN} allowFontScaling={false} />
    </View>
  );
}

/** C23: the profile, and with consent today's plan, read again after a check-in. */
function refreshAfterCheckIn(): void {
  void (async () => {
    await useAppStore.getState().loadProfile();
    const state = useAppStore.getState();
    if (!selectHasHealthConsent(state) || state.healthAccess === 'minor') return;
    await useHealthStore.getState().load({ force: true });
  })().catch(() => undefined);
}

export default function SuccessCover() {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const { isAccessibilitySize } = useA11ySize();
  const visible = useWalkIn((s) => s.showSuccess);
  const checkedInAt = useWalkIn((s) => s.successTimestamp);
  const venueName = useWalkIn((s) => s.successVenueName);
  const memberShortName = useWalkIn((s) => s.successMemberShortName);
  const activityName = useWalkIn((s) => s.successActivityName);
  const party = useWalkIn((s) => s.successParty);
  const coverage = useWalkIn((s) => s.successCoverage);

  const done = () => {
    walkInActions().resetSuccess();
    refreshAfterCheckIn();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={done}
      testID="walkin.success"
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.proof}>
          {visible ? (
            <CheckInProofDisplay
              checkedInAt={checkedInAt ?? new Date()}
              venueName={venueName}
              memberShortName={memberShortName}
              activityName={activityName}
              confirmationCode={null}
              party={party}
              balance={balanceAfter(coverage, language)}
              hint={null}
              mark={<SuccessCheckmark diameter={isAccessibilitySize ? 40 : 120} />}
            />
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: isAccessibilitySize ? 8 : 12,
            paddingBottom: (isAccessibilitySize ? 14 : 32) + insets.bottom,
          }}
        >
          <PrimaryButton title={t('common.done')} onPress={done} tone="action" testID="walkin.success.done" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  proof: { flex: 1 },
  mark: { alignItems: 'center', justifyContent: 'center' },
  disc: { position: 'absolute' },
});
