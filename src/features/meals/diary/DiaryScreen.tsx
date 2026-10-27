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
 * ONE DAY'S READ NEVER SPEAKS FOR ANOTHER. iOS reads in `.task(id: date)`,
 * which cancels the read of a day the member has left. Here a read for a day
 * no longer on screen still lands (its day is kept), but its busy state, its
 * failure line and the offline flag belong to its own day: a slow read of
 * yesterday can never take today's offline banner away (and with it the
 * rule that the offline copy offers no Copy from yesterday).
 *
 * A NEW DATE FROM THE ROUTE. iOS pushes a new diary for every "Food diary"
 * link. React Navigation's `navigate` to a Diary already on top gives it new
 * params instead, so the page follows them: the new day is shown and read
 * again, as a fresh page would be.
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
import type { HealthAccess, MealSlot } from '../../../health/models';
import { MealGateSheet } from '../../../health/ui';
import { translate, useT } from '../../../i18n';
import { addServerDays, localTime, todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import type { SharedRouteProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { mealApi } from '../api/mealApi';
import { usePendingMeals } from '../outbox/mealOutbox';
import type { MealItemDraft } from '../types/draft';
import { draftFromRecord } from '../types/draftFactory';
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

/** What a read of one day came to. */
type LoadOutcome = 'kept' | 'fresh' | 'cached' | 'failed';

/** `record` without `key` (the same object when it has none). */
function without<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export default function DiaryScreen({ route, navigation }: SharedRouteProps<'Diary'>) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const today = todayServerDay();

  const [date, setDate] = useState(() => clampToToday(route.params.date, todayServerDay()));
  const [days, setDays] = useState<Readonly<Record<string, MealDayRecord>>>({});
  const [yesterday, setYesterday] = useState<MealDayRecord | null>(null);
  // Per day (see ONE DAY'S READ above): reads in flight, the failure line,
  // and which day is the offline copy of the Today read (only ever today).
  const [inFlight, setInFlight] = useState<Readonly<Record<string, number>>>({});
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({});
  const [cachedDay, setCachedDay] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deleting, setDeleting] = useState<MealRecord | null>(null);
  const [copying, setCopying] = useState<MealSlot | null>(null);
  // The membership gate this page draws itself when no app-wide host can
  // (kept, with its access, while it slides away).
  const [localGate, setLocalGate] = useState<{ readonly access: HealthAccess; readonly visible: boolean } | null>(null);

  const healthAccess = useAppStore((s) => s.healthAccess);
  const cachedAt = useHealthStore((s) => s.cachedAt);
  const pending = usePendingMeals(date);
  const day = days[date] ?? null;
  const isToday = date === today;
  const loading = (inFlight[date] ?? 0) > 0;
  const failedKey = failures[date] ?? null;
  const showingCache = cachedDay === date;
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
  const cachedDayRef = useRef(cachedDay);
  cachedDayRef.current = cachedDay;

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
    async (wanted: string, force: boolean): Promise<LoadOutcome> => {
      if (!force && daysRef.current[wanted]) return 'kept';
      setInFlight((current) => ({ ...current, [wanted]: (current[wanted] ?? 0) + 1 }));
      const fail = (key: string): LoadOutcome => {
        setFailures((current) => ({ ...current, [wanted]: key }));
        return 'failed';
      };
      try {
        const fresh = await mealApi().mealDay(wanted, language);
        if (!mounted.current) return 'fresh';
        // Also at once, for a caller that acts on the fresh day (removeItem).
        daysRef.current = { ...daysRef.current, [wanted]: fresh };
        setDays((current) => ({ ...current, [wanted]: fresh }));
        setFailures((current) => without(current, wanted));
        setCachedDay((current) => (current === wanted ? null : current));
        const todayNow = todayServerDay();
        // The Home row and Plan read the same day.
        if (wanted === todayNow && force) await useHealthStore.getState().load({ force: true });
        if (wanted === todayNow) await loadYesterday();
        return 'fresh';
      } catch (error) {
        if (!mounted.current || isCancellation(error)) return 'failed';
        // Only a Today read OF this day: an app left open past midnight
        // holds yesterday's, which must never be shown as today.
        const todayRead = useHealthStore.getState().today;
        const cached =
          wanted === todayServerDay() && todayRead?.date === wanted ? cachedTodayDay(todayRead.meals, wanted) : null;
        if (isOffline(error) && cached) {
          setDays((current) => ({ ...current, [wanted]: cached }));
          setCachedDay(wanted);
          return 'cached';
        }
        if (isOffline(error)) return fail('health.offline.action_hint');
        if (isApiError(error)) useHealthStore.getState().handle(error, { foreground: true });
        return fail('common.error_body');
      } finally {
        if (mounted.current) {
          setInFlight((current) => {
            const left = (current[wanted] ?? 1) - 1;
            return left > 0 ? { ...current, [wanted]: left } : without(current, wanted);
          });
        }
      }
    },
    [language, loadYesterday],
  );

  const reload = useCallback(() => load(dateRef.current, true), [load]);

  // Each day the bar lands on is read once (iOS `.task(id: date)`).
  useEffect(() => {
    void load(date, false);
  }, [date, load]);

  // Every appearance (iOS `onAppear`): counted, and back from the meal page
  // or an editor the day is read again. Not re-run by a new `load` (a
  // language change), which is not an appearance.
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      const current = dateRef.current;
      track('diary_viewed', { relative: current === todayServerDay() ? 'today' : 'past' });
      if (daysRef.current[current]) void loadRef.current(current, true);
    }, []),
  );

  // A new date from the route while the page is up (see A NEW DATE FROM THE
  // ROUTE above): the arrival of a fresh page, so counted and read again.
  const params = route.params;
  const seenParams = useRef(params);
  useEffect(() => {
    if (params === seenParams.current) return;
    seenParams.current = params;
    const now = todayServerDay();
    const next = clampToToday(params.date, now);
    track('diary_viewed', { relative: next === now ? 'today' : 'past' });
    if (next !== dateRef.current) setDate(next);
    // An unread day is read by the date effect above.
    if (daysRef.current[next]) void loadRef.current(next, true);
  }, [params]);

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
      // No item editor host on screen: the meal editor edits every item.
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
              const access = useAppStore.getState().healthAccess;
              // No app-wide host to draw it: this page does.
              if (!presentMealGate(access) && mounted.current) setLocalGate({ access, visible: true });
            } else {
              showToast(t('common.error_body'), { kind: 'meal' });
            }
          }
          break;
        }
      }
      track('diary_copy_yesterday');
      await load(dateRef.current, true);
      // Its "Food diary" opens the diary through Plan, as every save toast does.
      if (last) await showMealSavedToast(last, language);
      if (mounted.current) setCopying(null);
    },
    [language, load, t, yesterday],
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
    async (shownMeal: MealRecord, shownItem: MealItemDraft) => {
      let meal = shownMeal;
      let item = shownItem;
      if (itemRemoval(meal, item).kind === 'confirmDelete') {
        setDeleting(meal);
        return;
      }
      // The offline copy is rebuilt from the Today read: no per 100 g values,
      // no overrides, no updatedAt. A PATCH built from it would strip the
      // other items' numbers with no conflict guard, so the day is read
      // first and the removal works on the meal as the server has it.
      if (cachedDayRef.current === dateRef.current) {
        const outcome = await reload();
        if (!mounted.current) return;
        const freshMeal = outcome === 'fresh' ? daysRef.current[dateRef.current]?.meals.find((m) => m.id === meal.id) : undefined;
        const freshItem = freshMeal?.items.find((record) => record.id === item.storedId);
        if (!freshMeal || !freshItem) {
          // Still offline (or the read failed) says so; a meal or item gone
          // meanwhile is simply not there any more on the fresh day.
          if (outcome === 'cached') showToast(t('health.offline.action_hint'), { kind: 'meal' });
          else if (outcome !== 'fresh') showToast(t('common.error_body'), { kind: 'meal' });
          return;
        }
        meal = freshMeal;
        item = draftFromRecord(freshItem);
      }
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

      {/* Only when `presentMealGate` had no host to draw it (copy refused by the membership). */}
      <MealGateSheet
        visible={localGate?.visible ?? false}
        access={localGate?.access ?? healthAccess}
        onClose={() => setLocalGate((current) => (current ? { ...current, visible: false } : null))}
        onSeeMemberships={() => navigation.navigate('Plans')}
        onOpenAccount={() => navigation.navigate('Account')}
        testID="diary.gate"
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
