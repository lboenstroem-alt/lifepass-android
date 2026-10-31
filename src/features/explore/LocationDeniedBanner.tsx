// "Location is off" over the Explore map (iOS SearchMapView
// `locationDeniedBanner`): a crossed-out pin, the two lines, and an "Open"
// capsule that goes where location can be turned back on.
//
// It shows while location is off (src/stores/locationStore `selectLocationOff`):
// the member chose "Don't allow", or location is switched off for the whole
// phone. It appears as soon as "Don't allow" is chosen and goes once location
// is allowed again: the store re-reads the permission when the app comes back
// from Settings. Open takes the member to the app's settings page, or to the
// phone's location settings when location is off for the phone
// (`openLocationSettings`), since allowing the app changes nothing until it
// is on.
//
// The banner draws itself only while location is off, so a host can mount it
// unconditionally. It belongs to the map, as on iOS (never over the list):
// the map's own overlay stack (EXPL-2, `ExploreMap`) mounts it under the
// sights toggle and the legend, 20 in from the sides and 8 below them. The
// Explore screen does not draw it as well, so there is only ever one.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import {
  locationStore,
  openLocationSettings,
  selectLocationOffReason,
  useLocationStore,
  type LocationStore,
} from '../../stores/locationStore';
import { colors, radius } from '../../theme';

export interface LocationDeniedBannerProps {
  /** The location store (tests pass their own). */
  readonly store?: LocationStore;
  /** What Open does (default `openLocationSettings`). */
  readonly onOpen?: (reason: ReturnType<typeof selectLocationOffReason>) => void;
}

export default function LocationDeniedBanner({ store = locationStore, onOpen }: LocationDeniedBannerProps) {
  const { t } = useT();
  const reason = useLocationStore(selectLocationOffReason, store);
  if (reason === null) return null;

  const open = () => {
    if (onOpen) onOpen(reason);
    else void openLocationSettings(reason);
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      // One stop for TalkBack: what is wrong, what to do, and the button's word.
      accessibilityLabel={`${t('explore.location_off')}. ${t('explore.location_off_body')}`}
      accessibilityHint={t('explore.location_open')}
      testID="explore.locationOff"
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name="map-marker-off" size={16} color={colors.destructive} {...hiddenFromAccessibility} />
      <View style={styles.copy}>
        <LPText size={13} weight="semibold" color={colors.paper}>
          {t('explore.location_off')}
        </LPText>
        <LPText size={11} color={colors.paper3} numberOfLines={1}>
          {t('explore.location_off_body')}
        </LPText>
      </View>
      <View style={styles.open}>
        <LPText size={12} weight="bold" color={colors.ink}>
          {t('explore.location_open')}
        </LPText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(208,37,37,0.35)',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  copy: { flex: 1, gap: 1 },
  open: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
  },
  pressed: { opacity: 0.9 },
});
