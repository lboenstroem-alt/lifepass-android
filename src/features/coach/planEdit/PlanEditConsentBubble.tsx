/* eslint lifepass/no-literal-copy: "error" */
/**
 * The one-tap consent before a member's first plan change in chat (409
 * `plan_edit_consent_required`), in the chat on the Coach's dark glass: the
 * shared consent block (../../../health/consent/AiConsentBlock.tsx) with the
 * line that names a plan change (2026-09-v4). The tap grants it and sends
 * the same words again with the same key (./flow.ts `grantConsentFor`);
 * once granted the block goes.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AiConsentBlock, type AiConsentPalette } from '../../../health/ui';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { grantConsentFor, type PlanEditConsentPayload } from './flow';

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

function PlanEditConsentBubble({ message, busy }: CoachMessageRendererProps) {
  const payload = message.payload as PlanEditConsentPayload | undefined;
  if (!payload || payload.status === 'granted') return null;
  return (
    <View style={styles.root}>
      <AiConsentBlock
        lineKey="healthconsent.ai.plan_edit"
        ctaKey="coach.planEdit.consent.cta"
        icon="barbell-outline"
        granting={payload.status === 'granting' || busy}
        errorKey={payload.errorKey}
        onGrant={() => void grantConsentFor(message.id)}
        palette={COACH_CONSENT_PALETTE}
        testID="coach.planEdit.consentBlock"
        buttonTestID="coach.planEdit.consent"
        errorTestID="coach.planEdit.consentError"
      />
    </View>
  );
}

export default memo(PlanEditConsentBubble);

const styles = StyleSheet.create({
  root: { paddingLeft: 34, alignSelf: 'stretch' },
});
