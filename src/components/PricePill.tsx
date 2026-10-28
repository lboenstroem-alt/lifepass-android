// The venue price tag on cards and rows: iOS `VenuePricePill`
// (LifePassTheme.swift). In-bundle venues read "Included" (or "Limited visits"
// for a boutique) in moss; premium venues read "from ISK X" (or "See venue")
// in the signal accent. The words follow the language on screen.
//
// No line limit and no cap on font scaling, as iOS sets neither: at a large
// text size the price wraps inside the pill rather than being cut short, so
// the member always reads the whole figure they would pay.
import { StyleSheet, View } from 'react-native';

import LPText from './ui/LPText';
import { useT } from '../i18n';
import { colors } from '../theme';
import { isPremium, priceLabel, type VenuePricing } from '../types/venue';

type Props = {
  venue: VenuePricing;
  compact?: boolean;
  testID?: string;
};

export default function PricePill({ venue, compact = false, testID }: Props) {
  const { t } = useT();
  const tint = isPremium(venue) ? colors.signal : colors.moss;
  return (
    <View
      testID={testID}
      style={[
        styles.pill,
        compact && styles.pillCompact,
        // The tint at 10 % behind, 20 % around (iOS opacity 0.10 / 0.20).
        { backgroundColor: `${tint}1A`, borderColor: `${tint}33` },
      ]}
    >
      <LPText size={compact ? 11 : 12} weight="semibold" color={tint}>
        {priceLabel(venue, t)}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillCompact: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
