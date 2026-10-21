/**
 * The meal editor (ios-ux.md 13 and 16): review a new meal before it is
 * saved, check a photo or description estimate, or change a meal already in
 * the diary. The Android port of iOS `MealEditorView`
 * (Views/Meals/MealEditorView.swift).
 *
 * - `tray`    the capture page's items, reviewed as a new meal (route
 *             `Review` inside the meal page). Save posts OP-34 through the
 *             page (or queues it offline) and closes the page.
 * - `draft`   an estimate the server saved as a draft, from a photo or a
 *             description (route `Draft` inside the meal page). Nothing is
 *             ever regenerated: the member corrects the amounts and Save
 *             confirms the draft with OP-35 (`confirmed: true` and the
 *             `updatedAt` as loaded). Never queued offline.
 * - `stored`  a meal by id (route `MealEditor`: a diary row, the drafts
 *             list, a notification). A confirmed meal commits every change
 *             as it is made; a draft opens as a draft.
 *
 * Leaving an unsaved draft asks "Keep this estimate for later?", on the top
 * bar's back and on Android's own back alike.
 */
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove, useNavigation, type NavigationAction } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, newIdempotencyKey } from '../../../api';
import {
  Dialog,
  ErrorState,
  EstimateChip,
  LPText,
  PrimaryButton,
  showToast,
  SkeletonCard,
  TopBar,
} from '../../../components/ui';
import { openHealthConsent, useHealthStore } from '../../../health';
import { presentMealGate } from '../../../health/gate/mealGate';
import { HealthFormat, useT } from '../../../i18n';
import { serverDay, todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { openSharedRoute, type SharedRouteNavigation } from '../../../navigation/sharedSheet';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline, minTouch, radius } from '../../../theme';
import { mealApi } from '../api/mealApi';
import { refreshMineFoods } from '../foodsCache/foodsCache';
import { displayedItem, isEstimateItem, loggedAtFor, changingAmount } from '../math/itemMath';
import { isChangedFromStored, isUntouchedEstimate, itemNeedsCheck, type MealItemDraft } from '../types/draft';
import { draftFromRecord } from '../types/draftFactory';
import { isMealFromDescription, type MealPatchBody, type MealRecord, type MealSlot } from '../types/models';

import FoodItemEditorSheet from '../itemEditor/FoodItemEditorSheet';
import { isUndoableRemoval } from '../itemEditor/itemEditorRules';
import { mealAmountLine, mealCountBand, mealGrams, mealKcal, mealSourceWord } from '../itemEditor/mealText';
import { offerUndo, patchMealItems } from '../itemEditor/storedCommit';

import { dropAddFoodHandoff, openAddFoodPage } from './addFood';
import AmountPill from './AmountPillPopover';
import { useMealCaptureState, type MealCaptureLink } from './captureLink';
import { draftThumbnail, forgetDraftThumbnail } from './draftThumbnails';
import {
  accuracyKey,
  canSave as canSaveItems,
  clampedLoggedAt,
  confirmingAll,
  dayLine as dayLineText,
  draftConfirmBody,
  EDITABLE_SLOTS,
  editableSlotOf,
  editorKind,
  editorTotals,
  estimateBannerKey,
  hasRange as hasRangeIn,
  mergeAfterConflict,
  saveHelper as saveHelperText,
  showsAmountPill,
  uncheckedCount as uncheckedIn,
  whenText as whenLine,
  type EditableMealSlot,
} from './mealEditorRules';
import QuickAddToMealSheet from './QuickAddToMealSheet';
import { mealSavedFeedback } from './saveFeedback';
import { openMealWhenPicker } from './whenPicker';

/** Which meal the editor holds (iOS `MealEditorView.Mode`). */
export type MealEditorMode =
  /** The capture page's tray, reviewed as a new meal. */
  | { readonly kind: 'tray'; readonly capture: MealCaptureLink }
  /** A draft the page was handed (a scan's or a description's answer); the page's tray joins it. */
  | { readonly kind: 'draft'; readonly meal: MealRecord; readonly capture: MealCaptureLink | null }
  /** A meal by id, read from the server; `capture` when it is a draft opened inside a meal page. */
  | { readonly kind: 'stored'; readonly mealId: string; readonly capture: MealCaptureLink | null };

export interface MealEditorViewProps {
  readonly mode: MealEditorMode;
  /** The meal changed or was deleted: whoever shows meals reads again (iOS `onChanged`). */
  readonly onChanged?: () => void;
  readonly testID?: string;
}

type DialogKind = 'deleteMeal' | 'discardEstimate' | 'leaveDraft';

export default function MealEditorView({ mode, onChanged, testID = 'mealEditor' }: MealEditorViewProps) {
  const { t, tp, language } = useT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const healthAccess = useAppStore((s) => s.healthAccess);
  const readOnly = healthAccess !== 'entitled';
  const todayMeals = useHealthStore((s) => s.today?.meals ?? null);

  const capture = mode.capture;
  const captureState = useMealCaptureState(capture);

  const [record, setRecordState] = useState<MealRecord | null>(mode.kind === 'draft' ? mode.meal : null);
  const recordRef = useRef(record);
  const setRecord = (next: MealRecord | null): void => {
    recordRef.current = next;
    setRecordState(next);
  };
  // A handed draft is on screen from the first frame, with the page's tray
  // joined to it (iOS applies it in `.task`, a frame later).
  const [initial] = useState(() => initialEditorState(mode));
  const [draftItems, setDraftItemsState] = useState<readonly MealItemDraft[]>(initial.items);
  const draftItemsRef = useRef<readonly MealItemDraft[]>(initial.items);
  const setDraftItems = (next: readonly MealItemDraft[]): void => {
    draftItemsRef.current = next;
    setDraftItemsState(next);
  };
  const [slot, setSlot] = useState<MealSlot>(initial.slot);
  const [logDate, setLogDate] = useState(initial.logDate);
  const [loggedAt, setLoggedAt] = useState<Date>(initial.loggedAt);
  const [loaded, setLoaded] = useState(mode.kind !== 'stored');
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [showChangedBanner, setShowChangedBanner] = useState(false);
  const [editingItem, setEditingItem] = useState<MealItemDraft | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MealItemDraft | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [saved, setSavedState] = useState(false);
  const savedRef = useRef(false);
  const setSaved = (): void => {
    savedRef.current = true;
    setSavedState(true);
  };
  /** The page is going: a removal it starts is never held back by the leave question. */
  const leaving = useRef(false);
  /** The removal the member started (Android back) while the leave question is up. */
  const pendingLeave = useRef<NavigationAction | null>(null);
  /** The tray joins a draft inside a meal page once: a handed draft at once, one read by id on its first read. */
  const trayJoined = useRef(mode.kind === 'draft');

  const sourceKind = mode.kind;
  const kind = editorKind(sourceKind, record);
  const items: readonly MealItemDraft[] = mode.kind === 'tray' ? (captureState?.tray ?? []) : draftItems;
  const totals = editorTotals(items);
  const fromDescription = record !== null && isMealFromDescription(record);
  const unchecked = uncheckedIn(items);
  const hasRange = hasRangeIn(items);
  const canSave = canSaveItems(items, readOnly);
  const saveHelper = kind !== 'existing' ? saveHelperText(items, readOnly, t, tp) : null;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // -----------------------------------------------------------------------
  // Leaving

  const leave = useCallback((): void => {
    leaving.current = true;
    const pending = pendingLeave.current;
    pendingLeave.current = null;
    // Inside a meal page: after a save the whole page closes; otherwise back
    // to the page (iOS `capture.path.removeLast()`).
    if (capture && mode.kind !== 'tray' && savedRef.current) {
      capture.close();
      return;
    }
    if (pending) {
      navigation.dispatch(pending);
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  }, [capture, mode.kind, navigation]);

  const asksBeforeLeaving = kind === 'draft' && !saved && !readOnly;
  usePreventRemove(asksBeforeLeaving, ({ data }) => {
    if (leaving.current || savedRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    pendingLeave.current = data.action;
    setDialog('leaveDraft');
  });

  const goBack = (): void => {
    if (asksBeforeLeaving) {
      pendingLeave.current = null;
      setDialog('leaveDraft');
      return;
    }
    leave();
  };

  // -----------------------------------------------------------------------
  // Loading

  const apply = (meal: MealRecord): void => {
    setRecord(meal);
    setDraftItems(meal.items.map(draftFromRecord));
    setSlot(meal.slot);
    setLogDate(meal.logDate);
    setLoggedAt(meal.loggedAt ?? loggedAtFor(meal.logDate));
    onChangedRef.current?.();
  };

  /** Items already on the page's tray join a draft as extra items (12.4). */
  const joinTray = (): void => {
    if (trayJoined.current || !capture) return;
    trayJoined.current = true;
    const tray = capture.store.getState().tray;
    if (tray.length > 0) setDraftItems([...draftItemsRef.current, ...tray]);
  };

  const loadStored = async (): Promise<void> => {
    if (mode.kind !== 'stored') return;
    setLoadFailed(false);
    try {
      const meal = await mealApi().meal(mode.mealId, language);
      apply(meal);
      setThumbnail(draftThumbnail(meal.id));
      if (!meal.confirmed && capture) joinTray();
      setLoaded(true);
      const description = isMealFromDescription(meal);
      track('meal_editor_opened', { mode: meal.confirmed ? 'existing' : description ? 'text_draft' : 'photo_draft' });
      if (!meal.confirmed) {
        track('meal_estimate_opened', { entry: capture ? (description ? 'describe' : 'scan') : 'plan_drafts' });
      }
    } catch (error) {
      if (error instanceof ApiError && error.isProblem('health_meal_not_found')) {
        useHealthStore.getState().setToast('health.err.changed');
        showToast(t('health.err.changed'), { kind: 'meal' });
        leave();
        return;
      }
      setLoadFailed(true);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    switch (mode.kind) {
      case 'tray':
        track('meal_editor_opened', { mode: 'new' });
        return;
      case 'draft': {
        setThumbnail(draftThumbnail(mode.meal.id));
        onChangedRef.current?.();
        const description = isMealFromDescription(mode.meal);
        track('meal_editor_opened', { mode: description ? 'text_draft' : 'photo_draft' });
        track('meal_estimate_opened', { entry: description ? 'describe' : 'scan' });
        return;
      }
      case 'stored':
        void loadStored();
    }
    // Once, when the editor opens (iOS `.task`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Writes

  const handleWriteError = async (error: ApiError, meal: MealRecord): Promise<void> => {
    if (error.isOffline) {
      // A draft confirmation depends on the stored draft, so it is never
      // queued (16.6); the edits stay while the editor is open.
      setErrorKey('health.offline.action_hint');
      return;
    }
    if (error.isProblem('meal_changed', 'meal_needs_confirmation')) {
      // Reload, and keep the member's edits where the item still exists.
      try {
        const reloaded = await mealApi().meal(meal.id, language);
        setRecord(reloaded);
        setDraftItems(mergeAfterConflict(draftItemsRef.current, reloaded, error.isProblem('meal_needs_confirmation')));
      } catch {
        // The banner and the toast still say what happened; the next Save answers again.
      }
      setShowChangedBanner(error.isProblem('meal_changed'));
      showToast(t('health.err.changed'), { kind: 'meal' });
      return;
    }
    switch (useHealthStore.getState().handle(error, { foreground: true })) {
      case 'presentConsent':
        if (capture) openHealthConsent({ entry: 'scan', onGranted: () => confirmDraft() });
        return;
      case 'gate':
        presentMealGate(useAppStore.getState().healthAccess);
        leave();
        return;
      case 'pendingDeletion':
        setErrorKey('health.err.pending_deletion');
        return;
      case 'changedElsewhere':
        onChangedRef.current?.();
        leave();
        return;
      case 'rateLimited':
        setErrorKey('health.err.rate_limited');
        return;
      default:
        setErrorKey('common.error_body');
    }
  };

  /** OP-35 with `confirmed: true`, every item, and the draft's updatedAt as loaded (13.4). */
  const confirmDraft = async (): Promise<void> => {
    const current = recordRef.current;
    if (!current) return;
    setSaving(true);
    setErrorKey(null);
    const body = draftConfirmBody({ slot, loggedAt, logDate, items: draftItemsRef.current, record: current });
    try {
      const result = await mealApi().patchMeal(current.id, body, newIdempotencyKey());
      setSaved();
      const edited = draftItemsRef.current.some(isChangedFromStored);
      track('meal_logged', {
        source: isMealFromDescription(current) ? 'text' : 'photo',
        items: mealCountBand(draftItemsRef.current.length),
        edited,
      });
      forgetDraftThumbnail(current.id);
      capture?.discardTray();
      refreshMineFoods();
      mealSavedFeedback(result.meal);
      onChangedRef.current?.();
      leave();
    } catch (error) {
      if (error instanceof ApiError) await handleWriteError(error, current);
      else setErrorKey('common.error_body');
    } finally {
      setSaving(false);
    }
  };

  /** An existing meal's items, committed at once (R4). */
  const commitItems = async (
    newItems: readonly MealItemDraft[],
    previous: readonly MealItemDraft[],
    meal: MealRecord,
    undoKey: string | null,
  ): Promise<void> => {
    try {
      const committed = await patchMealItems(meal, newItems);
      apply(committed);
      track('meal_updated');
      if (undoKey) {
        offerUndo({ messageKey: undoKey, committed, previous, language, onRestored: apply, toastOnFailure: false });
      }
    } catch (error) {
      if (error instanceof ApiError) await handleWriteError(error, meal);
      else setErrorKey('common.error_body');
    }
  };

  /** Slot or time of an existing meal, committed on selection. */
  const commitMeta = async (body: MealPatchBody): Promise<void> => {
    const current = recordRef.current;
    if (!current) return;
    try {
      const result = await mealApi().patchMeal(current.id, body, newIdempotencyKey());
      apply(result.meal);
      track('meal_updated');
    } catch (error) {
      apply(current);
      if (error instanceof ApiError) await handleWriteError(error, current);
    }
  };

  const mealDeleted = (): void => {
    setSaved();
    onChangedRef.current?.();
    if (recordRef.current?.logDate === todayServerDay()) void useHealthStore.getState().load({ force: true });
    leave();
  };

  const deleteMeal = async (estimate: boolean): Promise<void> => {
    const current = recordRef.current;
    if (!current) return;
    try {
      await mealApi().deleteMeal(current.id);
      track(estimate ? 'meal_estimate_discarded' : 'meal_deleted');
      forgetDraftThumbnail(current.id);
      mealDeleted();
    } catch (error) {
      setErrorKey(error instanceof ApiError && error.isOffline ? 'health.offline.action_hint' : 'common.error_body');
    }
  };

  // -----------------------------------------------------------------------
  // Changes

  const replace = (item: MealItemDraft): void => {
    if (mode.kind === 'tray') {
      mode.capture.replace(item);
      return;
    }
    const list = draftItemsRef.current;
    const index = list.findIndex((entry) => entry.localId === item.localId);
    if (index < 0) return;
    const next = [...list];
    next[index] = item;
    setDraftItems(next);
  };

  const addItems = (added: readonly MealItemDraft[]): void => {
    if (added.length === 0) return;
    switch (kind) {
      case 'new':
        if (mode.kind === 'tray') mode.capture.add(added, 'search');
        return;
      case 'draft':
        setDraftItems([...draftItemsRef.current, ...added]);
        track('meal_estimate_item_edited', { field: 'added' });
        return;
      case 'existing': {
        const current = recordRef.current;
        if (!current) return;
        const previous = draftItemsRef.current;
        void commitItems([...previous, ...added], previous, current, null);
      }
    }
  };
  // The page opened for Add food hands its items here, however long it stays open.
  const addItemsRef = useRef(addItems);
  addItemsRef.current = addItems;
  const [addFoodReceiver] = useState(() => (added: readonly MealItemDraft[]) => addItemsRef.current(added));
  useEffect(() => () => dropAddFoodHandoff(addFoodReceiver), [addFoodReceiver]);

  const removeStored = async (item: MealItemDraft, confirmed: boolean): Promise<void> => {
    const current = recordRef.current;
    if (!current) return;
    const previous = draftItemsRef.current;
    const remaining = previous.filter((entry) => entry.localId !== item.localId);
    if (remaining.length === 0) {
      setDialog('deleteMeal');
      return;
    }
    const undoable = isUndoableRemoval(item);
    if (!undoable && !confirmed) {
      setConfirmRemove(item);
      return;
    }
    setConfirmRemove(null);
    await commitItems(remaining, previous, current, undoable ? 'food.editor.removed' : null);
    track('meal_item_deleted');
  };

  const remove = (item: MealItemDraft): void => {
    switch (kind) {
      case 'new':
        if (mode.kind === 'tray') mode.capture.remove(item.localId);
        return;
      case 'draft':
        setDraftItems(draftItemsRef.current.filter((entry) => entry.localId !== item.localId));
        track('meal_estimate_item_edited', { field: 'removed' });
        return;
      case 'existing':
        void removeStored(item, false);
    }
  };

  const confirmAll = (): void => {
    setDraftItems(confirmingAll(draftItemsRef.current));
    track('meal_estimate_confirm_all');
  };

  const changeSlot = (value: EditableMealSlot): void => {
    if (value === slot) return;
    setSlot(value);
    if (mode.kind === 'tray') {
      mode.capture.setSlot(value);
      return;
    }
    const current = recordRef.current;
    if (kind === 'existing' && current) {
      void commitMeta({ slot: value, ...(current.updatedAt !== null ? { expectedUpdatedAt: current.updatedAt } : {}) });
    }
  };

  const changeWhen = (instant: Date): void => {
    const day = serverDay(instant);
    const at = clampedLoggedAt(instant);
    setLoggedAt(at);
    setLogDate(day);
    if (mode.kind === 'tray') {
      mode.capture.setDate(day);
      mode.capture.setChosenLoggedAt(at);
      return;
    }
    const current = recordRef.current;
    if (kind === 'existing' && current) {
      void commitMeta({
        loggedAt: at,
        logDate: day,
        ...(current.updatedAt !== null ? { expectedUpdatedAt: current.updatedAt } : {}),
      });
    }
  };

  const openWhen = (): void => {
    openMealWhenPicker({
      initial: loggedAt,
      allowsOlderThan30Days: kind === 'existing',
      doneLabel: t('common.done'),
      cancelLabel: t('common.cancel'),
      onPick: changeWhen,
    });
  };

  const openAddFood = (): void => {
    if (mode.kind === 'tray') {
      // Inside the capture page: back to Search, same tray.
      mode.capture.setMode('search');
      leave();
      return;
    }
    openAddFoodPage({ slot: editableSlotOf(slot), date: logDate, onAddToMeal: addFoodReceiver });
  };

  const save = async (): Promise<void> => {
    if (!canSave) return;
    if (mode.kind === 'tray') {
      setSaving(true);
      const outcome = await mode.capture.save();
      setSaving(false);
      setErrorKey(mode.capture.store.getState().saveErrorKey);
      if (outcome.kind !== 'failed') {
        setSaved();
        leaving.current = true;
        mode.capture.close();
      }
      return;
    }
    await confirmDraft();
  };

  const multiplyFromPill = (item: MealItemDraft, factor: number): void => {
    replace({ ...changingAmount(item, item.amount * factor), confirmed: true });
    track('meal_estimate_item_edited', { field: 'multiplier' });
  };

  // -----------------------------------------------------------------------
  // Drawing

  const title = t(kind === 'existing' ? 'meal.editor.title_edit' : 'meal.editor.title_new');
  const dayLine = dayLineText({ logDate, meals: todayMeals, recordId: record?.id ?? null, totals, t, language });

  let body: ReactNode;
  if (mode.kind === 'stored' && !loaded) {
    body = loadFailed ? (
      <ErrorState onRetry={() => void loadStored()} testID={`${testID}.error`} />
    ) : (
      <View style={styles.skeletons} testID={`${testID}.loading`}>
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        testID={`${testID}.list`}
      >
        {kind === 'draft' ? (
          <View style={styles.estimateBanner} testID={`${testID}.estimateBanner`}>
            <Ionicons name="sparkles" size={16} color={colors.rust} style={styles.bannerIcon} />
            <View style={styles.grow}>
              <LPText size={14}>{t(estimateBannerKey(record))}</LPText>
              <LPText size={11} color={colors.paper2}>
                {t(accuracyKey(record))}
              </LPText>
            </View>
            {thumbnail ? (
              <Image
                source={{ uri: thumbnail }}
                style={styles.thumbnail}
                accessible
                accessibilityLabel={t('meal.photo.preview_label')}
                testID={`${testID}.thumbnail`}
              />
            ) : null}
          </View>
        ) : null}

        {showChangedBanner ? (
          <View style={styles.changedBanner} accessibilityLiveRegion="polite">
            <LPText size={13}>{t('meal.editor.changed_banner')}</LPText>
          </View>
        ) : null}

        {/* Slot and time */}
        <Section>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>
            {EDITABLE_SLOTS.map((value) => {
              const selected = slot === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => changeSlot(value)}
                  disabled={readOnly}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: readOnly }}
                  accessibilityLabel={t(`slot.${value}`)}
                  style={styles.slotTouch}
                  testID={`${testID}.slot.${value}`}
                >
                  <View style={[styles.slotChip, selected && styles.slotChipSelected]}>
                    <LPText size={13} weight="semibold" color={selected ? colors.onAccent : colors.paper}>
                      {t(`slot.${value}`)}
                    </LPText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.rule} />
          <Pressable
            onPress={openWhen}
            disabled={readOnly}
            accessibilityRole="button"
            accessibilityLabel={`${t('meal.editor.when')}, ${whenLine(logDate, loggedAt, t, language)}`}
            style={styles.row}
            testID={`${testID}.when`}
          >
            <LPText size={15} style={styles.grow}>
              {t('meal.editor.when')}
            </LPText>
            <LPText size={14} weight="semibold" color={colors.rust}>
              {whenLine(logDate, loggedAt, t, language)}
            </LPText>
          </Pressable>
        </Section>

        {/* Items and actions */}
        <Section>
          {items.length === 0 ? (
            <View style={styles.row}>
              <LPText size={14} color={colors.paper2}>
                {t('meal.editor.no_items')}
              </LPText>
            </View>
          ) : null}
          {items.map((item, index) => (
            <View key={item.localId}>
              {index > 0 ? <View style={styles.rule} /> : null}
              <ItemRow
                item={item}
                kind={kind}
                readOnly={readOnly}
                onOpen={() => setEditingItem(item)}
                onRemove={() => remove(item)}
                onMultiply={(factor) => multiplyFromPill(item, factor)}
                testID={`${testID}.item.${index}`}
              />
            </View>
          ))}
          {kind === 'draft' && unchecked > 0 && !readOnly ? (
            <ActionRow icon="checkmark-circle-outline" label={t('meal.estimate.confirm_all')} accent onPress={confirmAll} testID={`${testID}.confirmAll`} />
          ) : null}
          {!readOnly ? (
            <>
              {kind === 'draft' && !fromDescription ? (
                <ActionRow icon="scan-outline" label={t('meal.photo.add_missing')} onPress={openAddFood} testID={`${testID}.addMissing`} />
              ) : null}
              <ActionRow icon="add" label={t('meal.editor.add_food')} onPress={openAddFood} testID={`${testID}.addFood`} />
              <ActionRow icon="add-circle-outline" label={t('food.quick_add')} onPress={() => setShowQuickAdd(true)} testID={`${testID}.quickAdd`} />
            </>
          ) : null}
        </Section>

        {/* Totals */}
        <Section>
          <View style={styles.totals} accessible testID={`${testID}.totals`}>
            <View style={styles.totalsHead}>
              <LPText size={28} weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {totals.kcalLow === totals.kcalHigh
                  ? HealthFormat.kcal(totals.kcalLow, language)
                  : t('plan.nutrition.kcal_range', {
                      low: HealthFormat.integer(totals.kcalLow, language),
                      high: HealthFormat.integer(totals.kcalHigh, language),
                    })}
              </LPText>
              {hasRange ? <EstimateChip /> : null}
            </View>
            <View style={styles.macros}>
              <MacroColumn title={t('meal.macro.protein')} value={HealthFormat.grams(totals.proteinG, language)} />
              <MacroColumn title={t('meal.macro.carbs')} value={HealthFormat.grams(totals.carbsG, language)} />
              <MacroColumn title={t('meal.macro.fat')} value={HealthFormat.grams(totals.fatG, language)} />
            </View>
            {dayLine ? (
              <LPText size={12} color={colors.paper2} testID={`${testID}.dayLine`}>
                {dayLine}
              </LPText>
            ) : null}
          </View>
        </Section>
        <View style={styles.footnotes}>
          {hasRange ? (
            <LPText size={11} color={colors.paper2}>
              {t(accuracyKey(record))}
            </LPText>
          ) : null}
          <LPText size={11} color={colors.paper2}>
            {t('food.credits_line')}
          </LPText>
        </View>

        {/* Save */}
        <View style={styles.saveBlock}>
          {errorKey ? (
            <>
              <LPText size={13} color={colors.destructive} align="center" accessibilityLiveRegion="polite" testID={`${testID}.errorText`}>
                {t(errorKey)}
              </LPText>
              {errorKey === 'health.err.pending_deletion' ? (
                <Pressable
                  onPress={() => openSharedRoute(navigation as unknown as SharedRouteNavigation, 'Account')}
                  accessibilityRole="button"
                  accessibilityLabel={t('health.err.open_account')}
                  style={styles.centredLink}
                >
                  <LPText size={13} weight="semibold" color={colors.rust}>
                    {t('health.err.open_account')}
                  </LPText>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {kind !== 'existing' ? (
            <>
              {saveHelper ? (
                <LPText size={12} color={colors.paper2} align="center" testID={`${testID}.saveHelper`}>
                  {saveHelper}
                </LPText>
              ) : null}
              {!readOnly ? (
                <PrimaryButton
                  title={t('meal.editor.save')}
                  onPress={() => void save()}
                  disabled={!canSave}
                  loading={isSaving}
                  shape="flat"
                  accessibilityHint={saveHelper ?? undefined}
                  testID={`${testID}.save`}
                />
              ) : null}
            </>
          ) : null}
          {kind === 'existing' ? (
            <DestructiveButton label={t('meal.editor.delete')} onPress={() => setDialog('deleteMeal')} testID={`${testID}.delete`} />
          ) : null}
          {kind === 'draft' ? (
            <DestructiveButton
              label={t('meal.editor.discard_estimate')}
              onPress={() => setDialog('discardEstimate')}
              testID={`${testID}.discard`}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  const existingRecord = kind === 'existing' ? record : null;

  return (
    <View style={styles.screen} testID={testID}>
      <TopBar title={title} onBack={goBack} />
      {body}

      {existingRecord ? (
        <FoodItemEditorSheet
          item={editingItem}
          context={{ kind: 'stored', meal: existingRecord, onCommitted: apply, onDeleted: mealDeleted }}
          offBarcode={editingItem?.source === 'off' ? editingItem.barcode : null}
          readOnly={readOnly}
          onClose={() => setEditingItem(null)}
          testID={`${testID}.itemEditor`}
        />
      ) : (
        <FoodItemEditorSheet
          item={editingItem}
          context={{
            kind: 'local',
            onUpdate: replace,
            onRemove: () => {
              if (editingItem) remove(editingItem);
            },
          }}
          offBarcode={editingItem?.source === 'off' ? editingItem.barcode : null}
          readOnly={readOnly}
          fromDescription={fromDescription}
          onClose={() => setEditingItem(null)}
          testID={`${testID}.itemEditor`}
        />
      )}
      <QuickAddToMealSheet visible={showQuickAdd} onAdd={(item) => addItems([item])} onClose={() => setShowQuickAdd(false)} />

      <Dialog
        visible={dialog === 'deleteMeal'}
        onClose={() => setDialog(null)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.delete.title')}
        message={t('meal.delete.body')}
        buttons={[
          { label: t('meal.delete.confirm'), role: 'destructive', onPress: () => void deleteMeal(false), testID: `${testID}.delete.confirm` },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
      <Dialog
        visible={dialog === 'discardEstimate'}
        onClose={() => setDialog(null)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.discard.title')}
        message={t('meal.discard.body')}
        buttons={[
          { label: t('meal.discard.confirm'), role: 'destructive', onPress: () => void deleteMeal(true), testID: `${testID}.discard.confirm` },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
      <Dialog
        visible={dialog === 'leaveDraft'}
        onClose={() => {
          setDialog(null);
          pendingLeave.current = null;
        }}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.draft_leave.title')}
        buttons={[
          {
            label: t('meal.draft_leave.keep'),
            onPress: () => {
              track('meal_estimate_kept');
              leave();
            },
            testID: `${testID}.leave.keep`,
          },
          {
            label: t('meal.draft_leave.discard'),
            role: 'destructive',
            onPress: () => {
              pendingLeave.current = null;
              void deleteMeal(true);
            },
            testID: `${testID}.leave.discard`,
          },
          { label: t('common.cancel'), role: 'cancel', testID: `${testID}.leave.cancel` },
        ]}
      />
      <Dialog
        visible={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('food.editor.remove_title')}
        buttons={[
          {
            label: t('food.editor.remove'),
            role: 'destructive',
            onPress: () => {
              if (confirmRemove) void removeStored(confirmRemove, true);
            },
            testID: `${testID}.remove.confirm`,
          },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces

interface InitialEditorState {
  readonly items: readonly MealItemDraft[];
  readonly slot: MealSlot;
  readonly logDate: string;
  readonly loggedAt: Date;
}

/** What the editor shows before anything is read: the page's slot and time, or the handed draft with the tray. */
function initialEditorState(mode: MealEditorMode): InitialEditorState {
  switch (mode.kind) {
    case 'tray': {
      const page = mode.capture.store.getState();
      return { items: [], slot: page.slot, logDate: page.date, loggedAt: page.chosenLoggedAt ?? loggedAtFor(page.date) };
    }
    case 'draft': {
      const meal = mode.meal;
      const tray = mode.capture?.store.getState().tray ?? [];
      return {
        items: [...meal.items.map(draftFromRecord), ...tray],
        slot: meal.slot,
        logDate: meal.logDate,
        loggedAt: meal.loggedAt ?? loggedAtFor(meal.logDate),
      };
    }
    case 'stored':
      return { items: [], slot: 'snack', logDate: todayServerDay(), loggedAt: new Date() };
  }
}

function Section({ children }: { children: ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

function ActionRow({
  icon,
  label,
  onPress,
  accent = false,
  testID,
}: {
  icon: 'add' | 'add-circle-outline' | 'scan-outline' | 'checkmark-circle-outline';
  label: string;
  onPress: () => void;
  accent?: boolean;
  testID: string;
}) {
  return (
    <>
      <View style={styles.rule} />
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.row} testID={testID}>
        <Ionicons name={icon} size={15} color={colors.rust} style={styles.actionIcon} />
        <LPText size={accent ? 14 : 15} weight={accent ? 'semibold' : 'regular'} color={accent ? colors.rust : colors.paper} style={styles.grow}>
          {label}
        </LPText>
      </Pressable>
    </>
  );
}

function MacroColumn({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.macroColumn}>
      <LPText size={11} weight="semibold" color={colors.paper2}>
        {title}
      </LPText>
      <LPText size={16} weight="semibold">
        {value}
      </LPText>
    </View>
  );
}

function DestructiveButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.destructive} testID={testID}>
      <LPText size={14} weight="semibold" color={colors.destructive}>
        {label}
      </LPText>
    </Pressable>
  );
}

interface ItemRowProps {
  readonly item: MealItemDraft;
  readonly kind: 'new' | 'draft' | 'existing';
  readonly readOnly: boolean;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly onMultiply: (factor: number) => void;
  readonly testID: string;
}

/** One item: its name, the amount or the estimate's grams, the calories; swipe to Delete. */
function ItemRow({ item, kind, readOnly, onOpen, onRemove, onMultiply, testID }: ItemRowProps) {
  const { t, language } = useT();
  const result = displayedItem(item);
  const estimate = isEstimateItem(item);
  const needsCheck = itemNeedsCheck(item);
  const amount =
    estimate && isUntouchedEstimate(item)
      ? item.liquid
        ? t('meal.item.about_ml', { ml: mealGrams(result.grams ?? item.amount, language) })
        : t('meal.item.about_grams', { grams: mealGrams(result.grams ?? item.amount, language) })
      : mealAmountLine(item, t, language);
  const spoken = [item.label, mealAmountLine(item, t, language), mealKcal(result, language)];
  if (estimate) spoken.push(t('health.estimate'));
  if (needsCheck) spoken.push(t('meal.item.check_amount'));
  const deletable = !readOnly;

  const row = (
    <View style={styles.itemRow}>
      <Pressable
        onPress={onOpen}
        disabled={readOnly && kind !== 'existing'}
        accessibilityRole="button"
        accessibilityLabel={spoken.join(', ')}
        accessibilityActions={deletable ? [{ name: 'delete', label: t('common.delete') }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete' && deletable) onRemove();
        }}
        style={styles.itemMain}
        testID={testID}
      >
        <View style={styles.grow}>
          <View style={styles.itemTitle}>
            {needsCheck ? <Ionicons name="alert-circle-outline" size={13} color={colors.signal} /> : null}
            <LPText size={15} numberOfLines={2} style={styles.shrink}>
              {item.label}
            </LPText>
          </View>
          {needsCheck ? (
            <LPText size={12} weight="semibold" color={colors.signal}>
              {t('meal.item.check_amount')}
            </LPText>
          ) : null}
          <View style={styles.itemMeta}>
            <LPText size={12} color={colors.paper2}>
              {amount}
            </LPText>
            {!estimate ? (
              <>
                <LPText size={12} color={colors.paper3}>
                  {MIDDLE_DOT}
                </LPText>
                <LPText size={12} color={colors.paper3} numberOfLines={1} style={styles.shrink}>
                  {mealSourceWord(item.source, t)}
                </LPText>
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.itemKcal}>
          <LPText size={14} weight="semibold" align="right">
            {mealKcal(result, language)}
          </LPText>
          {estimate ? <EstimateChip /> : null}
        </View>
      </Pressable>
      {showsAmountPill(item, kind, readOnly) ? (
        <AmountPill item={item} onMultiply={onMultiply} onExact={onOpen} testID={`${testID}.pill`} />
      ) : null}
    </View>
  );

  if (!deletable) return row;
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <Pressable
          onPress={() => {
            methods.close();
            onRemove();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.delete')}
          style={styles.swipeDelete}
          testID={`${testID}.swipeDelete`}
        >
          <LPText size={14} weight="semibold" color={colors.onAccent}>
            {t('common.delete')}
          </LPText>
        </Pressable>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

const MIDDLE_DOT = '·';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  skeletons: { padding: 20, gap: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 16 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  estimateBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: radius.field,
    backgroundColor: colors.rust3,
  },
  bannerIcon: { marginTop: 2 },
  thumbnail: { width: 72, height: 72, borderRadius: radius.field },
  changedBanner: { padding: 14, borderRadius: radius.field, backgroundColor: colors.rust3 },
  section: {
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  rule: { height: hairline, backgroundColor: colors.line, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: minTouch, paddingHorizontal: 16, gap: 10 },
  slots: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  slotTouch: { minHeight: minTouch, justifyContent: 'center' },
  slotChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotChipSelected: { backgroundColor: colors.rust },
  actionIcon: { width: 22, textAlign: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 16, backgroundColor: colors.ink2 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingVertical: 12, minHeight: minTouch },
  itemTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  itemKcal: { alignItems: 'flex-end', gap: 4 },
  swipeDelete: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.destructive,
  },
  totals: { padding: 16, gap: 12 },
  totalsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  macros: { flexDirection: 'row' },
  macroColumn: { flex: 1, gap: 2 },
  footnotes: { gap: 8, paddingHorizontal: 4, marginTop: -8 },
  saveBlock: { gap: 10, paddingTop: 4 },
  centredLink: { minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  destructive: { minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
});
