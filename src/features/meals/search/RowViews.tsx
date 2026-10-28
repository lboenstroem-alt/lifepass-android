/**
 * The rows of Search mode (iOS `FoodSearchMode` foodRow, recentMealRow,
 * presetMealRow, sectionHeader, emptyLine, errorRow, skeletonRows, the
 * quick buttons and "Describe it instead").
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { Kicker, LPText, SkeletonBlock } from '../../../components/ui';
import { useT } from '../../../i18n';
import { integer, roundHalfAwayFromZero } from '../../../i18n/format';
import { mealSlotCopyKey } from '../../../health/models';
import { colors, hairline } from '../../../theme';
import { amountLine, sourceWord } from '../capture/mealText';
import { draftFromChoice } from '../types/draftFactory';
import type { FoodChoice, PresetMeal, RecentMeal } from '../types/models';

import { rowKcal, showsSourceWord, type RowOrigin } from './searchRules';

/** A food: tap opens the item editor, the plus adds the usual portion. */
export function FoodRow({
  choice,
  from,
  onOpen,
  onAdd,
  onRemove,
}: {
  readonly choice: FoodChoice;
  readonly from: RowOrigin;
  readonly onOpen: () => void;
  readonly onAdd: () => void;
  /** My foods: "Remove from My foods" as an accessibility action. */
  readonly onRemove?: () => void;
}) {
  const { t, language } = useT();
  const item = draftFromChoice(choice);
  const kcal = rowKcal(choice, item);
  const portion = amountLine(item, language, t);
  const detail = t('food.row.detail', { portion, kcal: integer(kcal, language) });
  const word = showsSourceWord(choice, from) ? sourceWord(choice.source, t) : null;
  const line = [detail, word, choice.brand].filter((part): part is string => part !== null).join(' · ');
  const label = [choice.label, portion, `${kcal} ${t('a11y.kilocalories')}`, word, choice.brand]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  const removeLabel = t('food.mine.remove');

  return (
    <View style={styles.row} testID={`food.row.${choice.key}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={onRemove ? [{ name: 'remove', label: removeLabel }] : undefined}
        onAccessibilityAction={(event: AccessibilityActionEvent) => {
          if (event.nativeEvent.actionName === 'remove') onRemove?.();
        }}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        testID={`food.open.${choice.key}`}
      >
        <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={1}>
          {choice.label}
        </LPText>
        <LPText size={12} color={colors.paper2} numberOfLines={1}>
          {line}
        </LPText>
      </Pressable>
      <AddButton label={t('a11y.add_food', { name: choice.label })} onPress={onAdd} testID={`food.add.${choice.key}`} />
    </View>
  );
}

/** A meal the member logged recently: the plus adds every item. */
export function RecentMealRow({ meal, onAdd }: { readonly meal: RecentMeal; readonly onAdd: () => void }) {
  const { t, tp, language } = useT();
  const names = meal.items.map((food) => food.label).join(', ');
  const detail = tp('food.recent_meal.detail', meal.itemCount, {
    count: String(meal.itemCount),
    kcal: integer(roundHalfAwayFromZero(meal.kcal), language),
  });
  return (
    <View style={styles.row} testID={`food.recentMeal.${meal.key}`}>
      <View style={[styles.rowMain, styles.recentMeal]}>
        <Kicker text={t(mealSlotCopyKey(meal.slot))} />
        <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={1}>
          {names}
        </LPText>
        <LPText size={12} color={colors.paper2}>
          {detail}
        </LPText>
      </View>
      <AddButton label={t('a11y.add_food', { name: names })} onPress={onAdd} testID={`food.addMeal.${meal.key}`} />
    </View>
  );
}

/** A preset meal: opens the preset sheet. */
export function PresetMealRow({ meal, onOpen }: { readonly meal: PresetMeal; readonly onOpen: () => void }) {
  const { t, language } = useT();
  const detail = t('food.meal.detail', {
    count: String(meal.ingredients.length),
    kcal: integer(roundHalfAwayFromZero(meal.perServing?.kcal ?? 0), language),
  });
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${meal.name}, ${detail}`}
      style={({ pressed }) => [styles.row, styles.presetRow, pressed && styles.pressed]}
      testID={`food.preset.${meal.id}`}
    >
      <View style={styles.rowMain}>
        <LPText size={15} weight="semibold" color={colors.paper} numberOfLines={1}>
          {meal.name}
        </LPText>
        <LPText size={12} color={colors.paper2} numberOfLines={1}>
          {detail}
        </LPText>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.paper3} style={styles.chevron} />
    </Pressable>
  );
}

function AddButton({ label, onPress, testID }: { readonly label: string; readonly onPress: () => void; readonly testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={2}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name="add-circle" size={28} color={colors.rust} />
    </Pressable>
  );
}

/** A section's kicker, with "See all" when there is more. */
export function SectionHeader({ title, onSeeAll, testID }: { readonly title: string; readonly onSeeAll?: () => void; readonly testID?: string }) {
  const { t } = useT();
  return (
    <View style={styles.header} testID={testID}>
      <Kicker text={title} color={colors.paper2} accessibilityRole="header" style={styles.grow} />
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} accessibilityRole="button" style={styles.seeAll} hitSlop={4}>
          <LPText size={12} weight="semibold" color={colors.accentText}>
            {t('common.see_all')}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A line of explanation in place of a list. */
export function EmptyLine({ text, testID }: { readonly text: string; readonly testID?: string }) {
  return (
    <LPText size={14} color={colors.paper2} style={styles.empty} testID={testID}>
      {text}
    </LPText>
  );
}

/** Something failed: the words and Try again. */
export function ErrorRow({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.error} testID="food.error">
      <LPText size={14} color={colors.paper2}>
        {t('common.error_body')}
      </LPText>
      <RetryButton onPress={onRetry} />
    </View>
  );
}

export function RetryButton({ onPress }: { readonly onPress: () => void }) {
  const { t } = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.retry} testID="food.retry">
      <LPText size={14} weight="semibold" color={colors.accentText}>
        {t('health.retry')}
      </LPText>
    </Pressable>
  );
}

/** Six rows of placeholder while nothing is known yet. */
export function SkeletonRows() {
  return (
    <View testID="food.skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.skeleton}>
          <SkeletonBlock height={13} width={170} radius={4} />
          <SkeletonBlock height={10} width={110} radius={4} />
        </View>
      ))}
    </View>
  );
}

/** One of the quick buttons: Describe a meal, Quick add calories, Create my food. */
export function QuickButton({
  icon,
  title,
  onPress,
  testID,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={16} color={colors.rust} />
      <LPText size={13} weight="semibold" color={colors.paper} numberOfLines={2} style={styles.grow}>
        {title}
      </LPText>
    </Pressable>
  );
}

/** "Describe it instead": the one primary action of a search that found nothing (or only part). */
export function DescribeInsteadButton({ title, onPress }: { readonly title: string; readonly onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.describe, pressed && styles.pressed]}
      testID="food.describe_instead"
    >
      <Ionicons name="chatbox-ellipses-outline" size={15} color={colors.onAccent} />
      <LPText size={15} weight="semibold" color={colors.onAccent}>
        {title}
      </LPText>
    </Pressable>
  );
}

/** A row with the page's side insets (the List's row insets on iOS). */
export function Inset({ children, style }: { readonly children: ReactNode; readonly style?: object }) {
  return <View style={[styles.inset, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 20,
    paddingRight: 12,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
    backgroundColor: colors.ink,
  },
  rowMain: { flex: 1, minHeight: 56, justifyContent: 'center', gap: 3 },
  recentMeal: { paddingVertical: 8 },
  presetRow: { paddingRight: 16 },
  chevron: { width: 32, textAlign: 'center' },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 20, paddingTop: 6 },
  grow: { flex: 1 },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  empty: { paddingHorizontal: 20, paddingVertical: 12 },
  error: { paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  skeleton: { minHeight: 56, justifyContent: 'center', gap: 6, paddingHorizontal: 20 },
  quick: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  describe: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: colors.actionFill,
  },
  inset: { paddingHorizontal: 20, paddingVertical: 4 },
});
