// Text in the LifePass faces: the port of SwiftUI's
//   Text(...).font(.lpSans(size: 15, weight: .semibold)).foregroundStyle(.lpPaper2)
// as
//   <LPText size={15} weight="semibold" color={colors.paper2}>{t('...')}</LPText>
//
// `serif` switches to Fraunces (iOS `LPFont.serif`). `maxScale` caps how far
// the member's font size can grow it (FONT_SCALE_CAP, iOS
// `.dynamicTypeSize(...)`); by default text scales freely, as on iOS.
//
// THE FACE FOLLOWS THE PROPS. A caller's `style` may set size, colour,
// spacing and so on, but its font family only counts when its author wrote
// one: the Inter Tight family installFontDefaults injects into StyleSheet
// styles never overrides `serif` or `weight` (theme/fontInjection.ts).
import type { Ref } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, sans, serif as serifFace, type FontWeight } from '../../theme';
import { hasExplicitFontFamily } from '../../theme/fontInjection';

export type LPTextProps = TextProps & {
  size?: number;
  weight?: FontWeight;
  serif?: boolean;
  italic?: boolean;
  color?: string;
  /** Letter spacing (SwiftUI `.tracking`). */
  tracking?: number;
  align?: TextStyle['textAlign'];
  /** Upper bound on font scaling (see FONT_SCALE_CAP). */
  maxScale?: number;
  /** The native text, e.g. a sheet's title for its `initialFocusRef`. */
  ref?: Ref<Text>;
};

export default function LPText({
  size = 15,
  weight = 'regular',
  serif = false,
  italic = false,
  color = colors.paper,
  tracking,
  align,
  maxScale,
  style,
  ...rest
}: LPTextProps) {
  const face = serif ? serifFace(size, weight, italic) : sans(size, weight, italic);
  const keepFace = !hasExplicitFontFamily(style) && { fontFamily: face.fontFamily };
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxScale ?? rest.maxFontSizeMultiplier}
      style={[face, { color }, tracking !== undefined && { letterSpacing: tracking }, align && { textAlign: align }, style, keepFace]}
    />
  );
}
