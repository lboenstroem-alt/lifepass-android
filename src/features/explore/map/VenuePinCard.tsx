// The pinned venue's card on the Explore map (iOS SearchMapView `venueCard`).
//
// A 56 pt photo; the name (two lines); the ring's swatch with "{long type} ·
// {town}" and " · Coming soon" while the venue awaits connection; a
// one-sentence summary in English only (as on the web: there is no
// Icelandic prose to shorten); "★ 4.6" when rated; "Open venue" underlined
// with a chevron; "Tap again to open" (the second tap is on the pin, so the
// hint is for the eye only, and it is dropped while the pin is still under
// this card); the compact price pill; and a close button. A tap anywhere on
// the card opens the venue too.
//
// It sits a fixed distance above the bottom of the map and slides in when a
// pin is pinned (still under Remove animations). Its height is reported so
// the map can slide a pin pinned under it clear (`revealMove`).
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import PricePill from '../../../components/PricePill';
import { hiddenFromAccessibility, LPText, VenueImage } from '../../../components/ui';
import { useT } from '../../../i18n';
import { COMING_SOON_KEY, longLabel, shortSummary, type Classification } from '../../../lib/venueMarkerType';
import { colors, hairline, radius } from '../../../theme';
import type { Venue } from '../../../types/venue';
import VenueRing from './VenueRing';

export interface VenuePinCardProps {
  readonly venue: Venue;
  readonly ring: Classification;
  /** "Tap again to open" shows (not while the pin is still under the card). */
  readonly showsTapAgain: boolean;
  /** A tap on the card or on "Open venue". */
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** The card's resting height, for the reveal. */
  readonly onHeight: (height: number) => void;
  /** The card's gap above the bottom of the map. */
  readonly bottom: number;
  readonly reduceMotion: boolean;
}

/** "Gym & pool · Reykjavík · Coming soon": the card's type line. */
export function cardTypeLine(
  venue: Pick<Venue, 'city'>,
  ring: Classification,
  t: (key: string) => string,
  language: 'en' | 'is',
): string {
  const parts = [longLabel(ring.type, language)];
  if (venue.city) parts.push(venue.city);
  if (ring.comingSoon) parts.push(t(COMING_SOON_KEY));
  return parts.join(' · ');
}

/** The card's one sentence: the English description's, in English only. */
export function cardSummary(venue: Pick<Venue, 'description'>, language: 'en' | 'is'): string {
  return language === 'en' ? shortSummary(venue.description) : '';
}

/** "4.6" when the venue has a rating above zero (iOS `String(format: "%.1f")`, a point in both languages). */
export function cardRating(venue: Pick<Venue, 'averageRating'>): string | null {
  const rating = venue.averageRating;
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : null;
}

export default function VenuePinCard({
  venue,
  ring,
  showsTapAgain,
  onOpen,
  onClose,
  onHeight,
  bottom,
  reduceMotion,
}: VenuePinCardProps) {
  const { t, language } = useT();
  const typeLine = cardTypeLine(venue, ring, t, language);
  const summary = cardSummary(venue, language);
  const rating = cardRating(venue);

  // Slides in when it appears; a pin moving the card to another venue keeps it in place.
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(appear, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [appear, reduceMotion]);
  const translateY = appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  const onLayout = (event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height);
  const infoLabel = [venue.name, typeLine, summary, rating].filter((part): part is string => !!part).join(', ');

  return (
    <Animated.View
      style={[styles.wrap, { bottom, opacity: appear, transform: [{ translateY }] }]}
      onLayout={onLayout}
      pointerEvents="box-none"
      testID="explore.venueCard"
    >
      <Pressable onPress={onOpen} accessible={false} style={styles.card} testID="explore.venueCard.body">
        <View style={styles.top}>
          <VenueImage uri={venue.imageUrl} height={56} recyclingKey={venue.id} style={styles.photo} />
          <View style={styles.info} accessible accessibilityLabel={infoLabel} testID="explore.venueCard.info">
            <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={2} style={styles.name}>
              {venue.name}
            </LPText>
            <View style={styles.typeRow}>
              <VenueRing type={ring.type} comingSoon={ring.comingSoon} size="card" />
              <LPText size={12} color={colors.paper2} numberOfLines={1} style={styles.shrink} testID="explore.venueCard.type">
                {typeLine}
              </LPText>
            </View>
            {summary ? (
              <LPText size={12.5} color={colors.paper2} numberOfLines={3} testID="explore.venueCard.summary">
                {summary}
              </LPText>
            ) : null}
            {rating ? (
              <View style={styles.rating} testID="explore.venueCard.rating">
                <Ionicons name="star" size={9} color={colors.signal} />
                <LPText size={11} color={colors.paper3}>
                  {rating}
                </LPText>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            style={styles.open}
            hitSlop={{ top: 0, bottom: 0, left: 4, right: 4 }}
            testID="explore.venueCard.open"
          >
            <LPText size={13} weight="semibold" color={colors.paper} style={styles.underline}>
              {t('map.open_venue')}
            </LPText>
            <Ionicons name="chevron-forward" size={12} color={colors.paper} {...hiddenFromAccessibility} />
          </Pressable>
          {showsTapAgain ? (
            <LPText
              size={11}
              color={colors.paper3}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={styles.shrink}
              testID="explore.venueCard.tapAgain"
              {...hiddenFromAccessibility}
            >
              {t('map.tap_again')}
            </LPText>
          ) : null}
          <View style={styles.spacer} />
          <PricePill venue={venue} compact />
        </View>
      </Pressable>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('map.close')}
        style={styles.close}
        testID="explore.venueCard.close"
      >
        <Ionicons name="close" size={16} color={colors.paper2} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20 },
  card: {
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 2,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line2,
    boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 20, color: 'rgba(0,0,0,0.4)' }],
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  photo: { width: 56, height: 56, borderRadius: 8 },
  info: { flex: 1, gap: 4 },
  // Room for the close button in the corner.
  name: { paddingRight: 30 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  underline: { textDecorationLine: 'underline' },
  spacer: { flex: 1 },
  close: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
