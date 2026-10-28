/**
 * The Today card's buttons and chips (iOS `PlanTodayCard.capsuleButton`,
 * `actionTextButton`, `doneChip`, `waitingChip` and the lighter chip), and
 * the context every row of the card reads them through.
 *
 * TWO RULES THE BUTTONS KEEP FOR EVERY ROW:
 * - One action at a time: while one is in flight every action button is
 *   disabled, and the one in flight shows a spinner in its place.
 * - Offline dims every action except the runner's (Start, Do it now,
 *   Resume): they run from the cached session and their Save waits in the
 *   outbox (`allowOffline`).
 *
 * At the accessibility text sizes the action row is a column (iOS
 * `actionsStack`): a capsule on one line kept its width and the text buttons
 * beside it broke mid-word ("Mer / kja sem lokið"). Below them the capsule
 * stays on one line and the text buttons wrap.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { LPText } from '../../../components/ui';
import { colors, minTouch } from '../../../theme';

import { useTodayCard } from './TodayCardContext';

type CapsuleProps = {
  title: string;
  onPress: () => void;
  /** The runner starts and resumes from the cached session with no connection (7.2). */
  allowOffline?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** The rust capsule: Start, Resume, Book a class, Find a pool, Log a workout. */
export function CapsuleButton({ title, onPress, allowOffline = false, accessibilityLabel, testID }: CapsuleProps) {
  const { busy, isOffline, actionsStack } = useTodayCard();
  const dimmed = isOffline && !allowOffline;
  const disabled = busy !== null || dimmed;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.capsuleOuter, dimmed && styles.dimmed, pressed && !disabled && styles.pressed]}
      testID={testID}
    >
      <View style={[styles.capsule, actionsStack && styles.capsuleStacked]}>
        <LPText
          size={13}
          weight="semibold"
          color={colors.onAccent}
          align="center"
          numberOfLines={actionsStack ? undefined : 1}
        >
          {title}
        </LPText>
      </View>
    </Pressable>
  );
}

type TextActionProps = {
  title: string;
  /** The action's busy key: a spinner replaces the title while it is in flight. */
  busyKey: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * A text action that writes, or opens something that will (Undo, Mark as
 * done, Preview, Remove): disabled while any action is in flight or offline.
 */
export function TextAction({ title, busyKey, onPress, accessibilityLabel, testID }: TextActionProps) {
  const { busy, isOffline } = useTodayCard();
  const disabled = busy !== null || isOffline;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled, busy: busy === busyKey }}
      style={({ pressed }) => [styles.textAction, pressed && !disabled && styles.pressed]}
      testID={testID}
    >
      {busy === busyKey ? (
        <ActivityIndicator size="small" color={colors.paper2} />
      ) : (
        <LPText size={13} weight="semibold" color={colors.paper2}>
          {title}
        </LPText>
      )}
    </Pressable>
  );
}

/**
 * A text button that only opens a sheet (No energy today, Skip it, Not now,
 * Why?): never locked by an action in flight, as on iOS.
 */
export function PlainTextButton({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={colors.paper2}>
        {title}
      </LPText>
    </Pressable>
  );
}

/** The row of actions under a session: a line, or a column at the accessibility sizes. */
export function ActionRow({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { actionsStack } = useTodayCard();
  return (
    <View style={[actionsStack ? styles.actionsColumn : styles.actionsLine, style]} testID={testID}>
      {children}
    </View>
  );
}

/** A small capsule chip: Done, Waiting to sync, Lighter version, the recovery band. */
export function TodayChip({ text, tone, testID }: { text: string; tone: 'done' | 'soft'; testID?: string }) {
  return (
    <View style={[styles.chip, tone === 'done' ? styles.chipDone : styles.chipSoft]} testID={testID}>
      <LPText size={11} weight="semibold" color={tone === 'done' ? colors.onAccent : colors.signal}>
        {text}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  capsuleOuter: { minHeight: minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  capsule: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // At the accessibility sizes the capsule grows with its text rather than
  // clipping it, as a rounded rectangle.
  capsuleStacked: { borderRadius: 22, paddingVertical: 10 },
  dimmed: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  textAction: { minHeight: minTouch, justifyContent: 'center', flexShrink: 1 },
  actionsLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16 },
  actionsColumn: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 4 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  chipDone: { backgroundColor: colors.rust },
  chipSoft: { backgroundColor: colors.rust3 },
});
