/* eslint lifepass/no-literal-copy: "error" */
// The Coach's plain bubbles (iOS CoachView.swift `MessageBubbleView`,
// `CoachAssistantAvatar`, `TypingIndicatorView`), in the 2.5.4 dark glass:
// the member's turns on the darker action blue (white text 6.0:1), the
// Coach's on glass with a hairline. Both keep the iOS corner cut: 4 on the
// side the bubble comes from, 18 elsewhere.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

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

/** A row with the avatar and a glass bubble of `text` (the venue carousel's and the strip's intro). */
export function AssistantText({ text }: { text: string }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.row}>
      <CoachAssistantAvatar />
      <View style={[styles.bubble, assistantBubbleStyle, { maxWidth: width * 0.75 }]}>
        <LPText size={14} color={coachPalette.textPrimary} style={styles.text}>
          {text}
        </LPText>
      </View>
    </View>
  );
}

export function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const { width } = useWindowDimensions();
  if (role === 'assistant') return <AssistantText text={text} />;
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
  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: coachPalette.textSecondary },
});
