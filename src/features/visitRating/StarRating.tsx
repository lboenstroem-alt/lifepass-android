/* eslint lifepass/no-literal-copy: "error" */
/**
 * Five stars to rate with: the sheet's Overall, Equipment and Cleanliness
 * rows.
 *
 * TOUCH. A star sets the rating to itself. On an optional row a tap on the
 * star already chosen clears the row (an optional score can be taken back);
 * the required Overall, once chosen, only changes.
 *
 * TALKBACK. The row is ONE adjustable control, read as its label and its
 * value ("Overall, 4 out of 5 stars, slider"); swiping up or down (or the
 * volume keys) moves it a star at a time, from 1 (Overall) or 0 (an optional
 * row) to 5. The stars themselves are decoration to TalkBack, as one row of
 * stars is one element on the reviews page.
 *
 * The glyphs keep their size at every text size (the row would not fit on
 * a phone at the largest one); each star still has a 44 dp target.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { hiddenFromAccessibility } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, minTouch } from '../../theme';

export interface StarRatingProps {
  /** What TalkBack calls the row ("Overall", "Equipment, Optional"). */
  readonly label: string;
  /** 0 (none chosen) to 5. */
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Can the row go back to none: true for an optional row. */
  readonly clearable: boolean;
  readonly disabled?: boolean;
  /** The glyph size (dp). */
  readonly size?: number;
  readonly testID?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/** TalkBack's own swipe up and down (standard actions: it words them itself). */
const ACTIONS = [{ name: 'increment' as const }, { name: 'decrement' as const }];

/** What an adjustment does to `value` (TalkBack's swipe up or down). Pure. */
export function adjustedStars(value: number, action: 'increment' | 'decrement', clearable: boolean): number {
  if (action === 'increment') return Math.min(5, Math.max(0, value) + 1);
  const floor = clearable ? 0 : Math.min(1, Math.max(0, value));
  return Math.max(floor, value - 1);
}

/** What a tap on `star` does to `value`. Pure. */
export function tappedStars(value: number, star: number, clearable: boolean): number {
  return clearable && star === value ? 0 : star;
}

export default function StarRating({
  label,
  value,
  onChange,
  clearable,
  disabled = false,
  size = 30,
  testID,
}: StarRatingProps) {
  const { t } = useT();
  const onAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    const name = event.nativeEvent.actionName;
    if (name !== 'increment' && name !== 'decrement') return;
    const next = adjustedStars(value, name, clearable);
    if (next !== value) onChange(next);
  };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 5, now: value, text: t('venue2.a11y.rating', { count: value }) }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAction}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      {STARS.map((star) => {
        const on = star <= value;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(tappedStars(value, star, clearable))}
            disabled={disabled}
            hitSlop={4}
            style={({ pressed }) => [styles.star, pressed && styles.pressed]}
            {...hiddenFromAccessibility}
            testID={testID ? `${testID}.${star}` : undefined}
          >
            <Ionicons
              name={on ? 'star' : 'star-outline'}
              size={size}
              color={on ? colors.signal : colors.paper4}
              allowFontScaling={false}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  star: { minWidth: minTouch, minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
