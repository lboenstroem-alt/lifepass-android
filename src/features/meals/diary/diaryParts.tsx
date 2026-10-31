/**
 * The pieces of the food diary page (iOS DiaryDayView's sections): the date
 * bar, the day's summary, the drafts waiting for review, a slot with its
 * meals and items, and the footer. Each draws what it is handed; the page
 * (./DiaryScreen.tsx) owns the loading, the writes and the navigation.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { EstimateChip, hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { mealSlotCopyKey, type MealSlot } from '../../../health/models';
import { useT, type Lang } from '../../../i18n';
import { dayEnergy, decimal, integer, kcal, localTime, shortDay, wholeNumberOf } from '../../../i18n/format';
import { colors, hairline, radius } from '../../../theme';
import type { MealOutboxItem } from '../outbox/rules';
import { allDraftsOf, type MealDayRecord, type MealRecord } from '../types/models';
import { draftFromRecord } from '../types/draftFactory';
import type { MealItemDraft } from '../types/draft';

import { draftRowCopyKey, relativeDay, slotKcal, swipeDelta } from './diaryModel';
import { amountLine, itemKcalText } from './itemText';

// ---------------------------------------------------------------------------
// The date bar

export function DateBar({
  date,
  today,
  onStep,
  onPick,
}: {
  date: string;
  today: string;
  onStep: (delta: -1 | 1) => void;
  onPick: () => void;
}) {
  const { t, language } = useT();
  const isToday = date === today;
  const relative = relativeDay(date, today);
  const label = relative === 'today' ? t('diary.today') : relative === 'yesterday' ? t('diary.yesterday') : shortDay(date, language);
  return (
    <View style={styles.dateBar} testID="diary.dateBar">
      <Pressable
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.prev_day')}
        style={({ pressed }) => [styles.chevron, pressed && styles.pressed]}
        testID="diary.prev"
      >
        <Ionicons name="chevron-back" size={18} color={colors.paper} />
      </Pressable>
      <Pressable
        onPress={onPick}
        accessibilityRole="button"
        accessibilityHint={t('meal.header.change_date')}
        style={({ pressed }) => [styles.dateButton, pressed && styles.pressed]}
        testID="diary.date"
      >
        <LPText size={16} weight="semibold" color={colors.paper}>
          {label}
        </LPText>
        <Ionicons name="calendar-outline" size={14} color={colors.paper3} {...hiddenFromAccessibility} />
      </Pressable>
      <Pressable
        onPress={() => onStep(1)}
        disabled={isToday}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.next_day')}
        accessibilityState={{ disabled: isToday }}
        style={({ pressed }) => [styles.chevron, pressed && !isToday && styles.pressed]}
        testID="diary.next"
      >
        <Ionicons name="chevron-forward" size={18} color={isToday ? colors.paper4 : colors.paper} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The summary

/** iOS formats every whole-number value of a status line in the account's number format. */
function formatParams(params: Readonly<Record<string, string>>, lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = /^-?\d+$/.test(value) ? integer(Number(value), lang) : value;
  }
  return out;
}

export function SummaryCard({
  day,
  isEmpty,
  onSwipe,
}: {
  day: MealDayRecord;
  /** No saved meal and none waiting on the phone. */
  isEmpty: boolean;
  onSwipe: (delta: -1 | 1) => void;
}) {
  const { t, language } = useT();
  const totals = day.totals ?? { kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  const energy = dayEnergy(totals, day.target);
  const low = wholeNumberOf(totals.kcalLow);
  const high = wholeNumberOf(totals.kcalHigh);
  const headline =
    low === high
      ? kcal(energy.eatenMidKcal, language)
      : t('plan.nutrition.kcal_range', { low: integer(low, language), high: integer(high, language) });
  const target = day.target;
  const proteinLine = target
    ? t('diary.protein_line', {
        eaten: decimal(totals.proteinG, language, 0),
        target: decimal(target.proteinG, language, 0),
      })
    : null;
  const proteinFill = Math.max(0, Math.min(1, energy.proteinFill ?? 0));

  // THE GESTURE IS BUILT ONCE (see PlanWeekStrip): a Pan rebuilt on a
  // re-render (the read landing) drops the swipe the member is making.
  const latest = useRef(onSwipe);
  useEffect(() => {
    latest.current = onSwipe;
  }, [onSwipe]);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-30, 30])
        .failOffsetY([-30, 30])
        .onEnd((event) => {
          const delta = swipeDelta(event.translationX, event.translationY);
          if (delta !== null) latest.current(delta);
        })
        .withTestId('diary.summary.swipe'),
    [],
  );

  return (
    <GestureDetector gesture={swipe}>
      <View style={[styles.card, styles.summary]} testID="diary.summary">
        <Kicker text={t('diary.summary.kicker')} />
        <View style={styles.headline}>
          <LPText size={28} weight="semibold" color={colors.paper} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {headline}
          </LPText>
          {energy.showsEstimateChip ? <EstimateChip testID="diary.summary.estimate" /> : null}
        </View>
        {target ? (
          <View style={styles.targetRow}>
            <LPText size={13} color={colors.paper} style={styles.shrink}>
              {t('plan.nutrition.target', {
                low: integer(target.kcalLow, language),
                high: integer(target.kcalHigh, language),
                protein: decimal(target.proteinG, language, 0),
              })}
            </LPText>
            <EstimateChip />
          </View>
        ) : day.targetWithheld !== null && day.targetWithheld !== 'unknown' ? (
          <LPText size={13} color={colors.paper2}>
            {t('plan.targets.withheld')}
          </LPText>
        ) : null}
        {energy.status ? (
          // Always neutral: over the range is never red.
          <LPText size={13} color={colors.paper2} testID="diary.summary.status">
            {t(energy.status.key, formatParams(energy.status.params, language))}
          </LPText>
        ) : null}
        {target && proteinLine ? (
          <View style={styles.protein}>
            <View style={styles.bar} accessible accessibilityLabel={proteinLine} testID="diary.summary.protein">
              <View style={[styles.barFill, { width: `${proteinFill * 100}%` }]} />
            </View>
            <LPText size={12} color={colors.paper2} {...hiddenFromAccessibility}>
              {proteinLine}
            </LPText>
          </View>
        ) : null}
        <LPText size={12} color={colors.paper2}>
          {t('diary.carbs_fat_line', {
            carbs: decimal(totals.carbsG, language, 0),
            fat: decimal(totals.fatG, language, 0),
          })}
        </LPText>
        {isEmpty ? (
          <LPText size={13} color={colors.paper2} style={styles.empty}>
            {t('diary.empty')}
          </LPText>
        ) : null}
      </View>
    </GestureDetector>
  );
}

// ---------------------------------------------------------------------------
// Drafts

export function DraftsSection({ day, onOpen }: { day: MealDayRecord; onOpen: (mealId: string) => void }) {
  const { t } = useT();
  const drafts = allDraftsOf(day);
  if (drafts.length === 0) return null;
  return (
    <View style={styles.section} testID="diary.drafts">
      <Kicker text={t('diary.drafts')} color={colors.paper2} accessibilityRole="header" style={styles.sectionKicker} />
      <View style={styles.card}>
        {drafts.map((draft, index) => (
          <Pressable
            key={draft.id}
            onPress={() => onOpen(draft.id)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, index > 0 && styles.divider, pressed && styles.pressed]}
            testID={`diary.draft.${draft.id}`}
          >
            <Ionicons
              name={draft.source === 'text' ? 'chatbubble-ellipses-outline' : 'scan-outline'}
              size={18}
              color={colors.rust}
              {...hiddenFromAccessibility}
            />
            <LPText size={15} color={colors.paper} style={styles.grow}>
              {t(draftRowCopyKey(draft), { time: draft.loggedAt ? localTime(draft.loggedAt) : '' })}
            </LPText>
            <Ionicons name="chevron-forward" size={13} color={colors.paper3} {...hiddenFromAccessibility} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// A slot

export interface SlotSectionProps {
  readonly slot: MealSlot;
  readonly meals: readonly MealRecord[];
  readonly queued: readonly MealOutboxItem[];
  readonly readOnly: boolean;
  readonly canCopy: boolean;
  /** The slot being copied right now, if any (every copy button waits). */
  readonly copying: MealSlot | null;
  readonly onOpenMeal: (mealId: string) => void;
  readonly onOpenItem: (meal: MealRecord, item: MealItemDraft) => void;
  readonly onRemoveItem: (meal: MealRecord, item: MealItemDraft) => void;
  readonly onAdd: () => void;
  readonly onCopy: () => void;
}

export function SlotSection({
  slot,
  meals,
  queued,
  readOnly,
  canCopy,
  copying,
  onOpenMeal,
  onOpenItem,
  onRemoveItem,
  onAdd,
  onCopy,
}: SlotSectionProps) {
  const { t, language } = useT();
  const slotName = t(mealSlotCopyKey(slot));
  const total = slotKcal(meals);
  const rows: ReactNode[] = [];

  for (const meal of meals) {
    const time = meal.loggedAt ? localTime(meal.loggedAt) : '';
    const mealDivided = rows.length > 0;
    rows.push(
      <Pressable
        key={`meal.${meal.id}`}
        onPress={() => onOpenMeal(meal.id)}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.open_meal', { slot: slotName, time })}
        style={({ pressed }) => [styles.timeRow, mealDivided && styles.divider, pressed && styles.pressed]}
        testID={`diary.meal.${meal.id}`}
      >
        <LPText size={10} color={colors.paper2} tracking={1.1} style={styles.mono}>
          {time}
        </LPText>
        <Ionicons name="chevron-forward" size={10} color={colors.paper3} />
      </Pressable>,
    );
    for (const record of meal.items) {
      const item = draftFromRecord(record);
      rows.push(
        <ItemRow
          key={`item.${record.id}`}
          item={item}
          divided={rows.length > 0}
          onOpen={() => onOpenItem(meal, item)}
          onRemove={() => onRemoveItem(meal, item)}
        />,
      );
    }
  }

  for (const entry of queued) {
    entry.body.items.forEach((input, index) => {
      rows.push(
        <View key={`queued.${entry.id}.${index}`} style={[styles.row, rows.length > 0 && styles.divider]} testID={`diary.queued.${entry.id}`}>
          <LPText size={15} color={colors.paper} numberOfLines={1} style={styles.grow}>
            {input.label}
          </LPText>
          <View style={styles.syncChip}>
            <LPText size={10} weight="semibold" color={colors.signal}>
              {t('plan.waiting_sync')}
            </LPText>
          </View>
        </View>,
      );
    });
  }

  if (!readOnly) {
    const addDivided = rows.length > 0;
    rows.push(
      <Pressable
        key="add"
        onPress={onAdd}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, addDivided && styles.divider, pressed && styles.pressed]}
        testID={`diary.add.${slot}`}
      >
        <Ionicons name="add-circle-outline" size={16} color={colors.accentText} {...hiddenFromAccessibility} />
        <LPText size={14} weight="semibold" color={colors.accentText}>
          {t('diary.add_food')}
        </LPText>
      </Pressable>,
    );
    if (canCopy) {
      const busy = copying === slot;
      rows.push(
        <Pressable
          key="copy"
          onPress={onCopy}
          disabled={copying !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: copying !== null, busy }}
          style={({ pressed }) => [styles.action, styles.divider, pressed && copying === null && styles.pressed]}
          testID={`diary.copy.${slot}`}
        >
          {busy ? <ActivityIndicator size="small" color={colors.paper2} /> : null}
          <Ionicons name="copy-outline" size={15} color={colors.accentText} {...hiddenFromAccessibility} />
          <LPText size={14} weight="semibold" color={colors.accentText}>
            {t('diary.copy_yesterday')}
          </LPText>
        </Pressable>,
      );
    }
  }

  return (
    <View style={styles.section} testID={`diary.slot.${slot}`}>
      <View style={styles.slotHeader} accessible accessibilityRole="header">
        <LPText size={15} weight="semibold" color={colors.paper} style={styles.grow}>
          {slotName}
        </LPText>
        {total > 0 ? (
          <LPText size={13} weight="semibold" color={colors.paper2} testID={`diary.slot.${slot}.kcal`}>
            {kcal(total, language)}
          </LPText>
        ) : null}
      </View>
      {rows.length > 0 ? <View style={styles.card}>{rows}</View> : null}
    </View>
  );
}

/** One item: tap opens the editor; swipe (or the TalkBack action) deletes. */
function ItemRow({ item, divided, onOpen, onRemove }: { item: MealItemDraft; divided: boolean; onOpen: () => void; onRemove: () => void }) {
  const { t, language } = useT();
  const swipeable = useRef<SwipeableMethods | null>(null);
  const deleteLabel = t('common.delete');
  const amount = amountLine(item, language, t);
  const energy = itemKcalText(item, language);
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={divided ? styles.divider : undefined}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            swipeable.current?.close();
            onRemove();
          }}
          accessibilityRole="button"
          style={styles.deleteAction}
          testID={`diary.item.${item.storedId}.delete`}
        >
          <LPText size={14} weight="semibold" color={colors.onAccent}>
            {deleteLabel}
          </LPText>
        </Pressable>
      )}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${item.label}, ${amount}, ${energy}`}
        accessibilityActions={[{ name: 'delete', label: deleteLabel }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onRemove();
        }}
        style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
        testID={`diary.item.${item.storedId}`}
      >
        <View style={styles.grow}>
          <LPText size={15} color={colors.paper} numberOfLines={2}>
            {item.label}
          </LPText>
          <LPText size={12} color={colors.paper2}>
            {amount}
          </LPText>
        </View>
        <LPText size={14} weight="semibold" color={colors.paper} align="right">
          {energy}
        </LPText>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

// ---------------------------------------------------------------------------
// Footer

export function DiaryFooter() {
  const { t } = useT();
  return (
    <View style={styles.footer}>
      <LPText size={11} color={colors.paper2}>
        {t('meal.estimate.accuracy')}
      </LPText>
      <LPText size={11} color={colors.paper2}>
        {t('food.credits_line')}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  dateBar: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 8, gap: 4 },
  chevron: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dateButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pressed: { opacity: 0.7 },
  card: {
    marginHorizontal: 16,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  summary: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  protein: { gap: 6 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.ink3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.rust },
  empty: { paddingTop: 4 },
  section: { gap: 8 },
  sectionKicker: { marginHorizontal: 20 },
  slotHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, minHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 16, paddingVertical: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 16, paddingVertical: 6 },
  mono: { fontFamily: 'monospace' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.ink2,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  grow: { flex: 1 },
  syncChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.rust3 },
  deleteAction: { width: 88, backgroundColor: colors.destructive, alignItems: 'center', justifyContent: 'center' },
  footer: { gap: 8, marginHorizontal: 20 },
});
