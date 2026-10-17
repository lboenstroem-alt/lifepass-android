/* eslint lifepass/no-literal-copy: "error" */
// The input's trailing mic (iOS CoachView.swift `inputBar`): an outline mic
// to start dictating while the input is empty, disabled while an allowance
// is spent; a filled mic on the accent while recording, which stops it.
// The listening itself is ./useDictation.ts.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';

type Props = {
  recording: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
};

export default function MicButton({ recording, disabled, onStart, onStop }: Props) {
  const { t } = useT();
  if (recording) {
    return (
      <Pressable
        onPress={onStop}
        style={[styles.button, styles.recording]}
        accessibilityRole="button"
        accessibilityLabel={t('coach.a11y.stop_recording')}
        testID="coach.mic.stop"
      >
        <Ionicons name="mic" size={18} color="#FFFFFF" />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onStart}
      disabled={disabled}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={t('coach.a11y.start_voice')}
      accessibilityState={{ disabled }}
      testID="coach.mic.start"
    >
      <Ionicons name="mic-outline" size={20} color={coachPalette.textMeta} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: coachPalette.accent },
  pressed: { opacity: 0.7 },
});
