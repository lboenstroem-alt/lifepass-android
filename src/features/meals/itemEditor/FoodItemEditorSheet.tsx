/**
 * The food item editor (ios-ux.md 16.5): the Android port of iOS
 * `FoodItemEditorSheet` (Views/Meals/FoodItemEditorSheet.swift). Amount
 * first, then the numbers, MyFitnessPal style.
 *
 * One sheet for every place an item is changed, by `context`:
 * - `new`     a food the member is about to add (a search row, a barcode
 *             result): the button says Add to meal;
 * - `local`   an item of a meal that is not saved yet (the tray, a photo or
 *             description draft): changes stay local until the meal's Save;
 * - `stored`  an item of a saved meal: Update and Remove commit at once with
 *             OP-35 (R4) and offer Undo.
 *
 *   <FoodItemEditorSheet
 *     item={editing}                       // null closes it (iOS `.sheet(item:)`)
 *     context={{ kind: 'local', onUpdate: replace, onRemove: () => remove(editing) }}
 *     onClose={() => setEditing(null)}
 *   />
 *
 * The decision stays in reach: the primary button (and an Open Food Facts
 * product's attribution) is pinned under the scrolling numbers, so on a
 * small phone the numbers scroll under it and the button never does.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../../api';
import {
  Card,
  Dialog,
  EstimateChip,
  LPText,
  MenuPicker,
  PrimaryButton,
  Sheet,
  SheetTextInput,
} from '../../../components/ui';
import { useHealthStore } from '../../../health';
import { presentMealGate } from '../../../health/gate/mealGate';
import { HealthFormat, useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline, minTouch, radius, serif } from '../../../theme';
import { mealApi } from '../api/mealApi';
import {
  applyingField,
  displayedItem,
  isEstimateItem,
  kcalMid,
  macroMismatchKcal,
  MULTIPLIERS,
  resettingValue,
} from '../math/itemMath';
import { itemNeedsCheck, type MealItemDraft } from '../types/draft';
import { draftFromRecord } from '../types/draftFactory';
import { isGramsServing, servingEquals, type MealNutrientField, type MealRecord } from '../types/models';

import {
  amountAccessibilityKey,
  amountLabelKey,
  applyingTypedNutrient,
  currentServingTitle,
  editEvent,
  editorServingMenu,
  isAmountValid,
  isMultiplierSelected,
  isNameEditable,
  isNutrientEdited,
  isUndoableRemoval,
  multipliedItem,
  multiplierLabel,
  nutrientTitleKey,
  pickingServing,
  pinnedBottomPadding,
  primaryTitleKey,
  renamedItem,
  servingTitle,
  showsKcalRange,
  steppedItem,
  syncedTexts,
  EMPTY_TEXTS,
  type ItemEditorField,
  type ItemEditorTexts,
} from './itemEditorRules';
import MealOFFAttribution from './MealOFFAttribution';
import { mealKcal, mealSourceWord } from './mealText';
import { offerUndo, patchMealItems } from './storedCommit';

/** What the item editor's buttons do, by where the item lives (iOS `FoodItemEditorContext`). */
export type FoodItemEditorContext =
  /** A food the member is about to add (a search row, a barcode result). */
  | { readonly kind: 'new'; readonly onAdd: (item: MealItemDraft) => void }
  /** An item of a meal that is not saved yet: changes stay local until the meal's own Save. */
  | { readonly kind: 'local'; readonly onUpdate: (item: MealItemDraft) => void; readonly onRemove: () => void }
  /** An item of a saved meal: Update and Remove commit at once (R4). */
  | {
      readonly kind: 'stored';
      readonly meal: MealRecord;
      readonly onCommitted: (meal: MealRecord) => void;
      readonly onDeleted: () => void;
    };

export interface FoodItemEditorSheetProps {
  /** The item to edit; null closes the sheet. A different item is a new presentation. */
  readonly item: MealItemDraft | null;
  readonly context: FoodItemEditorContext;
  /** Cancel, back, a pan down, or the sheet's own button finishing: set `item` to null. */
  readonly onClose: () => void;
  /** Extra lines under the header (the per 100 g line of a barcode result). */
  readonly detail?: string | null;
  /** The Open Food Facts attribution footer, always visible for a product. */
  readonly offBarcode?: string | null;
  /** "Your food" or "From the label" for a barcode found on the server. */
  readonly sourceWordOverride?: string | null;
  /** Every control disabled (a member without a membership looking at a saved meal). */
  readonly readOnly?: boolean;
  /** An item of an estimate made from a description: its check line says so instead of naming a photo. */
  readonly fromDescription?: boolean;
  readonly testID?: string;
}

const KCAL_UNIT = 'kcal';
const GRAM_UNIT = 'g';
const MACROS: readonly MealNutrientField[] = ['protein', 'carbs', 'fat'];

/**
 * Which item a presentation is for. A caller may hand a fresh draft of the
 * same food on every render (`draftFromChoice(choice)` inline mints a new
 * local id each time); that is still the same opening, and the member's
 * changes must not be thrown away under them.
 */
function identityOf(item: MealItemDraft): string {
  return item.storedId ?? item.choiceKey ?? item.localId;
}

interface Shown {
  readonly item: MealItemDraft;
  /** One per opening: a new key is a fresh sheet with fresh fields. */
  readonly key: number;
}

export default function FoodItemEditorSheet(props: FoodItemEditorSheetProps) {
  const [shown, setShownState] = useState<Shown | null>(() => (props.item ? { item: props.item, key: 0 } : null));
  const shownRef = useRef(shown);
  const setShown = useCallback((next: Shown | null) => {
    shownRef.current = next;
    setShownState(next);
  }, []);
  const opening = useRef(0);
  /** The parent closed it (`item` went null): the next item is a new opening, even the same food. */
  const closed = useRef(props.item === null);
  const latest = useRef(props.item);
  latest.current = props.item;

  useEffect(() => {
    const item = props.item;
    if (!item) {
      closed.current = true;
      return;
    }
    const current = shownRef.current;
    if (current && !closed.current && identityOf(current.item) === identityOf(item)) return;
    closed.current = false;
    opening.current += 1;
    setShown({ item, key: opening.current });
  }, [props.item, setShown]);

  // The content stays while the sheet slides away, then goes.
  const onClosed = useCallback(() => {
    if (latest.current === null) setShown(null);
  }, [setShown]);

  if (!shown) return null;
  return <ItemEditorPresentation key={shown.key} {...props} initial={shown.item} visible={props.item !== null} onClosed={onClosed} />;
}

interface PresentationProps extends FoodItemEditorSheetProps {
  readonly initial: MealItemDraft;
  readonly visible: boolean;
  readonly onClosed: () => void;
}

function ItemEditorPresentation({
  initial,
  visible,
  onClosed,
  context,
  onClose,
  detail = null,
  offBarcode = null,
  sourceWordOverride = null,
  readOnly = false,
  fromDescription = false,
  testID = 'itemEditor',
}: PresentationProps) {
  const { t, language } = useT();
  const insets = useSafeAreaInsets();

  const [item, setItemState] = useState(initial);
  const itemRef = useRef(initial);
  const setItem = useCallback((next: MealItemDraft) => {
    itemRef.current = next;
    setItemState(next);
  }, []);
  const [baseAmount, setBaseAmount] = useState(initial.amount);
  const [focus, setFocus] = useState<ItemEditorField | null>(null);
  const [editingCalories, setEditingCalories] = useState(false);
  const [texts, setTexts] = useState<ItemEditorTexts>(() => syncedTexts(EMPTY_TEXTS, initial, null, false, language));
  const [isCommitting, setCommitting] = useState(false);
  const [inlineErrorKey, setInlineErrorKey] = useState<string | null>(null);
  /**
   * A saved meal's change in flight: the sheet stays (no back, no pan down,
   * no Cancel) until the server has answered, so its outcome is shown here.
   * Android's rule for a sheet with a request in flight
   * (src/navigation/guards.ts `sheetBackPolicy`).
   */
  const committingStored = context.kind === 'stored' && isCommitting;
  /**
   * False once this presentation has closed or unmounted. A commit answering
   * after that must not close whatever sheet is on screen by then (the
   * parent's `onClose` clears the CURRENT item, maybe another one) or write
   * an error nobody sees. iOS `dismiss()` acts on its own sheet only.
   */
  const presented = useRef(visible);
  useEffect(() => {
    presented.current = visible;
    return () => {
      presented.current = false;
    };
  }, [visible]);
  /** The sheet's own close once its work is done, while it is still this presentation. */
  const closeSelf = (): void => {
    if (presented.current) onClose();
  };
  const showError = (key: string | null): void => {
    if (presented.current) setInlineErrorKey(key);
  };
  const [dialog, setDialog] = useState<'remove' | 'deleteMeal' | null>(null);
  const storedMeal = useRef<MealRecord | null>(context.kind === 'stored' ? context.meal : null);
  const kcalInput = useRef<TextInput>(null);
  const [focusKcalSoon, setFocusKcalSoon] = useState(false);

  const result = displayedItem(item);
  const estimate = isEstimateItem(item);
  const nameEditable = isNameEditable(item, readOnly);
  const needsCheck = itemNeedsCheck(item);
  const amountValid = isAmountValid(item);
  const servingOptions = useMemo(() => editorServingMenu(item, language), [item, language]);

  // The fields follow the numbers, except the one under the member's finger.
  useEffect(() => {
    setTexts((previous) => syncedTexts(previous, item, focus, editingCalories, language));
  }, [item, focus, editingCalories, language]);

  // "Set my own number" turns the range into a field and puts the cursor in it.
  useEffect(() => {
    if (!focusKcalSoon) return;
    setFocusKcalSoon(false);
    kcalInput.current?.focus();
  }, [focusKcalSoon]);

  const blur = (): void => {
    Keyboard.dismiss();
    setFocus(null);
  };

  const trackEdit = (field: string): void => {
    track(editEvent(itemRef.current), { field });
  };

  // ---------------------------------------------------------------------
  // Committing a stored item (R4)

  const patch = async (meal: MealRecord, items: readonly MealItemDraft[]): Promise<MealRecord | null> => {
    setCommitting(true);
    setInlineErrorKey(null);
    try {
      return await patchMealItems(meal, items);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        showError('common.error_body');
        return null;
      }
      if (error.isOffline) {
        showError('health.offline.action_hint');
      } else if (error.isProblem('meal_changed')) {
        // Reload, and keep what the member typed: one more tap saves it.
        showError('meal.editor.changed_banner');
        try {
          const reloaded = await mealApi().meal(meal.id, language);
          storedMeal.current = reloaded;
          if (context.kind === 'stored') context.onCommitted(reloaded);
        } catch {
          // The banner stands; the next Update answers again.
        }
      } else {
        switch (useHealthStore.getState().handle(error, { foreground: true })) {
          case 'gate':
            presentMealGate(useAppStore.getState().healthAccess);
            closeSelf();
            break;
          case 'pendingDeletion':
            showError('health.err.pending_deletion');
            break;
          case 'changedElsewhere':
            closeSelf();
            break;
          default:
            showError('common.error_body');
        }
      }
      return null;
    } finally {
      setCommitting(false);
    }
  };

  const commitUpdate = async (): Promise<void> => {
    const meal = storedMeal.current;
    if (context.kind !== 'stored' || !meal) return;
    const current = itemRef.current;
    const others = meal.items.map(draftFromRecord);
    const updated = others.map((other) => (other.storedId === current.storedId ? current : other));
    const committed = await patch(meal, updated);
    if (!committed) return;
    context.onCommitted(committed);
    track('meal_updated');
    offerUndo({
      messageKey: 'food.editor.updated',
      committed,
      previous: others,
      language,
      onRestored: context.onCommitted,
      toastOnFailure: true,
    });
    closeSelf();
  };

  const removeStored = async (confirmed: boolean): Promise<void> => {
    const meal = storedMeal.current;
    if (context.kind !== 'stored' || !meal) return;
    const current = itemRef.current;
    const others = meal.items.map(draftFromRecord);
    const remaining = others.filter((other) => other.storedId !== current.storedId);
    if (remaining.length === 0) {
      setDialog('deleteMeal');
      return;
    }
    // An Open Food Facts or photo item cannot come back from Undo (its
    // snapshot or estimate stays on the server), so it asks first.
    const undoable = isUndoableRemoval(current);
    if (!undoable && !confirmed) {
      setDialog('remove');
      return;
    }
    const committed = await patch(meal, remaining);
    if (!committed) return;
    context.onCommitted(committed);
    track('meal_item_deleted');
    if (undoable) {
      offerUndo({
        messageKey: 'food.editor.removed',
        committed,
        previous: others,
        language,
        onRestored: context.onCommitted,
        toastOnFailure: true,
      });
    }
    closeSelf();
  };

  const deleteWholeMeal = async (): Promise<void> => {
    if (context.kind !== 'stored') return;
    setCommitting(true);
    try {
      await mealApi().deleteMeal(context.meal.id);
      track('meal_deleted');
      context.onDeleted();
      closeSelf();
    } catch (error) {
      showError(error instanceof ApiError && error.isOffline ? 'health.offline.action_hint' : 'common.error_body');
    } finally {
      setCommitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // The member's changes

  const onAmountText = (value: string): void => {
    setTexts((previous) => ({ ...previous, amount: value }));
    const parsed = HealthFormat.parseDecimal(value);
    if (parsed === null || !(parsed > 0)) return;
    setItem(applyingField(itemRef.current, parsed));
  };

  const onNutrientText = (field: MealNutrientField, value: string): void => {
    setTexts((previous) => ({ ...previous, [field]: value }));
    const outcome = applyingTypedNutrient(itemRef.current, field, value);
    if (outcome.kind === 'ignored') return;
    if (outcome.kind === 'tooBig') {
      setInlineErrorKey(outcome.errorKey);
      return;
    }
    setInlineErrorKey(null);
    setItem(outcome.item);
    trackEdit(field === 'kcal' ? 'calories' : 'macros');
  };

  const onNameText = (value: string): void => {
    setTexts((previous) => ({ ...previous, name: value }));
    setItem(renamedItem(itemRef.current, value));
  };

  const step = (direction: -1 | 1): void => {
    blur();
    setItem(steppedItem(itemRef.current, direction));
    trackEdit('amount');
  };

  const multiply = (factor: number): void => {
    blur();
    setItem(multipliedItem(itemRef.current, baseAmount, factor));
    trackEdit('multiplier');
  };

  const pickServing = (index: string): void => {
    const serving = servingOptions[Number(index)];
    if (!serving) return;
    blur();
    const next = pickingServing(itemRef.current, serving);
    setItem(next);
    setBaseAmount(next.amount);
    trackEdit('serving');
  };

  const setOwnCalories = (): void => {
    setEditingCalories(true);
    setTexts((previous) => ({ ...previous, kcal: String(kcalMid(result)) }));
    setFocus('kcal');
    setFocusKcalSoon(true);
  };

  const reset = (field: MealNutrientField): void => {
    // Out of the field first, or the typed number stays in it over the value just restored.
    blur();
    setItem(resettingValue(itemRef.current, field));
  };

  const primary = (): void => {
    blur();
    const current = itemRef.current;
    if (itemNeedsCheck(current)) {
      setItem({ ...current, confirmed: true });
      return;
    }
    switch (context.kind) {
      case 'new':
        context.onAdd(current);
        onClose();
        return;
      case 'local':
        context.onUpdate(current);
        onClose();
        return;
      case 'stored':
        void commitUpdate();
    }
  };

  // ---------------------------------------------------------------------
  // Drawing

  const currentServingIndex = (() => {
    const index = item.displaysGrams
      ? servingOptions.findIndex(isGramsServing)
      : servingOptions.findIndex((option) => servingEquals(option, item.serving));
    return index < 0 ? '' : String(index);
  })();

  const macroHint = macroMismatchKcal(result);
  const sourceWord = sourceWordOverride ?? mealSourceWord(item.source, t);

  const footer = readOnly ? undefined : (
    <View style={{ marginBottom: pinnedBottomPadding(offBarcode !== null, insets.bottom) - FOOTER_KIT_PADDING }}>
      <PrimaryButton
        title={t(primaryTitleKey(context.kind, item))}
        onPress={primary}
        disabled={!amountValid}
        loading={committingStored}
        testID={`${testID}.primary`}
      />
      {offBarcode !== null ? (
        <View style={styles.compactAttribution}>
          <MealOFFAttribution barcode={offBarcode} compact testID={`${testID}.off`} />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        onClosed={onClosed}
        busy={committingStored}
        snapPoints={SNAP_POINTS}
        footer={footer}
        testID={testID}
      >
        <View style={styles.toolbar}>
          <Pressable
            onPress={onClose}
            disabled={committingStored}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            accessibilityState={{ disabled: committingStored }}
            style={styles.toolbarButton}
            testID={`${testID}.cancel`}
          >
            <LPText size={15} color={committingStored ? colors.paper3 : colors.paper2}>
              {t('common.cancel')}
            </LPText>
          </Pressable>
        </View>

        <View style={styles.page}>
          {/* Header */}
          <View style={styles.header}>
            {nameEditable ? (
              <SheetTextInput
                value={texts.name}
                onChangeText={onNameText}
                onFocus={() => setFocus('name')}
                onBlur={() => setFocus((previous) => (previous === 'name' ? null : previous))}
                placeholder={t('food.create.name')}
                placeholderTextColor={colors.paper3}
                returnKeyType="done"
                accessibilityLabel={t('food.create.name')}
                style={[styles.nameInput, serif(22)]}
                testID={`${testID}.name`}
              />
            ) : (
              <LPText serif size={22} accessibilityRole="header" testID={`${testID}.title`}>
                {item.label}
              </LPText>
            )}
            <View style={styles.sourceRow}>
              {item.brand ? (
                <>
                  <LPText size={13} color={colors.paper2}>
                    {item.brand}
                  </LPText>
                  <LPText size={13} color={colors.paper3}>
                    {MIDDLE_DOT}
                  </LPText>
                </>
              ) : null}
              {estimate ? (
                <EstimateChip />
              ) : (
                <LPText size={13} color={colors.paper2}>
                  {sourceWord}
                </LPText>
              )}
            </View>
            {detail ? (
              <LPText size={12} color={colors.paper2}>
                {detail}
              </LPText>
            ) : null}
          </View>

          {needsCheck ? (
            <View style={styles.checkBanner} testID={`${testID}.check`}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.signal} />
              <LPText size={13} style={styles.grow}>
                {t(fromDescription ? 'meal.describe.check_amount_body' : 'meal.item.check_amount_body')}
              </LPText>
            </View>
          ) : null}

          {/* Amount */}
          <Card>
            <View style={styles.amountRow}>
              <LPText size={15} style={styles.grow}>
                {t(amountLabelKey(item))}
              </LPText>
              <StepButton
                icon="remove"
                label={t('a11y.decrease_amount')}
                disabled={readOnly}
                onPress={() => step(-1)}
                testID={`${testID}.decrease`}
              />
              <SheetTextInput
                value={texts.amount}
                onChangeText={onAmountText}
                onFocus={() => setFocus('amount')}
                onBlur={() => setFocus((previous) => (previous === 'amount' ? null : previous))}
                keyboardType="decimal-pad"
                returnKeyType="done"
                editable={!readOnly}
                placeholder="0"
                placeholderTextColor={colors.paper3}
                accessibilityLabel={t(amountAccessibilityKey(item))}
                style={styles.amountInput}
                testID={`${testID}.amount`}
              />
              <StepButton
                icon="add"
                label={t('a11y.increase_amount')}
                disabled={readOnly}
                onPress={() => step(1)}
                testID={`${testID}.increase`}
              />
            </View>
            {/* Six equal chips, so all of them fit a narrow phone without a scroll hiding 2x. */}
            <View style={styles.chips}>
              {MULTIPLIERS.map((factor) => {
                const selected = isMultiplierSelected(item, baseAmount, factor);
                return (
                  <Pressable
                    key={factor}
                    onPress={() => multiply(factor)}
                    disabled={readOnly}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.portion_times', { value: HealthFormat.decimal(factor, language, 2) })}
                    accessibilityState={{ selected, disabled: readOnly }}
                    style={styles.chipTouch}
                    testID={`${testID}.multiplier.${factor}`}
                  >
                    <View style={[styles.chip, selected && styles.chipSelected]}>
                      <LPText
                        size={13}
                        weight="semibold"
                        color={selected ? colors.onAccent : colors.paper}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {multiplierLabel(factor, language)}
                      </LPText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.rule} />
            <View style={styles.servingRow}>
              <LPText size={15}>{t('food.editor.serving')}</LPText>
              <View style={styles.grow} />
              <MenuPicker
                options={servingOptions.map((serving, index) => ({
                  value: String(index),
                  label: servingTitle(serving, item, t),
                  testID: `${testID}.serving.${index}`,
                }))}
                value={currentServingIndex}
                onChange={pickServing}
                label={t('food.editor.serving')}
                disabled={readOnly || servingOptions.length < 2}
                renderTrigger={() => (
                  <View style={styles.servingTrigger}>
                    <LPText size={14} weight="semibold" color={colors.rust} numberOfLines={1}>
                      {currentServingTitle(item, t)}
                    </LPText>
                    <Ionicons name="chevron-expand" size={12} color={colors.rust} />
                  </View>
                )}
                testID={`${testID}.serving`}
              />
            </View>
          </Card>

          {/* Nutrition */}
          <Card>
            <View style={[styles.nutrientRow, styles.kcalRow]}>
              <NutrientLabel title={t(nutrientTitleKey('kcal'))} edited={isNutrientEdited(item, 'kcal')} editedWord={t('food.editor.edited')} />
              <View style={styles.grow} />
              {showsKcalRange(item, editingCalories) ? (
                <>
                  <LPText size={17} weight="semibold" testID={`${testID}.kcalRange`}>
                    {mealKcal(result, language)}
                  </LPText>
                  <EstimateChip />
                  <Pressable
                    onPress={setOwnCalories}
                    disabled={readOnly}
                    accessibilityRole="button"
                    accessibilityLabel={t('food.editor.set_own')}
                    style={styles.pencil}
                    testID={`${testID}.setOwn`}
                  >
                    <Ionicons name="pencil" size={14} color={colors.rust} />
                  </Pressable>
                </>
              ) : (
                <NutrientField
                  ref={kcalInput}
                  field="kcal"
                  text={texts.kcal}
                  unit={KCAL_UNIT}
                  title={t(nutrientTitleKey('kcal'))}
                  edited={isNutrientEdited(item, 'kcal')}
                  editedWord={t('food.editor.edited')}
                  resetLabel={t('a11y.reset_value')}
                  readOnly={readOnly}
                  width={96}
                  onChangeText={(value) => onNutrientText('kcal', value)}
                  onFocus={() => setFocus('kcal')}
                  onBlur={() => setFocus((previous) => (previous === 'kcal' ? null : previous))}
                  onReset={() => reset('kcal')}
                  testID={`${testID}.kcal`}
                />
              )}
            </View>
            {MACROS.map((field) => (
              <View key={field}>
                <View style={styles.rule} />
                <View style={styles.nutrientRow}>
                  <NutrientLabel title={t(nutrientTitleKey(field))} edited={isNutrientEdited(item, field)} editedWord={t('food.editor.edited')} />
                  <View style={styles.grow} />
                  <NutrientField
                    field={field}
                    text={texts[field]}
                    unit={GRAM_UNIT}
                    title={t(nutrientTitleKey(field))}
                    edited={isNutrientEdited(item, field)}
                    editedWord={t('food.editor.edited')}
                    resetLabel={t('a11y.reset_value')}
                    readOnly={readOnly}
                    width={80}
                    onChangeText={(value) => onNutrientText(field, value)}
                    onFocus={() => setFocus(field)}
                    onBlur={() => setFocus((previous) => (previous === field ? null : previous))}
                    onReset={() => reset(field)}
                    testID={`${testID}.${field}`}
                  />
                </View>
              </View>
            ))}
          </Card>

          {macroHint !== null && !estimate ? (
            <LPText size={12} color={colors.paper2} style={styles.hint} testID={`${testID}.macroHint`}>
              {t('food.editor.macro_hint', { kcal: HealthFormat.integer(macroHint, language) })}
            </LPText>
          ) : null}

          {/* With buttons the attribution is pinned under them; a read-only sheet ends here. */}
          {offBarcode !== null && readOnly ? <MealOFFAttribution barcode={offBarcode} testID={`${testID}.off`} /> : null}

          {inlineErrorKey ? (
            <LPText size={13} color={colors.destructive} testID={`${testID}.error`} accessibilityLiveRegion="polite">
              {t(inlineErrorKey)}
            </LPText>
          ) : null}

          {/* Remove sits at the end of the page, away from the primary button. */}
          {!readOnly && context.kind !== 'new' ? (
            <Pressable
              onPress={() => {
                if (context.kind === 'local') {
                  context.onRemove();
                  onClose();
                } else {
                  void removeStored(false);
                }
              }}
              disabled={committingStored}
              accessibilityRole="button"
              accessibilityLabel={t('food.editor.remove')}
              style={styles.remove}
              testID={`${testID}.remove`}
            >
              <LPText size={14} weight="semibold" color={colors.destructive}>
                {t('food.editor.remove')}
              </LPText>
            </Pressable>
          ) : null}
        </View>
      </Sheet>

      <Dialog
        visible={dialog === 'remove'}
        onClose={() => setDialog(null)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('food.editor.remove_title')}
        buttons={[
          { label: t('food.editor.remove'), role: 'destructive', onPress: () => void removeStored(true), testID: `${testID}.remove.confirm` },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
      <Dialog
        visible={dialog === 'deleteMeal'}
        onClose={() => setDialog(null)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('meal.delete.title')}
        message={t('meal.delete.body')}
        buttons={[
          { label: t('meal.delete.confirm'), role: 'destructive', onPress: () => void deleteWholeMeal(), testID: `${testID}.deleteMeal.confirm` },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces

const MIDDLE_DOT = '·';

/** Tall enough for the amount, the chips and the serving above the pinned button; the member can pull it to full height. */
const SNAP_POINTS = ['72%', '100%'];

/** The UI kit's Sheet pads its footer by the bottom inset plus this. */
const FOOTER_KIT_PADDING = 16;

function StepButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={17} color={colors.paper} />
    </Pressable>
  );
}

/**
 * The row's name, with the Edited tag under it once the member has typed
 * their own number: under, not beside the field, where the field, the reset
 * and the unit already fill a narrow row.
 */
function NutrientLabel({ title, edited, editedWord }: { title: string; edited: boolean; editedWord: string }) {
  return (
    <View style={styles.nutrientLabel}>
      <LPText size={15} numberOfLines={1}>
        {title}
      </LPText>
      {edited ? (
        <View style={styles.editedTag}>
          <LPText size={10} weight="semibold" color={colors.signal}>
            {editedWord}
          </LPText>
        </View>
      ) : null}
    </View>
  );
}

interface NutrientFieldProps {
  readonly ref?: Ref<TextInput>;
  readonly field: MealNutrientField;
  readonly text: string;
  readonly unit: string;
  readonly title: string;
  readonly edited: boolean;
  readonly editedWord: string;
  readonly resetLabel: string;
  readonly readOnly: boolean;
  readonly width: number;
  readonly onChangeText: (value: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onReset: () => void;
  readonly testID: string;
}

function NutrientField({
  ref,
  field,
  text,
  unit,
  title,
  edited,
  editedWord,
  resetLabel,
  readOnly,
  width,
  onChangeText,
  onFocus,
  onBlur,
  onReset,
  testID,
}: NutrientFieldProps) {
  return (
    <View style={styles.fieldRow}>
      {edited ? (
        <Pressable
          onPress={onReset}
          disabled={readOnly}
          accessibilityRole="button"
          accessibilityLabel={resetLabel}
          style={styles.reset}
          testID={`${testID}.reset`}
        >
          <Ionicons name="arrow-undo" size={13} color={colors.paper2} />
        </Pressable>
      ) : null}
      <SheetTextInput
        ref={ref}
        value={text}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        keyboardType={field === 'kcal' ? 'number-pad' : 'decimal-pad'}
        returnKeyType="done"
        editable={!readOnly}
        placeholder="0"
        placeholderTextColor={colors.paper3}
        accessibilityLabel={`${title}, ${unit}`}
        accessibilityValue={{ text: edited ? `${text}, ${editedWord}` : text }}
        style={[styles.nutrientInput, { width }, field === 'kcal' ? styles.kcalInput : styles.macroInput]}
        testID={testID}
      />
      <LPText size={13} color={colors.paper2} style={styles.unit}>
        {unit}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', marginTop: -8, marginBottom: 4 },
  toolbarButton: { minHeight: minTouch, justifyContent: 'center', paddingRight: 12 },
  page: { gap: 18, paddingBottom: 12 },
  header: { gap: 6, paddingTop: 4 },
  nameInput: { color: colors.paper, padding: 0 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  checkBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radius.field,
    backgroundColor: colors.rust3,
  },
  grow: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  amountInput: {
    width: 72,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.ink3,
    textAlign: 'center',
    color: colors.paper,
    fontSize: 17,
    fontWeight: '600',
    padding: 0,
  },
  stepButton: {
    width: minTouch,
    height: minTouch,
    borderRadius: minTouch / 2,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  chips: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 12 },
  chipTouch: { flex: 1, minHeight: minTouch, justifyContent: 'center' },
  chip: {
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  chipSelected: { backgroundColor: colors.rust },
  rule: { height: hairline, backgroundColor: colors.line },
  servingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  servingTrigger: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: minTouch, maxWidth: 200 },
  nutrientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
  kcalRow: { paddingVertical: 8 },
  nutrientLabel: { gap: 4, flexShrink: 0 },
  editedTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.rust3,
  },
  pencil: { width: minTouch, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reset: { width: 36, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  nutrientInput: {
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.ink3,
    paddingHorizontal: 10,
    paddingVertical: 0,
    textAlign: 'right',
    color: colors.paper,
    fontWeight: '600',
  },
  kcalInput: { fontSize: 17 },
  macroInput: { fontSize: 15 },
  unit: { width: 30 },
  hint: { paddingHorizontal: 4 },
  remove: { minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  compactAttribution: { paddingTop: 2 },
});
