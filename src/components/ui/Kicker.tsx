// A small uppercase label (iOS Kicker): Inter Tight 10 semibold, tracking 1.6.
// A caller's style may change size or spacing; the face stays the kicker's
// unless the caller names a family itself (theme/fontInjection.ts).
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, fonts, sans } from '../../theme';
import { hasExplicitFontFamily } from '../../theme/fontInjection';

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

const KICKER_FACE = { fontFamily: fonts.sansSemiBold } as const;

export default function Kicker({ text, color = colors.paper3, style, maxScale, accessibilityRole, numberOfLines, testID }: KickerProps) {
  return (
    <Text
      testID={testID}
      accessibilityRole={accessibilityRole}
      maxFontSizeMultiplier={maxScale}
      numberOfLines={numberOfLines}
      style={[styles.kicker, { color }, style, !hasExplicitFontFamily(style) && KICKER_FACE]}
    >
      {text.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  kicker: { ...sans(10, 'semibold'), letterSpacing: 1.6 },
});
