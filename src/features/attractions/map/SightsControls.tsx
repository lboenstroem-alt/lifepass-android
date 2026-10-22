/* eslint lifepass/no-literal-copy: "error" */
/**
 * The sights' controls over the Explore map (iOS SearchMapView
 * `sightsToggle`, the attribution plate and `sightsRetryNotice`): placed by
 * EXPL-2's overlay stack through ../../explore/map/sightsControls.tsx.
 *
 *   - The TOGGLE, leading in the controls row: an 11 pt ring and "Sights" /
 *     "Staðir" on a capsule, light blue and white while on. TalkBack hears
 *     "Sights" / "Áhugaverðir staðir" (the legend's word, as iOS labels it)
 *     and its selected state.
 *   - The CREDIT PLATE under the legend while the layer is on: the feed's own
 *     ODbL notice, on a plate of its own so it stays legible over pins and
 *     names. Required, not optional: the licence wants the notice visible
 *     wherever the data appears, in an app too.
 *   - The RETRY NOTICE while the markers failed and none are held: quiet on
 *     purpose (the legend's size and colours, not a banner), since the venue
 *     map under it still works and the schedule is already asking again. A
 *     spinner in place of "Try again" while a request is out, and no second
 *     tap then: it would only restart the wait.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

/** lpInk (#F8F6F1) at an opacity, as the map's plates. */
const plate = (opacity: number) => `rgba(248,246,241,${opacity})`;

/** Map controls stay at a size the map can hold (the legend's words are not scaled past this either). */
const MAX_SCALE = 1.5;

export interface SightsToggleProps {
  readonly on: boolean;
  readonly onToggle: () => void;
}

export function SightsToggle({ on, onToggle }: SightsToggleProps) {
  const { t } = useT();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={t('attraction.legend_sights')}
      accessibilityState={{ selected: on }}
      // A 32 dp capsule with a 48 dp target.
      hitSlop={8}
      style={({ pressed }) => [styles.toggle, on ? styles.toggleOn : styles.toggleOff, pressed && styles.pressed]}
      testID="explore.map.sightsToggle"
    >
      <View style={[styles.swatch, on ? styles.swatchOn : styles.swatchOff]} {...hiddenFromAccessibility} />
      <LPText size={12} weight="semibold" color={on ? colors.paper : colors.paper2} maxScale={MAX_SCALE} numberOfLines={1}>
        {t('attraction.sights')}
      </LPText>
    </Pressable>
  );
}

export interface SightsCreditPlateProps {
  /** The feed's `attribution`, as sent. */
  readonly text: string;
}

export function SightsCreditPlate({ text }: SightsCreditPlateProps) {
  return (
    <View style={styles.credit} testID="explore.map.sightsCredit">
      <LPText size={9} color={colors.paper2} align="center" numberOfLines={2} maxScale={MAX_SCALE}>
        {text}
      </LPText>
    </View>
  );
}

export interface SightsRetryNoticeProps {
  /** A marker request is out: a spinner, and no second tap. */
  readonly loading: boolean;
  readonly onRetry: () => void;
}

export function SightsRetryNotice({ loading, onRetry }: SightsRetryNoticeProps) {
  const { t } = useT();
  const failed = t('attraction.sights_failed');
  const retry = t('attraction.retry');
  return (
    <Pressable
      onPress={onRetry}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={loading ? failed : `${failed} ${retry}`}
      accessibilityState={{ disabled: loading, busy: loading }}
      hitSlop={8}
      style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
      testID="explore.map.sightsRetry"
    >
      <LPText size={11} color={colors.paper2} maxScale={MAX_SCALE}>
        {failed}
      </LPText>
      {loading ? (
        <ActivityIndicator size="small" color={colors.paper2} style={styles.spinner} testID="explore.map.sightsRetry.loading" />
      ) : (
        <LPText size={11} weight="semibold" color={colors.paper} maxScale={MAX_SCALE} style={styles.underline}>
          {retry}
        </LPText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: plate(0.94),
  },
  toggleOn: { borderColor: colors.attraction },
  toggleOff: { borderColor: colors.line },
  // SwiftUI strokes the 11 pt circle on its path: the view is a stroke wider.
  swatch: { width: 13.5, height: 13.5, borderRadius: 6.75, borderWidth: 2.5 },
  swatchOn: { borderColor: colors.attraction, backgroundColor: '#FFFFFF' },
  swatchOff: { borderColor: colors.line2, backgroundColor: 'transparent' },
  credit: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: plate(0.9),
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: plate(0.92),
  },
  // iOS `.controlSize(.mini)`.
  spinner: { transform: [{ scale: 0.7 }], height: 14 },
  underline: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.85 },
});
