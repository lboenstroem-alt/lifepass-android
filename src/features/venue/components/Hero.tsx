/* eslint lifepass/no-literal-copy: "error" */
// The hero (iOS VenueDetailView `heroBlock`): a 420 pt full-bleed photo that
// starts at the very top of the screen, behind the status bar, under a wash
// of the page's paper (0.35 → 0.05 → 0.70 → paper), so the dark title reads
// on its tail. Three frosted circles float over it: back, the favourite heart
// and share. Only that chrome moves down by the covered strip (`topInset`);
// the hero keeps its designed height, as on iOS.
//
// LARGE TEXT. The hero is 420 pt as designed, but grows rather than letting a
// long name at a large font size ride up under the round buttons (iOS lets
// them overlap); the page measures it (`onLayout`) for its scroll maths.
//
// No photo: a paper gradient with a photo glyph, never a stock picture. The
// carousel dots of iOS only show for more than one image, which no venue has
// today (`venueImages` returns at most one), so there are none here.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Kicker, LPText, VenueImage } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { venueImages, type Venue } from '../../../types/venue';
import { HERO_HEIGHT, heroKicker } from '../model';
import { FrostedCircleButton, paperAt } from './shared';

export interface HeroProps {
  readonly venue: Venue;
  /** The strip the status bar covers: the buttons sit below it. */
  readonly topInset: number;
  readonly isFavourite: boolean;
  readonly onBack: () => void;
  readonly onToggleFavourite: () => void;
  readonly onShare: () => void;
  /** The hero's drawn height (420 unless large text grew it). */
  readonly onHeight?: (height: number) => void;
}

const WASH = [paperAt(0.35), paperAt(0.05), paperAt(0.7), colors.ink] as const;
const WASH_STOPS = [0, 0.35, 0.85, 1] as const;

export default function Hero({ venue, topInset, isFavourite, onBack, onToggleFavourite, onShare, onHeight }: HeroProps) {
  const { t } = useT();
  const image = venueImages(venue)[0] ?? null;
  const kicker = heroKicker(venue, t);
  return (
    <View
      style={styles.hero}
      testID="venue.hero"
      onLayout={(event: LayoutChangeEvent) => onHeight?.(event.nativeEvent.layout.height)}
    >
      {image ? (
        <VenueImage uri={image} style={StyleSheet.absoluteFill} recyclingKey={venue.id} />
      ) : (
        <LinearGradient colors={[colors.ink3, colors.ink2]} style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Ionicons name="image-outline" size={34} color={colors.paper3} accessibilityElementsHidden importantForAccessibility="no" />
        </LinearGradient>
      )}

      {/* The wash never takes a touch, or the buttons over it would stop working. */}
      <LinearGradient pointerEvents="none" colors={WASH} locations={WASH_STOPS} style={StyleSheet.absoluteFill} />

      <View style={[styles.nav, { paddingTop: topInset + 8 }]}>
        <FrostedCircleButton icon="chevron-back" onPress={onBack} accessibilityLabel={t('common.back')} testID="venue.back" />
        <View style={styles.navTrailing}>
          <FrostedCircleButton
            icon={isFavourite ? 'heart' : 'heart-outline'}
            tint={isFavourite ? colors.rust2 : colors.paper}
            onPress={onToggleFavourite}
            accessibilityLabel={t('venue.page.a11y_favourite')}
            selected={isFavourite}
            testID="venue.favourite"
          />
          <FrostedCircleButton
            icon="share-social-outline"
            onPress={onShare}
            accessibilityLabel={t('venue.page.a11y_share')}
            testID="venue.share"
          />
        </View>
      </View>

      <View style={styles.title}>
        <Kicker text={kicker.text} color={kicker.premium ? colors.signal : colors.paper2} testID="venue.kicker" />
        <LPText serif size={38} tracking={-1.2} color={colors.paper} accessibilityRole="header">
          {venue.name}
        </LPText>
        {venue.city ? (
          <LPText serif italic size={20} color={colors.paper2}>
            {venue.city}
          </LPText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: HERO_HEIGHT, width: '100%', overflow: 'hidden', backgroundColor: colors.ink3 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  navTrailing: { flexDirection: 'row', gap: 8 },
  // Pushed to the bottom by the free space between it and the buttons.
  title: { marginTop: 'auto', paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20, gap: 8 },
});
