/* eslint lifepass/no-literal-copy: "error" */
/**
 * Route `PlanUsage`: the member's caps and usage dashboard, the Android port
 * of iOS `CreditsDetailView` (Views/Profile/CreditDetailView.swift), pushed
 * from Account's "Plan & usage". Its rules are in ./usageModel.
 *
 * Top to bottom, as iOS draws it:
 *   banner        a live booking block (red), else active strikes (aurora)
 *   Your plan     the plan's name and its renewal date        (with a tier)
 *   This period   the top-up prompt, then the gym and studio, pool and
 *                 per-day lanes, and open bookings            (with a tier)
 *   Active passes each pass, its expiry and its visits left   (with passes)
 *   no tier, no passes: the payment issue (past due) or "not on a plan yet"
 *                 with View plans
 *   How visits work, always last
 *
 * Read from the app store only, as iOS reads AppState; a profile without a
 * usage block degrades this page, never the account.
 */
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, type ComponentProps, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ActivePass, Usage, UsageLane } from '../../../api/profile';
import { LPText, PrimaryButton } from '../../../components/ui';
import { passName, visitsLeft } from '../../../copy/passCopy';
import { useT } from '../../../i18n';
import type { SharedRouteProps } from '../../../navigation/types';
import { selectActivePasses, selectUsage, useAppStore } from '../../../stores/appStore';
import { colors, hairline, radius } from '../../../theme';
import InlineTitleBar from '../billing/InlineTitleBar';
import {
  laneMeter,
  meterOf,
  topUpPrompt,
  usageBanner,
  usageDate,
  usageEmptyState,
  usagePlanName,
} from './usageModel';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A theme colour at an opacity (SwiftUI `.opacity(_:)`); the tokens are #RRGGBB. */
function tint(hex: string, opacity: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${opacity})`;
}

/** iOS's monospaced digits (`.design(.monospaced)`). */
const MONO = { fontFamily: 'monospace' } as const;

export default function PlanUsageScreen({ navigation }: SharedRouteProps<'PlanUsage'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; outside the tabs (the shared sheet) it is the system bar.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const usage = useAppStore(selectUsage);
  const passes = useAppStore(selectActivePasses);
  const subscription = useAppStore((s) => s.subscription);

  const banner = usageBanner(usage);
  const empty = usageEmptyState(usage, passes.length, subscription);
  const fmt = (date: Date) => usageDate(date, language);

  return (
    <View style={styles.page} testID="usage-screen">
      <InlineTitleBar
        title={t('usage.title')}
        onBack={() => navigation.goBack()}
        background={colors.ink2}
        testID="usage.bar"
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 20 + 32 + tabBarHeight }]} testID="usage.scroll">
        {banner?.kind === 'block' ? (
          <Banner
            icon="warning"
            color={colors.destructive}
            title={t('usage.block.title')}
            body={t('usage.block.body', { date: fmt(banner.until) })}
            testID="usage.banner.block"
          />
        ) : null}
        {banner?.kind === 'strikes' ? (
          <Banner
            icon="warning-outline"
            color={colors.aurora}
            title={t('usage.strikes.title', { active: banner.active, threshold: banner.threshold })}
            body={t('usage.strikes.body', { threshold: banner.threshold })}
            testID="usage.banner.strikes"
          />
        ) : null}

        {usage && usage.tier !== null ? (
          <>
            <Panel icon="card-outline" title={t('usage.your_plan')} testID="usage.plan">
              <View style={styles.infoRows}>
                <InfoRow label={t('usage.plan')} value={usagePlanName(subscription, usage)} />
                {subscription ? <InfoRow label={t('usage.renews')} value={fmt(subscription.currentPeriodEndsAt)} /> : null}
              </View>
            </Panel>
            <UsagePanel usage={usage} fmt={fmt} />
          </>
        ) : null}

        {passes.length > 0 ? <PassesPanel passes={passes} fmt={fmt} /> : null}

        {empty === 'pastDue' ? (
          <StateCard
            icon="warning-outline"
            iconColor={colors.signal}
            borderColor={tint(colors.signal, 0.35)}
            borderWidth={1}
            title={t('account.past_due_title')}
            body={t('account.past_due_body')}
            testID="usage.pastDue"
          />
        ) : null}
        {empty === 'noPlan' ? (
          <StateCard
            icon="sparkles"
            iconColor={colors.rust}
            borderColor={colors.line}
            title={t('usage.no_plan.title')}
            body={t('usage.no_plan.body')}
            testID="usage.noPlan"
          >
            <PrimaryButton title={t('usage.no_plan.cta')} shape="flat" onPress={() => navigation.navigate('Plans')} testID="usage.viewPlans" />
          </StateCard>
        ) : null}

        <Explainer />
      </ScrollView>
    </View>
  );
}

// MARK: - Panels

function Panel({ icon, title, children, testID }: { icon: IconName; title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.panelHeader}>
        <Ionicons name={icon} size={14} color={colors.rust} accessibilityElementsHidden importantForAccessibility="no" />
        <LPText size={14} weight="bold" accessibilityRole="header">
          {title}
        </LPText>
      </View>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible style={styles.infoRow}>
      <LPText size={13} color={colors.paper3}>
        {label}
      </LPText>
      <LPText size={13} weight="medium" align="right" style={styles.shrink}>
        {value}
      </LPText>
    </View>
  );
}

/** "This period": the top-up prompt, then each lane and open bookings. */
function UsagePanel({ usage, fmt }: { usage: Usage; fmt: (date: Date) => string }) {
  const { t } = useT();
  const prompt = topUpPrompt(usage);
  return (
    <View style={[styles.card, styles.usagePanel]} testID="usage.period">
      <View style={styles.panelHeader}>
        <Ionicons name="speedometer-outline" size={14} color={colors.rust} accessibilityElementsHidden importantForAccessibility="no" />
        <LPText size={14} weight="bold" accessibilityRole="header">
          {t('usage.this_period')}
        </LPText>
      </View>

      {prompt ? (
        <View style={styles.topUp} testID="usage.topUp">
          <Ionicons name="add-circle" size={14} color={colors.signal} accessibilityElementsHidden importantForAccessibility="no" />
          <LPText size={12} style={styles.shrink}>
            {t(prompt.key, { price: prompt.price })}
          </LPText>
        </View>
      ) : null}

      <View style={styles.lanes}>
        {usage.network ? <LaneRow label={t('usage.lane.gym')} lane={usage.network} fmt={fmt} testID="usage.lane.gym" /> : null}
        {usage.pools ? <LaneRow label={t('usage.lane.pool')} lane={usage.pools} fmt={fmt} testID="usage.lane.pool" /> : null}
        {usage.daily ? (
          <LaneRow label={t('usage.lane.daily')} lane={usage.daily} fmt={fmt} resetsDaily testID="usage.lane.daily" />
        ) : null}
        <ConcurrentRow open={usage.concurrent.open} cap={usage.concurrent.cap} />
      </View>
    </View>
  );
}

/** "{used} of {cap}", the bar (red at the limit), "{n} left" or "At limit", and when it resets. */
function LaneRow({
  label,
  lane,
  fmt,
  resetsDaily = false,
  testID,
}: {
  label: string;
  lane: UsageLane;
  fmt: (date: Date) => string;
  resetsDaily?: boolean;
  testID: string;
}) {
  const { t } = useT();
  const meter = meterOf(lane);
  let reset: string | null = null;
  if (lane.resetsAt) reset = t('usage.resets_on', { date: fmt(lane.resetsAt) });
  else if (resetsDaily) reset = t('usage.resets_daily');
  return (
    <View accessible style={styles.lane} testID={testID}>
      <View style={styles.laneTop}>
        <LPText size={13} weight="medium" style={styles.shrink}>
          {label}
        </LPText>
        <LPText size={13} weight="semibold" style={MONO}>
          {t('usage.x_of_y', { used: lane.used, cap: lane.cap })}
        </LPText>
      </View>
      <Bar fraction={meter.fraction} atLimit={meter.atLimit} />
      <View style={styles.laneBottom}>
        <LPText size={11} color={meter.atLimit ? colors.destructive : colors.paper3}>
          {meter.atLimit ? t('usage.at_limit') : t('usage.x_left', { count: meter.remaining })}
        </LPText>
        {reset ? (
          <LPText size={11} color={colors.paper3} align="right" style={styles.shrink}>
            {reset}
          </LPText>
        ) : null}
      </View>
    </View>
  );
}

/** Open bookings against the concurrent cap; just the count when there is no cap. */
function ConcurrentRow({ open, cap }: { open: number; cap: number | null }) {
  const { t } = useT();
  if (cap === null) {
    return (
      <View accessible style={styles.laneTop} testID="usage.lane.open">
        <LPText size={13} weight="medium" style={styles.shrink}>
          {t('usage.lane.open_bookings')}
        </LPText>
        <LPText size={13} weight="semibold" style={MONO}>
          {String(open)}
        </LPText>
      </View>
    );
  }
  const meter = laneMeter(open, cap);
  return (
    <View accessible style={styles.lane} testID="usage.lane.open">
      <View style={styles.laneTop}>
        <LPText size={13} weight="medium" style={styles.shrink}>
          {t('usage.lane.open_bookings')}
        </LPText>
        <LPText size={13} weight="semibold" style={MONO}>
          {t('usage.x_of_y', { used: open, cap })}
        </LPText>
      </View>
      <Bar fraction={meter.fraction} atLimit={meter.atLimit} />
      <LPText size={11} color={meter.atLimit ? colors.destructive : colors.paper3}>
        {meter.atLimit ? t('usage.cancel_to_book') : t('usage.x_left', { count: meter.remaining })}
      </LPText>
    </View>
  );
}

/** A 4 pt capsule, filled to `fraction` (decoration: the words beside it say the same). */
function Bar({ fraction, atLimit }: { fraction: number; atLimit: boolean }) {
  return (
    <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View
        style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: atLimit ? colors.destructive : colors.rust }]}
        testID="usage.bar.fill"
      />
    </View>
  );
}

/** "Active passes": each pass by name, its expiry, and what it has left. */
function PassesPanel({ passes, fmt }: { passes: readonly ActivePass[]; fmt: (date: Date) => string }) {
  const { t, language } = useT();
  return (
    <Panel icon="ticket-outline" title={t('usage.active_passes')} testID="usage.passes">
      <View>
        {passes.map((pass, index) => (
          <View
            key={pass.id}
            accessible
            style={[styles.passRow, index < passes.length - 1 && styles.passDivider]}
            testID={`usage.pass.${pass.id}`}
          >
            <View style={styles.passLeading}>
              <LPText size={14} weight="semibold">
                {passName(pass.type, language)}
              </LPText>
              <LPText size={11} color={colors.paper3}>
                {t('usage.pass.expires', { date: fmt(pass.expiresAt) })}
              </LPText>
            </View>
            <LPText size={13} weight="medium" style={MONO}>
              {visitsLeft(pass.visitsLeft, language)}
            </LPText>
          </View>
        ))}
      </View>
    </Panel>
  );
}

// MARK: - Banners and states

function Banner({ icon, color, title, body, testID }: { icon: IconName; color: string; title: string; body: string; testID: string }) {
  return (
    <View
      accessible
      style={[styles.banner, { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.25) }]}
      testID={testID}
    >
      <Ionicons name={icon} size={16} color={color} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.bannerText}>
        <LPText size={14} weight="semibold">
          {title}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {body}
        </LPText>
      </View>
    </View>
  );
}

function StateCard({
  icon,
  iconColor,
  borderColor,
  borderWidth = hairline,
  title,
  body,
  children,
  testID,
}: {
  icon: IconName;
  iconColor: string;
  borderColor: string;
  borderWidth?: number;
  title: string;
  body: string;
  children?: ReactNode;
  testID: string;
}) {
  return (
    <View style={[styles.stateCard, { borderColor, borderWidth }]} testID={testID}>
      <Ionicons name={icon} size={32} color={iconColor} accessibilityElementsHidden importantForAccessibility="no" />
      <LPText size={17} weight="semibold" align="center" accessibilityRole="header">
        {title}
      </LPText>
      <LPText size={13} color={colors.paper3} align="center">
        {body}
      </LPText>
      {children ? <View style={styles.stateAction}>{children}</View> : null}
    </View>
  );
}

/** "How visits work": allowance, top-up, the premium surcharge rule, reset. */
function Explainer() {
  const { t } = useT();
  const rows: { icon: IconName; color: string; key: string }[] = [
    { icon: 'ribbon', color: colors.moss, key: 'usage.explainer.allowance' },
    { icon: 'add-circle', color: colors.signal, key: 'usage.explainer.topup' },
    { icon: 'star', color: colors.aurora, key: 'usage.explainer.premium' },
    { icon: 'hourglass-outline', color: colors.paper3, key: 'usage.explainer.reset' },
  ];
  return (
    <View style={[styles.card, styles.explainer]} testID="usage.explainer">
      <LPText size={14} weight="semibold" accessibilityRole="header">
        {t('usage.explainer.title')}
      </LPText>
      <View style={styles.explainerRows}>
        {rows.map((row) => (
          <View key={row.key} style={styles.explainerRow}>
            <View style={styles.explainerIcon}>
              <Ionicons name={row.icon} size={10} color={row.color} accessibilityElementsHidden importantForAccessibility="no" />
            </View>
            <LPText size={13} color={colors.paper3} style={[styles.shrink, styles.explainerText]}>
              {t(row.key)}
            </LPText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink2,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  card: {
    padding: 16,
    gap: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  usagePanel: {
    gap: 14,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoRows: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  shrink: {
    flexShrink: 1,
  },
  topUp: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radius.field,
    borderWidth: 1,
    backgroundColor: tint(colors.signal, 0.1),
    borderColor: tint(colors.signal, 0.25),
  },
  lanes: {
    gap: 14,
  },
  lane: {
    gap: 6,
  },
  laneTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  laneBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  passRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  passDivider: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  passLeading: {
    flex: 1,
    gap: 2,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    gap: 4,
  },
  stateCard: {
    alignItems: 'center',
    gap: 14,
    padding: 20,
    backgroundColor: colors.ink2,
    borderRadius: radius.sheet,
  },
  stateAction: {
    alignSelf: 'stretch',
  },
  explainer: {
    gap: 10,
  },
  explainerRows: {
    gap: 8,
  },
  explainerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  explainerIcon: {
    width: 16,
    height: 16,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerText: {
    lineHeight: 19,
  },
});
