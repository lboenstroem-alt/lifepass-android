/**
 * The Open Food Facts attribution (iOS `MealOFFAttribution`, ios-ux.md 14.3):
 * always visible, never behind a disclosure: where the numbers came from,
 * under which licence, and a link to the product page.
 *
 * `compact` is one row, the licence beside the link: the footer pinned under
 * the item editor's button, so it is on screen at every height of the sheet.
 */
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, minTouch } from '../../../theme';

import { offProductPage } from './itemEditorRules';

export interface MealOFFAttributionProps {
  readonly barcode: string;
  readonly compact?: boolean;
  readonly testID?: string;
}

export default function MealOFFAttribution({ barcode, compact = false, testID }: MealOFFAttributionProps) {
  const { t } = useT();
  const url = offProductPage(barcode);
  const licence = (
    <LPText size={11} color={colors.paper2} style={compact ? styles.grow : undefined}>
      {t('food.off.attribution')}
    </LPText>
  );
  const link = (
    <Pressable
      onPress={() => {
        track('off_product_link_opened');
        void Linking.openURL(url).catch(() => undefined);
      }}
      accessibilityRole="link"
      accessibilityLabel={t('food.off.view_product')}
      style={styles.link}
      testID={testID ? `${testID}.link` : undefined}
    >
      <LPText size={12} weight="semibold" color={colors.rust} style={styles.underline}>
        {t('food.off.view_product')}
      </LPText>
    </Pressable>
  );
  if (compact) {
    return (
      <View style={styles.row} testID={testID}>
        {licence}
        {link}
      </View>
    );
  }
  return (
    <View style={styles.stack} testID={testID}>
      {licence}
      {link}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stack: { gap: 6, paddingHorizontal: 4 },
  grow: { flex: 1 },
  link: { minHeight: minTouch, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
});
