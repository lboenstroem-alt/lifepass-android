/* eslint lifepass/no-literal-copy: "error" */
/**
 * The member card at the top of Account: the port of iOS
 * `AccountView.memberCard` (Views/Profile/AccountView.swift).
 *
 * Avatar letter, name and email, and the capsule into Plans ("Change plan"
 * for a plan holder, else "View plans": the same flow as the Membership row
 * below, where the eye already is). Under them the kicker ("Plan · Plus",
 * the pass for a pass holder, "Plan · None") and either:
 * - in dunning, `account.past_due_body` and the Fix payment capsule (ACCT-3's
 *   `slots/PastDueFix`, which owns the retry). Access is suspended then and
 *   the usage lanes read null, so the caps line would say "No active
 *   membership" about a plan that still exists; or
 * - the serif caps line (accountCopy `capsSummary`) and the renewal date or
 *   the pass's "Valid until".
 *
 * The card is ink2 with a glacier-blue radial wash from its top right corner
 * (iOS `RadialGradient`, end radius 260), drawn with react-native-svg once
 * the card knows its size.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Kicker, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors } from '../../theme';

import {
  avatarInitial,
  capsSummary,
  isPastDue,
  memberCardFootnote,
  memberCardKicker,
  plansButtonTitle,
  type MembershipFacts,
} from './accountCopy';
import PastDueFix from './slots/PastDueFix';

/** iOS `Color(red: 0.16, green: 0.19, blue: 0.26)`, the avatar gradient's dark end. */
const AVATAR_DEEP = '#293042';
const WHITE = '#FFFFFF';

export interface MemberCardProps {
  readonly fullName: string | null;
  readonly email: string | null;
  readonly facts: MembershipFacts;
  readonly onOpenPlans: () => void;
}

export default function MemberCard({ fullName, email, facts, onOpenPlans }: MemberCardProps) {
  const { t, language } = useT();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const pastDue = isPastDue(facts);
  const footnote = pastDue ? null : memberCardFootnote(facts, language);
  const plansTitle = plansButtonTitle(facts, language);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };

  return (
    <View style={styles.card} onLayout={onLayout} testID="account.memberCard">
      {size ? <RustWash width={size.width} height={size.height} /> : null}

      <View style={styles.identity}>
        <View style={styles.avatarRing} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <LinearGradient
            colors={[colors.paper, AVATAR_DEEP]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <LPText serif size={22} weight="semibold" color={WHITE} maxScale={1}>
              {avatarInitial(fullName)}
            </LPText>
          </LinearGradient>
        </View>
        <View style={styles.names}>
          <LPText size={16} weight="semibold" color={colors.paper}>
            {fullName ?? t('common.member')}
          </LPText>
          <LPText size={12} color={colors.paper3} numberOfLines={1}>
            {email ?? ''}
          </LPText>
        </View>
        <Pressable
          onPress={onOpenPlans}
          accessibilityRole="button"
          accessibilityLabel={plansTitle}
          hitSlop={8}
          style={({ pressed }) => [styles.plansButton, pressed && styles.pressed]}
          testID="account.memberCard.plans"
        >
          <LPText size={12} weight="semibold" color={WHITE} numberOfLines={1}>
            {plansTitle}
          </LPText>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <Kicker text={memberCardKicker(facts, language)} color={colors.paper2} testID="account.memberCard.kicker" />
        {pastDue ? (
          <>
            <LPText size={14} color={colors.paper} testID="account.memberCard.pastDue">
              {t('account.past_due_body')}
            </LPText>
            <PastDueFix />
          </>
        ) : (
          <>
            <LPText serif size={20} tracking={-0.4} color={colors.paper} testID="account.memberCard.caps">
              {capsSummary(facts, language)}
            </LPText>
            {footnote ? (
              <LPText size={11} color={colors.paper3} testID="account.memberCard.footnote">
                {footnote}
              </LPText>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

/** The glacier wash from the top right corner (iOS `RadialGradient` at x 0.9, y 0, radius 260). */
function RustWash({ width, height }: { width: number; height: number }) {
  const cx = width * 0.9;
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Defs>
        <RadialGradient id="accountWash" cx={cx} cy={0} r={260} fx={cx} fy={0} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.rust} stopOpacity={0.35} />
          <Stop offset="1" stopColor={colors.rust} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#accountWash)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    gap: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.ink2,
    overflow: 'hidden',
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.line2, overflow: 'hidden' },
  avatar: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  names: { flex: 1, gap: 2 },
  plansButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.rust,
    flexShrink: 0,
  },
  pressed: { opacity: 0.7 },
  summary: { gap: 6 },
});
