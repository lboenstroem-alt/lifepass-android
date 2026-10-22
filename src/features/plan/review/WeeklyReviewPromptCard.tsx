/**
 * Shown instead of the review when the week is up and the member has not
 * checked in yet (iOS WeeklyReviewPromptCard, C6): "Your week", "How did
 * your week go?", a line, and "Weekly check-in", which opens the sheet.
 * Plan only draws it for an entitled member (./reviewRules.ts).
 */
import type { Ref } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { Card, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, radius } from '../../../theme';

export type WeeklyReviewPromptCardProps = {
  onOpen: () => void;
  /** The heading TalkBack lands on when Plan scrolls here. */
  titleRef?: Ref<Text>;
  testID?: string;
};

export default function WeeklyReviewPromptCard({ onOpen, titleRef, testID = 'plan.review.prompt' }: WeeklyReviewPromptCardProps) {
  const { t } = useT();
  const cta = t('review.prompt.cta');
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <Kicker text={t('review.title')} />
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessible accessibilityRole="header">
          {t('review.prompt.title')}
        </LPText>
      </View>
      <Card style={styles.card}>
        <LPText size={14} color={colors.paper2}>
          {t('review.prompt.body')}
        </LPText>
        <Pressable
          onPress={() => {
            track('review_prompt_opened');
            onOpen();
          }}
          accessibilityRole="button"
          accessibilityLabel={cta}
          hitSlop={4}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          testID={`${testID}.cta`}
        >
          <LPText size={13} weight="semibold" color={colors.onAccent}>
            {cta}
          </LPText>
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 10, paddingHorizontal: 24 },
  card: { marginHorizontal: 20, padding: 14, gap: 12 },
  button: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.rust,
  },
  pressed: { opacity: 0.8 },
});
