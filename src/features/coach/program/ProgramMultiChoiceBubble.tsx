/* eslint lifepass/no-literal-copy: "error" */
/**
 * Chips that stay selected until Continue (iOS `ProgramMultiChoiceBubble`,
 * Views/Coach/ProgramBubbles.swift): question 5 (what to plan around), 5b
 * (where the injury is, at most 3) and the summary's "where" row.
 *
 * WHY NOT THE QUESTION BUBBLE. That bubble answers on the first tap, which is
 * right for "how many days" and wrong for "anything we should plan around":
 * an injury AND a condition is one answer, and a member who taps injury first
 * must be able to add the second without the wizard having already moved on.
 *
 * It wears the Coach's photo palette, as every other bubble on the photo.
 * Answered (`closed`), the chips stay visible: the picked ones filled, the
 * rest at 35%, and Continue gone.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { assistantBubbleStyle, CoachAssistantAvatar } from '../../../screens/coach/MessageBubble';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { multiSelectOf } from './messages';
import { canConfirm } from './multiSelect';
import { confirmMultiSelect, toggleProgramOption } from './wizard';

/**
 * The chips and Continue are drawn 40 dp tall, as iOS draws them (40 pt), and
 * touched 48 dp tall, Android's minimum target: these are the safety and
 * injury taps, where a mis-tap matters most. Four above and four below fills
 * the 8 dp gap between two rows of chips without the two rows overlapping.
 */
const TOUCH_SLOP = { top: 4, bottom: 4 } as const;

function ProgramMultiChoiceBubble({ message }: CoachMessageRendererProps) {
  const { t } = useT();
  const state = multiSelectOf(message);
  if (!state) return null;
  const closed = state.closed;
  const ready = canConfirm(state);
  const continueLabel = t('common.continue');

  return (
    <View style={styles.root} testID={`coach.program.multi.${state.question}`}>
      <View style={styles.row}>
        <CoachAssistantAvatar size={24} />
        <View style={[styles.bubble, assistantBubbleStyle, styles.corners]}>
          <LPText size={14} color={coachPalette.textPrimary} style={styles.text}>
            {state.text}
          </LPText>
          {state.noteKey ? (
            <LPText size={12} color={coachPalette.textMeta} style={styles.note}>
              {t(state.noteKey)}
            </LPText>
          ) : null}
        </View>
      </View>

      <View style={styles.chips}>
        {state.options.map((option) => {
          const selected = state.selection.includes(option.value);
          const label = t(option.labelKey);
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (!closed) toggleProgramOption(message.id, option.value);
              }}
              disabled={closed}
              hitSlop={TOUCH_SLOP}
              accessibilityRole="checkbox"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected, disabled: closed }}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                closed && !selected && styles.chipDimmed,
                pressed && !closed && styles.pressed,
              ]}
              testID={`coach.program.option.${option.value}`}
            >
              <View {...hiddenFromAccessibility}>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={15}
                  color={selected ? '#FFFFFF' : coachPalette.textPrimary}
                />
              </View>
              <LPText size={13} weight={selected ? 'semibold' : 'medium'} color={selected ? '#FFFFFF' : coachPalette.textPrimary}>
                {label}
              </LPText>
            </Pressable>
          );
        })}
      </View>

      {state.showsMaxHint ? (
        <LPText size={12} weight="medium" color={coachPalette.textSecondary} accessibilityLiveRegion="polite">
          {t('program.part.max')}
        </LPText>
      ) : null}

      {!closed ? (
        <Pressable
          onPress={() => confirmMultiSelect(message.id)}
          disabled={!ready}
          hitSlop={TOUCH_SLOP}
          accessibilityRole="button"
          accessibilityLabel={
            ready ? `${continueLabel}. ${t('a11y.selected_count', { count: String(state.selection.length) })}` : continueLabel
          }
          accessibilityState={{ disabled: !ready }}
          style={({ pressed }) => [styles.confirm, !ready && styles.confirmDisabled, pressed && ready && styles.pressed]}
          testID="coach.program.continue"
        >
          <LPText size={13} weight="semibold" color="#FFFFFF">
            {continueLabel}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

export default memo(ProgramMultiChoiceBubble);

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, flexShrink: 1, gap: 6 },
  corners: { borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  text: { lineHeight: 20 },
  note: { lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  chipSelected: { backgroundColor: coachPalette.userBubble, borderColor: coachPalette.userBubble },
  chipDimmed: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  confirm: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: coachPalette.accent,
  },
  confirmDisabled: { opacity: 0.35 },
});
