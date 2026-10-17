/**
 * One plan or pass card on the Plans screen: iOS `PlansView.planCard`.
 *
 * The name (serif, a product name or a day pass's category name) and its
 * subtitle sit side by side when both fit beside the price, else the subtitle
 * goes under the name; the name never breaks inside a word (with a price
 * beside it, "Explorer" used to wrap to "Explore" / "r" on iOS) and shrinks a
 * little before it would. The price is the catalogue's, right-aligned, and
 * ABSENT (never 0) without one. Then the feature lines with checkmarks, and
 * on every membership card, verified or not, that it needs Icelandic
 * electronic ID: a fact about the product.
 *
 * The popular card is tinted with a "Most popular" badge; the selected card
 * has the accent border.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors } from '../../theme';

import type { PlanCatalog } from './catalog';
import { displayName, isSubscription, subtitle, type Plan } from './plans';
import { cardFeatureLines, priceLabel } from './pricing';

export interface PlanCardProps {
  readonly plan: Plan;
  readonly catalog: PlanCatalog | null;
  readonly selected: boolean;
  readonly onPress: () => void;
}

/** iOS `.lpRust.opacity(0.4)`: the popular card's border when it is not the selected one. */
const POPULAR_BORDER = 'rgba(71,133,194,0.4)';

export default function PlanCard({ plan, catalog, selected, onPress }: PlanCardProps) {
  const { t, language } = useT();
  const price = priceLabel(plan, catalog);
  const lines = cardFeatureLines(plan, catalog, language);
  const membership = isSubscription(plan);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`plans.card.${plan.id}`}
      style={[
        styles.card,
        plan.isPopular && styles.popular,
        selected ? styles.selected : plan.isPopular && styles.popularBorder,
      ]}
    >
      <View style={styles.top}>
        <View style={styles.nameBlock}>
          <LPText
            serif
            size={30}
            tracking={-0.8}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={styles.name}
          >
            {displayName(plan, language)}
          </LPText>
          <LPText size={13} color={colors.mutedTextStrong} numberOfLines={1} style={styles.subtitle}>
            {subtitle(plan, language)}
          </LPText>
        </View>
        {price !== null && (
          <View style={styles.priceBlock}>
            <LPText size={17} weight="semibold">
              {price}
            </LPText>
            {membership && (
              <LPText size={10} color={colors.mutedTextStrong}>
                {t('plans.per_month')}
              </LPText>
            )}
          </View>
        )}
      </View>

      <View style={styles.lines}>
        {lines.map((text) => (
          <View key={text} style={styles.line}>
            <Ionicons name="checkmark" size={11} color={colors.signal} style={styles.lineIcon} />
            <LPText size={12.5} color={colors.paper2} style={styles.lineText}>
              {text}
            </LPText>
          </View>
        ))}
      </View>

      {membership && (
        <View style={styles.line}>
          <Ionicons name="shield-checkmark-outline" size={10} color={colors.mutedTextStrong} style={styles.lineIcon} />
          <LPText size={11.5} color={colors.mutedTextStrong} style={styles.lineText}>
            {t('plans.eid.required')}
          </LPText>
        </View>
      )}

      {plan.isPopular && (
        <View style={styles.badge}>
          <LPText size={9} weight="bold" tracking={1.2} color={colors.onAccent} maxScale={1.5}>
            {t('plans.most_popular').toUpperCase()}
          </LPText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  popular: { backgroundColor: colors.rust3 },
  popularBorder: { borderColor: POPULAR_BORDER },
  selected: { borderColor: colors.rust, borderWidth: 1.5 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // Side by side when both fit, the subtitle wrapping under the name when not.
  nameBlock: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: 10,
    rowGap: 2,
  },
  name: { flexShrink: 1, maxWidth: '100%' },
  subtitle: { flexShrink: 1, paddingBottom: 5 },
  priceBlock: { alignItems: 'flex-end', paddingTop: 8 },
  lines: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineIcon: { marginTop: 4 },
  lineText: { flex: 1 },
  badge: {
    position: 'absolute',
    top: -9,
    left: 18,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    // iOS fills it lpRust; white on the readable fill keeps 9 pt legible (F5's contrast tokens).
    backgroundColor: colors.actionFill,
  },
});
