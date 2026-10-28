/**
 * The intro card (iOS `PlanIntroCard`, `ios-ux.md` 3.6): an entitled member
 * who has no plan yet. "A plan for the month, a workout for today, and the
 * soak after.", three rows, Get a 4-week plan (the Coach's wizard), Log a
 * meal, and Not now.
 *
 * Not now collapses the card for good, per member, to the row "Want a 4-week
 * plan? Get one in the Coach." (./introCollapse.ts).
 *
 * iOS also offers Connect Apple Health here. Android reads no Health Connect
 * (owner decision), so there is no third button rather than one that leads
 * nowhere.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, hiddenFromAccessibility, Kicker, LPText, PrimaryButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline } from '../../../theme';
import PlanBulletRow from '../gate/PlanBulletRow';

export type PlanIntroCardProps = {
  isCollapsed: boolean;
  /** Get a 4-week plan, and the collapsed row: the Coach's programme wizard. */
  onGetPlan: () => void;
  /** Log a meal: the meal page (the consent sheet first, when consent is missing). */
  onLogMeal: () => void;
  /** Not now: collapse for good. */
  onNotNow: () => void;
  testID?: string;
};

/** `plan_intro_cta_tapped.cta`. */
export type IntroCta = 'get_plan' | 'log_meal' | 'not_now';

const INTRO_ROWS: readonly { readonly icon: keyof typeof Ionicons.glyphMap; readonly key: string }[] = [
  { icon: 'calendar-outline', key: 'plan.intro.r1' },
  { icon: 'swap-horizontal-outline', key: 'plan.intro.r2' },
  { icon: 'trending-up-outline', key: 'plan.intro.r3' },
];

export default function PlanIntroCard({ isCollapsed, onGetPlan, onLogMeal, onNotNow, testID = 'plan.intro' }: PlanIntroCardProps) {
  const { t } = useT();
  const tap = (cta: IntroCta, action: () => void) => () => {
    track('plan_intro_cta_tapped', { cta });
    action();
  };

  if (isCollapsed) {
    // The row is the button: one element that says what it does.
    const label = t('plan.intro.collapsed');
    return (
      <Pressable
        onPress={onGetPlan}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.collapsedOuter, pressed && styles.pressed]}
        testID={`${testID}.collapsed`}
      >
        <Card style={styles.collapsed}>
          <View style={styles.collapsedIcon} {...hiddenFromAccessibility}>
            <Ionicons name="sparkles-outline" size={15} color={colors.rust} />
          </View>
          <LPText size={14} color={colors.paper} style={styles.flex}>
            {label}
          </LPText>
          <View {...hiddenFromAccessibility}>
            <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
          </View>
        </Card>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <Kicker text={t('plan.intro.kicker')} />
        <LPText serif size={28} color={colors.paper} accessibilityRole="header">
          {t('plan.intro.title')}
        </LPText>
      </View>
      <Card style={styles.card}>
        <LPText size={15} color={colors.paper} style={styles.body}>
          {t('plan.intro.body')}
        </LPText>
        {INTRO_ROWS.map((row) => (
          <PlanBulletRow key={row.key} icon={row.icon} text={t(row.key)} />
        ))}
        <View style={styles.rule} />
        <View style={styles.actions}>
          <PrimaryButton
            title={t('plan.intro.cta')}
            icon="sparkles"
            onPress={tap('get_plan', onGetPlan)}
            testID={`${testID}.cta.get_plan`}
          />
          <View style={styles.textButtons}>
            <IntroTextButton label={t('plan.intro.log_meal')} onPress={tap('log_meal', onLogMeal)} testID={`${testID}.cta.log_meal`} />
            <IntroTextButton label={t('plan.intro.not_now')} onPress={tap('not_now', onNotNow)} testID={`${testID}.cta.not_now`} />
          </View>
        </View>
      </Card>
    </View>
  );
}

function IntroTextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={colors.paper2}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  card: { marginHorizontal: 20 },
  body: { paddingHorizontal: 14, paddingVertical: 14 },
  rule: { height: hairline, backgroundColor: colors.line },
  actions: { gap: 14, paddingHorizontal: 14, paddingVertical: 14 },
  textButtons: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  collapsedOuter: { marginHorizontal: 20 },
  collapsed: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 60 },
  collapsedIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
});
