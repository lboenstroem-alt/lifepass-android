/**
 * The smaller parts of Body and goals: Your plan, the under-18 notice and
 * the footer.
 */
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { ProfileProgramSummary } from '../../../api/profile';
import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AccountCard, AccountRowButton, AccountSection } from '../../account';

import { planWeekLine } from '../model';

/**
 * 3. Your plan (iOS `planSection`): the running or paused plan, "Week 3 of
 * 8", which takes the member to Plan at its root. Hidden without one.
 */
export function PlanSection({ program, onOpen }: { readonly program: ProfileProgramSummary; readonly onOpen: () => void }) {
  const { t } = useT();
  return (
    <AccountSection kicker={t('bodygoals.sec.plan')} testID="bodygoals.plan">
      <AccountRowButton
        title={program.summaryTitle ?? t('plan.title')}
        subtitle={planWeekLine(t, program)}
        onPress={onOpen}
        testID="bodygoals.plan.row"
      />
    </AccountSection>
  );
}

/**
 * UNDER 18 IS NOT A SETTINGS PAGE (iOS `minorNotice`). The page is not
 * reachable in that state, except one way: a member the phone thought was
 * an entitled adult opens it, the server refuses a grant as under 18, and the
 * profile read that follows flips the access under them. They get the
 * consent sheet's fixed line, not a page of dead switches blaming their
 * membership.
 */
export function MinorNotice() {
  const { t } = useT();
  return (
    <AccountCard testID="bodygoals.minor">
      <View style={styles.minor}>
        <LPText size={15} weight="medium" color={colors.paper} accessibilityRole="header">
          {t('health.minor.title')}
        </LPText>
        <LPText size={14} color={colors.paper2}>
          {t('health.minor.body')}
        </LPText>
      </View>
    </AccountCard>
  );
}

/** Where the footer's credits link goes (the same page as Plan's footer). */
export const CREDITS_URL = 'https://www.lifepass.is/attractions/credits';

/** "General fitness guidance, not medical advice." and the sources and credits (iOS `footer`). */
export function BodyGoalsFooter() {
  const { t } = useT();
  const credits = t('plan.footer.credits');
  return (
    <View style={styles.footer} testID="bodygoals.footer">
      <LPText size={12} color={colors.paper3} align="center">
        {t('health.disclaimer')}
      </LPText>
      <Pressable
        onPress={() => void Linking.openURL(CREDITS_URL).catch(() => undefined)}
        accessibilityRole="link"
        accessibilityLabel={credits}
        style={({ pressed }) => [styles.credits, pressed && styles.pressed]}
        testID="bodygoals.footer.credits"
      >
        <LPText size={12} weight="semibold" color={colors.paper2} align="center">
          {credits}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  minor: { gap: 10, padding: 16 },
  footer: { gap: 10, paddingTop: 4 },
  credits: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.7 },
});
