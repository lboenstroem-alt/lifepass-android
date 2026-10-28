/* eslint lifepass/no-literal-copy: "error" */
// The Coach's plain bubbles (iOS CoachView.swift `MessageBubbleView`,
// `CoachAssistantAvatar`, `TypingIndicatorView`), in the 2.5.4 dark glass:
// the member's turns on the darker action blue (white text 6.0:1), the
// Coach's on glass with a hairline. Both keep the iOS corner cut: 4 on the
// side the bubble comes from, 18 elsewhere.
//
// "Report this reply" (Android only, COACH-7; Google Play's AI-generated
// content policy): a bubble with the model's own words gets `onReport`, and
// then three ways to the report sheet, as a review card has its "...": a
// small "..." button beside the bubble, a long-press on the bubble, and a
// TalkBack action named "Report this reply" on it. The member's own
// bubbles, the greeting and the app's own sentences never get one (the
// store marks which bubbles are the model's: `isReportableReply`).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type AccessibilityActionEvent } from 'react-native';

import { LPText } from '../../components/ui';
import { hiddenFromAccessibility } from '../../components/ui/a11y';
import { coachPalette } from '../../features/coach/theme/palette';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';

/** The Coach's mark beside its bubbles: a waveform on a 15% aurora disc. Decorative. */
export function CoachAssistantAvatar({ size = 26 }: { size?: number }) {
  return (
    <View
      {...hiddenFromAccessibility}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <MaterialCommunityIcons name="waveform" size={Math.round(size * 0.5)} color={coachPalette.avatar} />
    </View>
  );
}

/** The glass behind an assistant bubble (iOS: 4 at the top leading corner). */
export const assistantBubbleStyle = {
  backgroundColor: coachPalette.tile,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: coachPalette.glassStroke,
  borderTopLeftRadius: 4,
  borderTopRightRadius: 18,
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
} as const;

/** The TalkBack action on a reportable bubble. */
export const REPORT_REPLY_ACTION = 'reportReply';

/** How long a press on a reply must last to open the report sheet (Android's own long-press is 400 to 500 ms). */
const REPORT_LONG_PRESS_MS = 450;

/**
 * A row with the avatar and a glass bubble of `text` (a reply, the venue
 * carousel's and the class list's intro, the strip's prompt). `onReport`:
 * the bubble is the model's own words, and offers "Report this reply".
 */
export function AssistantText({ text, onReport }: { text: string; onReport?: () => void }) {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const words = (
    <LPText size={14} color={coachPalette.textPrimary} style={styles.text}>
      {text}
    </LPText>
  );
  if (!onReport) {
    return (
      <View style={styles.row}>
        <CoachAssistantAvatar />
        <View style={[styles.bubble, assistantBubbleStyle, { maxWidth: width * 0.75 }]}>{words}</View>
      </View>
    );
  }
  const label = t('coach.report.action');
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === REPORT_REPLY_ACTION) onReport();
  };
  return (
    <View style={styles.row}>
      <CoachAssistantAvatar />
      {/* The bubble reads as its words; long-press and TalkBack's action report it. */}
      <Pressable
        onLongPress={onReport}
        delayLongPress={REPORT_LONG_PRESS_MS}
        accessibilityActions={[{ name: REPORT_REPLY_ACTION, label }]}
        onAccessibilityAction={onAction}
        style={[styles.bubble, assistantBubbleStyle, { maxWidth: width * 0.75 }]}
        testID="coach.reply"
      >
        {words}
      </Pressable>
      <Pressable
        onPress={onReport}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
        testID="coach.reply.report"
      >
        <Ionicons name="ellipsis-horizontal" size={16} color={coachPalette.textMeta} {...hiddenFromAccessibility} />
      </Pressable>
    </View>
  );
}

export function MessageBubble({
  role,
  text,
  onReport,
}: {
  role: 'user' | 'assistant';
  text: string;
  /** An assistant bubble with the model's own words: offers "Report this reply". Never on the member's own. */
  onReport?: () => void;
}) {
  const { width } = useWindowDimensions();
  if (role === 'assistant') return <AssistantText text={text} onReport={onReport} />;
  return (
    <View style={[styles.row, styles.rowUser]}>
      <View style={[styles.bubble, styles.userBubble, { maxWidth: width * 0.75 }]}>
        <LPText size={14} color="#FFFFFF" style={styles.text}>
          {text}
        </LPText>
      </View>
    </View>
  );
}

/** Three dots that take turns (iOS: a 0.45 s tick). Still for a member who asked for less motion. */
export function TypingIndicator() {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => setPhase((current) => (current + 1) % 3), 450);
    return () => clearInterval(timer);
  }, [reduceMotion]);
  return (
    <View style={styles.row} accessible accessibilityLabel={t('a11y.loading')} testID="coach.typing">
      <CoachAssistantAvatar />
      <View style={[styles.typing, assistantBubbleStyle]}>
        {[0, 1, 2].map((dot) => (
          <View
            key={dot}
            style={[styles.dot, { opacity: reduceMotion ? 0.6 : phase === dot ? 1 : 0.3 }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: coachPalette.avatarDisc,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, alignSelf: 'stretch' },
  rowUser: { justifyContent: 'flex-end' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, flexShrink: 1 },
  userBubble: {
    backgroundColor: coachPalette.userBubble,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  text: { lineHeight: 20 },
  // The "..." beside a reply: 24 dp, 48 with its hit slop; it never squeezes the bubble's words away.
  more: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  morePressed: { opacity: 0.6 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: coachPalette.textSecondary },
});
