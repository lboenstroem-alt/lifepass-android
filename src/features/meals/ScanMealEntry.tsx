/**
 * "Scan your meal" on the Scan tab (iOS `CheckInView.mealButton`, ios-ux.md
 * 11.5 and 11.6), mounted by CHECKIN-1 above the reticle. Never in the
 * scanner a venue pushes (CHECKIN-1 leaves it out there).
 *
 * ITS LOOK, by the member's access:
 *   minor       nothing at all
 *   entitled    the full card: fork badge, "Scan your meal", "Photo, barcode
 *               or search", chevron
 *   otherwise   the full card until the membership gate has been seen once on
 *               this phone (per member, `scan.meal.gateSeen.<id>`, wiped
 *               with the member's health data), then a compact pill; nothing
 *               on the first visit until that flag has been read, so the
 *               card never turns into the pill under the member's eyes
 *               (./capture/scanGateSeen.ts)
 * Over the live camera it floats on the picture (the page colour at 0.94, a
 * white hairline, a soft shadow); on the camera-off page it takes the page's
 * own hairline. Drawn at half strength and not pressable while a walk-in is
 * in flight.
 *
 * A TAP:
 *   entitled with consent     the meal page, over everything, in the last
 *                             mode used (Search when the camera is not
 *                             allowed), slot by the clock, today
 *   entitled without consent  the consent sheet first, then the page
 *   everyone else             the membership gate, never a page that then
 *                             fails ("Included with a LifePass membership")
 * `scan_meal_tapped` records which (`outcome`) and the button's look (`mode`).
 *
 * While the page is open the Scan tab is not focused, so its viewfinder is
 * unmounted and no QR code can check anyone in under it (CHECKIN-1). The
 * tap therefore opens the page AT ONCE, in the same turn (iOS pauses QR reads
 * the moment the page is asked for): the camera permission and the last mode
 * are read ahead, when the Scan tab mounts, regains focus or comes back to
 * the foreground, never between the tap and the page, when a code still in
 * view could start a walk-in under the opening page.
 */
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { openHealthConsent } from '../../health/consent/presenter';
import type { HealthAccess } from '../../health/models';
import { HealthConsentSheet, MealGateSheet } from '../../health/ui';
import { useT } from '../../i18n';
import { todayServerDay } from '../../i18n/format';
import { track } from '../../lib/analytics';
import { useAppNavigation } from '../../navigation/hooks';
import type { MealCaptureMode } from '../../navigation/types';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { colors, hairline } from '../../theme';

import { openingModeFrom, storedLastMode } from './capture/lastMode';
import { markScanGateSeen, useScanGateSeen } from './capture/scanGateSeen';

export interface ScanMealEntryProps {
  /** Disabled (drawn, not hidden) while a walk-in is in flight. */
  readonly disabled?: boolean;
}

export type MealButtonStyle = 'full' | 'compact' | 'hidden';

/**
 * iOS `mealButtonStyle` (the pushed scanner never mounts this). `gateSeen`
 * null: not read yet, so nothing is drawn for someone the answer matters to,
 * rather than the full card that turns into the pill a moment later.
 */
export function mealButtonStyle(access: HealthAccess, gateSeen: boolean | null): MealButtonStyle {
  if (access === 'minor') return 'hidden';
  if (access === 'entitled') return 'full';
  if (gateSeen === null) return 'hidden';
  return gateSeen ? 'compact' : 'full';
}

/** Whether the camera may be used now; any doubt opens Search. */
async function cameraAllowed(): Promise<boolean> {
  try {
    return (await Camera.getCameraPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

interface FocusSource {
  addListener(event: 'focus', callback: () => void): () => void;
}

/**
 * The mode the meal page opens in, known before the tap (iOS reads
 * `camera.authorization` and the stored mode synchronously). Read when the
 * Scan tab mounts, each time it is focused again (back from the page, which
 * may have stored a new mode) and each return to the foreground (a
 * permission changed in Settings); a live viewfinder means the camera is
 * allowed. Until the first read lands, any doubt about the camera opens
 * Search.
 */
function useOpeningMode(navigation: FocusSource): () => MealCaptureMode {
  const cameraOk = useRef(false);
  const stored = useRef<MealCaptureMode | null>(null);
  const cameraLive = useIntentStore((s) => s.scanCameraLive);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void cameraAllowed().then((allowed) => {
        if (mounted) cameraOk.current = allowed;
      });
      void storedLastMode().then((mode) => {
        if (mounted) stored.current = mode;
      });
    };
    refresh();
    const offFocus = navigation.addListener('focus', refresh);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      offFocus();
      foreground.remove();
    };
  }, [navigation]);

  useEffect(() => {
    if (cameraLive) cameraOk.current = true;
  }, [cameraLive]);

  return useCallback(() => openingModeFrom(cameraOk.current, stored.current), []);
}

export default function ScanMealEntry({ disabled = false }: ScanMealEntryProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const access = useAppStore((s) => s.healthAccess);
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const onCamera = useIntentStore((s) => s.scanCameraLive);
  const gateSeen = useScanGateSeen(profileId);
  const [gateVisible, setGateVisible] = useState(false);
  const [gateAccess, setGateAccess] = useState<HealthAccess>(access);
  const [localConsent, setLocalConsent] = useState(false);
  const [consentShown, setConsentShown] = useState(false);
  const style = mealButtonStyle(access, gateSeen);
  const openingMode = useOpeningMode(navigation);

  const markGateSeen = useCallback(() => {
    if (profileId) markScanGateSeen(profileId);
  }, [profileId]);

  /** The page, in this turn: nothing is awaited between the tap and the navigation. */
  const presentMealCapture = useCallback(() => {
    navigation.navigate('MealCapture', { origin: 'scanTab', mode: openingMode(), date: todayServerDay() });
  }, [navigation, openingMode]);

  /** After the consent sheet: only for a member it actually let in. */
  const openAfterConsent = useCallback(() => {
    const app = useAppStore.getState();
    if (app.healthAccess !== 'entitled' || !selectHasHealthConsent(app)) return;
    presentMealCapture();
  }, [presentMealCapture]);

  const onPress = () => {
    const app = useAppStore.getState();
    const mode = style === 'compact' ? 'compact' : 'full';
    switch (app.healthAccess) {
      case 'minor':
        return;
      case 'entitled':
        if (selectHasHealthConsent(app)) {
          track('scan_meal_tapped', { outcome: 'opened', mode });
          presentMealCapture();
        } else {
          track('scan_meal_tapped', { outcome: 'consent', mode });
          if (!openHealthConsent({ entry: 'scan', onGranted: openAfterConsent })) {
            setConsentShown(true);
            setLocalConsent(true);
          }
        }
        return;
      default:
        // Visitor passes, lapsed, company not activated, payment trouble:
        // the membership gate, never a page that then fails.
        track('scan_meal_tapped', { outcome: 'gate', mode });
        setGateAccess(app.healthAccess);
        setGateVisible(true);
    }
  };

  const title = t('scan.meal.title');
  const subtitle = t('scan.meal.sub');
  const surface = onCamera ? styles.onCamera : styles.onPage;

  return (
    <>
      {style === 'full' ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${subtitle}`}
          accessibilityHint={t('a11y.scan_meal_hint')}
          accessibilityState={{ disabled }}
          style={[styles.card, surface, disabled && styles.disabled]}
          testID="scan.meal.button"
        >
          <View style={styles.badge}>
            <Ionicons name="restaurant" size={18} color={colors.onAccent} />
          </View>
          <View style={styles.words}>
            <LPText size={16} weight="semibold" color={colors.paper} numberOfLines={1}>
              {title}
            </LPText>
            <LPText size={12} color={colors.paper2} numberOfLines={1}>
              {subtitle}
            </LPText>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.paper3} />
        </Pressable>
      ) : style === 'compact' ? (
        <View style={styles.pillRow}>
          <Pressable
            onPress={onPress}
            disabled={disabled}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={t('a11y.scan_meal_hint')}
            accessibilityState={{ disabled }}
            style={[styles.pill, surface, disabled && styles.disabled]}
            testID="scan.meal.pill"
          >
            <Ionicons name="restaurant" size={15} color={colors.rust} />
            <LPText size={13} weight="semibold" color={colors.paper}>
              {title}
            </LPText>
          </Pressable>
        </View>
      ) : null}

      <MealGateSheet
        visible={gateVisible}
        access={gateAccess}
        onClose={() => setGateVisible(false)}
        onClosed={markGateSeen}
        onSeeMemberships={() => navigation.navigate('Plans')}
        onOpenAccount={() => navigation.navigate('Account')}
        testID="scan.meal.gate"
      />
      {consentShown ? (
        <HealthConsentSheet
          visible={localConsent}
          entry="scan"
          onClose={() => setLocalConsent(false)}
          onGranted={openAfterConsent}
          onOpenAccount={() => navigation.navigate('Account')}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 10,
    paddingRight: 16,
    borderRadius: 18,
  },
  onCamera: {
    backgroundColor: 'rgba(248,246,241,0.94)',
    borderWidth: hairline,
    borderColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  onPage: {
    backgroundColor: colors.ink,
    borderWidth: hairline,
    borderColor: colors.line,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  badge: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.rust, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 2 },
  pillRow: { flexDirection: 'row' },
  pill: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 999 },
  disabled: { opacity: 0.5 },
});
