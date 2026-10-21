/**
 * "Looking for your bookings? They are under your picture on Home." (iOS
 * `bookingsHintRow`, R19): for a member whose install knew Profile as a tab,
 * on at most three appearances of Plan, until they find Profile from Home.
 * Open bookings goes there; the x ends the hint for good.
 *
 * The visit count and the decision are the shell's (`countPlanVisit`). iOS
 * lays the x over the banner's top corner; here it sits after the action, so
 * the two never overlap on a narrow phone. It is labelled "Done", as on iOS.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline, radius } from '../../../theme';
import { dismissBookingsHint, pushPlanRoute, usePlanShell } from '../shell/planShell';

export default function BookingsHintBanner() {
  const { t } = useT();
  const hintFor = usePlanShell((s) => s.bookingsHintFor);
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const isMinor = useAppStore((s) => s.healthAccess === 'minor');
  // The hint was decided for the member on screen, never for someone before them.
  if (!hintFor || hintFor !== profileId || isMinor) return null;

  const action = t('plan.open_bookings');
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="plan.banner.bookingsHint">
      <View style={styles.icon} {...hiddenFromAccessibility}>
        <Ionicons name="calendar-outline" size={14} color={colors.paper2} />
      </View>
      <LPText size={13} color={colors.paper} style={styles.message}>
        {t('plan.where_bookings')}
      </LPText>
      <Pressable
        onPress={() => pushPlanRoute('Profile', { initialTab: 'bookings' })}
        accessibilityRole="button"
        accessibilityLabel={action}
        hitSlop={5}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        testID="plan.banner.bookingsHint.open"
      >
        <LPText size={13} weight="semibold" color={colors.onAccent}>
          {action}
        </LPText>
      </Pressable>
      <Pressable
        onPress={dismissBookingsHint}
        accessibilityRole="button"
        accessibilityLabel={t('common.done')}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        testID="plan.banner.bookingsHint.dismiss"
      >
        <Ionicons name="close" size={14} color={colors.paper3} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 12,
    backgroundColor: colors.ink3,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  icon: { width: 18, height: 18, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1 },
  action: {
    minHeight: 34,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.rust,
    borderRadius: radius.pill,
  },
  close: { width: 44, height: 44, marginTop: -5, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
});
