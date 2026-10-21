/* eslint lifepass/no-literal-copy: "error" */
/**
 * Profile's member card: the port of iOS `LibraryView.memberCard`
 * (Views/Profile/LibraryView.swift). What it says is ./memberCard.ts.
 *
 * Avatar letter, name, and the email with an envelope; on the right the
 * glacier capsule (the plan, the tier or "VIEW PLANS"), which opens Plans,
 * and under it this period's caps. The card itself is NOT a button: Account
 * is behind the gear in the top bar (the first Android build opened Account
 * from anywhere on the card).
 *
 * The card is ink2 with a 1.5 pt gradient outline (rust to aurora to rust)
 * and a soft rust shadow, as iOS draws it.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import type { Usage } from '../../api/profile';
import type { Subscription } from '../../api/subscriptions';
import { colors } from '../../theme';

import { memberCardBadge, memberCardCaps, memberCardInitial, memberCardName } from './memberCard';

/** iOS `.foregroundStyle(.white)` on the avatar letter. */
const WHITE = '#FFFFFF';
/** The outline: rust 0.55, aurora 0.35, rust 0.2 (iOS `LinearGradient`, top leading to bottom trailing). */
const OUTLINE = ['rgba(71,133,194,0.55)', 'rgba(71,133,194,0.35)', 'rgba(71,133,194,0.2)'] as const;
const OUTLINE_WIDTH = 1.5;
const RADIUS = 18;

export interface LibraryMemberCardProps {
  readonly profile: { readonly fullName: string | null; readonly email: string | null } | null;
  readonly subscription: Subscription | null;
  readonly usage: Usage | null;
  readonly onOpenPlans: () => void;
}

export default function LibraryMemberCard({ profile, subscription, usage, onOpenPlans }: LibraryMemberCardProps) {
  const { t } = useT();
  const name = memberCardName(profile, t);
  const email = profile?.email ?? '';
  const badge = memberCardBadge(subscription, usage, t);
  const caps = memberCardCaps(usage, t);

  return (
    <LinearGradient
      colors={OUTLINE}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.outline}
      testID="library.memberCard"
    >
      <View style={styles.card}>
        <View style={styles.avatar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <LPText size={22} weight="semibold" color={WHITE} maxScale={1}>
            {memberCardInitial(name)}
          </LPText>
        </View>

        <View style={styles.names}>
          <LPText size={17} weight="semibold" tracking={-0.4} color={colors.paper} testID="library.memberCard.name">
            {name}
          </LPText>
          <View style={styles.emailRow}>
            <Ionicons
              name="mail-outline"
              size={10}
              color={colors.paper3}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <LPText size={12} color={colors.paper3} numberOfLines={1} style={styles.email}>
              {email}
            </LPText>
          </View>
        </View>

        <View style={styles.trailing}>
          <Pressable
            onPress={onOpenPlans}
            accessibilityRole="button"
            accessibilityLabel={badge}
            // The capsule is small (iOS draws it at 10 pt); the slop makes it a
            // 48 dp target without changing how it looks.
            hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
            style={({ pressed }) => [styles.badge, pressed && styles.pressed]}
            testID="library.memberCard.badge"
          >
            <LPText size={10} weight="semibold" tracking={0.5} color={colors.aurora} numberOfLines={1}>
              {badge}
            </LPText>
          </Pressable>
          {caps ? (
            <LPText size={11} color={colors.paper3} align="right" testID="library.memberCard.caps">
              {caps}
            </LPText>
          ) : null}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  outline: {
    borderRadius: RADIUS,
    padding: OUTLINE_WIDTH,
    shadowColor: colors.rust,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16 - OUTLINE_WIDTH,
    borderRadius: RADIUS - OUTLINE_WIDTH,
    backgroundColor: colors.ink2,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ink3,
    borderWidth: 1.5,
    borderColor: 'rgba(71,133,194,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  names: { flex: 1, gap: 4 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  email: { flexShrink: 1 },
  trailing: { alignItems: 'flex-end', gap: 6, flexShrink: 0, maxWidth: '45%' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(71,133,194,0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(71,133,194,0.3)',
  },
  pressed: { opacity: 0.7 },
});
