/**
 * Route `MealHistory`: the meal calendar (`ios-ux.md` 3.14), the Android port
 * of iOS `MealHistoryView` (Views/Plan/PlanHistory.swift). Its rules are in
 * ./historyModel.ts.
 *
 * Days grouped by month, newest first, a card per month; each row says the
 * short date and "{kcal} kcal · {protein} g protein · {n} meals" (or "Not
 * logged"), with a thin bar against the day's target. Read in windows of 30
 * days, once per opening; "Load earlier" until the first logged day, then
 * "That's the start of your food log." A day opens the diary for it.
 *
 * As on iOS, a read that fails adds nothing: the page says "Meals you log
 * show up here." until a read answers.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LPText, TopBar } from '../../../components/ui';
import { fetchMealDays, type MealDaySummary } from '../../../health';
import { useT } from '../../../i18n';
import { shortDay, todayServerDay } from '../../../i18n/format';
import type { SharedRouteProps } from '../../../navigation/types';
import { colors, hairline, radius } from '../../../theme';

import { canLoadEarlier, dayFill, metaLine, monthGroups, nextWindow } from './historyModel';

/** iOS leaves 140 pt under the list: the tab bar floats over the bottom. */
const BOTTOM_ROOM = 64;

export default function MealHistoryScreen({ navigation }: SharedRouteProps<'MealHistory'>) {
  const { t, tp, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [days, setDays] = useState<readonly MealDaySummary[]>([]);
  const [firstLogDate, setFirstLogDate] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const busy = useRef(false);
  const loadedFromRef = useRef(loadedFrom);
  loadedFromRef.current = loadedFrom;

  const loadEarlier = useCallback(async () => {
    if (busy.current) return;
    const window = nextWindow(loadedFromRef.current, todayServerDay());
    if (!window) return;
    busy.current = true;
    setIsLoading(true);
    try {
      const response = await fetchMealDays(window.from, window.to, language);
      if (!mounted.current) return;
      setDays((current) => [...current, ...(response.days ?? [])]);
      setFirstLogDate((current) => response.firstLogDate ?? current);
      setLoadedFrom(window.from);
    } catch {
      // iOS `try?`: nothing is added, and the page stays as it was.
    } finally {
      busy.current = false;
      if (mounted.current) setIsLoading(false);
    }
  }, [language]);

  // Read once per opening (iOS `.task(id: language)` guarded by `loadedOnce`).
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void loadEarlier();
  }, [loadEarlier]);

  const groups = monthGroups(days, language);
  const earlier = canLoadEarlier(firstLogDate, loadedFrom);

  return (
    <View style={styles.page} testID="mealHistory.screen">
      <TopBar title={t('history.meals.title')} onBack={() => navigation.goBack()} testID="mealHistory.bar" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: BOTTOM_ROOM + tabBarHeight }]} testID="mealHistory.scroll">
        {days.length === 0 && !isLoading ? (
          <LPText size={14} color={colors.paper2} style={styles.empty} testID="mealHistory.empty">
            {t('history.meals.empty')}
          </LPText>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.group} testID={`mealHistory.month.${group.key}`}>
              <LPText size={12} weight="semibold" color={colors.paper2} accessibilityRole="header" style={styles.month}>
                {group.label}
              </LPText>
              <View style={styles.card}>
                {group.days.map((day, index) => {
                  const fill = dayFill(day);
                  const meta = metaLine(day, language, t, tp);
                  const dateText = shortDay(day.date, language);
                  return (
                    <Pressable
                      key={day.date}
                      onPress={() => navigation.push('Diary', { date: day.date })}
                      accessibilityRole="button"
                      accessibilityLabel={`${dateText}, ${meta}`}
                      style={({ pressed }) => [styles.row, index > 0 && styles.divider, pressed && styles.pressed]}
                      testID={`mealHistory.day.${day.date}`}
                    >
                      <View style={styles.rowLine}>
                        <LPText size={14} weight="semibold" color={colors.paper}>
                          {dateText}
                        </LPText>
                        <LPText size={12} color={colors.paper2} align="right" style={styles.meta}>
                          {meta}
                        </LPText>
                      </View>
                      {fill !== null ? (
                        <View style={styles.bar} testID={`mealHistory.day.${day.date}.bar`}>
                          <View style={[styles.barFill, { width: `${fill * 100}%` }]} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.rust} style={styles.spinner} testID="mealHistory.loading" />
        ) : earlier ? (
          <Pressable
            onPress={() => void loadEarlier()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.loadEarlier, pressed && styles.pressed]}
            testID="mealHistory.loadEarlier"
          >
            <LPText size={13} weight="semibold" color={colors.paper2}>
              {t('history.meals.load_earlier')}
            </LPText>
          </Pressable>
        ) : firstLogDate !== null && days.length > 0 ? (
          <LPText size={13} color={colors.paper3} align="center" style={styles.start} testID="mealHistory.start">
            {t('history.meals.start')}
          </LPText>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { paddingTop: 16, gap: 18 },
  empty: { paddingHorizontal: 24 },
  group: { gap: 10 },
  month: { paddingHorizontal: 24 },
  card: {
    marginHorizontal: 20,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: { minHeight: 56, paddingHorizontal: 14, paddingVertical: 12, gap: 6, justifyContent: 'center' },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { flex: 1 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  pressed: { opacity: 0.7 },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.ink3, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.rust },
  spinner: { paddingVertical: 16 },
  loadEarlier: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  start: { paddingVertical: 8 },
});
