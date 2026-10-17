/**
 * The gate (iOS `PlanGateCard`, `ios-ux.md` 3.6.1): what a member whose
 * membership does not include the plan sees instead of one. A headline, what
 * is included, three bullets, the example week IN FULL, and the buttons for
 * their access value (./gateRules.ts).
 *
 * With consent there is also "Your earlier plans and meals are still here."
 * and Manage your data: a lapsed member's plan is gone, what they logged is
 * not, and the read-only cards under this one show it.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, hiddenFromAccessibility, Kicker, LPText, PrimaryButton } from '../../../components/ui';
import type { HealthAccess } from '../../../health';
import { HealthFormat, useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline, radius } from '../../../theme';
import { sessionKindIcon } from '../shell/sessionKindIcon';

import { GATE_BULLETS, GATE_CTA_KEYS, gateActions, gateBodyKey, SAMPLE_WEEK, showsPassLine, type GateCta } from './gateRules';
import PlanBulletRow from './PlanBulletRow';

export type PlanGateCardProps = {
  access: HealthAccess;
  trialEligible: boolean;
  hasConsent: boolean;
  /** See memberships: the Plans sheet. */
  onChoosePlans: () => void;
  /** Activate your company plan, Fix payment: Account. */
  onOpenAccount: () => void;
  /** Try it free: the trial page in a browser tab. */
  onStartTrial: () => void;
  /** Plan my day in the Coach: the Coach, with the prompt waiting. */
  onPlanMyDay: () => void;
  /** Manage your data: Body and goals. */
  onManageData: () => void;
  testID?: string;
};

export default function PlanGateCard({
  access,
  trialEligible,
  hasConsent,
  onChoosePlans,
  onOpenAccount,
  onStartTrial,
  onPlanMyDay,
  onManageData,
  testID = 'plan.gate',
}: PlanGateCardProps) {
  const { t } = useT();
  const perform = (cta: GateCta) => {
    track('plan_gate_cta_tapped', { cta });
    switch (cta) {
      case 'company':
      case 'fix_payment':
        onOpenAccount();
        return;
      case 'choose':
        onChoosePlans();
        return;
      case 'trial':
        onStartTrial();
        return;
      case 'day_plan':
        onPlanMyDay();
        return;
    }
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <Kicker text={t('plan.gate.kicker')} />
        <LPText serif size={24} color={colors.paper} accessibilityRole="header">
          {t('plan.gate.title')}
        </LPText>
      </View>

      <Card style={styles.card}>
        <View style={styles.bodyBlock}>
          <LPText size={15} color={colors.paper}>
            {t(gateBodyKey(access))}
          </LPText>
          {showsPassLine(access) ? (
            <LPText size={13} color={colors.paper2} testID={`${testID}.passLine`}>
              {t('plan.gate.pass_line')}
            </LPText>
          ) : null}
        </View>

        {GATE_BULLETS.map((bullet) => (
          <PlanBulletRow key={bullet.key} icon={bullet.icon} text={t(bullet.key)} />
        ))}

        <View style={styles.rule} />
        <View style={styles.inset}>
          <SampleWeek testID={`${testID}.sample`} />
        </View>
        <View style={styles.rule} />

        <View style={[styles.inset, styles.actions]}>
          {gateActions(access, trialEligible).map((cta) => (
            <GateButton key={cta} cta={cta} label={t(GATE_CTA_KEYS[cta])} onPress={() => perform(cta)} testID={`${testID}.cta.${cta}`} />
          ))}
        </View>
      </Card>

      {hasConsent ? (
        <View style={styles.history} testID={`${testID}.history`}>
          <LPText size={13} color={colors.paper2}>
            {t('plan.gate.history_line')}
          </LPText>
          <Pressable
            onPress={onManageData}
            accessibilityRole="button"
            accessibilityLabel={t('plan.gate.manage_data')}
            style={({ pressed }) => [styles.textButton, styles.leading, pressed && styles.pressed]}
            testID={`${testID}.manageData`}
          >
            <LPText size={13} weight="semibold" color={colors.paper2}>
              {t('plan.gate.manage_data')}
            </LPText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The primary button for the first CTA, the trial as an outlined capsule, the Coach as text. */
function GateButton({ cta, label, onPress, testID }: { cta: GateCta; label: string; onPress: () => void; testID: string }) {
  if (cta === 'trial') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.trial, pressed && styles.pressed]}
        testID={testID}
      >
        <LPText size={13} weight="semibold" color={colors.paper}>
          {label}
        </LPText>
      </Pressable>
    );
  }
  if (cta === 'day_plan') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        testID={testID}
      >
        <LPText size={13} weight="semibold" color={colors.paper2} align="center">
          {label}
        </LPText>
      </Pressable>
    );
  }
  return <PrimaryButton title={label} onPress={onPress} testID={testID} />;
}

/**
 * Non-interactive, and read by TalkBack as one element: seven separate rows
 * announcing a week nobody can tap is noise.
 */
function SampleWeek({ testID }: { testID: string }) {
  const { t, language } = useT();
  const kicker = t('plan.gate.sample_kicker');
  const note = t('plan.gate.sample_note');
  return (
    <View style={styles.sample} accessible accessibilityLabel={`${kicker}. ${note}`} testID={testID}>
      <Kicker text={kicker} />
      <View style={styles.sampleRows} {...hiddenFromAccessibility}>
        {SAMPLE_WEEK.map((row) => (
          <View key={row.weekday} style={[styles.sampleRow, row.kind === 'rest' && styles.restRow]}>
            <LPText size={10} tracking={1.1} color={colors.paper3} style={styles.sampleDay} numberOfLines={1}>
              {HealthFormat.weekdayAbbreviation(row.weekday, language).toUpperCase()}
            </LPText>
            <View style={styles.sampleIcon}>
              <MaterialCommunityIcons name={sessionKindIcon(row.kind)} size={14} color={colors.paper2} />
            </View>
            <LPText size={13} color={colors.paper} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.sampleTitle}>
              {t(row.titleKey)}
            </LPText>
            {row.minutes !== null ? (
              <LPText size={12} color={colors.paper3}>
                {HealthFormat.duration(row.minutes, language)}
              </LPText>
            ) : null}
          </View>
        ))}
      </View>
      <LPText size={12} color={colors.paper2} {...hiddenFromAccessibility}>
        {note}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  bodyBlock: { gap: 8, paddingHorizontal: 14, paddingVertical: 14 },
  rule: { height: hairline, backgroundColor: colors.line },
  inset: { paddingHorizontal: 14, paddingVertical: 14 },
  actions: { gap: 12, alignItems: 'stretch' },
  trial: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  leading: { alignSelf: 'flex-start' },
  history: { gap: 6, paddingHorizontal: 24, alignItems: 'flex-start' },
  sample: { gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.ink3 },
  sampleRows: { gap: 8 },
  sampleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  restRow: { opacity: 0.55 },
  sampleDay: { width: 34 },
  sampleIcon: { width: 20, alignItems: 'center' },
  sampleTitle: { flex: 1 },
  pressed: { opacity: 0.7 },
});
