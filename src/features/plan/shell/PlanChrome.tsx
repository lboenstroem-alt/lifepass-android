/**
 * The small pieces of the Plan page that are not cards: the loading
 * skeleton and the footer (iOS PlanView `loadingSkeleton` and `footer`).
 */
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { LPText, SkeletonCard } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

/** Where the footer's credits link goes (the sources of the sights, the trails and the weather). */
export const PLAN_CREDITS_URL = 'https://www.lifepass.is/attractions/credits';

/**
 * Two cards in the shape of the page, not a spinner over an empty one: a
 * member opening Plan knows what it looks like, and seeing that shape fill in
 * reads as fast. TalkBack hears one "Loading".
 */
export function PlanSkeleton({ testID = 'plan.skeleton' }: { testID?: string }) {
  const { t } = useT();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel={t('a11y.loading')} testID={testID}>
      <SkeletonCard rows={3} />
      <SkeletonCard rows={2} />
    </View>
  );
}

/** "General fitness guidance, not medical advice." and the sources and credits. */
export function PlanFooter({ testID = 'plan.footer' }: { testID?: string }) {
  const { t } = useT();
  const credits = t('plan.footer.credits');
  return (
    <View style={styles.footer} testID={testID}>
      <LPText size={12} color={colors.paper3} align="center">
        {t('health.disclaimer')}
      </LPText>
      <Pressable
        onPress={() => void Linking.openURL(PLAN_CREDITS_URL).catch(() => undefined)}
        accessibilityRole="link"
        accessibilityLabel={credits}
        style={({ pressed }) => [styles.credits, pressed && styles.pressed]}
        testID={`${testID}.credits`}
      >
        <LPText size={12} weight="semibold" color={colors.paper2} align="center">
          {credits}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: 28, paddingHorizontal: 20 },
  footer: { gap: 10, paddingHorizontal: 24, paddingTop: 8 },
  credits: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.7 },
});
