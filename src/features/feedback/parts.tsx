/**
 * The small pieces the feedback card, the report and the history share
 * (iOS `FeedbackNewPill`, `FeedbackActionButton`, and the two button looks
 * FeedbackCard.swift draws inline).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors } from '../../theme';

import { feedbackActionLabelKey } from './cardState';
import type { ShownFeedbackAction } from './actions';

/** "New", on a report the member has not opened. */
export function FeedbackNewPill({ testID = 'feedback.new' }: { testID?: string }) {
  const { t } = useT();
  return (
    <View style={styles.pill} testID={testID}>
      <LPText size={11} weight="semibold" color={colors.rust}>
        {t('feedback.card.new')}
      </LPText>
    </View>
  );
}

/** A line's action, labelled the house way: an outlined capsule, 44 tall to the touch. */
export function FeedbackActionButton({ action, onPress }: { action: ShownFeedbackAction; onPress: () => void }) {
  const { t } = useT();
  const label = t(feedbackActionLabelKey(action));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionHit, pressed && styles.pressed]}
      testID={`feedback.action.${action}`}
    >
      <View style={styles.actionCapsule}>
        <LPText size={13} weight="semibold" color={colors.paper}>
          {label}
        </LPText>
      </View>
    </Pressable>
  );
}

/** The card's filled capsule ("See your month", "Choose what is in it", "Include food and weight"). */
export function FeedbackFilledButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 2, bottom: 2 }}
      style={({ pressed }) => [styles.filled, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={colors.onAccent}>
        {label}
      </LPText>
    </Pressable>
  );
}

/** A plain text button, 44 tall ("Hide", "Past months", "Got it", "Not now", the report's footer links). */
export function FeedbackTextButton({
  label,
  onPress,
  color = colors.paper2,
  testID,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.text, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={color}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.rust3,
    alignSelf: 'center',
  },
  actionHit: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionCapsule: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
    justifyContent: 'center',
  },
  filled: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.rust,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.75 },
});
