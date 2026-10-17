// "Want to try something new?" (iOS `TryNewSection`): a centred heading, a
// rail of six picture cards and an ask card with a real text field and three
// quick chips. Every tap hands a prompt to the Coach (Home parks it and
// switches tab; the Coach sends it as a fresh turn).
//
// It needs no venue data, so it renders while the shelves are still loading.
//
// THE ASK FIELD (2.5.4). A field that grows to three lines took Return as a
// new line, so it could never send and the keyboard had no way out (the
// first Android build had exactly that bug). Now:
//   - the IME action says Send; it sends the trimmed text, or with nothing to
//     send just closes the keyboard (`submitBehavior="blurAndSubmit"`);
//   - a new line that reaches the field anyway is read the iOS way
//     (`askFieldChange`), and pasted lines become spaces;
//   - the keyboard is put away BEFORE the tab changes, so it is never left
//     up over the Coach;
//   - Home closes it on a tap anywhere outside the field and when the page is
//     dragged (HomeScreen), and Android's back key closes it too, which
//     covers iOS's Done key above the keyboard.
import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type GestureResponderEvent } from 'react-native';

import { LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, fonts, hairline } from '../../theme';
import { askFieldChange, HOME_ASK_CHIPS, HOME_COACH_CATEGORIES } from './coachPrompts';

/** iOS `Color.lpAurora.opacity(x)`. */
const aurora = (opacity: number) => `rgba(71,133,194,${opacity})`;

/** Lets Home tell a tap inside the ask field from one outside it. */
export interface TryNewSectionHandle {
  /** True while the ask field has the keyboard. */
  isInputFocused(): boolean;
  /** True when the touch that is starting began inside the field's row (the field or its send button). */
  touchStartedInInput(): boolean;
}

type Props = {
  onPrompt: (prompt: string) => void;
};

const TryNewSection = forwardRef<TryNewSectionHandle, Props>(function TryNewSection({ onPrompt }, ref) {
  const { t } = useT();
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const touchInInput = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      isInputFocused: () => input.current?.isFocused() ?? false,
      touchStartedInInput: () => {
        const inside = touchInInput.current;
        touchInInput.current = false;
        return inside;
      },
    }),
    [],
  );

  const send = (raw: string = text) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setText('');
    // The keyboard goes before the tab changes.
    input.current?.blur();
    Keyboard.dismiss();
    onPrompt(trimmed);
  };

  const onChangeText = (next: string) => {
    const change = askFieldChange(next);
    setText(change.text);
    if (change.kind === 'dismiss') {
      input.current?.blur();
      Keyboard.dismiss();
    } else if (change.kind === 'send') {
      send(change.text);
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <View style={styles.container}>
      <LPText serif size={26} tracking={-0.4} color={colors.paper} align="center" accessibilityRole="header">
        {t('home.try_lead')}
        <LPText serif italic size={26} tracking={-0.4} color={colors.paper}>
          {t('home.try_emph')}
        </LPText>
      </LPText>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.rail}
      >
        {HOME_COACH_CATEGORIES.map((category) => {
          const label = t(category.labelKey);
          return (
            <Pressable
              key={category.id}
              onPress={() => onPrompt(category.prompt)}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              testID={`home.category.${category.id}`}
            >
              <Image source={category.image} style={styles.cardImage} accessibilityIgnoresInvertColors />
              <LPText size={12} weight="medium" color={colors.paper2} align="center" numberOfLines={2} style={styles.cardLabel}>
                {label}
              </LPText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.askCard}>
        <View
          style={styles.inputRow}
          // Seen before Home's own touch handler (touches bubble up): a tap
          // here is the member placing the cursor or sending, not leaving.
          onTouchStart={(_event: GestureResponderEvent) => {
            touchInInput.current = true;
          }}
        >
          <TextInput
            ref={input}
            value={text}
            onChangeText={onChangeText}
            placeholder={t('home.ask_placeholder')}
            placeholderTextColor={colors.paper3}
            multiline
            // Return sends (or closes the keyboard); it never adds a line.
            submitBehavior="blurAndSubmit"
            returnKeyType="send"
            onSubmitEditing={() => send()}
            cursorColor={colors.rust}
            selectionColor={colors.rust3}
            accessibilityLabel={t('home.ask_placeholder')}
            style={styles.input}
            testID="home.coachInput"
          />
          {hasText ? (
            <Pressable
              onPress={() => send()}
              accessibilityRole="button"
              accessibilityLabel={t('coach.a11y.send_message')}
              hitSlop={9}
              testID="home.coachInput.send"
            >
              <Ionicons name="arrow-up-circle" size={28} color={colors.rust} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
        >
          {HOME_ASK_CHIPS.map((chip) => {
            const label = t(chip.labelKey);
            return (
              <Pressable
                key={chip.labelKey}
                onPress={() => onPrompt(chip.prompt)}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                testID={`home.chip.${chip.labelKey}`}
              >
                <LPText size={13} weight="medium" color={colors.signal}>
                  {label}
                </LPText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
});

export default TryNewSection;

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: 16 },
  rail: { gap: 14, paddingHorizontal: 4, paddingVertical: 4 },
  card: { width: 110, alignItems: 'center', gap: 10 },
  cardImage: { width: 100, height: 100, borderRadius: 16, backgroundColor: colors.ink3 },
  cardLabel: { width: 100 },
  askCard: {
    padding: 18,
    gap: 14,
    backgroundColor: colors.ink2,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: colors.line2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.ink3,
    borderRadius: 12,
    borderWidth: hairline,
    borderColor: colors.line2,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.paper,
    lineHeight: 20,
    padding: 0,
    // Grows to three lines (iOS `.lineLimit(1...3)`), then scrolls.
    maxHeight: 3 * 20,
    textAlignVertical: 'top',
  },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: aurora(0.5),
    backgroundColor: aurora(0.06),
  },
  pressed: { opacity: 0.8 },
});
