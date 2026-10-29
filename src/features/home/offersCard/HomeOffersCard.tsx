/**
 * "Get offers by email" on Home (iOS HomeOffersCard; the website dashboard's
 * card, apps/web/src/components/offers-opt-in/offers-opt-in-card.tsx): what
 * the member gets, one tap to opt in, and a No thanks that stays said; after
 * the tap, the done line. It draws what ./useOffersCard.ts says, and nothing
 * at all while the card is not offered.
 *
 * THE WORDS ARE THE CONSENT'S WORDS. The server records the opt-in as given
 * to the website card's title, body and button (`offers-card-2026-10-28`), so
 * `offers.card.title`, `.body` and `.opt_in` are those words exactly, in both
 * languages (src/i18n/ahead-of-ios.json; the tests hold them to it).
 *
 * THE BUTTONS sit side by side while they fit and wrap at large text sizes,
 * where "Sendið mér tilboð" and "Nei takk" do not share a row (iOS
 * ViewThatFits). Email me offers is white on the action fill (6:1, iOS
 * lpActionFill), 44 dp tall; both wait while a tap is on its way.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, View, type HostInstance, type Text } from 'react-native';

import { Card, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, minTouch, radius } from '../../../theme';
import { useOffersCard } from './useOffersCard';

/** Room for the done line to draw before TalkBack is moved onto it. */
const DONE_FOCUS_DELAY_MS = 300;

/** Home's gutter for its cards (the referral card's, HomeShelves). */
const CARD_GUTTER = 24;

type Props = {
  /** Home's visit count (../useHomeVisit.ts): the done line lasts one visit. */
  visit: number;
};

export default function HomeOffersCard({ visit }: Props) {
  const { t } = useT();
  const card = useOffersCard(visit);
  const doneTitle = useRef<Text>(null);

  // The button just pressed has gone: TalkBack goes on from the done line,
  // as the website moves focus to it.
  useEffect(() => {
    if (card.mode !== 'done') return undefined;
    const timer = setTimeout(() => {
      const node = doneTitle.current as unknown as HostInstance | null;
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, DONE_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [card.mode]);

  if (card.mode === 'hidden') return null;

  if (card.mode === 'done') {
    return (
      <Card style={styles.card} testID="home.offers.done">
        <View style={styles.titleRow}>
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={colors.accentText}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <LPText ref={doneTitle} serif size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header" style={styles.title}>
            {t('offers.card.done_title')}
          </LPText>
        </View>
        <LPText size={14} color={colors.paper2} style={styles.body}>
          {t('offers.card.done_body')}
        </LPText>
      </Card>
    );
  }

  const optInLabel = t('offers.card.opt_in');
  const dismissLabel = t('offers.card.dismiss');
  return (
    <Card style={styles.card} testID="home.offers">
      <View style={styles.titleRow}>
        <Ionicons name="mail-outline" size={18} color={colors.accentText} accessibilityElementsHidden importantForAccessibility="no" />
        <LPText serif size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header" style={styles.title}>
          {t('offers.card.title')}
        </LPText>
      </View>
      <LPText size={14} color={colors.paper2} style={styles.body}>
        {t('offers.card.body')}
      </LPText>
      {card.failed ? (
        <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" style={styles.failed} testID="home.offers.failed">
          {t('offers.card.failed')}
        </LPText>
      ) : null}
      <View style={styles.buttons}>
        <Pressable
          onPress={card.optIn}
          disabled={card.working}
          accessibilityRole="button"
          accessibilityLabel={optInLabel}
          accessibilityState={{ disabled: card.working, busy: card.working }}
          style={({ pressed }) => [styles.optIn, pressed && !card.working && styles.pressed]}
          testID="home.offers.optIn"
        >
          {card.working ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="mail-outline" size={14} color={colors.onAccent} accessibilityElementsHidden importantForAccessibility="no" />
          )}
          <LPText size={14} weight="semibold" color={colors.onAccent}>
            {optInLabel}
          </LPText>
        </Pressable>
        <Pressable
          onPress={card.dismiss}
          disabled={card.working}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          accessibilityState={{ disabled: card.working }}
          hitSlop={4}
          style={({ pressed }) => [styles.dismiss, pressed && !card.working && styles.pressed]}
          testID="home.offers.dismiss"
        >
          <LPText size={14} weight="semibold" color={colors.paper2}>
            {dismissLabel}
          </LPText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: CARD_GUTTER, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flexShrink: 1 },
  body: { marginTop: 10, lineHeight: 20 },
  failed: { marginTop: 10 },
  buttons: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
    rowGap: 4,
  },
  optIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: minTouch,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.actionFill,
  },
  dismiss: { minHeight: minTouch, justifyContent: 'center', paddingHorizontal: 6 },
  pressed: { opacity: 0.85 },
});
