/**
 * The Scan tab without a live camera (iOS `CheckInView.promptLayout`,
 * `ios-ux.md` 11.5):
 *
 *   notDetermined  a card with the QR mark and "Ready to scan", an
 *                  "Open Scanner" capsule that asks for the camera (a yes
 *                  turns the card into the live viewfinder), and "Scan the QR
 *                  code at the venue to log your visit."
 *   denied         "Camera access is off", a body that says meals can still
 *                  be logged by search, and Open Settings
 *   unavailable    "The camera isn't available on this device."
 *
 * The content sits between `reserveTop` (under the meal entry) and the tab
 * bar, a third of the free room above it and two thirds below, as iOS's
 * three spacers share it; it scrolls when large text makes it taller.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

export type PromptKind = 'notDetermined' | 'denied' | 'unavailable';

export interface ScanPromptProps {
  readonly kind: PromptKind;
  readonly reserveTop: number;
  readonly reserveBottom: number;
  readonly onOpenScanner: () => void;
  readonly onOpenSettings: () => void;
}

export default function ScanPrompt({ kind, reserveTop, reserveBottom, onOpenScanner, onOpenSettings }: ScanPromptProps) {
  const { t } = useT();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingBottom: reserveBottom }]}
      testID={`scan.prompt.${kind}`}
    >
      <View style={[styles.spacer, { minHeight: reserveTop }]} />
      {kind === 'notDetermined' ? (
        <View style={styles.column}>
          <View style={styles.readyCard}>
            <Ionicons name="qr-code-outline" size={56} color={colors.rust} {...hiddenFromAccessibility} />
            <LPText size={14} weight="medium" color={colors.paper3} align="center">
              {t('checkin.ready')}
            </LPText>
          </View>
          <Pressable
            onPress={onOpenScanner}
            accessibilityRole="button"
            accessibilityLabel={t('checkin.open_scanner')}
            style={({ pressed }) => [styles.openScanner, pressed && styles.pressed]}
            testID="scan.openScanner"
          >
            <Ionicons name="scan-outline" size={16} color="#FFFFFF" />
            <LPText size={15} weight="semibold" color="#FFFFFF">
              {t('checkin.open_scanner')}
            </LPText>
          </Pressable>
          <LPText size={13} color={colors.paper3} align="center" style={styles.prompt}>
            {t('checkin.scan_prompt')}
          </LPText>
        </View>
      ) : (
        <View style={[styles.column, styles.off]}>
          <View style={styles.offIcon}>
            <Ionicons name="videocam-off-outline" size={36} color={colors.paper3} {...hiddenFromAccessibility} />
          </View>
          {kind === 'denied' ? (
            <LPText serif size={22} color={colors.paper} align="center" accessibilityRole="header">
              {t('scan.camera_denied.title')}
            </LPText>
          ) : null}
          <LPText size={14} color={colors.paper2} align="center">
            {kind === 'denied' ? t('scan.camera_denied.body') : t('scan.camera_unavailable')}
          </LPText>
          {kind === 'denied' ? (
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              style={({ pressed }) => [styles.settings, pressed && styles.pressed]}
              testID="scan.openSettings"
            >
              <LPText size={15} weight="semibold" color="#FFFFFF">
                {t('bodygoals.open_settings')}
              </LPText>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={styles.spacer} />
      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink2 },
  content: { flexGrow: 1 },
  spacer: { flexGrow: 1 },
  column: { alignItems: 'center', gap: 20 },
  readyCard: {
    width: 200,
    height: 200,
    borderRadius: 20,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  openScanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.rust,
  },
  prompt: { paddingHorizontal: 40 },
  off: { gap: 14, paddingHorizontal: 36 },
  offIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settings: {
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
