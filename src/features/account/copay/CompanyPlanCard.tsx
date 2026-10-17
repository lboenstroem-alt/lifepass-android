/**
 * The company-plan card on Account (iOS `AccountView.companyPlanBanner`):
 *
 * - a co-pay plan waiting for the member: "{company} offers you the {plan}
 *   plan." and the CTA "Activate · ISK 4,900/mo" (or "· included"), or, while
 *   a personal plan blocks it, why it cannot be activated yet;
 * - else an unclaimed invitation: "Your company plan at {company} is waiting
 *   for you." and "Verify identity to claim", which opens Kenni (the claim
 *   happens inside the verification);
 * - else nothing.
 *
 * Drawn from props so it can be tested on its own; the Account slot
 * (slots/CompanyPlanBanner) feeds it the context and the actions.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { CompanyPlanContext } from '../../../supabase/services/companyPlans';
import { colors, radius } from '../../../theme';

import { activationCta } from './copayFlows';

/** The only `blocked` value iOS knows: a live personal plan holds activation until it ends. */
export const BLOCKED_BY_EXISTING_SUBSCRIPTION = 'existing_subscription';

export interface CompanyPlanCardProps {
  readonly context: CompanyPlanContext | null;
  /** An activation is running: the CTA reads "Processing…" and does nothing. */
  readonly activating: boolean;
  /** The activation CTA: the confirm comes next. */
  readonly onActivate: () => void;
  /** "Verify identity to claim": the Kenni sheet. */
  readonly onVerify: () => void;
}

export default function CompanyPlanCard({ context, activating, onActivate, onVerify }: CompanyPlanCardProps) {
  const { t, language } = useT();
  const activation = context?.pendingActivation ?? null;
  const invite = context?.pendingInvite ?? null;

  if (activation) {
    const blocked = activation.blocked === BLOCKED_BY_EXISTING_SUBSCRIPTION;
    const cta = activating ? t('common.processing') : activationCta(activation, language);
    return (
      <View style={styles.card} testID="copay.banner.activation">
        <Kicker text={t('account.copay_kicker')} color={colors.paper2} />
        <LPText size={14} color={colors.paper} testID="copay.banner.offer">
          {t('account.copay_offer', { company: activation.companyName, plan: activation.productName })}
        </LPText>
        {blocked ? (
          <LPText size={12} color={colors.paper3} testID="copay.banner.blocked">
            {t('account.copay_blocked_sub')}
          </LPText>
        ) : (
          <Pressable
            onPress={onActivate}
            disabled={activating}
            accessibilityRole="button"
            accessibilityLabel={cta}
            accessibilityState={{ disabled: activating, busy: activating }}
            hitSlop={6}
            style={({ pressed }) => [styles.cta, (pressed || activating) && styles.dimmed]}
            testID="copay.banner.activate"
          >
            <LPText size={13} weight="semibold" color={colors.onAccent}>
              {cta}
            </LPText>
          </Pressable>
        )}
      </View>
    );
  }

  if (invite) {
    const cta = t('account.copay_invite_cta');
    return (
      <View style={styles.card} testID="copay.banner.invite">
        <Kicker text={t('account.copay_kicker')} color={colors.paper2} />
        <LPText size={14} color={colors.paper} testID="copay.banner.inviteText">
          {t('account.copay_invite', { company: invite.companyName })}
        </LPText>
        <Pressable
          onPress={onVerify}
          accessibilityRole="button"
          accessibilityLabel={cta}
          hitSlop={6}
          style={({ pressed }) => [styles.cta, pressed && styles.dimmed]}
          testID="copay.banner.verify"
        >
          <LPText size={13} weight="semibold" color={colors.onAccent}>
            {cta}
          </LPText>
        </Pressable>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  // iOS: VStack spacing 10, padding 16, ink2, corner 14, a rust outline at 40 %.
  card: {
    gap: 10,
    padding: 16,
    alignSelf: 'stretch',
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(71,133,194,0.4)', // colors.rust (#4785C2) at 40 %
  },
  // iOS: 13 pt semibold white on rust, padding 14 by 9, a capsule.
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.rust,
  },
  dimmed: { opacity: 0.6 },
});
