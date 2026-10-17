// The banner at the top of Explore's list (iOS `EditorialBannerView`): a
// muted hero video on a loop, 180 dp tall, fading to the page colour at the
// foot, with the kicker and the serif line over it ("Gym, Spa, Pool, Lagoon-
// all at one pass", the last words in italic).
//
// The video plays only while Explore is on screen (iOS pauses it when the
// banner disappears), so a list left behind a pushed venue page does not
// keep decoding frames.
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, Kicker, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, radius } from '../../theme';

const HERO_VIDEO = require('../../../assets/lp-video-search-page.mp4');

export const BANNER_HEIGHT = 180;

export interface EditorialBannerProps {
  /** Explore is on screen: the video plays; otherwise it is paused. */
  readonly playing: boolean;
}

export default function EditorialBanner({ playing }: EditorialBannerProps) {
  const { t } = useT();
  const player = useVideoPlayer(HERO_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    try {
      if (playing) player.play();
      else player.pause();
    } catch {
      // A player already released (the list unmounting): nothing to do.
    }
  }, [player, playing]);

  return (
    <View style={styles.container} testID="explore.banner">
      <View style={styles.video} {...hiddenFromAccessibility}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      </View>
      <LinearGradient
        // iOS: lpInk at 5 % from 40 % of the height to 90 % at the foot.
        colors={['rgba(248,246,241,0.05)', 'rgba(248,246,241,0.90)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.copy}>
        <Kicker text={t('explore.banner_kicker')} color={colors.signal} />
        <LPText serif size={22} tracking={-0.4} color={colors.paper}>
          {t('explore.banner_lead')}
          <LPText serif italic size={22} tracking={-0.4} color={colors.paper}>
            {t('explore.banner_emph')}
          </LPText>
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // At least 180 dp; a large font size grows it rather than cutting the line (iOS ZStack).
    minHeight: BANNER_HEIGHT,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: colors.ink3,
  },
  video: { ...StyleSheet.absoluteFillObject },
  copy: { padding: 16, gap: 4 },
});
