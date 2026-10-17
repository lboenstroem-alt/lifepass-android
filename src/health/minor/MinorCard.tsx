/**
 * The under-18 card (iOS 4.4): "For members aged 18 and over" and what the
 * member can still use. No controls but Done where it closes something.
 *
 * Two places show it, as on iOS:
 * - `variant="sheet"`: the consent sheet turns into it after the server
 *   refuses a verified member under 18 (`health_minor_blocked`); Done closes
 *   the sheet, and only then does the phone wipe and re-read the profile.
 * - `variant="plan"`: the Plan tab's minor section (PLAN-1 mounts it), the
 *   card chrome iOS gives it there: "two lines of loose text on a blank page
 *   reads as a screen that failed to load, which is the wrong thing to say to
 *   the one member who is not allowed in."
 */
import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { Card, hiddenFromAccessibility, Kicker, LPText, PrimaryButton } from '../../components/ui';
import { useT } from '../../i18n';
import { colors } from '../../theme';

export type MinorCardProps = {
  variant?: 'sheet' | 'plan';
  /** The sheet variant's Done. */
  onDone?: () => void;
  testID?: string;
};

const MinorCard = forwardRef<Text, MinorCardProps>(function MinorCard({ variant = 'sheet', onDone, testID }, titleRef) {
  const { t } = useT();

  if (variant === 'plan') {
    return (
      <View style={styles.plan} testID={testID}>
        <View style={styles.planHeader}>
          <Kicker text={t('plan.title')} />
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('health.minor.title')}
          </LPText>
        </View>
        <Card style={styles.planCard}>
          <LPText size={15} color={colors.paper}>
            {t('health.minor.body')}
          </LPText>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.sheet} testID={testID}>
      <View {...hiddenFromAccessibility}>
        <Ionicons name="person-circle-outline" size={28} color={colors.paper3} />
      </View>
      <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
        {t('health.minor.title')}
      </LPText>
      <LPText size={15} color={colors.paper2}>
        {t('health.minor.body')}
      </LPText>
      {onDone ? <PrimaryButton title={t('common.done')} onPress={onDone} style={styles.done} /> : null}
    </View>
  );
});

export default MinorCard;

const styles = StyleSheet.create({
  sheet: { gap: 14, paddingHorizontal: 4, paddingVertical: 12 },
  done: { marginTop: 4 },
  plan: { gap: 14 },
  planHeader: { gap: 10, paddingHorizontal: 24 },
  planCard: { marginHorizontal: 20, paddingHorizontal: 14, paddingVertical: 14 },
});
