// The Venues / Classes switch in the feed's fixed header (iOS
// `ExploreModeToggle`), so the way back to the venues never scrolls away.
// The feed is the Classes side; "Venues" hands back to Explore.
import { StyleSheet, View } from 'react-native';

import { Chip } from '../../../components/ui';
import { useT } from '../../../i18n';

export interface ModeToggleProps {
  readonly onShowVenues?: () => void;
}

export default function ModeToggle({ onShowVenues }: ModeToggleProps) {
  const { t } = useT();
  return (
    <View style={styles.row}>
      <Chip tone="ink" testID="classes.mode.venues" label={t('classes.segment_venues')} selected={false} onPress={() => onShowVenues?.()} />
      <Chip tone="ink" testID="classes.mode.classes" label={t('classes.segment_classes')} selected onPress={() => undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
});
