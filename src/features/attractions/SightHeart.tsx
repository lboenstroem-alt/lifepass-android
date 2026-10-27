/* eslint lifepass/no-literal-copy: "error" */
/**
 * A hike's or sight's heart (API 0.45.0; docs/05 "Saved hikes and sights"):
 * saves the place to the member's Favourites, where it is listed under
 * "Hikes & sights". Drawn on the place's card and wherever places are listed
 * (Home's Outside picks, Explore's search, a card's nearby places, the
 * Coach's plan sights), every one reading the ONE favourites store, so a
 * heart tapped on one screen is already right on the others.
 *
 * The heart is the venue page's: the outline in paper, filled rust once
 * saved (src/features/venue/components/Hero.tsx). What it does is the store's
 * (src/features/favourites, HIKES AND SIGHTS): it flips at once, ignores taps
 * while its write is in flight, flips back and says so when the server
 * refuses, and is checked against the list when it was pressed before the
 * list had arrived.
 *
 * TalkBack: a toggle named for the place, "Save Skógafoss to favourites" /
 * "Vista í uppáhalds: Skógafoss" (the name is never declined), that never
 * changes with the state; the state is the toggle's own checked state.
 *
 *   `bar`    a 36 dp circle for the card's top bar, beside Done
 *   `row`    a 32 dp circle at the end of a list row
 *   `float`  a 32 dp frosted circle over a picture (the Coach's plan sights)
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { useT } from '../../i18n';
import { colors, hairline } from '../../theme';
import { useSavedAttraction } from '../favourites';

export type SightHeartVariant = 'bar' | 'row' | 'float';

export interface SightHeartProps {
  /** The place's slug: what the saved set keys on. */
  readonly slug: string;
  /** The place's name as the screen shows it, for TalkBack. */
  readonly name: string;
  readonly variant?: SightHeartVariant;
  readonly testID?: string;
}

/** The paper the venue page's frosted circles are made of (iOS `.ultraThinMaterial`). */
const FROSTED = 'rgba(248,246,241,0.86)';

export default function SightHeart({ slug, name, variant = 'row', testID }: SightHeartProps) {
  const { t } = useT();
  const heart = useSavedAttraction(slug);
  const { toggle } = heart;
  const id = testID ?? `attraction.heart.${slug}`;
  return (
    <Pressable
      onPress={() => {
        // The store says so itself when the server refuses; nothing to add.
        toggle().catch(() => undefined);
      }}
      accessibilityRole="togglebutton"
      accessibilityLabel={t('favourites.heart.save', { name })}
      accessibilityState={{ checked: heart.saved, busy: heart.toggling }}
      hitSlop={variant === 'bar' ? 6 : 8}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed]}
      testID={id}
    >
      <Ionicons
        name={heart.saved ? 'heart' : 'heart-outline'}
        size={variant === 'bar' ? 17 : 15}
        color={heart.saved ? colors.rust2 : variant === 'float' ? colors.paper : colors.paper2}
        testID={`${id}.${heart.saved ? 'filled' : 'outline'}`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  bar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  row: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink3,
  },
  float: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FROSTED,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  pressed: { opacity: 0.7 },
});
