/**
 * The amount pill of a photo or description item (iOS R5, `amountPill` and
 * `multiplierPopover` in MealEditorView.swift): the grams, and a small card
 * of multiplier chips that change the amount in one tap, plus "Exact amount"
 * for the item editor.
 *
 * iOS draws a popover anchored to the pill. Android has none, so this is a
 * transparent modal with the card placed under the pill (or above it when
 * there is no room). A tap outside or back closes it without a change.
 *
 * The card is placed by its MEASURED height: at a larger font scale (or
 * with a wider "1,25x") the chips wrap onto a second row, and a card placed
 * by a fixed height would run off the screen or cover the pill. Until both
 * the pill's position and the card's height are known, the card is
 * invisible and takes no touch.
 */
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { LPText } from '../../../components/ui';
import { HealthFormat, useT } from '../../../i18n';
import { colors, hairline, minTouch, radius } from '../../../theme';
import { gramsFor, MULTIPLIERS } from '../math/itemMath';
import type { MealItemDraft } from '../types/draft';

import { multiplierLabel } from '../itemEditor/itemEditorRules';

export interface AmountPillProps {
  readonly item: MealItemDraft;
  /** A multiplier was picked: `factor` times the amount on screen. */
  readonly onMultiply: (factor: number) => void;
  /** "Exact amount": the item editor. */
  readonly onExact: () => void;
  readonly testID?: string;
}

type Anchor = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** Room for the six chips on one row at the default text size; they wrap past that. */
const CARD_WIDTH = 6 * minTouch + 5 * 8 + 24;
const EDGE = 12;
const GAP = 4;

/**
 * Where the card goes for a pill at `anchor`: under it when the card fits
 * there, else above it, else as low as the screen allows. Exported for tests.
 */
export function cardPlacement(
  anchor: Anchor,
  card: { readonly width: number; readonly height: number },
  window: { readonly width: number; readonly height: number },
): { readonly top: number; readonly left: number } {
  const below = anchor.y + anchor.height + GAP;
  const above = anchor.y - GAP - card.height;
  let top: number;
  if (below + card.height <= window.height - EDGE) top = below;
  else if (above >= EDGE) top = above;
  else top = Math.max(EDGE, window.height - EDGE - card.height);
  const left = Math.min(Math.max(EDGE, anchor.x + anchor.width - card.width), window.width - EDGE - card.width);
  return { top, left };
}

export default function AmountPill({ item, onMultiply, onExact, testID = 'amountPill' }: AmountPillProps) {
  const { t, language } = useT();
  const pill = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const window = useWindowDimensions();
  const grams = gramsFor(item.serving, item.amount) ?? item.amount;

  const show = (): void => {
    setOpen(true);
    pill.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };
  const close = (): void => {
    setOpen(false);
    setAnchor(null);
    setCardHeight(null);
  };
  const onCardLayout = (event: LayoutChangeEvent): void => {
    const height = event.nativeEvent.layout.height;
    setCardHeight((previous) => (previous === height ? previous : height));
  };

  const width = Math.min(CARD_WIDTH, window.width - 2 * EDGE);
  const placed = anchor !== null && cardHeight !== null;
  const { top, left } = placed ? cardPlacement(anchor, { width, height: cardHeight }, window) : { top: 0, left: EDGE };

  return (
    <>
      <Pressable
        ref={pill}
        onPress={show}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.pillTouch}
        testID={testID}
      >
        <View style={styles.pill}>
          <LPText size={13} weight="semibold" color={colors.rust}>
            {HealthFormat.grams(grams, language, item.liquid)}
          </LPText>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} testID={`${testID}.outside`} />
        <View
          style={[styles.card, { top, left, width, opacity: placed ? 1 : 0 }]}
          onLayout={onCardLayout}
          pointerEvents={placed ? 'auto' : 'none'}
          importantForAccessibility={placed ? 'auto' : 'no-hide-descendants'}
          accessibilityViewIsModal
          testID={`${testID}.popover`}
        >
          <View style={styles.chips}>
            {MULTIPLIERS.map((factor) => (
              <Pressable
                key={factor}
                onPress={() => {
                  close();
                  onMultiply(factor);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.portion_times', { value: HealthFormat.decimal(factor, language, 2) })}
                style={styles.chip}
                testID={`${testID}.multiplier.${factor}`}
              >
                <LPText size={13} weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {multiplierLabel(factor, language)}
                </LPText>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => {
              close();
              onExact();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('meal.item.exact')}
            style={styles.exact}
            testID={`${testID}.exact`}
          >
            <LPText size={13} weight="semibold" color={colors.rust}>
              {t('meal.item.exact')}
            </LPText>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pillTouch: { minHeight: minTouch, justifyContent: 'center' },
  pill: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.rust3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    padding: 12,
    gap: 10,
    borderRadius: radius.field,
    backgroundColor: colors.ink,
    borderWidth: hairline,
    borderColor: colors.line,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minWidth: minTouch,
    minHeight: minTouch,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exact: { minHeight: minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
});
