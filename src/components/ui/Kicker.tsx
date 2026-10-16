// A small uppercase label (iOS Kicker): Inter Tight 10 semibold, tracking 1.6.
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, sans } from '../../theme';

export type KickerProps = {
  text: string;
  color?: string;
  style?: StyleProp<TextStyle>;
  /** Upper bound on font scaling (FONT_SCALE_CAP). */
  maxScale?: number;
  accessibilityRole?: 'header' | 'text';
  numberOfLines?: number;
  testID?: string;
};

export default function Kicker({ text, color = colors.paper3, style, maxScale, accessibilityRole, numberOfLines, testID }: KickerProps) {
  return (
    <Text
      testID={testID}
      accessibilityRole={accessibilityRole}
      maxFontSizeMultiplier={maxScale}
      numberOfLines={numberOfLines}
      style={[styles.kicker, { color }, style]}
    >
      {text.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  kicker: { ...sans(10, 'semibold'), letterSpacing: 1.6 },
});
