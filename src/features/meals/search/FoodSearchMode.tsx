/**
 * Search mode of the meal page (iOS `FoodSearchMode`, ios-ux.md 15): the
 * food table, preset foods and meals, and the member's own history. Never a
 * model call: only "Describe it instead" (MEAL-5's sheet, while the server
 * advertises `meal_describe` and the day is within 30 days) asks for an
 * estimate.
 *
 * Built for a lunch logged in under twenty seconds: the recents and recent
 * meals are there before anything is typed, the field is NOT focused on open
 * so the keyboard does not hide them, and a plus adds the usual portion in
 * one tap ("Added", with Undo).
 *
 * THE SEARCH. Two characters or more, 300 ms after the last keystroke, then
 * `POST /health/foods/search` (OP-38, the words in the body). A newer query
 * cancels the one in flight, and an answer for words no longer in the field
 * is dropped; the list dims while a search runs. Offline says "Search needs a
 * connection."; a 403 shows the membership gate.
 *
 * MY FOODS. Removing one (swipe, or TalkBack's "Remove from My foods"
 * action) takes it off every list at once, then tells the server with a
 * fresh key; it comes back if that fails, with "This needs a connection."
 * when offline.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ApiError, newIdempotencyKey } from '../../../api';
import { Chip, ChipRow, LPText } from '../../../components/ui';
import { useHealthStore } from '../../../health/store';
import { useT } from '../../../i18n';
import { haptics } from '../../../lib/haptics';
import { track } from '../../../lib/analytics';
import { selectSupportsMealDescribe, useAppStore } from '../../../stores/appStore';
import { colors, hairline } from '../../../theme';
import { mealApi } from '../api/mealApi';
import { pageToastOffset, type MealCaptureModel } from '../capture/captureModel';
import { useCapture } from '../capture/capturePages';
import { mealCountBand } from '../capture/mealAnalytics';
import { showMealToast } from '../capture/saveFeedback';
import { NewItemEditor } from '../capture/slots';
import CreateFoodSheet from '../createFood/CreateFoodSheet';
import { openDescribe } from '../describe';
import {
  openFoodsCache,
  refreshFoodsCache,
  refreshMineFoods,
  removeMineLocally,
  restoreMine,
  useMealFoodsCache,
} from '../foodsCache/foodsCache';
import PresetMealSheet from '../preset/PresetMealSheet';
import QuickAddSheet from '../quickAdd/QuickAddSheet';
import type { MealItemDraft } from '../types/draft';
import { draftFromChoice } from '../types/draftFactory';
import type { FoodChoice, FoodSearchResult, MealEntrySource, PresetMeal } from '../types/models';
import { characterPrefix } from '../types/text';

import { searchRows, type SearchRow } from './searchRows';
import {
  entrySourceFor,
  filterTitleKey,
  FOOD_FILTERS,
  fromValueFor,
  isQuerying,
  SEARCH_DEBOUNCE_MS,
  trimmedQuery,
  type FoodFilter,
  type RowOrigin,
} from './searchRules';
import {
  DescribeInsteadButton,
  EmptyLine,
  ErrorRow,
  FoodRow,
  Inset,
  PresetMealRow,
  QuickButton,
  RecentMealRow,
  RetryButton,
  SectionHeader,
  SkeletonRows,
} from './RowViews';

/** How long the describe sheet waits before pushing its draft (iOS 350 ms, after the sheet is down). */
const DRAFT_PUSH_DELAY_MS = 350;

export interface FoodSearchModeProps {
  readonly model: MealCaptureModel;
}

export default function FoodSearchMode({ model }: FoodSearchModeProps) {
  const { t, language } = useT();
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const supportsDescribe = useAppStore(selectSupportsMealDescribe);
  const date = useCapture(model, (s) => s.date);
  const slot = useCapture(model, (s) => s.slot);
  const presets = useMealFoodsCache((s) => s.presets);
  const mine = useMealFoodsCache((s) => s.mine);
  const presetsFailed = useMealFoodsCache((s) => s.presetsFailed);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FoodFilter>('all');
  const [results, setResults] = useState<FoodSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErrorKey, setSearchErrorKey] = useState<string | null>(null);
  const [showAllRecentMeals, setShowAllRecentMeals] = useState(false);
  const [removingOffline, setRemovingOffline] = useState(false);
  const [editing, setEditing] = useState<FoodChoice | null>(null);
  const [presetMeal, setPresetMeal] = useState<PresetMeal | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const field = useRef<TextInput>(null);

  const trimmed = trimmedQuery(query);
  const querying = isQuerying(query);
  const describeOn = supportsDescribe && model.describeAvailable;
  // The newest words, for an answer to check it is still wanted.
  const latestQuery = useRef(trimmed);
  latestQuery.current = trimmed;
  const inFlight = useRef<AbortController | null>(null);

  // The lists: what is stored at once, then both refreshed.
  useEffect(() => {
    if (!profileId) return;
    void openFoodsCache({ profileId, language });
  }, [profileId, language]);

  const runSearch = useCallback(
    async (text: string) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setSearching(true);
      try {
        const found = await mealApi().search(text, language, { signal: controller.signal });
        if (text !== latestQuery.current || !model.isAlive) return;
        setResults(found);
        setSearchErrorKey(null);
        track('food_search_performed', { count_band: mealCountBand(found.mine.length + found.foods.length + found.meals.length) });
        if (found.mine.length + found.foods.length + found.meals.length === 0) track('food_search_empty');
      } catch (error) {
        if (text !== latestQuery.current || !model.isAlive) return;
        if (error instanceof ApiError) {
          if (error.isCancellation) return;
          setResults(null);
          if (error.isOffline) {
            setSearchErrorKey('food.search.offline');
          } else if (useHealthStore.getState().handle(error, { foreground: true }) === 'gate') {
            model.showGate(useAppStore.getState().healthAccess);
          } else {
            setSearchErrorKey('common.error_body');
          }
        } else {
          setResults(null);
          setSearchErrorKey('common.error_body');
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setSearching(false);
        }
      }
    },
    [language, model],
  );

  // 300 ms after the last keystroke; fewer than two characters clears.
  useEffect(() => {
    if (!querying) {
      inFlight.current?.abort();
      setResults(null);
      setSearchErrorKey(null);
      return undefined;
    }
    const timer = setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, querying, runSearch]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const changeQuery = (value: string) => {
    setQuery(value);
    // Typing goes back to All.
    if (value !== '' && filter !== 'all') setFilter('all');
  };

  const pickFilter = (chip: FoodFilter) => {
    setQuery('');
    setFilter(chip);
    track('food_filter_selected', { filter: chip });
  };

  const add = useCallback(
    (items: MealItemDraft[], source: MealEntrySource, from: string, quick: boolean) => {
      model.add(items, source);
      haptics.notification('success');
      track('food_added', { from, quick });
      showMealToast(t('food.added'), {
        action: { label: t('plan.undo'), onPress: () => model.undoLastAdd() },
        bottomOffset: pageToastOffset(model.state.tray.length),
      });
    },
    [model, t],
  );

  const mineLists = mine ?? { recents: [], frequent: [], mine: [], recentMeals: [] };

  const addChoice = (choice: FoodChoice, from: RowOrigin) => {
    add([draftFromChoice(choice)], entrySourceFor(choice, from, presets, mineLists), from, true);
  };

  /** A row's tap: the item editor (MEAL-4), else the usual portion as the plus adds it. */
  const openChoice = (choice: FoodChoice) => {
    if (NewItemEditor) {
      field.current?.blur();
      setEditing(choice);
      return;
    }
    add([draftFromChoice(choice)], entrySourceFor(choice, null, presets, mineLists), fromValueFor(choice, presets, mineLists, querying), false);
  };

  const hide = async (choice: FoodChoice) => {
    setRemovingOffline(false);
    const removal = removeMineLocally(choice.key);
    try {
      await mealApi().hideFood(choice.key, newIdempotencyKey());
      track('food_mine_removed');
      refreshMineFoods();
    } catch (error) {
      if (error instanceof ApiError && error.isOffline) setRemovingOffline(true);
      restoreMine(removal);
    }
  };

  const describe = (text: string, entry: 'button' | 'empty_search' | 'closest') => {
    field.current?.blur();
    track('meal_describe_opened', { entry });
    openDescribe({
      text,
      slot,
      date,
      // Pushed once the sheet is down, onto the page's own stack, like a photo estimate.
      onDraft: (mealId) => {
        setTimeout(() => model.openDraft(mealId), DRAFT_PUSH_DELAY_MS);
      },
      onSearch: (words) => setQuery(characterPrefix(words, 60)),
    });
  };

  const rows = useMemo(
    () =>
      searchRows({
        query: trimmed,
        querying,
        filter,
        presets,
        mine,
        presetsFailed,
        showAllRecentMeals,
        results,
        searching,
        searchErrorKey,
        describeOn,
        removingOffline,
      }),
    [trimmed, querying, filter, presets, mine, presetsFailed, showAllRecentMeals, results, searching, searchErrorKey, describeOn, removingOffline],
  );

  const renderRow = ({ item: row }: { item: SearchRow }) => {
    switch (row.kind) {
      case 'header':
        return (
          <SectionHeader
            title={row.titleKey ? t(row.titleKey) : (row.title ?? '')}
            onSeeAll={
              row.seeAll === 'recentMeals'
                ? () => setShowAllRecentMeals(true)
                : row.seeAll === 'recent'
                  ? () => pickFilter('recent')
                  : row.seeAll === 'meals'
                    ? () => pickFilter('meals')
                    : undefined
            }
            testID={row.key}
          />
        );
      case 'food': {
        const content = (
          <FoodRow
            choice={row.choice}
            from={row.from}
            onOpen={() => openChoice(row.choice)}
            onAdd={() => addChoice(row.choice, row.from)}
            onRemove={row.removable ? () => void hide(row.choice) : undefined}
          />
        );
        const body = row.removable ? <RemovableRow onRemove={() => void hide(row.choice)}>{content}</RemovableRow> : content;
        return row.dimmed ? <View style={styles.dimmed}>{body}</View> : body;
      }
      case 'recentMeal':
        return (
          <RecentMealRow
            meal={row.meal}
            onAdd={() => add(row.meal.items.map((choice) => draftFromChoice(choice)), 'recent', 'recent_meal', true)}
          />
        );
      case 'preset': {
        const body = <PresetMealRow meal={row.meal} onOpen={() => setPresetMeal(row.meal)} />;
        return row.dimmed ? <View style={styles.dimmed}>{body}</View> : body;
      }
      case 'quick':
        return (
          <Inset style={styles.quickRow}>
            {row.offersDescribe && describeOn ? (
              <QuickButton icon="chatbox-ellipses-outline" title={t('meal.describe.open')} onPress={() => describe('', 'button')} testID="food.describe" />
            ) : null}
            <View style={styles.quickPair}>
              <QuickButton icon="add-circle-outline" title={t('food.quick_add')} onPress={() => setShowQuickAdd(true)} testID="food.quickAdd" />
              <QuickButton icon="create-outline" title={t('food.create')} onPress={() => setShowCreate(true)} testID="food.create" />
            </View>
          </Inset>
        );
      case 'describeInstead':
        return (
          <Inset>
            <DescribeInsteadButton title={t('meal.describe.cta')} onPress={() => describe(trimmed, row.entry)} />
          </Inset>
        );
      case 'line':
        return <EmptyLine text={t(row.textKey, row.params)} testID={`food.line.${row.key}`} />;
      case 'error':
        return row.retry === 'cache' ? (
          <ErrorRow onRetry={() => void refreshFoodsCache()} />
        ) : (
          <Inset>
            <RetryButton onPress={() => void runSearch(trimmed)} />
          </Inset>
        );
      case 'skeleton':
        return <SkeletonRows />;
    }
  };

  const pageTrayCount = useCapture(model, (s) => s.tray.length);

  return (
    <View style={styles.mode} testID="food.search">
      <View style={styles.fieldRow}>
        <Ionicons name="search" size={15} color={colors.paper3} />
        <TextInput
          ref={field}
          value={query}
          onChangeText={changeQuery}
          placeholder={t('food.search.placeholder')}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={t('food.search.placeholder')}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          cursorColor={colors.rust}
          selectionColor={colors.rust3}
          style={styles.field}
          testID="food.search.field"
        />
        {query !== '' ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={t('a11y.clear_search')} style={styles.clear}>
            <Ionicons name="close-circle" size={17} color={colors.paper3} />
          </Pressable>
        ) : null}
      </View>

      <ChipRow scroll contentInset={20} gap={8} style={styles.chips} testID="food.filters">
        {FOOD_FILTERS.map((chip) => (
          <Chip
            key={chip}
            label={t(filterTitleKey(chip))}
            selected={filter === chip && !querying}
            onPress={() => pickFilter(chip)}
            testID={`food.filter.${chip}`}
          />
        ))}
      </ChipRow>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        initialNumToRender={20}
        testID="food.list"
      />

      <PresetMealSheet
        visible={presetMeal !== null}
        meal={presetMeal}
        onAdd={(items) => add(items, 'preset', 'preset_meal', false)}
        onClose={() => setPresetMeal(null)}
      />
      <QuickAddSheet
        visible={showQuickAdd}
        target={{ kind: 'capture', model }}
        onClose={() => setShowQuickAdd(false)}
        toastOffset={pageToastOffset(Math.max(pageTrayCount, 1))}
      />
      <CreateFoodSheet
        visible={showCreate}
        barcode={null}
        onAdd={(item) => {
          add([item], 'manual', 'search', false);
          track('food_created', { from: 'search' });
        }}
        onClose={() => setShowCreate(false)}
      />
      {NewItemEditor && editing ? (
        <NewItemEditor
          visible
          item={draftFromChoice(editing)}
          offBarcode={editing.source === 'off' ? editing.barcode : null}
          onAdd={(item) =>
            add(
              [item],
              entrySourceFor(editing, null, presets, mineLists),
              fromValueFor(editing, presets, mineLists, querying),
              false,
            )
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

/** A My foods row: swipe it left for "Remove from My foods". */
function RemovableRow({ children, onRemove }: { readonly children: ReactNode; readonly onRemove: () => void }) {
  const { t } = useT();
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable onPress={onRemove} accessibilityRole="button" style={styles.remove} testID="food.mine.remove">
          <LPText size={13} weight="semibold" color={colors.onAccent} align="center">
            {t('food.mine.remove')}
          </LPText>
        </Pressable>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  mode: { flex: 1, backgroundColor: colors.ink },
  fieldRow: {
    marginHorizontal: 20,
    marginTop: 4,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  field: { flex: 1, fontSize: 16, color: colors.paper, paddingVertical: 8 },
  clear: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { marginTop: 10, marginBottom: 6 },
  list: { paddingBottom: 24 },
  dimmed: { opacity: 0.5 },
  quickRow: { gap: 10, paddingVertical: 10 },
  quickPair: { flexDirection: 'row', gap: 10 },
  remove: { width: 120, backgroundColor: colors.destructive, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
