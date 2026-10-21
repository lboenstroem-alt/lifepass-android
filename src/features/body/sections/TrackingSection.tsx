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
 *
 * ONLY THE SWITCH GOES DIM when it cannot be turned on (iOS disables the
 * Toggle alone): the title and "Needs an active membership" stay at full
 * strength, because that line is the one that tells the member why. The
 * kit's ToggleRow dims the whole row, so this row is drawn here, the way
 * the busy row beside it is.
 */
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { LPText } from '../../../components/ui';
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
        <View style={styles.row} accessible accessibilityLabel={`${title}, ${subtitle}`} accessibilityState={{ busy: true }} testID="bodygoals.tracking.busy">
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
        <TrackingRow
          title={title}
          subtitle={subtitle}
          value={hasConsent}
          onValueChange={(wantsOn) => {
            if (wantsOn === hasConsent) return;
            if (wantsOn) onTurnOn();
            else onTurnOff();
          }}
          disabled={!hasConsent && !enabled}
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

/**
 * The switch row: one switch to TalkBack, toggled by a tap anywhere on it
 * (as the kit's ToggleRow), with only the switch drawn dim while disabled.
 */
function TrackingRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly disabled: boolean;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed]}
      testID="bodygoals.tracking.switch"
    >
      <View style={styles.words}>
        <LPText size={14} weight="medium" color={colors.paper}>
          {title}
        </LPText>
        <LPText size={11} color={colors.paper3}>
          {subtitle}
        </LPText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.rust, false: colors.line2 }}
        thumbColor={colors.onAccent}
        style={disabled && styles.switchDisabled}
        // The row speaks for the switch; the switch alone would be a second stop.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        testID="bodygoals.tracking.switch.control"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  words: { flex: 1, gap: 2 },
  errorPad: { paddingTop: 12 },
  pressed: { opacity: 0.85 },
  // A disabled Android switch keeps its colours; iOS greys a disabled Toggle.
  switchDisabled: { opacity: 0.45 },
});
