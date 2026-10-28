/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Processing…" over the scanner while a walk-in request is in flight (iOS:
 * a 40 % black scrim and a card with a spinner, over the camera region). It
 * fills its parent and takes the touches under it.
 *
 * The card's words are the page's ink: iOS draws them white on `lpCard`,
 * which is a light surface in the 2.5.6 palette, so they could not be read.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LPText } from '../../../../components/ui';
import { useT } from '../../../../i18n';
import { colors, radius } from '../../../../theme';
import { useWalkIn } from '../useWalkIn';

export default function ProcessingOverlay() {
  const { t } = useT();
  const processing = useWalkIn((s) => s.isProcessing);
  if (!processing) return null;
  return (
    <View style={styles.scrim} testID="walkin.processing">
      <View style={styles.card} accessible accessibilityRole="progressbar" accessibilityLabel={t('common.processing')}>
        <ActivityIndicator color={colors.paper} />
        <LPText size={15} weight="medium" color={colors.paper}>
          {t('common.processing')}
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: 24,
    gap: 12,
    alignItems: 'center',
    borderRadius: radius.sheet,
    backgroundColor: colors.ink2,
  },
});
