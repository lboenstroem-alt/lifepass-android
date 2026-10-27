/* eslint lifepass/no-literal-copy: "error" */
/**
 * "How was your visit?" on Home: the small card for the ask the server says
 * is due (docs/05, "The card"), with the title, the venue name on its own
 * line (never inside a sentence, so it is never inflected), "Tap the stars
 * to rate it", five stars and "Not now".
 *
 * A star opens the sheet with that overall chosen; "Not now" dismisses the
 * ask on the server and the card goes.
 *
 * WHEN IT ASKS. The card is where the ask is shown, so it is what asks for
 * it: while Home is the screen in focus, once per return to the foreground,
 * and never while a booking, payment or check-in flow is on screen (it asks
 * once that flow is over). `GET /visit-rating-prompts/current` stamps the
 * ask shown, so it is never called anywhere the card could not be seen
 * (./store.ts).
 *
 * Draws nothing at all while there is no ask (no gap is left on Home).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { subscribeFlowsOnScreen } from '../../app/flowsOnScreen';
import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, minTouch, radius } from '../../theme';

import { useScreenFocused, useVisitRating, visitRatingActions } from './useVisitRating';

const STARS = [1, 2, 3, 4, 5] as const;

/** Asks for the card while Home is in focus (see the file comment). */
function useCardCheck(): void {
  const focused = useScreenFocused();
  const foreground = useVisitRating((state) => state.foreground);
  useEffect(() => {
    if (!focused) return;
    const check = () => void visitRatingActions().checkForCard();
    check();
    // A flow that was on screen ends: the card may ask now.
    return subscribeFlowsOnScreen(check);
  }, [focused, foreground]);
}

export default function VisitRatingCard() {
  const { t } = useT();
  const card = useVisitRating((state) => state.card);
  useCardCheck();
  if (!card) return null;

  return (
    <View style={styles.card} testID="visitRating.card">
      <View style={styles.header}>
        <View style={styles.words}>
          <LPText size={16} weight="semibold" color={colors.paper} accessibilityRole="header">
            {t('visitRating.card.title')}
          </LPText>
          <LPText size={14} weight="medium" color={colors.paper2} testID="visitRating.card.venue">
            {card.venueName}
          </LPText>
        </View>
        <Pressable
          onPress={() => visitRatingActions().notNow()}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          testID="visitRating.card.dismiss"
        >
          <LPText size={13} weight="medium" color={colors.accentText}>
            {t('visitRating.card.dismiss')}
          </LPText>
        </Pressable>
      </View>
      <LPText size={12} color={colors.mutedTextStrong}>
        {t('visitRating.card.line')}
      </LPText>
      <View style={styles.stars}>
        {STARS.map((star) => (
          <Pressable
            key={star}
            onPress={() => visitRatingActions().openFromCard(star)}
            accessibilityRole="button"
            accessibilityLabel={t('venue2.a11y.rating', { count: star })}
            hitSlop={2}
            style={({ pressed }) => [styles.star, pressed && styles.pressed]}
            testID={`visitRating.card.star.${star}`}
          >
            <Ionicons name="star-outline" size={28} color={colors.signal} allowFontScaling={false} {...hiddenFromAccessibility} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 4,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  words: { flex: 1, gap: 2 },
  dismiss: { minHeight: minTouch, justifyContent: 'center', marginTop: -12, marginRight: -4, paddingHorizontal: 4 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -8 },
  star: { minWidth: minTouch, minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
