/* eslint lifepass/no-literal-copy: "error" */
/**
 * The member's own visit first (iOS 2.5.3, `CheckInView.ownVisitSheet`):
 * shown when the venue sells guest seats and the member's own visit costs
 * nothing. It names the venue, says what covers the visit ("Covered by your
 * Adventurer pass: uses 1 of 6 visits (5 left after)", the membership's line,
 * or from an older server "Your visit has no charge."), offers a free
 * "Check in, no charge", and keeps the guest sheet behind "Bringing a
 * guest?". No price is on this sheet, because none of the prices the venue
 * sells at the door is the member's.
 *
 * The words scroll and the buttons stay pinned (the footer), so at the large
 * text sizes, or in Icelandic on a small phone, "Check in" is never the part
 * that falls off; at the accessibility sizes it opens at full height. The
 * close button sends nothing and ends the attempt; on Android, back does the
 * same (./useBackEndsStep). A tap outside or a pan down does nothing, as iOS
 * (`interactiveDismissDisabled`). For an attempt that came by link, the
 * link's note is here and this tap is the confirmation.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { hiddenFromAccessibility, LPText, Sheet } from '../../../../components/ui';
import { coverageLine } from '../../../../copy/passCopy';
import { useA11ySize } from '../../../../hooks/useA11ySize';
import { useT } from '../../../../i18n';
import { colors, minTouch, radius } from '../../../../theme';
import type { WalkInCoverage } from '../../../../api/walkInPreview';
import { useWalkIn, walkInActions } from '../useWalkIn';

import { LinkButton, SolidButton } from './buttons';
import { useBackEndsStep } from './useBackEndsStep';

type IconName = keyof typeof Ionicons.glyphMap;

/** iOS: a pass's ticket, the membership's seal, else a check mark. */
export function coverageIcon(coverage: WalkInCoverage | null | undefined): IconName {
  switch (coverage?.kind) {
    case 'pass':
      return 'ticket';
    case 'subscription':
      return 'shield-checkmark';
    default:
      return 'checkmark-circle';
  }
}

export default function OwnVisitSheet() {
  const { t, language } = useT();
  const { isAccessibilitySize } = useA11ySize();
  const visible = useWalkIn((s) => s.showOwnVisitConfirm);
  const venueName = useWalkIn((s) => s.preview?.venue.name ?? null);
  const coverage = useWalkIn((s) => s.preview?.coveredBy ?? null);
  const linked = useWalkIn((s) => s.linkedAttempt);
  const sellsGuests = useWalkIn((s) => s.guestBandOffers.length > 0);
  const titleRef = useRef<Text>(null);
  const line = coverageLine(coverage, language) ?? t('checkin.cover.free');
  const decline = () => walkInActions().declineOwnVisit();
  useBackEndsStep(visible, decline);

  return (
    <Sheet
      visible={visible}
      // Never by a tap outside or a pan down (iOS); back is useBackEndsStep's.
      dismissible={false}
      onClose={decline}
      fullHeight={isAccessibilitySize}
      initialFocusRef={titleRef}
      testID="walkin.ownVisit"
      footer={
        <>
          <SolidButton
            title={t('checkin.cover.check_in')}
            onPress={() => void walkInActions().checkInOwnVisit()}
            testID="walkin.ownVisit.checkIn"
          />
          {sellsGuests ? (
            <LinkButton
              size={15}
              title={t('checkin.cover.guest_toggle')}
              accessibilityHint={t('checkin.cover.guest_hint')}
              onPress={() => void walkInActions().openGuestsFromOwnVisit()}
              testID="walkin.ownVisit.guests"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <LPText size={12} weight="semibold" tracking={0.6} color={colors.mutedTextStrong}>
              {t('checkin.cover.eyebrow').toUpperCase()}
            </LPText>
            {venueName ? (
              <LPText ref={titleRef} serif size={26} color={colors.paper} accessibilityRole="header">
                {venueName}
              </LPText>
            ) : null}
          </View>
          <Pressable
            onPress={decline}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={styles.close}
            testID="walkin.ownVisit.close"
          >
            <View style={styles.closeDisc}>
              <Ionicons name="close" size={16} color={colors.paper} />
            </View>
          </Pressable>
        </View>
        <View style={styles.card} accessible accessibilityLabel={line} testID="walkin.ownVisit.coverage">
          <Ionicons name={coverageIcon(coverage)} size={18} color={colors.accentText} {...hiddenFromAccessibility} />
          <LPText size={16} weight="medium" color={colors.paper} style={styles.line}>
            {line}
          </LPText>
        </View>
        {linked ? (
          // The link alert's note, here because this step replaces it.
          <LPText size={13} color={colors.mutedTextStrong}>
            {t('checkin.link.confirm_body')}
          </LPText>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { flex: 1, gap: 6 },
  close: { width: minTouch, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  closeDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
  },
  line: { flex: 1 },
});
