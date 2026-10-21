/* eslint lifepass/no-literal-copy: "error" */
/**
 * A sight's mark: a hollow light-blue ring (iOS `AttractionMapMarker`,
 * Views/Search/SearchMapView.swift). The map, Home's Outside card, the card's
 * walk links and nearby rows, and the Coach's and Plan's sight rows all draw
 * it, so a sight reads as "public place" before anyone reads a word and can
 * never pass for a venue the pass opens.
 *
 *   - The ring's size and stroke follow the tier (a top pick larger, a
 *     standard sight smaller and quieter), and grow when selected.
 *   - Hikes get a small dark centre: the ring marks the trailhead. Top picks
 *     get a light-blue one. A top-pick trailhead reads as a trailhead first,
 *     since the larger ring already says it is a pick.
 *
 * SwiftUI strokes a circle on its path (half the stroke outside, half
 * inside); a View's border is all inside, so the view is drawn one stroke
 * wider than the ring's diameter to land on the same pixels.
 *
 * Decorative to TalkBack: the row or map element around it names the sight.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AttractionTier } from '../../api/attractions';
import { hiddenFromAccessibility } from '../../components/ui';
import { colors } from '../../theme';
import { ringDiameter } from './rules';

export interface AttractionRingProps {
  readonly tier?: AttractionTier;
  readonly isSelected?: boolean;
  readonly isTrailhead?: boolean;
  /**
   * The square the ring is centred in (iOS `.frame(width:height:)`), e.g. 32
   * on Home, 28 on a walk link. Omitted, the ring's own size.
   */
  readonly frame?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** The stroke width per tier (iOS `lineWidth`). */
export function ringLineWidth(tier: AttractionTier, isSelected: boolean): number {
  switch (tier) {
    case 'top':
      return isSelected ? 4.5 : 3.5;
    case 'notable':
      return isSelected ? 4 : 3;
    case 'standard':
      return isSelected ? 3.5 : 2.5;
  }
}

/** The centre dot's colour, or null for none (iOS `dotColor`). */
export function ringDotColor(tier: AttractionTier, isTrailhead: boolean): string | null {
  if (isTrailhead) return colors.attraction2;
  if (tier === 'top') return colors.attraction;
  return null;
}

/** The centre dot's diameter (iOS `dotDiameter`). */
export function ringDotDiameter(tier: AttractionTier, isSelected: boolean): number {
  if (tier === 'top') return isSelected ? 8 : 6;
  return isSelected ? 7 : 5;
}

export default function AttractionRing({
  tier = 'notable',
  isSelected = false,
  isTrailhead = false,
  frame,
  style,
  testID,
}: AttractionRingProps) {
  const diameter = ringDiameter(tier, isSelected);
  const lineWidth = ringLineWidth(tier, isSelected);
  const outer = diameter + lineWidth;
  const dotColor = ringDotColor(tier, isTrailhead);
  const dot = ringDotDiameter(tier, isSelected);
  const box = frame ?? outer;
  return (
    <View
      {...hiddenFromAccessibility}
      pointerEvents="none"
      testID={testID}
      style={[styles.frame, { width: box, height: box }, style]}
    >
      <View
        style={[
          styles.ring,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: lineWidth,
            elevation: tier === 'top' ? 3 : 2,
          },
        ]}
        testID={testID ? `${testID}.ring` : undefined}
      >
        {dotColor ? (
          <View
            style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: dotColor }}
            testID={testID ? `${testID}.dot` : undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.attraction,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
  },
});
