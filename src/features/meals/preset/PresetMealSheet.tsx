/**
 * A preset meal (iOS `PresetMealSheet`, ios-ux.md 15.3): its name, the
 * ingredients with their amounts and calories, and a servings stepper (0.5
 * to 4 in halves) pinned with "Add to meal", so the one control that changes
 * every amount stays in view however long the list is.
 *
 * Each ingredient goes in at its recipe grams times the servings, rounded,
 * at least 1 g, counted from the food table (basis database); the meal-level
 * source is `preset`.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent, type Text } from 'react-native';

import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { decimal, kcal as kcalText } from '../../../i18n/format';
import { haptics } from '../../../lib/haptics';
import { colors, hairline, radius } from '../../../theme';
import { amountLine } from '../capture/mealText';
import { displayedItem } from '../math/itemMath';
import type { MealItemDraft } from '../types/draft';
import { draftFromIngredient } from '../types/draftFactory';
import type { PresetMeal } from '../types/models';

export const SERVINGS_MIN = 0.5;
export const SERVINGS_MAX = 4;
export const SERVINGS_STEP = 0.5;

/** One step up or down, inside 0.5 to 4. */
export function stepServings(servings: number, direction: 1 | -1): number {
  return Math.min(SERVINGS_MAX, Math.max(SERVINGS_MIN, servings + direction * SERVINGS_STEP));
}

/** The items the meal adds at `servings`. */
export function presetItems(meal: PresetMeal, servings: number): MealItemDraft[] {
  return meal.ingredients.map((ingredient) => draftFromIngredient(ingredient, servings));
}

export interface PresetMealSheetProps {
  readonly visible: boolean;
  /** The meal on screen; kept by the caller while the sheet slides away. */
  readonly meal: PresetMeal | null;
  readonly onAdd: (items: MealItemDraft[]) => void;
  readonly onClose: () => void;
}

export default function PresetMealSheet(props: PresetMealSheetProps) {
  // Each opening starts at 1 serving (iOS makes new @State per sheet).
  const [presentation, setPresentation] = useState(0);
  const wasVisible = useRef(props.visible);
  useEffect(() => {
    if (props.visible && !wasVisible.current) setPresentation((n) => n + 1);
    wasVisible.current = props.visible;
  }, [props.visible]);
  if (!props.meal) return null;
  return <PresetMealContent key={presentation} {...props} meal={props.meal} />;
}

function PresetMealContent({ visible, meal, onAdd, onClose }: PresetMealSheetProps & { readonly meal: PresetMeal }) {
  const { t, language } = useT();
  const [servings, setServings] = useState(1);
  const titleRef = useRef<Text>(null);
  const items = presetItems(meal, servings);
  const servingsText = decimal(servings, language, 1);

  const step = (direction: 1 | -1) => {
    const next = stepServings(servings, direction);
    if (next === servings) return;
    haptics.selection();
    setServings(next);
  };

  const footer = (
    <View style={styles.footer}>
      <View style={styles.servings}>
        <LPText size={15} color={colors.paper} style={styles.grow}>
          {t('food.meal.servings')}
        </LPText>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('food.meal.servings')}
          accessibilityValue={{ text: servingsText }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event: AccessibilityActionEvent) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
          style={styles.stepper}
          testID="preset.servings"
        >
          <LPText size={17} weight="semibold" color={colors.paper} align="right" style={styles.servingsValue} testID="preset.servings.value">
            {servingsText}
          </LPText>
          <StepButton icon="remove" disabled={servings <= SERVINGS_MIN} onPress={() => step(-1)} testID="preset.servings.down" />
          <StepButton icon="add" disabled={servings >= SERVINGS_MAX} onPress={() => step(1)} testID="preset.servings.up" />
        </View>
      </View>
      <PrimaryButton
        title={t('food.meal.add_all')}
        onPress={() => {
          onAdd(presetItems(meal, servings));
          onClose();
        }}
        testID="preset.add"
      />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoints={['55%', '92%']} initialFocusRef={titleRef} footer={footer} testID="preset.sheet">
      <View style={styles.page}>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel} hitSlop={6}>
          <LPText size={15} color={colors.accentText}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header">
          {meal.name}
        </LPText>
        <View style={styles.card}>
          {meal.ingredients.map((ingredient, index) => {
            const item = items[index];
            if (!item) return null;
            return (
              <View key={`${ingredient.foodId}-${index}`} style={[styles.ingredient, index > 0 && styles.divided]} testID={`preset.ingredient.${index}`}>
                <View style={styles.grow}>
                  <LPText size={15} color={colors.paper}>
                    {ingredient.label}
                  </LPText>
                  <LPText size={12} color={colors.paper2}>
                    {amountLine(item, language, t)}
                  </LPText>
                </View>
                <LPText size={14} weight="semibold" color={colors.paper}>
                  {kcalText(displayedItem(item).kcalLow, language)}
                </LPText>
              </View>
            );
          })}
        </View>
      </View>
    </Sheet>
  );
}

function StepButton({
  icon,
  disabled,
  onPress,
  testID,
}: {
  readonly icon: 'add' | 'remove';
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.step, disabled && styles.stepDisabled, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={colors.paper} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16, paddingBottom: 12 },
  cancel: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  card: { backgroundColor: colors.ink2, borderRadius: radius.card, borderWidth: hairline, borderColor: colors.line, overflow: 'hidden' },
  ingredient: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: hairline, borderTopColor: colors.line },
  grow: { flex: 1 },
  footer: { gap: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8, backgroundColor: colors.ink },
  servings: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  servingsValue: { minWidth: 40 },
  step: {
    width: 44,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
