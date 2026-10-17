/**
 * "How LifePass works": iOS PlanInfoSheet (Views/Plans/PlanInfoSheet.swift).
 *
 * The answers people were emailing support for, given a permanent home on the
 * Plans screen (customers reported seeing this once in onboarding and never
 * finding it again). Four questions, answered in their words: what's in each
 * membership, what an extra visit costs once the monthly visits are spent,
 * what "in-bundle" means, and what premium venues are.
 *
 * Numbers are LIVE where we have them: tier caps come from the same priced
 * catalogue the cards use, and a signed-in member's own drop-in prices come
 * from their usage block. The generic copy stands alone when either is
 * absent, so the sheet never waits on a read.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import type { Usage } from '../../api/profile';
import { LPText, Sheet } from '../../components/ui';
import { iskPrefix, translate, useT, type Lang } from '../../i18n';
import { selectUsage, useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

import type { CatalogTier, PlanCatalog } from './catalog';

type TopupPrices = Usage['topup']['prices'];

/**
 * A signed-in member's own drop-in prices, when the usage block carries them:
 * the concrete answer to "what would my 5th gym visit cost". Only the prices
 * the server sent; null when it sent none.
 */
export function memberTopupLine(prices: TopupPrices | null | undefined, lang: Lang): string | null {
  if (!prices) return null;
  const parts: string[] = [];
  if (prices.gym !== null) parts.push(`${translate('plans.info.cat.gym', lang)} ${iskPrefix(prices.gym)}`);
  if (prices.studio !== null) parts.push(`${translate('plans.info.cat.studio', lang)} ${iskPrefix(prices.studio)}`);
  if (prices.pool !== null) parts.push(`${translate('plans.info.cat.pool', lang)} ${iskPrefix(prices.pool)}`);
  if (parts.length === 0) return null;
  return `${translate('plans.info.your_prices', lang)} ${parts.join(' · ')}`;
}

export interface PlanInfoSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The catalogue on screen; the tier rows are left out without one. */
  readonly catalog: PlanCatalog | null;
}

export default function PlanInfoSheet({ visible, onClose, catalog }: PlanInfoSheetProps) {
  const { t, language } = useT();
  const usage = useAppStore(selectUsage);
  const titleRef = useRef<Text>(null);
  const tiers = catalog?.tiers ?? [];
  const yourPrices = memberTopupLine(usage?.topup.prices, language);

  return (
    <Sheet visible={visible} onClose={onClose} initialFocusRef={titleRef} contentStyle={styles.content} testID="plans.info">
      <View style={styles.header}>
        <LPText ref={titleRef} serif size={28} accessibilityRole="header" style={styles.title}>
          {t('plans.info.title')}
        </LPText>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={8}
          style={styles.close}
        >
          <Ionicons name="close" size={15} color={colors.paper2} />
        </Pressable>
      </View>

      <Section title={t('plans.info.included.title')} body={t('plans.info.included.body')}>
        {tiers.length > 0 && (
          <View style={styles.tiers}>
            {tiers.map((tier) => (
              <TierRow key={tier.slug} tier={tier} />
            ))}
          </View>
        )}
      </Section>

      <Section title={t('plans.info.extra.title')} body={t('plans.info.extra.body')}>
        {yourPrices !== null && (
          <View style={styles.callout} testID="plans.info.your_prices">
            <LPText size={13} weight="medium" color={colors.paper}>
              {yourPrices}
            </LPText>
          </View>
        )}
      </Section>

      <Section title={t('plans.info.inbundle.title')} body={t('plans.info.inbundle.body')} />
      <Section title={t('plans.info.premium.title')} body={t('plans.info.premium.body')} />

      <LPText size={12} color={colors.mutedTextStrong} style={styles.footer}>
        {t('plans.info.footer')}
      </LPText>
    </Sheet>
  );
}

function Section({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <LPText size={15} weight="semibold" accessibilityRole="header">
        {title}
      </LPText>
      <LPText size={13.5} color={colors.paper2} style={styles.body}>
        {body}
      </LPText>
      {children}
    </View>
  );
}

function TierRow({ tier }: { tier: CatalogTier }) {
  const { t } = useT();
  return (
    <View style={styles.tier} accessible>
      <LPText size={13.5} weight="semibold">
        {tier.name}
      </LPText>
      <LPText size={13} color={colors.paper2}>
        {t('plans.info.tier_line', { network: tier.networkCap, pools: tier.poolCap, daily: tier.dailyCap })}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24, gap: 28 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { flex: 1 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 8 },
  body: { lineHeight: 20 },
  tiers: { gap: 14, paddingTop: 4 },
  tier: { gap: 3, padding: 12, borderRadius: 10, backgroundColor: colors.ink2 },
  callout: { marginTop: 4, padding: 12, borderRadius: 10, backgroundColor: colors.rust3 },
  footer: { lineHeight: 18, paddingTop: 4 },
});
