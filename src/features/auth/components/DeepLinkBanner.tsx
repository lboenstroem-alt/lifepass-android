/**
 * The non-blocking banner on Log in for an auth link that could not become a
 * session (iOS LoginView's `deepLinkError` banner): an info glyph in the
 * premium accent, the message, and a close button. The app store holds the
 * message (`deepLinkError`, set by ./authCallback.ts); the screen clears it
 * when the member edits the email, and the close button clears it here.
 *
 * TalkBack reads it when it appears (a polite live region): the member
 * arrived from their email app and is looking at the form, not the banner.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import LPText from '../../../components/ui/LPText';
import { useT } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';

/** iOS `Color.lpSignal.opacity(0.3)` (lpSignal is #2A4D6F). */
const SIGNAL_RULE = 'rgba(42,77,111,0.3)';

export default function DeepLinkBanner({ style }: { readonly style?: StyleProp<ViewStyle> }) {
  const { t } = useT();
  const message = useAppStore((s) => s.deepLinkError);
  if (!message) return null;
  return (
    <View style={[styles.banner, style]} testID="auth.deepLinkBanner">
      <Ionicons name="information-circle-outline" size={15} color={colors.signal} style={styles.icon} />
      <LPText size={12} color={colors.paper2} style={styles.text} accessibilityLiveRegion="polite">
        {message}
      </LPText>
      <Pressable
        onPress={() => useAppStore.getState().setDeepLinkError(null)}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        testID="auth.deepLinkBanner.close"
      >
        <Ionicons name="close" size={13} color={colors.paper3} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SIGNAL_RULE,
  },
  icon: { marginTop: 0 },
  text: { flex: 1 },
});
