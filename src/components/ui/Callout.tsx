// The one-time pointer bubble (iOS Home's CalloutBubble: "your bookings are
// here now", pointing at the avatar).
//
// The card and its pointer are drawn as ONE closed path. Stacking a triangle
// on a stroked card leaves the card's top hairline running straight across
// the arrow's base, so the pointer reads as a smudge rather than a pointer;
// one path means one continuous outline. The apex sits `arrowInset` in from
// the trailing edge: 22 by default, half the 44 pt button the bubble is
// aligned to, so it lands on the button's centre.
//
// A tap anywhere on it dismisses it (the caller records that it was seen).
import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, hairline } from '../../theme';
import LPText from './LPText';

export const CALLOUT_ARROW = { width: 16, height: 8, inset: 22 } as const;

/** The bubble's outline: a rounded card with the pointer rising from its top edge. */
export function calloutPath(
  width: number,
  height: number,
  cornerRadius = 12,
  arrowInset: number = CALLOUT_ARROW.inset,
): string {
  const { width: arrowWidth, height: arrowHeight } = CALLOUT_ARROW;
  const top = arrowHeight;
  const r = Math.min(cornerRadius, Math.min(width, height - top) / 2);
  const apexX = width - arrowInset;
  const leftX = apexX - arrowWidth / 2;
  const rightX = apexX + arrowWidth / 2;
  const n = (value: number) => Number(value.toFixed(2));
  return [
    `M${n(r)} ${n(top)}`,
    `L${n(leftX)} ${n(top)}`,
    `L${n(apexX)} 0`,
    `L${n(rightX)} ${n(top)}`,
    `L${n(width - r)} ${n(top)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(width)} ${n(top + r)}`,
    `L${n(width)} ${n(height - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(width - r)} ${n(height)}`,
    `L${n(r)} ${n(height)}`,
    `A${n(r)} ${n(r)} 0 0 1 0 ${n(height - r)}`,
    `L0 ${n(top + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(top)}`,
    'Z',
  ].join(' ');
}

export type CalloutProps = {
  text: string;
  onDismiss: () => void;
  width?: number;
  arrowInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function Callout({ text, onDismiss, width = 260, arrowInset = CALLOUT_ARROW.inset, style, testID }: CalloutProps) {
  const [height, setHeight] = useState(0);
  return (
    <Pressable
      testID={testID}
      onPress={onDismiss}
      accessibilityRole="text"
      accessibilityLabel={text}
      style={[{ width }, style]}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      {/* A body-shaped view under the outline carries the shadow (a path cannot). */}
      <View style={[styles.shadow, { top: CALLOUT_ARROW.height }]} pointerEvents="none" />
      {height > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={calloutPath(width, height, 12, arrowInset)} fill={colors.ink2} stroke={colors.line} strokeWidth={hairline} />
        </Svg>
      ) : null}
      <View style={styles.content}>
        <LPText size={14} color={colors.paper}>
          {text}
        </LPText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  content: { paddingHorizontal: 14, paddingTop: CALLOUT_ARROW.height + 12, paddingBottom: 12 },
});
