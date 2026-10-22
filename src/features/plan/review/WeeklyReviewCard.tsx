/**
 * Last week, in five lines (iOS WeeklyReviewCard, `ios-ux.md` 3.12): "Week
 * of {date}", "Your week", then the lines the server sent values for
 * (./reviewRules.ts), the next week's change and the server's insight.
 *
 * On Plan it is the scroll and TalkBack target of the weekly check-in
 * notification: `titleRef` is the heading Plan moves TalkBack onto. Inside
 * the check-in sheet it is drawn without its kicker and title
 * (`showsKicker={false}`), under the sheet's own "Your week".
 */
import type { Ref } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { Card, Kicker, LPText } from '../../../components/ui';
import type { WeeklyReviewView } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { colors, hairline } from '../../../theme';

import { presentText, reviewLines } from './reviewRules';

export type WeeklyReviewCardProps = {
  review: WeeklyReviewView;
  /** The kicker and the title over the card (off inside the check-in sheet). */
  showsKicker?: boolean;
  /** The heading TalkBack lands on when Plan scrolls here. */
  titleRef?: Ref<Text>;
  testID?: string;
};

export default function WeeklyReviewCard({ review, showsKicker = true, titleRef, testID = 'plan.review' }: WeeklyReviewCardProps) {
  const translator = useT();
  const { t, language } = translator;
  const lines = reviewLines(review, translator);
  const change = presentText(review.nextWeekChange);
  const insight = presentText(review.insight);

  return (
    <View style={styles.wrap} testID={testID}>
      {showsKicker ? (
        <View style={styles.header}>
          <Kicker text={t('review.kicker', { date: review.weekStartsOn ? shortDay(review.weekStartsOn, language) : '' })} />
          <LPText ref={titleRef} serif size={22} color={colors.paper} accessible accessibilityRole="header">
            {t('review.title')}
          </LPText>
        </View>
      ) : null}

      <Card style={showsKicker ? styles.cardInset : undefined}>
        {lines.map((line, index) => (
          <View key={`${index}-${line}`}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <LPText size={14} color={colors.paper} style={styles.line} testID={`${testID}.line`}>
              {line}
            </LPText>
          </View>
        ))}

        {change ? (
          <View testID={`${testID}.next_week`}>
            <View style={styles.rule} />
            <View style={styles.changeBlock}>
              <Kicker text={t('review.next_week')} />
              <LPText size={14} color={colors.paper}>
                {change}
              </LPText>
            </View>
          </View>
        ) : null}

        {insight ? (
          <View testID={`${testID}.insight`}>
            <View style={styles.rule} />
            <LPText serif size={17} color={colors.paper} style={styles.insight}>
              {insight}
            </LPText>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  cardInset: { marginHorizontal: 20 },
  rule: { height: hairline, backgroundColor: colors.line },
  line: { paddingHorizontal: 14, paddingVertical: 12 },
  changeBlock: { gap: 4, paddingHorizontal: 14, paddingVertical: 12 },
  insight: { paddingHorizontal: 14, paddingVertical: 14 },
});
