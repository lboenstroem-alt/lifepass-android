// The standard LifePass card (iOS `.lpCard()`): ink2 fill, a 0.5 hairline in
// the warm rule colour, radius 14.
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors, hairline, radius as radii } from '../../theme';

export type CardProps = ViewProps & {
  children?: ReactNode;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export default function Card({ children, radius = radii.card, style, ...rest }: CardProps) {
  return (
    <View {...rest} style={[styles.card, { borderRadius: radius }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
});
