/**
 * The soft accent glow behind the wordmark on Log in (iOS LoginView's
 * `RadialGradient(colors: [lpRust.opacity(0.25), .clear], center: (0.5, 0.1),
 * startRadius: 0, endRadius: 360)`), drawn edge to edge under the content.
 * Decoration: TalkBack never sees it.
 */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../../../theme';

export default function RustGlow() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="authGlow" cx={width * 0.5} cy={height * 0.1} r={360} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.rust} stopOpacity={0.25} />
            <Stop offset="1" stopColor={colors.rust} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#authGlow)" />
      </Svg>
    </View>
  );
}
