// One capsule in Explore's filter rows (iOS SearchMapView `chip`, `subChip`,
// `groupChip` and the class chips): a name, then a count or a chevron.
//
//   top  the class chips, "All" and the group chips: paper fill when chosen.
//   sub  a granular chip in an open group's row: rust fill when chosen, so it
//        reads as a level deeper than the paper-filled chips above it.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { colors, radius } from '../../theme';

export interface FilterChipProps {
  readonly title: string;
  readonly onPress: () => void;
  /** Chosen (a class chip, a granular chip), or highlighted (an open or active group). */
  readonly selected: boolean;
  readonly variant?: 'top' | 'sub';
  /** The count after the name. */
  readonly count?: number;
  /** A group chip: the chevron after the name says whether its row is open. */
  readonly expanded?: boolean;
  /** The premium chip's signal dot. */
  readonly dot?: boolean;
  readonly testID?: string;
}

export default function FilterChip({ title, onPress, selected, variant = 'top', count, expanded, dot = false, testID }: FilterChipProps) {
  const sub = variant === 'sub';
  const foreground = selected ? (sub ? colors.onAccent : colors.ink) : colors.paper2;
  const isGroup = expanded !== undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // A group says whether its row is open; a chip whether it is the one chosen.
      accessibilityState={isGroup ? { expanded, selected } : { selected }}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        sub && styles.sub,
        selected && (sub ? styles.subSelected : styles.selected),
        pressed && styles.pressed,
      ]}
    >
      {dot ? <View style={styles.dot} {...hiddenFromAccessibility} /> : null}
      <LPText size={sub ? 12 : 12.5} weight="semibold" tracking={-0.1} color={foreground}>
        {title}
      </LPText>
      {count !== undefined ? (
        <LPText size={sub ? 10.5 : 11} color={foreground} style={sub ? styles.subCount : styles.count}>
          {String(count)}
        </LPText>
      ) : null}
      {isGroup ? (
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={10}
          color={foreground}
          style={styles.chevron}
          {...hiddenFromAccessibility}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  selected: { backgroundColor: colors.paper, borderColor: colors.paper },
  sub: { paddingHorizontal: 13, paddingVertical: 7 },
  subSelected: { backgroundColor: colors.rust, borderColor: colors.rust },
  count: { opacity: 0.55 },
  subCount: { opacity: 0.6 },
  chevron: { opacity: 0.6 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.signal },
  pressed: { opacity: 0.85 },
});
