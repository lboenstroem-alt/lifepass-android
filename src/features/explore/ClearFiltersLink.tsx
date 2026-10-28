// "Clear" under the search row while a filter is on: an Android convenience
// the owner kept from the first build (decision D4). iOS has the key
// (`explore.filters_clear`) but no link; on iOS a filter comes off by tapping
// its chip again. Every chip goes back to its default and the open row closes.
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors } from '../../theme';

export default function ClearFiltersLink({ onPress }: { readonly onPress: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" hitSlop={10} testID="explore.filters.clear">
        <LPText size={12} weight="medium" color={colors.accentText}>
          {t('explore.filters_clear')}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 8, marginTop: -2 },
});
