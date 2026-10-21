/**
 * 1. Tracking (iOS `trackingSection`): "Health and fitness tracking", with
 * "On since 1 September", "Off. Nothing health related is stored." or
 * "Needs an active membership" under it, and the switch.
 *
 * Turning it ON opens the consent sheet; turning it OFF asks the
 * delete-everything question, because withdrawal IS erasure: the switch and
 * "Delete all health data" run the same call. While that call is in flight a
 * spinner stands where the switch was. Without consent and without an
 * active membership the switch is off and cannot be turned on (the gate).
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LPText, ToggleRow } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AccountRowDivider, AccountSection } from '../../account';

import { CardErrorLine } from '../ui/parts';

export type TrackingSectionProps = {
  readonly hasConsent: boolean;
  readonly subtitle: string;
  /** False without consent and without an active membership. */
  readonly enabled: boolean;
  readonly isWithdrawing: boolean;
  /** The withdrawal's error line, or null. */
  readonly errorKey: string | null;
  readonly onTurnOn: () => void;
  readonly onTurnOff: () => void;
};

export default function TrackingSection({ hasConsent, subtitle, enabled, isWithdrawing, errorKey, onTurnOn, onTurnOff }: TrackingSectionProps) {
  const { t } = useT();
  const title = t('bodygoals.tracking');
  return (
    <AccountSection kicker={t('bodygoals.sec.tracking')} testID="bodygoals.tracking">
      <AccountRowDivider />
      {isWithdrawing ? (
        <View style={styles.busyRow} accessible accessibilityLabel={`${title}, ${subtitle}`} accessibilityState={{ busy: true }} testID="bodygoals.tracking.busy">
          <View style={styles.words}>
            <LPText size={14} weight="medium" color={colors.paper}>
              {title}
            </LPText>
            <LPText size={11} color={colors.paper3}>
              {subtitle}
            </LPText>
          </View>
          <ActivityIndicator size="small" color={colors.rust} />
        </View>
      ) : (
        <ToggleRow
          title={title}
          subtitle={subtitle}
          value={hasConsent}
          onValueChange={(wantsOn) => {
            if (wantsOn === hasConsent) return;
            if (wantsOn) onTurnOn();
            else onTurnOff();
          }}
          disabled={!hasConsent && !enabled}
          testID="bodygoals.tracking.switch"
        />
      )}
      {errorKey ? (
        <View>
          <AccountRowDivider />
          <View style={styles.errorPad}>
            <CardErrorLine text={t(errorKey)} testID="bodygoals.tracking.error" />
          </View>
        </View>
      ) : null}
    </AccountSection>
  );
}

const styles = StyleSheet.create({
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  words: { flex: 1, gap: 2 },
  errorPad: { paddingTop: 12 },
});
