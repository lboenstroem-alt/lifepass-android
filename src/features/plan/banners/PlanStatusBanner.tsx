/**
 * The ONE status banner at the top of Plan (iOS `statusBanner`, 3.5), in
 * priority order: a payment problem outranks something that could not be
 * saved, which outranks being offline. Money first because it is the one the
 * member has to act on; the failed item second because it is the one that
 * quietly loses work. A member is never told three things at once.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText, showDialog, StatusBanner } from '../../../components/ui';
import { useHealthStore } from '../../../health';
import { HealthFormat, useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';
import type { PlanOutboxItem } from '../shell/bridges';
import { discardOutboxItem, pushPlanRoute, saveOutboxItemAsExtra, usePlanShell } from '../shell/planShell';
import { usePlanView } from '../shell/planView';

/** Which banner shows, if any (pure, for the screen and its tests). */
export type PlanStatusBannerKind =
  | { readonly kind: 'pastDue' }
  | { readonly kind: 'outbox'; readonly item: PlanOutboxItem }
  | { readonly kind: 'offline' }
  | null;

export function planStatusBanner(input: {
  readonly isPastDue: boolean;
  readonly failedItems: readonly PlanOutboxItem[];
  readonly isOffline: boolean;
}): PlanStatusBannerKind {
  if (input.isPastDue) return { kind: 'pastDue' };
  const item = input.failedItems[0];
  if (item) return { kind: 'outbox', item };
  if (input.isOffline) return { kind: 'offline' };
  return null;
}

export default function PlanStatusBanner() {
  const { t } = useT();
  const { access, isOffline } = usePlanView();
  const failedItems = usePlanShell((s) => s.failedOutboxItems);
  const cachedAt = useHealthStore((s) => s.cachedAt);
  const banner = planStatusBanner({ isPastDue: access === 'past_due', failedItems, isOffline });

  if (!banner) return null;
  switch (banner.kind) {
    case 'pastDue':
      return (
        <StatusBanner
          icon="warning-outline"
          message={t('health.past_due.banner')}
          actionLabel={t('health.past_due.cta')}
          onAction={() => pushPlanRoute('Account')}
          testID="plan.banner.pastDue"
        />
      );
    case 'outbox':
      return <OutboxBanner item={banner.item} />;
    case 'offline':
      return (
        <StatusBanner
          icon="cloud-offline-outline"
          message={t('health.offline.banner', { time: cachedAt ? HealthFormat.time(cachedAt) : '' })}
          testID="plan.banner.offline"
        />
      );
  }
}

/**
 * A workout or a meal this phone saved that the server will not take. Its own
 * layout rather than StatusBanner's, because this is the one banner with two
 * decisions under it: "Save as extra" reposts a workout with a new key and
 * `asExtra: true`; "Discard" throws away something the member did, so it
 * asks first.
 */
function OutboxBanner({ item }: { item: PlanOutboxItem }) {
  const { t } = useT();
  const confirmDiscard = () =>
    showDialog({
      title: t('plan.outbox.discard_title'),
      presentation: 'actionSheet',
      titleVisibility: 'visible',
      buttons: [
        { label: t('plan.outbox.discard'), role: 'destructive', onPress: () => void discardOutboxItem(item) },
        { label: t('common.cancel'), role: 'cancel' },
      ],
    });

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="plan.banner.outbox">
      <View style={styles.messageRow}>
        <View style={styles.icon}>
          <Ionicons name="sync-outline" size={14} color={colors.paper2} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <LPText size={13} color={colors.paper} style={styles.message}>
          {t(item.kind === 'workout' ? 'plan.outbox.failed' : 'plan.outbox.meal_failed')}
        </LPText>
      </View>
      <View style={styles.actions}>
        {item.kind === 'workout' ? (
          <Pressable
            onPress={() => void saveOutboxItemAsExtra(item)}
            accessibilityRole="button"
            accessibilityLabel={t('plan.outbox.save_extra')}
            hitSlop={5}
            style={({ pressed }) => [styles.saveExtra, pressed && styles.pressed]}
            testID="plan.banner.outbox.saveExtra"
          >
            <LPText size={13} weight="semibold" color={colors.onAccent}>
              {t('plan.outbox.save_extra')}
            </LPText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={confirmDiscard}
          accessibilityRole="button"
          accessibilityLabel={t('plan.outbox.discard')}
          style={({ pressed }) => [styles.discard, pressed && styles.pressed]}
          testID="plan.banner.outbox.discard"
        >
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {t('plan.outbox.discard')}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: colors.ink3,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 18, height: 18, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 28 },
  saveExtra: {
    minHeight: 34,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.rust,
    borderRadius: radius.pill,
  },
  discard: { minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.75 },
});
