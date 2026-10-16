// Loading placeholders (iOS HealthSkeletonBlock / HealthSkeletonCard).
//
// Deliberately NOT a spinner over the whole page. A member opening Plan knows
// what shape it has; showing that shape filling in reads as fast, while a
// spinner over an empty page reads as broken. The block pulses between full
// and 55 % opacity; with Remove animations on, it simply sits there. Both are
// hidden from TalkBack: a placeholder has nothing to say.
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue } from 'react-native';

import { useReduceMotion } from '../../hooks/useReduceMotion';
import { colors, hairline } from '../../theme';
import { hiddenFromAccessibility } from './a11y';
import Card from './Card';

export type SkeletonBlockProps = {
  height?: number;
  /** Fixed width; omitted, the block fills the row (iOS `maxWidth: .infinity`). */
  width?: DimensionValue;
  radius?: number;
  testID?: string;
};

/** One pulse: 1.2 s ease-in-out to 55 % and back, forever (iOS autoreverses). */
const PULSE_MS = 1200;
const DIM = 0.55;

export function SkeletonBlock({ height = 16, width, radius = 6, testID }: SkeletonBlockProps) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: DIM, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [reduceMotion, opacity]);

  return (
    <Animated.View
      testID={testID}
      {...hiddenFromAccessibility}
      style={[
        styles.block,
        { height, borderRadius: radius, opacity },
        width === undefined ? styles.fill : { width },
      ]}
    />
  );
}

export type SkeletonCardProps = {
  rows?: number;
  showsHeader?: boolean;
  testID?: string;
};

/** A card-shaped group of skeleton rows, in the card chrome so nothing jumps when content lands. */
export function SkeletonCard({ rows = 3, showsHeader = true, testID }: SkeletonCardProps) {
  const count = Math.max(rows, 1);
  return (
    <View testID={testID} {...hiddenFromAccessibility} style={styles.card}>
      {showsHeader ? (
        <View style={styles.header}>
          <SkeletonBlock height={10} width={90} radius={3} />
          <SkeletonBlock height={22} width={200} radius={5} />
        </View>
      ) : null}
      <Card>
        {Array.from({ length: count }, (_, index) => (
          <View key={index}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.row}>
              <SkeletonBlock height={34} width={34} radius={10} />
              <View style={styles.lines}>
                <SkeletonBlock height={13} width={index === 0 ? 170 : 130} radius={4} />
                <SkeletonBlock height={10} width={index === 0 ? 110 : 90} radius={4} />
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.ink3 },
  fill: { alignSelf: 'stretch' },
  card: { gap: 14 },
  header: { gap: 8, paddingHorizontal: 4 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  lines: { gap: 7, flexShrink: 1 },
});
