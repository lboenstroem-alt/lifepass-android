// Choice chips, in the two looks iOS uses:
//   tone 'ink'     Explore's Venues/Classes switch (ExploreModeToggle): the
//                  selected chip is ink on paper, the others quiet.
//   tone 'accent'  the body sheet's goal and age chips: the selected chip is
//                  glacier blue with white text, 44 tall.
// `shape` 'capsule' (default) or 'rounded' (the goal chips' radius 12).
// Selected state is spoken (iOS `.isSelected`).
//
// ChipRow lays chips out in a wrapping row (iOS CoachFlowLayout) or, with
// `scroll`, a single horizontally scrolling line.
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, hairline, radius } from '../../theme';
import LPText from './LPText';

export type ChipTone = 'ink' | 'accent';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: ChipTone;
  shape?: 'capsule' | 'rounded';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  /** Stretch to share a row equally (the goal chips). */
  grow?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

export function Chip({
  label,
  selected = false,
  onPress,
  tone = 'accent',
  shape = 'capsule',
  icon,
  disabled = false,
  grow = false,
  accessibilityHint,
  testID,
}: ChipProps) {
  const look = LOOKS[tone];
  const fill = selected ? look.selectedFill : look.fill;
  const text = selected ? look.selectedText : look.text;
  const stroke = selected ? look.selectedStroke : look.stroke;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        tone === 'ink' ? styles.inkChip : styles.accentChip,
        { backgroundColor: fill, borderColor: stroke, borderWidth: tone === 'ink' ? 1 : hairline },
        { borderRadius: shape === 'rounded' ? radius.field : radius.pill },
        grow && styles.grow,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={13} color={text} /> : null}
      <LPText size={13} weight={selected || tone === 'ink' ? 'semibold' : 'medium'} color={text} tracking={tone === 'ink' ? -0.1 : undefined} numberOfLines={2}>
        {label}
      </LPText>
    </Pressable>
  );
}

const LOOKS: Record<ChipTone, { fill: string; text: string; stroke: string; selectedFill: string; selectedText: string; selectedStroke: string }> = {
  ink: {
    fill: colors.ink2,
    text: colors.paper2,
    stroke: colors.line,
    selectedFill: colors.paper,
    selectedText: colors.ink,
    selectedStroke: colors.paper,
  },
  accent: {
    fill: colors.ink2,
    text: colors.paper,
    stroke: colors.line,
    selectedFill: colors.rust,
    selectedText: colors.onAccent,
    selectedStroke: colors.rust,
  },
};

export type ChipRowProps = {
  children: ReactNode;
  /** One scrolling line instead of wrapping rows. */
  scroll?: boolean;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  /** Padding at the scroll line's ends (a page gutter). */
  contentInset?: number;
  testID?: string;
};

export function ChipRow({ children, scroll = false, gap = 8, style, contentInset = 0, testID }: ChipRowProps) {
  if (scroll) {
    return (
      <ScrollView
        testID={testID}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={[styles.line, { gap, paddingHorizontal: contentInset }]}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View testID={testID} style={[styles.wrap, { gap }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  inkChip: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 36 },
  accentChip: { paddingHorizontal: 14, minHeight: 44 },
  grow: { flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center' },
});
