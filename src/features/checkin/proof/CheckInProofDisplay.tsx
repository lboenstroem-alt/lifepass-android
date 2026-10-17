/**
 * What a member holds up at the front desk after checking in: the Android
 * port of iOS `CheckInProofDisplay` (Views/CheckIn/CheckInView.swift).
 *
 * ONE VIEW FOR BOTH SCREENS. A member arrives at reception holding either the
 * live scan success screen or the proof Home re-offers minutes later. Staff
 * learn a shape, and two shapes means reading every screen from scratch, so
 * both are this view.
 *
 * WHAT IS BIG, AND WHY. It is read at arm's length, across a counter, by
 * someone who is not holding the phone. The TIME and the VENUE are the whole
 * question at a desk (is this from just now, and is it here), so they are the
 * two biggest things on the screen. The member's name sits directly under
 * them, big enough to read from the same distance, because the third question
 * is who. Everything else (the activity, the confirmation code, the guest
 * receipt, the hint) is support and is deliberately small.
 *
 * THE NAME IS THE SERVER'S. `memberShortName` arrives already shortened to
 * "Lucas B." and is rendered exactly as sent. Nothing is shortened, padded or
 * fallen back to here: no name means no name, never an email, never a
 * placeholder, never the full `memberName`.
 *
 * LARGE TEXT. At the accessibility sizes (font scale about 1.5 and up):
 * - the time, day, venue and name stop growing at iOS accessibility1
 *   (`FONT_SCALE_CAP.accessibility1`), as do the party receipt and the
 *   balance; the eyebrow and the balance label stop at xxLarge;
 * - the mark stands BESIDE the eyebrow instead of above it, and the caller
 *   hands in a smaller one;
 * - the margins and the big lines' dead leading give their room back;
 * - the party receipt becomes one line, so a guest charge already taken from
 *   the member's card stays on the phone rather than under Done;
 * - and the whole proof scrolls when it is still taller than the phone.
 * The detail line and the hint keep scaling the whole way.
 *
 * TalkBack reads the eyebrow, then ONE summary of the big lines ("14:32, Thu
 * 23 Apr, World Class Laugar, Lucas B.").
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type TextStyle } from 'react-native';

import type { CheckInParty } from '../../../api/profile';
import { LPText } from '../../../components/ui';
import { FONT_SCALE_CAP, useA11ySize } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import {
  partyBreakdownLine,
  partyChargedLine,
  partyCompactLine,
  partyGuestCount,
  partyHeadline,
  proofDay,
  proofDetailLine,
  proofSummary,
  proofTime,
} from './proofFormat';

export interface CheckInProofDisplayProps {
  /** When the check-in happened, as the server recorded it. */
  readonly checkedInAt: Date;
  readonly venueName: string | null;
  /** Already shortened by the server; null shows no name. */
  readonly memberShortName: string | null;
  /** The booked class, or the caller's own word for a plain walk-in; null prints nothing. */
  readonly activityName: string | null;
  /** The short confirmation code, on screens that hold a check-in id. */
  readonly confirmationCode: string | null;
  /** The guest party this scan admitted. */
  readonly party: CheckInParty | null;
  /** What the pass or month has left after this visit (the live success screen only). */
  readonly balance?: string | null;
  /** "Show this screen to the staff at reception", where it is wanted. */
  readonly hint: string | null;
  /** The check mark. */
  readonly mark: ReactNode;
}

/** No glyph room above or below digits: only the dead leading, given back at the accessibility sizes. */
function trim(compact: boolean, points: number): TextStyle | null {
  return compact ? { marginVertical: -points } : null;
}

export default function CheckInProofDisplay({
  checkedInAt,
  venueName,
  memberShortName,
  activityName,
  confirmationCode,
  party,
  balance,
  hint,
  mark,
}: CheckInProofDisplayProps) {
  const { t, language } = useT();
  const compact = useA11ySize().isAccessibilitySize;

  const time = proofTime(checkedInAt);
  const day = proofDay(checkedInAt, language);
  const venue = venueName && venueName.length > 0 ? venueName : null;
  const name = memberShortName && memberShortName.length > 0 ? memberShortName : null;
  const detail = proofDetailLine(activityName, confirmationCode, t);
  const showsParty = party !== null && partyGuestCount(party) > 0;
  const charged = party ? partyChargedLine(party, t) : null;

  const eyebrow = (
    <LPText
      size={14}
      weight="semibold"
      tracking={0.8}
      color={colors.paper3}
      align="center"
      maxScale={FONT_SCALE_CAP.xxLarge}
      accessibilityLabel={t('checkin.success')}
      style={!compact && styles.eyebrowStacked}
    >
      {t('checkin.success').toUpperCase()}
    </LPText>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, compact ? styles.contentCompact : styles.contentRoomy]}
      testID="checkin.proof"
    >
      {compact ? (
        <View style={styles.markBeside}>
          {mark}
          <View style={styles.eyebrowBeside}>{eyebrow}</View>
        </View>
      ) : (
        <>
          {mark}
          {eyebrow}
        </>
      )}

      <View
        accessible
        accessibilityLabel={proofSummary(time, day, venue, name)}
        style={[styles.headline, { marginTop: compact ? 6 : 10, gap: compact ? 2 : 6 }]}
        testID="checkin.proof.headline"
      >
        <LPText
          size={72}
          weight="bold"
          color={colors.paper}
          align="center"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.4}
          maxScale={FONT_SCALE_CAP.accessibility1}
          style={[styles.display, styles.digits, trim(compact, 22)]}
        >
          {time}
        </LPText>
        <LPText
          size={17}
          weight="medium"
          color={colors.paper3}
          align="center"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          maxScale={FONT_SCALE_CAP.accessibility1}
          style={[styles.display, trim(compact, 4)]}
        >
          {day}
        </LPText>
        {venue ? (
          <LPText
            size={36}
            weight="semibold"
            color={colors.paper}
            align="center"
            numberOfLines={3}
            adjustsFontSizeToFit
          minimumFontScale={0.45}
            maxScale={FONT_SCALE_CAP.accessibility1}
            style={[styles.display, trim(compact, 9), { marginTop: compact ? 6 - 9 : 14 }]}
          >
            {venue}
          </LPText>
        ) : null}
        {name ? (
          <LPText
            size={30}
            weight="medium"
            color={colors.paper}
            align="center"
            numberOfLines={2}
            adjustsFontSizeToFit
          minimumFontScale={0.5}
            maxScale={FONT_SCALE_CAP.accessibility1}
            style={[styles.display, trim(compact, 8), { marginTop: compact ? 4 - 8 : 6 }]}
            testID="checkin.proof.name"
          >
            {name}
          </LPText>
        ) : null}
      </View>

      {detail ? (
        <LPText size={14} color={colors.paper3} align="center" style={styles.detail}>
          {detail}
        </LPText>
      ) : null}

      {showsParty && party ? (
        <View
          style={[styles.party, compact ? styles.partyCompact : styles.partyRoomy]}
          testID="checkin.proof.party"
        >
          <LPText size={26} weight="bold" color={colors.paper} align="center" maxScale={FONT_SCALE_CAP.accessibility1}>
            {partyHeadline(party, t)}
          </LPText>
          {compact ? (
            <LPText size={15} weight="medium" color={colors.paper3} align="center" maxScale={FONT_SCALE_CAP.accessibility1}>
              {partyCompactLine(party, t)}
            </LPText>
          ) : (
            <>
              <LPText size={15} weight="medium" color={colors.paper3} align="center">
                {partyBreakdownLine(party, t)}
              </LPText>
              {charged ? (
                <LPText size={13} color={colors.paper3} align="center">
                  {charged}
                </LPText>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {balance ? (
        <View
          accessible
          accessibilityLabel={`${t('checkin.balance.label')}: ${balance}`}
          style={[styles.balance, { marginTop: compact ? 10 : 18 }]}
          testID="checkin.proof.balance"
        >
          <LPText size={11} weight="semibold" tracking={0.8} color={colors.paper3} maxScale={FONT_SCALE_CAP.xxLarge}>
            {t('checkin.balance.label').toUpperCase()}
          </LPText>
          <LPText size={15} weight="medium" color={colors.paper} align="center" maxScale={FONT_SCALE_CAP.accessibility1}>
            {balance}
          </LPText>
        </View>
      ) : null}

      {hint ? (
        <LPText size={13} color={colors.paper3} align="center" style={styles.hint}>
          {hint}
        </LPText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // Centred while it fits, and only then: taller than the phone, it scrolls.
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'stretch', paddingHorizontal: 24 },
  contentRoomy: { paddingVertical: 28 },
  contentCompact: { paddingVertical: 6 },
  markBeside: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 2 },
  eyebrowBeside: { flexShrink: 1 },
  eyebrowStacked: { marginTop: 14 },
  headline: { alignItems: 'stretch' },
  // Android pads every line for accents it never draws here; the proof's
  // display lines take only their own height.
  display: { includeFontPadding: false },
  digits: { fontVariant: ['tabular-nums'] },
  detail: { marginTop: 18 },
  party: { alignItems: 'center', borderRadius: 14, backgroundColor: colors.ink2 },
  partyRoomy: { marginTop: 20, paddingVertical: 16, paddingHorizontal: 20, gap: 6 },
  partyCompact: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  balance: { alignItems: 'center', gap: 4 },
  hint: { marginTop: 20 },
});
