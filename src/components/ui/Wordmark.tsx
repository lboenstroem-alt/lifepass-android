// The official LifePass wordmark (iOS LPWordmark): the same artwork lifepass-ios
// ships, recoloured to white with alpha kept so `tintColor` can paint it any
// colour. Defaults to the ink so it reads on paper. TalkBack hears "LifePass".
import { Image } from 'react-native';

import { colors } from '../../theme';

export type WordmarkProps = {
  /** Rendered height; width follows the artwork's 450:116 aspect ratio. */
  height?: number;
  color?: string;
  /** Hide from TalkBack where a nearby label already names the app. */
  decorative?: boolean;
};

const WORDMARK = require('../../../assets/LifePass2-white logo.png');

export default function Wordmark({ height = 20, color = colors.paper, decorative = false }: WordmarkProps) {
  return (
    <Image
      source={WORDMARK}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : 'LifePass'}
      importantForAccessibility={decorative ? 'no' : 'yes'}
      style={{ height, width: (height * 450) / 116, resizeMode: 'contain', tintColor: color }}
    />
  );
}
