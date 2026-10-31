/* eslint lifepass/no-literal-copy: "error" */
/**
 * The one-tap consent before a member's first plan change in chat (409
 * `plan_edit_consent_required`): iOS `PlanEditConsentSheet`'s content, in
 * the chat on the Coach's dark glass. Its title, the shared consent block
 * (../../../health/consent/AiConsentBlock.tsx) with the line that names a
 * plan change (2026-09-v4), and "Not now". The tap grants it and sends the
 * same words again with the same key (./flow.ts `grantConsentFor`); "Not
 * now" sends nothing ("Okay. Your plan stays as it is."). Once answered,
 * the block goes.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { HealthConsentVersion } from '../../../health';
import { AiConsentBlock, type AiConsentPalette } from '../../../health/ui';
import { useAppStore } from '../../../stores/appStore';
import { useT } from '../../../i18n';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { declineConsentFor, grantConsentFor, type PlanEditConsentPayload } from './flow';

const COACH_CONSENT_PALETTE: AiConsentPalette = {
  text: coachPalette.textPrimary,
  link: coachPalette.textSecondary,
  icon: coachPalette.avatar,
  error: coachPalette.textSecondary,
  background: coachPalette.tile,
  border: coachPalette.stroke,
  button: coachPalette.accent,
  buttonText: '#FFFFFF',
};

/** v4 also covers describing a meal: a consent older than v3 never showed that line, so it is shown here. */
const DESCRIBE_LINE = [{ key: 'healthconsent.ai.describe', icon: 'chatbubble-ellipses-outline' }] as const;

function PlanEditConsentBubble({ message, busy }: CoachMessageRendererProps) {
  const { t } = useT();
  const standingVersion = useAppStore((s) => s.profile?.health?.consent?.version ?? null);
  const payload = message.payload as PlanEditConsentPayload | undefined;
  if (!payload || payload.status === 'granted' || payload.status === 'declined') return null;
  const granting = payload.status === 'granting' || busy;
  return (
    <View style={styles.root} testID="coach.planEdit.consentBubble">
      <LPText serif size={18} color={coachPalette.textPrimary} accessibilityRole="header">
        {t('coach.planEdit.consent.title')}
      </LPText>
      <AiConsentBlock
        lineKey="healthconsent.ai.plan_edit"
        extraLines={HealthConsentVersion.coversMealDescribe(standingVersion) ? [] : DESCRIBE_LINE}
        ctaKey="coach.planEdit.consent.cta"
        icon="barbell-outline"
        granting={granting}
        errorKey={payload.errorKey}
        onGrant={() => void grantConsentFor(message.id)}
        palette={COACH_CONSENT_PALETTE}
        testID="coach.planEdit.consentBlock"
        buttonTestID="coach.planEdit.consent"
        errorTestID="coach.planEdit.consentError"
      />
      <Pressable
        onPress={() => declineConsentFor(message.id)}
        disabled={granting}
        accessibilityRole="button"
        accessibilityLabel={t('healthconsent.not_now')}
        accessibilityState={{ disabled: granting }}
        style={({ pressed }) => [styles.notNow, pressed && styles.pressed]}
        testID="coach.planEdit.consentNotNow"
      >
        <LPText size={14} weight="semibold" color={coachPalette.textSecondary}>
          {t('healthconsent.not_now')}
        </LPText>
      </Pressable>
    </View>
  );
}

export default memo(PlanEditConsentBubble);

const styles = StyleSheet.create({
  root: { paddingLeft: 34, alignSelf: 'stretch', gap: 10 },
  notNow: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
});
