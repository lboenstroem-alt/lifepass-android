/* eslint lifepass/no-literal-copy: "error" */
// A question bubble and its chips (iOS CoachView.swift `QuestionBubbleView`):
// every wizard's questions draw here, and a tap goes back through the store
// to the flow that asked (`useCoachStore.selectOption`).
//
// - Answered (or abandoned): the chips close; the chosen one stays filled in
//   the action blue, the others fade to 35%.
// - "Other" opens an inline field. Where the answer travels to a server with
//   its own limit (`maxLength`, UTF-16 units), the text is cut to it AS IT IS
//   TYPED, so the answer the member sees is the answer that is sent.
//
// Owned by COACH-1 until COACH-2 lands (plan 3.0.1).
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { LPText } from '../../components/ui';
import { truncatedToUTF16 } from '../../features/coach/chat/text';
import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';
import type { QuestionOption } from '../../types/coach';
import { assistantBubbleStyle, CoachAssistantAvatar } from './MessageBubble';

type Props = {
  question: string;
  options: readonly QuestionOption[];
  answered: boolean;
  /** The label of the chip that answered it. */
  selectedAnswer?: string;
  onSelect: (value: string, label: string) => void;
};

export default function QuestionBubbleMessage({ question, options, answered, selectedAnswer, onSelect }: Props) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState('');
  const otherLimit = options.find((option) => option.isOther)?.maxLength;

  const changeOther = (typed: string) => {
    setOtherText(otherLimit === undefined ? typed : truncatedToUTF16(typed, otherLimit));
  };

  const submitOther = () => {
    let text = otherText.trim();
    // Belt and braces with the live cap: whatever reaches the flow is inside the limit.
    if (otherLimit !== undefined) text = truncatedToUTF16(text, otherLimit);
    if (!text) return;
    onSelect(text, text);
  };

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <CoachAssistantAvatar size={24} />
        <View style={[styles.bubble, assistantBubbleStyle, styles.questionCorners, { maxWidth: width * 0.75 }]}>
          <LPText size={14} color={coachPalette.textPrimary} style={styles.text}>
            {question}
          </LPText>
        </View>
      </View>

      <View style={styles.chips}>
        {options.map((option) => {
          if (option.isOther && !answered) {
            if (showOther) {
              return (
                <View key={`other-${option.value}`} style={styles.otherRow}>
                  <TextInput
                    value={otherText}
                    onChangeText={changeOther}
                    placeholder={t('coach.other.placeholder')}
                    placeholderTextColor={coachPalette.placeholder}
                    style={styles.otherInput}
                    autoFocus
                    returnKeyType="send"
                    submitBehavior="blurAndSubmit"
                    onSubmitEditing={submitOther}
                    selectionColor={coachPalette.accent}
                    underlineColorAndroid="transparent"
                    accessibilityLabel={t('coach.other.label')}
                    testID="coach.question.other_input"
                  />
                  <Pressable
                    onPress={submitOther}
                    style={styles.otherSend}
                    accessibilityRole="button"
                    accessibilityLabel={t('coach.a11y.send_message')}
                    hitSlop={8}
                  >
                    <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              );
            }
            return (
              <Chip
                key={`other-${option.value}`}
                label={t('coach.other.label')}
                selected={false}
                dimmed={false}
                disabled={false}
                onPress={() => setShowOther(true)}
              />
            );
          }
          const selected = answered && selectedAnswer === option.label;
          return (
            <Chip
              key={`${option.value}-${option.label}`}
              label={option.label}
              selected={selected}
              dimmed={answered && !selected}
              disabled={answered}
              onPress={() => {
                if (!answered) onSelect(option.value, option.label);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function Chip({
  label,
  selected,
  dimmed,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        dimmed && styles.chipDimmed,
        pressed && !disabled && styles.chipPressed,
      ]}
    >
      <LPText
        size={13}
        weight={selected ? 'semibold' : 'medium'}
        color={selected ? '#FFFFFF' : dimmed ? coachPalette.textMeta : coachPalette.textPrimary}
      >
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, flexShrink: 1 },
  // A question's bubble is a touch tighter than a message's (iOS: 16, not 18).
  questionCorners: { borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  text: { lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  chipSelected: { backgroundColor: coachPalette.userBubble, borderColor: coachPalette.userBubble },
  chipDimmed: { opacity: 0.35 },
  chipPressed: { opacity: 0.75 },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  otherInput: { minWidth: 110, fontSize: 13, color: coachPalette.textPrimary, paddingVertical: 4 },
  otherSend: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: coachPalette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
