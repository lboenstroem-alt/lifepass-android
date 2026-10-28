/**
 * Above the membership cards, for whoever hasn't verified: memberships need
 * Icelandic eID, visitor passes don't, and the passes are one tap away (the
 * web's /plans says the same). iOS `PlansView.eidHint`.
 *
 * The screen shows it only once the profile has loaded and says the member
 * is unverified (the same gate as the "Step 1" chip), so a verified member
 * never sees it flash in.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, hairline, minTouch } from '../../theme';

export default function EidHint({ onSeePasses }: { readonly onSeePasses: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.box} testID="plans.eid.hint">
      <View style={styles.row}>
        <Ionicons
          name="shield-checkmark-outline"
          size={12}
          color={colors.paper2}
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <LPText size={13} color={colors.paper2} style={styles.text}>
          {t('plans.eid.no_id_hint')}
        </LPText>
      </View>
      {/* The way to the passes reads as a line of text but is a full 44 pt to hit. */}
      <Pressable accessibilityRole="button" onPress={onSeePasses} testID="plans.eid.see_passes" style={styles.button}>
        <LPText size={13} weight="semibold" color={colors.accentText}>
          {t('plans.eid.see_passes')}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 2,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderRadius: 12,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  icon: { marginTop: 3 },
  text: { flex: 1 },
  button: { minHeight: minTouch, justifyContent: 'center', alignSelf: 'flex-start', paddingLeft: 20, paddingRight: 8 },
});
