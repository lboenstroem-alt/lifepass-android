/**
 * Route `Diary`: the food diary for one day (`ios-ux.md` 17), the Android
 * port of iOS `DiaryDayView` (Views/Meals/DiaryDayView.swift). What was
 * eaten, by meal slot, against the day's target, with add, edit and delete
 * in place. Its rules are in ./diaryModel.ts.
 *
 * Top to bottom, as iOS draws it:
 *   the top bar ("Food diary", back, busy while a shown day re-reads)
 *   the date bar: previous, "Today" / "Yesterday" / a short date with the
 *     calendar (a year back), next (off on today)
 *   the offline banner, when today is the cached Today read
 *   the summary (swipe it left or right for another day)
 *   "Waiting for review": photo and description drafts, once each
 *   a section per slot: its meals and items, the meals waiting on the phone,
 *     Add food, Copy from yesterday
 *   the accuracy note and the food data credits
 *
 * LOADING. Each day is read once (OP-33) and kept in memory while the page
 * is up; pull to refresh, and every return to the page (from the meal page
 * or an editor), reads the day again. A forced read of today also reloads
 * Plan's Today read (Home and Plan show the same day) and reads yesterday
 * for Copy. Offline, today falls back to the cached Today read with the
 * offline banner, another day says "This needs a connection."; any other
 * failure says so with Try again.
 *
 * READ ONLY without the membership (past due, lapsed with consent): history
 * can be read and items deleted, nothing new is added or copied.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isApiError, isCancellation, isOffline, isProblem, newIdempotencyKey } from '../../../api';
import { Dialog, LPText, showToast, SkeletonCard, StatusBanner, TopBar } from '../../../components/ui';
import { presentMealGate, useHealthStore } from '../../../health';
import type { MealSlot } from '../../../health/models';
import { translate, useT } from '../../../i18n';
import { addServerDays, localTime, todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import type { SharedRouteProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { mealApi } from '../api/mealApi';
import { usePendingMeals } from '../outbox/mealOutbox';
import type { MealItemDraft } from '../types/draft';
import type { MealDayRecord, MealRecord } from '../types/models';

import DiaryDateSheet from './DiaryDateSheet';
import {
  cachedTodayDay,
  canCopyYesterday,
  clampToToday,
  DIARY_SLOTS,
  itemRemoval,
  queuedInSlot,
  slotMeals,
  stepDay,
  undoRemovalBody,
  yesterdaySources,
} from './diaryModel';
import { DateBar, DiaryFooter, DraftsSection, SlotSection, SummaryCard } from './diaryParts';
import { showMealSavedToast } from './savedToast';
import { openStoredItemEditor } from './storedItemEditor';

/** iOS leaves 120 pt under the list; the tab bar floats over it. */
const BOTTOM_ROOM = 40;

export default function DiaryScreen({ route, navigation }: SharedRouteProps<'Diary'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const today = todayServerDay();

  const [date, setDate] = useState(() => clampToToday(route.params.date, todayServerDay()));
  const [days, setDays] = useState<Readonly<Record<string, MealDayRecord>>>({});
  const [yesterday, setYesterday] = useState<MealDayRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [showingCache, setShowingCache] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deleting, setDeleting] = useState<MealRecord | null>(null);
  const [copying, setCopying] = useState<MealSlot | null>(null);

  const healthAccess = useAppStore((s) => s.healthAccess);
  const cachedAt = useHealthStore((s) => s.cachedAt);
  const pending = usePendingMeals(date);
  const day = days[date] ?? null;
  const isToday = date === today;
  // Past due or lapsed with consent: history is readable and deletable, nothing new is added.
  const readOnly = healthAccess !== 'entitled';

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const daysRef = useRef(days);
  daysRef.current = days;
  const dateRef = useRef(date);
  dateRef.current = date;

  // ---- Loading (17.5)

  const loadYesterday = useCallback(async () => {
    const previous = addServerDays(todayServerDay(), -1);
    if (!previous) return;
    try {
      const read = await mealApi().mealDay(previous, language);
      if (mounted.current) setYesterday(read);
    } catch {
      if (mounted.current) setYesterday(null);
    }
  }, [language]);

  const load = useCallback(
    async (wanted: string, force: boolean) => {
      if (!force && daysRef.current[wanted]) return;
      setLoading(true);
      try {
        const fresh = await mealApi().mealDay(wanted, language);
        if (!mounted.current) return;
        setDays((current) => ({ ...current, [wanted]: fresh }));
        setFailedKey(null);
        setShowingCache(false);
        const todayNow = todayServerDay();
        // The Home row and Plan read the same day.
        if (wanted === todayNow && force) await useHealthStore.getState().load({ force: true });
        if (wanted === todayNow) await loadYesterday();
      } catch (error) {
        if (!mounted.current || isCancellation(error)) return;
        const cached = wanted === todayServerDay() ? cachedTodayDay(useHealthStore.getState().today?.meals, wanted) : null;
        if (isOffline(error) && cached) {
          setDays((current) => ({ ...current, [wanted]: cached }));
          setShowingCache(true);
        } else if (isOffline(error)) {
          setFailedKey('health.offline.action_hint');
        } else {
          if (isApiError(error)) useHealthStore.getState().handle(error, { foreground: true });
          setFailedKey('common.error_body');
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [language, loadYesterday],
  );

  const reload = useCallback(() => load(dateRef.current, true), [load]);

  // Each day the bar lands on is read once (iOS `.task(id: date)`).
  useEffect(() => {
    void load(date, false);
  }, [date, load]);

  // Every appearance: counted, and back from the meal page or an editor the day is read again.
  useFocusEffect(
    useCallback(() => {
      const current = dateRef.current;
      track('diary_viewed', { relative: current === todayServerDay() ? 'today' : 'past' });
      if (daysRef.current[current]) void load(current, true);
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(dateRef.current, true);
    if (mounted.current) setRefreshing(false);
  }, [load]);

  // ---- The date bar (17.3 item 2)

  const change = useCallback((value: string) => {
    const now = todayServerDay();
    if (value === dateRef.current) return;
    setDate(clampToToday(value, now));
    track('diary_day_changed');
  }, []);

  const step = useCallback(
    (delta: -1 | 1) => {
      const next = stepDay(dateRef.current, delta, todayServerDay());
      if (next) change(next);
    },
    [change],
  );

  // ---- Opening things

  /** The meal editor goes on this tab's own stack (iOS: Plan's), so the tab can pop it. */
  const openMeal = useCallback(
    (mealId: string) => {
      navigation.push('MealEditor', { mode: 'stored', mealId });
    },
    [navigation],
  );

  const openItem = useCallback(
    (meal: MealRecord, item: MealItemDraft) => {
      const opened = openStoredItemEditor({
        meal,
        item,
        offBarcode: item.source === 'off' ? item.barcode : null,
        onCommitted: () => void reload(),
        onDeleted: () => void reload(),
      });
      // No item editor in this build: the meal editor edits every item.
      if (!opened) openMeal(meal.id);
    },
    [openMeal, reload],
  );

  const addFood = useCallback(
    (slot: MealSlot) => {
      track('diary_add_tapped');
      if (slot === 'unknown') return;
      navigation.navigate('MealCapture', { origin: 'diary', mode: 'search', slot, date: dateRef.current });
    },
    [navigation],
  );

  // ---- Copy from yesterday (R7)

  const copyYesterday = useCallback(
    async (slot: MealSlot) => {
      if (!yesterday) return;
      setCopying(slot);
      const target = todayServerDay();
      let last: MealRecord | null = null;
      for (const meal of yesterdaySources(yesterday, slot)) {
        try {
          const written = await mealApi().copyMeal(meal.id, { logDate: target, loggedAt: new Date(), slot }, newIdempotencyKey());
          last = written.meal;
        } catch (error) {
          if (isOffline(error)) {
            showToast(t('health.offline.action_hint'), { kind: 'meal' });
          } else if (isApiError(error)) {
            if (useHealthStore.getState().handle(error, { foreground: true }) === 'gate') {
              presentMealGate(useAppStore.getState().healthAccess);
            } else {
              showToast(t('common.error_body'), { kind: 'meal' });
            }
          }
          break;
        }
      }
      track('diary_copy_yesterday');
      await load(dateRef.current, true);
      if (last) await showMealSavedToast(last, language, change);
      if (mounted.current) setCopying(null);
    },
    [change, language, load, t, yesterday],
  );

  // ---- Deleting (17.3)

  const deleteMeal = useCallback(
    async (meal: MealRecord) => {
      try {
        await mealApi().deleteMeal(meal.id);
        track('meal_deleted');
      } catch {
        showToast(t('common.error_body'), { kind: 'meal' });
      }
      await reload();
    },
    [reload, t],
  );

  const removeItem = useCallback(
    async (meal: MealRecord, item: MealItemDraft) => {
      const removal = itemRemoval(meal, item);
      if (removal.kind === 'confirmDelete') {
        setDeleting(meal);
        return;
      }
      try {
        const result = await mealApi().patchMeal(meal.id, removal.body, newIdempotencyKey());
        track('meal_item_deleted');
        await reload();
        if (!removal.undoable || !mounted.current) return;
        const updated = result.meal;
        showToast(translate('food.editor.removed', language), {
          kind: 'meal',
          action: {
            label: translate('plan.undo', language),
            onPress: () => {
              void (async () => {
                try {
                  await mealApi().patchMeal(updated.id, undoRemovalBody(removal.all, item, updated), newIdempotencyKey());
                } catch {
                  // iOS `try?`: the read below shows what the server has.
                }
                track('meal_update_undone');
                await reload();
              })();
            },
          },
        });
      } catch (error) {
        if (isProblem(error, 'meal_changed')) {
          showToast(t('health.err.changed'), { kind: 'meal' });
        } else if (isOffline(error)) {
          showToast(t('health.offline.action_hint'), { kind: 'meal' });
        } else if (isApiError(error)) {
          useHealthStore.getState().handle(error, { foreground: true });
        }
        await reload();
      }
    },
    [language, reload, t],
  );

  // ---- The page

  return (
    <View style={styles.page} testID="diary.screen">
      <TopBar title={t('diary.title')} onBack={() => navigation.goBack()} busy={loading && day !== null} testID="diary.bar" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: BOTTOM_ROOM + tabBarHeight }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[colors.rust]} tintColor={colors.rust} />}
        testID="diary.scroll"
      >
        <DateBar date={date} today={today} onStep={step} onPick={() => setShowDatePicker(true)} />

        {showingCache ? (
          <StatusBanner
            icon="cloud-offline-outline"
            message={t('health.offline.banner', { time: cachedAt ? localTime(cachedAt) : '' })}
            testID="diary.offline"
          />
        ) : null}

        {day ? (
          <>
            <SummaryCard day={day} isEmpty={day.meals.length === 0 && pending.length === 0} onSwipe={step} />
            <DraftsSection day={day} onOpen={openMeal} />
            {DIARY_SLOTS.map((slot) => {
              const meals = slotMeals(day, slot);
              return (
                <SlotSection
                  key={slot}
                  slot={slot}
                  meals={meals}
                  queued={queuedInSlot(pending, slot)}
                  readOnly={readOnly}
                  canCopy={canCopyYesterday(slot, { isToday, meals, showingCache, yesterday, pending })}
                  copying={copying}
                  onOpenMeal={openMeal}
                  onOpenItem={openItem}
                  onRemoveItem={(meal, item) => void removeItem(meal, item)}
                  onAdd={() => addFood(slot)}
                  onCopy={() => void copyYesterday(slot)}
                />
              );
            })}
            <DiaryFooter />
          </>
        ) : failedKey ? (
          <View style={styles.failed} testID="diary.failed">
            <LPText size={15} color={colors.paper2} align="center">
              {t(failedKey)}
            </LPText>
            <LPText
              size={14}
              weight="semibold"
              color={colors.accentText}
              accessibilityRole="button"
              onPress={() => void reload()}
              style={styles.retry}
              testID="diary.retry"
            >
              {t('health.retry')}
            </LPText>
          </View>
        ) : (
          <View style={styles.skeletons} testID="diary.loading">
            <SkeletonCard rows={2} showsHeader={false} />
            <SkeletonCard rows={3} showsHeader={false} />
          </View>
        )}
      </ScrollView>

      <DiaryDateSheet
        visible={showDatePicker}
        date={date}
        today={today}
        onPick={(picked) => {
          setShowDatePicker(false);
          change(picked);
        }}
        onClose={() => setShowDatePicker(false)}
      />

      <Dialog
        visible={deleting !== null}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.delete.title')}
        message={t('meal.delete.body')}
        buttons={[
          {
            label: t('meal.delete.confirm'),
            role: 'destructive',
            onPress: () => {
              const meal = deleting;
              if (meal) void deleteMeal(meal);
            },
            testID: 'diary.deleteMeal.confirm',
          },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
        onClose={() => setDeleting(null)}
        testID="diary.deleteMeal"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 4, gap: 16 },
  failed: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 24 },
  retry: { minHeight: 44, textAlignVertical: 'center' },
  skeletons: { gap: 16, paddingHorizontal: 16 },
});
