/* eslint lifepass/no-literal-copy: "error" */
// Small pieces the venue page draws more than once (iOS VenueDetailView's
// `frostedCircleButton`, `directionsCapsule` and `sectionTitle`).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';

/** iOS paints the page's paper (lpInk, #F8F6F1) at these opacities. */
export const paperAt = (opacity: number) => `rgba(248,246,241,${opacity})`;

/**
 * iOS `.ultraThinMaterial` in the light scheme: a pale, see-through glass.
 * Android has no backdrop blur on a plain view, so the glass is the page's
 * paper, translucent enough to show the photo under it.
 */
export const FROSTED = paperAt(0.72);

/** iOS `.bar` behind the status bar and the floating bar: nearly opaque paper. */
export const BAR_MATERIAL = paperAt(0.94);

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** A 38 pt frosted circle over the hero photo (back, heart, share). */
export function FrostedCircleButton({
  icon,
  tint = colors.paper,
  onPress,
  accessibilityLabel,
  selected,
  testID,
}: {
  readonly icon: IoniconName;
  readonly tint?: string;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  /** For a toggle (the heart): TalkBack says "selected". */
  readonly selected?: boolean;
  readonly testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      hitSlop={5}
      style={({ pressed }) => [styles.frosted, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={16} color={tint} />
    </Pressable>
  );
}

/**
 * "Directions": the same capsule beside the rating and in "Getting there"
 * (2.5.4). Both open the one directions dialog. The caller shows it only when
 * there is somewhere to go (`hasDirections`).
 */
export function DirectionsCapsule({ onPress, style }: { readonly onPress: () => void; readonly style?: StyleProp<ViewStyle> }) {
  const { t } = useT();
  const label = t('venue.directions');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.capsule, style, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name="directions" size={14} color={colors.paper} />
      <LPText size={12} weight="semibold" color={colors.paper}>
        {label}
      </LPText>
    </Pressable>
  );
}

/** A section's serif title, with an optional kicker above it. */
export function SectionTitle({ title, kicker }: { readonly title: string; readonly kicker?: string | null }) {
  return (
    <View style={styles.sectionTitle}>
      {kicker ? <Kicker text={kicker} color={colors.paper3} /> : null}
      <LPText serif size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header">
        {title}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  frosted: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FROSTED,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.ink2,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  sectionTitle: { gap: 4 },
  pressed: { opacity: 0.7 },
});
