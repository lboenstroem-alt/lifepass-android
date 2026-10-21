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
 *               with the member's health data), then a compact pill
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
 * unmounted and no QR code can check anyone in under it (CHECKIN-1).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { openHealthConsent } from '../../health/consent/presenter';
import { scanMealGateSeenKey } from '../../health/localKeys';
import type { HealthAccess } from '../../health/models';
import { HealthConsentSheet, MealGateSheet } from '../../health/ui';
import { useT } from '../../i18n';
import { todayServerDay } from '../../i18n/format';
import { track } from '../../lib/analytics';
import { useAppNavigation } from '../../navigation/hooks';
import { selectHasHealthConsent, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { colors, hairline } from '../../theme';

import { lastUsedMode } from './capture/lastMode';

export interface ScanMealEntryProps {
  /** Disabled (drawn, not hidden) while a walk-in is in flight. */
  readonly disabled?: boolean;
}

export type MealButtonStyle = 'full' | 'compact' | 'hidden';

/** iOS `mealButtonStyle` (the pushed scanner never mounts this). */
export function mealButtonStyle(access: HealthAccess, gateSeen: boolean): MealButtonStyle {
  if (access === 'minor') return 'hidden';
  if (access === 'entitled') return 'full';
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

/** The gate was seen by this member on this phone. */
function useGateSeen(profileId: string | null): readonly [boolean, () => void] {
  const [seen, setSeen] = useState<{ readonly id: string | null; readonly value: boolean }>({ id: null, value: false });
  useEffect(() => {
    if (!profileId) return undefined;
    let current = true;
    AsyncStorage.getItem(scanMealGateSeenKey(profileId))
      .then((stored) => {
        if (current) setSeen({ id: profileId, value: stored === 'true' });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [profileId]);
  const markSeen = useCallback(() => {
    if (!profileId) return;
    setSeen({ id: profileId, value: true });
    AsyncStorage.setItem(scanMealGateSeenKey(profileId), 'true').catch(() => undefined);
  }, [profileId]);
  return [seen.id === profileId && seen.value, markSeen] as const;
}

export default function ScanMealEntry({ disabled = false }: ScanMealEntryProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const access = useAppStore((s) => s.healthAccess);
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const onCamera = useIntentStore((s) => s.scanCameraLive);
  const [gateSeen, markGateSeen] = useGateSeen(profileId);
  const [gateVisible, setGateVisible] = useState(false);
  const [gateAccess, setGateAccess] = useState<HealthAccess>(access);
  const [localConsent, setLocalConsent] = useState(false);
  const [consentShown, setConsentShown] = useState(false);
  const opening = useRef(false);
  const style = mealButtonStyle(access, gateSeen);

  const presentMealCapture = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const mode = await lastUsedMode(await cameraAllowed());
      navigation.navigate('MealCapture', { origin: 'scanTab', mode, date: todayServerDay() });
    } finally {
      opening.current = false;
    }
  }, [navigation]);

  /** After the consent sheet: only for a member it actually let in. */
  const openAfterConsent = useCallback(() => {
    const app = useAppStore.getState();
    if (app.healthAccess !== 'entitled' || !selectHasHealthConsent(app)) return;
    void presentMealCapture();
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
          void presentMealCapture();
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
