// The capsules of the class filters (iOS ClassesDiscoveryView's Near me,
// day and category chips, and the radius pills).
//
//   'ink'     selected: ink text on a paper capsule (Near me, the days, the
//             categories); otherwise quiet paper2 on ink2.
//   'accent'  selected: white on the glacier accent (the 1/5/10 km radius).
//
// The capsule is drawn about 33 tall, as on iOS; the touch target is padded
// to 48 with hit slop. TalkBack hears the label and the selected state.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors, radius } from '../../../theme';

export interface FilterPillProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly variant?: 'ink' | 'accent';
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export default function FilterPill({ label, selected, onPress, variant = 'ink', icon, accessibilityLabel, testID }: FilterPillProps) {
  const accent = variant === 'accent';
  const fill = selected ? (accent ? colors.rust : colors.paper) : colors.ink2;
  const stroke = selected ? (accent ? colors.rust : colors.paper) : colors.line;
  const text = selected ? (accent ? colors.onAccent : colors.ink) : colors.paper2;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.pill,
        accent ? styles.accentPill : styles.inkPill,
        { backgroundColor: fill, borderColor: stroke },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={11} color={text} /> : null}
      <LPText size={accent ? 12 : 12.5} weight="semibold" color={text} tracking={accent ? undefined : -0.1}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  inkPill: { paddingHorizontal: 14, paddingVertical: 8 },
  accentPill: { paddingHorizontal: 12, paddingVertical: 7 },
  pressed: { opacity: 0.8 },
});
