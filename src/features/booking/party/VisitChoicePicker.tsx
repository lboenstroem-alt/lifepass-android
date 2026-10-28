/**
 * The premium rung picker on the confirm step (plan 3.0.3 slot, filled by
 * BOOK-2; mounted by BOOK-1's BookingChargeSection above the disclosure):
 * the Android port of iOS BookingChargeSection's `visitChoicePicker`
 * (Views/Booking/BookingConfirmComponents.swift).
 *
 * It shows only when the booking preview offered a genuine trade (a
 * subscriber with visits left, a member price configured and higher), never
 * for a class: "How do you want to pay?", then one row per rung with its
 * price, "Use a visit + surcharge" and "Keep my visit, member price". The
 * picked row is tinted. Picking the other re-previews with `visitChoice`
 * (the session's `changeVisitChoice`), so the disclosure, the consent and
 * Confirm all follow the PICKED rung. Rows refuse taps while a booking is in
 * flight.
 *
 * Controlled by the booking screen: `selected` is the rung the session will
 * send, `options` the same rungs with their prices, in `choices`' order.
 *
 * TALKBACK. The rows are radio buttons that say their price and whether they
 * are the one picked.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import type { VisitChoiceOption } from '../../../api/bookings';
import { LPText } from '../../../components/ui';
import { iskPrefix, useT } from '../../../i18n';
import { colors, parseColor } from '../../../theme';

export interface VisitChoicePickerProps {
  /** The rungs the preview offered, by their wire ids, in its order. */
  readonly choices: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (choice: string) => void;
  readonly disabled?: boolean;
  /** The same rungs in full (price, whether it spends a visit, the reason), in `choices`' order. */
  readonly options?: readonly VisitChoiceOption[];
}

/** The generated iOS key naming a rung: keep the visit, else spend one. */
export function visitChoiceLabelKey(choice: string): string {
  return choice === 'keep_visit' ? 'consent.visit_choice_keep' : 'consent.visit_choice_spend';
}

export default function VisitChoicePicker({ choices, selected, onSelect, disabled = false, options }: VisitChoicePickerProps) {
  const { t } = useT();
  if (choices.length === 0) return null;

  return (
    <View style={styles.picker} testID="booking.visit_choice">
      <LPText size={13} weight="semibold" color={colors.mutedTextStrong}>
        {t('consent.visit_choice_title')}
      </LPText>
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {choices.map((choice) => {
          const option = options?.find((candidate) => candidate.choice === choice) ?? null;
          const label = t(visitChoiceLabelKey(choice));
          const price = option ? iskPrefix(option.priceIsk) : null;
          const isSelected = choice === selected;
          return (
            <Pressable
              key={choice}
              onPress={() => {
                if (!isSelected) onSelect(choice);
              }}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={price ? `${label}, ${price}` : label}
              accessibilityState={{ checked: isSelected, disabled }}
              style={({ pressed }) => [styles.row, isSelected && styles.selected, pressed && styles.pressed]}
              testID={`booking.visit_choice.${choice}`}
            >
              <LPText size={15} style={styles.label}>
                {label}
              </LPText>
              {price ? (
                <LPText size={15} weight="semibold" style={styles.price}>
                  {price}
                </LPText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** iOS `Color.lpAccent.opacity(0.15)`, from the token. */
function accentWash(opacity: number): string {
  const [r, g, b, a] = parseColor(colors.rust);
  const channel = (value: number) => Math.round(value * 255);
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${+(a * opacity).toFixed(3)})`;
}

const styles = StyleSheet.create({
  picker: {
    gap: 8,
  },
  rows: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.ink2,
  },
  selected: {
    backgroundColor: accentWash(0.15),
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    flex: 1,
  },
  price: {
    // iOS `.monospacedDigit()`: the two prices line up.
    fontVariant: ['tabular-nums'],
  },
});
