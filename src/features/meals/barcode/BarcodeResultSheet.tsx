/**
 * What a scanned or typed barcode turned into (ios-ux.md 14.3, 14.4): the
 * port of iOS `BarcodeResultSheet` (Views/Meals/BarcodeResultSheet.swift).
 *
 *   the member's food / a label row  the item editor, "Your food" or "From
 *                                    the label", the per 100 g line
 *   an Open Food Facts product       the item editor with 1 serving when its
 *                                    weight is known (else 100 g), the per
 *                                    100 g (or ml) line, and the Open Food
 *                                    Facts attribution pinned under Add
 *   looking                          "Looking up the product" with Quick add
 *                                    and Create my food already usable
 *   no nutrition                     Create my food (prefilled), Quick add,
 *                                    Search instead, and the attribution
 *   lookup failed                    Try again, Create my food, Quick add,
 *                                    Search instead
 *   not found                        Create my food, Quick add, Search
 *                                    instead, Scan again
 *
 * Add puts the item in the tray (source barcode) with "Added" and Undo.
 * Each way out calls `onDismiss` once; the mode then forgets the lookup and
 * reads again a second later.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type Text } from 'react-native';
import { useStore } from 'zustand';

import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { integer } from '../../../i18n/format';
import { useT, type Lang } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, minTouch } from '../../../theme';
import { pageToastOffset, type MealCaptureModel } from '../capture/captureModel';
import { showMealToast } from '../capture/saveFeedback';
import CreateFoodSheet from '../createFood/CreateFoodSheet';
import { FoodItemEditorSheet, MealOFFAttribution } from '../itemEditor';
import { mealGrams } from '../itemEditor/mealText';
import QuickAddSheet from '../quickAdd/QuickAddSheet';
import type { MealItemDraft } from '../types/draft';
import { draftFromChoice, draftFromProduct } from '../types/draftFactory';
import { offItemPer100g, type Per100g } from '../types/models';

import type { BarcodeLookupModel, BarcodeResult } from './lookupModel';

export interface BarcodeResultSheetProps {
  readonly lookup: BarcodeLookupModel;
  readonly model: MealCaptureModel;
  /** "Search instead": the sheet goes and the page switches to Search. */
  readonly onSearchInstead: () => void;
  /** Every other way out (Cancel, back, a pan down, Add, Scan again). */
  readonly onDismiss: () => void;
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** "Per 100 g: 62 kcal · 10 g protein · 4 g carbs · 0.6 g fat" (per 100 ml for a liquid). */
export function per100gLine(values: Per100g | null, liquid: boolean, t: Translate, language: Lang): string | null {
  if (!values) return null;
  return t(liquid ? 'food.per100ml' : 'food.per100g', {
    kcal: integer(Math.round(values.kcal), language),
    protein: mealGrams(values.proteinG, language),
    carbs: mealGrams(values.carbsG, language),
    fat: mealGrams(values.fatG, language),
  });
}

/** The item editor's opening for a result that has one. */
interface EditorOpening {
  readonly item: MealItemDraft;
  readonly detail: string | null;
  readonly offBarcode: string | null;
  readonly sourceWordOverride: string | null;
}

function editorOpening(result: BarcodeResult | null, t: Translate, language: Lang): EditorOpening | null {
  if (result?.kind === 'choice') {
    const { food, origin } = result;
    return {
      item: draftFromChoice(food),
      detail: per100gLine(food.per100g, food.liquid, t, language),
      offBarcode: origin === 'mine' || food.source !== 'off' ? null : food.barcode,
      sourceWordOverride: t(origin === 'mine' ? 'food.source.mine' : 'food.source.label'),
    };
  }
  if (result?.kind === 'product') {
    return {
      item: draftFromProduct(result.snapshot, result.liquid),
      detail: per100gLine(offItemPer100g(result.snapshot), result.liquid, t, language),
      offBarcode: result.snapshot.barcode,
      sourceWordOverride: null,
    };
  }
  return null;
}

export default function BarcodeResultSheet({ lookup, model, onSearchInstead, onDismiss }: BarcodeResultSheetProps) {
  const { t, language } = useT();
  const shown = useStore(lookup.store, (s) => s.sheetShown);
  const result = useStore(lookup.store, (s) => s.result);
  const code = useStore(lookup.store, (s) => s.code);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const titleRef = useRef<Text>(null);
  /** Something went into the tray from a sheet over this one: this one goes too (iOS `dismiss()` in their callbacks). */
  const added = useRef(false);
  const trayAtQuickAdd = useRef(0);

  // One opening per result: a redraw hands the open editor the same item.
  const opening = useMemo(() => editorOpening(result, t, language), [result, t, language]);

  // A product that arrives replaces the looking sheet, and the sheet over it
  // goes with it; a lookup that has gone takes them too.
  useEffect(() => {
    if (opening !== null || !shown) {
      setShowCreate(false);
      setShowQuickAdd(false);
    }
  }, [opening, shown]);

  const toastAdded = () => {
    showMealToast(t('food.added'), {
      action: { label: t('plan.undo'), onPress: () => model.undoLastAdd() },
      bottomOffset: pageToastOffset(model.state.tray.length),
      page: model,
    });
  };

  const add = (item: MealItemDraft) => {
    model.add([item], 'barcode');
    track('food_added', { from: 'search', quick: false });
    toastAdded();
  };

  const prefill = result?.kind === 'noNutrition' ? { name: result.name, brand: result.brand } : { name: null, brand: null };
  const sheetVisible = shown && opening === null;

  return (
    <>
      {opening ? (
        <FoodItemEditorSheet
          item={shown ? opening.item : null}
          context={{ kind: 'new', onAdd: add }}
          detail={opening.detail}
          offBarcode={opening.offBarcode}
          sourceWordOverride={opening.sourceWordOverride}
          onClose={onDismiss}
          testID="meal.barcode.editor"
        />
      ) : null}

      <Sheet visible={sheetVisible} onClose={onDismiss} initialFocusRef={titleRef} testID="meal.barcode.result">
        <View style={styles.page}>
          <Pressable onPress={onDismiss} accessibilityRole="button" style={styles.cancel} hitSlop={6} testID="meal.barcode.resultCancel">
            <LPText size={15} color={colors.accentText}>
              {t('common.cancel')}
            </LPText>
          </Pressable>
          <ResultContent
            result={result}
            code={code}
            titleRef={titleRef}
            onCreate={() => setShowCreate(true)}
            onQuickAdd={() => {
              trayAtQuickAdd.current = model.state.tray.length;
              setShowQuickAdd(true);
            }}
            onRetry={() => lookup.retry(language)}
            onSearchInstead={onSearchInstead}
            onScanAgain={onDismiss}
          />
        </View>
      </Sheet>

      {/* A product that arrives meanwhile replaces this sheet, and what it opened goes with it (as on iOS). */}
      <CreateFoodSheet
        visible={showCreate && opening === null}
        barcode={code}
        prefillName={prefill.name}
        prefillBrand={prefill.brand}
        attribution={prefill.name !== null && code ? <MealOFFAttribution barcode={code} /> : null}
        onAdd={(item) => {
          model.add([item], 'manual');
          track('food_created', { from: 'barcode' });
          toastAdded();
          added.current = true;
        }}
        onClose={() => {
          setShowCreate(false);
          if (added.current) {
            added.current = false;
            onDismiss();
          }
        }}
      />
      <QuickAddSheet
        visible={showQuickAdd && opening === null}
        target={{ kind: 'capture', model }}
        toastOffset={pageToastOffset(Math.max(model.state.tray.length, 1))}
        onClose={() => {
          setShowQuickAdd(false);
          // Added to the tray, or saved at once (the page then closes): the result goes too.
          if (!model.isAlive || model.state.tray.length !== trayAtQuickAdd.current) onDismiss();
        }}
      />
    </>
  );
}

interface ResultContentProps {
  readonly result: BarcodeResult | null;
  readonly code: string | null;
  readonly titleRef: RefObject<Text | null>;
  readonly onCreate: () => void;
  readonly onQuickAdd: () => void;
  readonly onRetry: () => void;
  readonly onSearchInstead: () => void;
  readonly onScanAgain: () => void;
}

function ResultContent({ result, code, titleRef, onCreate, onQuickAdd, onRetry, onSearchInstead, onScanAgain }: ResultContentProps) {
  const { t } = useT();
  const kind = result?.kind ?? 'looking';
  switch (kind) {
    case 'looking':
    case 'choice':
    case 'product':
      return (
        <>
          <View style={styles.looking} accessible accessibilityLiveRegion="polite" testID="meal.barcode.resultLooking">
            <ActivityIndicator color={colors.paper} />
            <LPText ref={titleRef} size={16} weight="semibold" color={colors.paper}>
              {t('meal.barcode.looking')}
            </LPText>
          </View>
          <PrimaryButton title={t('food.quick_add')} onPress={onQuickAdd} testID="meal.barcode.quickAdd" />
          <TextButton label={t('food.create')} onPress={onCreate} testID="meal.barcode.create" />
        </>
      );
    case 'noNutrition':
      return (
        <>
          <Header icon="list-outline" title={t('food.no_nutrition.title')} body={t('food.no_nutrition.body')} titleRef={titleRef} />
          <PrimaryButton title={t('food.create')} onPress={onCreate} testID="meal.barcode.create" />
          <TextButton label={t('food.quick_add')} onPress={onQuickAdd} testID="meal.barcode.quickAdd" />
          <TextButton label={t('food.search_instead')} onPress={onSearchInstead} testID="meal.barcode.searchInstead" />
          {code ? <MealOFFAttribution barcode={code} testID="meal.barcode.attribution" /> : null}
        </>
      );
    case 'failed':
      return (
        <>
          <Header icon="cloud-offline-outline" title={null} body={t('food.off.unavailable')} titleRef={titleRef} />
          <PrimaryButton title={t('health.retry')} onPress={onRetry} testID="meal.barcode.retry" />
          <TextButton label={t('food.create')} onPress={onCreate} testID="meal.barcode.create" />
          <TextButton label={t('food.quick_add')} onPress={onQuickAdd} testID="meal.barcode.quickAdd" />
          <TextButton label={t('food.search_instead')} onPress={onSearchInstead} testID="meal.barcode.searchInstead" />
        </>
      );
    case 'notFound':
      return (
        <>
          <Header icon="barcode-outline" title={t('food.notfound.title')} body={t('food.notfound.body')} titleRef={titleRef} />
          <PrimaryButton title={t('food.create')} onPress={onCreate} testID="meal.barcode.create" />
          <TextButton label={t('food.quick_add')} onPress={onQuickAdd} testID="meal.barcode.quickAdd" />
          <TextButton label={t('food.search_instead')} onPress={onSearchInstead} testID="meal.barcode.searchInstead" />
          <TextButton label={t('food.scan_again')} onPress={onScanAgain} testID="meal.barcode.scanAgain" />
        </>
      );
  }
}

function Header({
  icon,
  title,
  body,
  titleRef,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string | null;
  readonly body: string;
  readonly titleRef: RefObject<Text | null>;
}) {
  return (
    <View style={styles.header}>
      <Ionicons name={icon} size={30} color={colors.rust} accessible={false} importantForAccessibility="no" />
      {title ? (
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header" testID="meal.barcode.resultTitle">
          {title}
        </LPText>
      ) : null}
      <LPText ref={title ? undefined : titleRef} size={15} color={colors.paper2} testID="meal.barcode.resultBody">
        {body}
      </LPText>
    </View>
  );
}

function TextButton({ label, onPress, testID }: { readonly label: string; readonly onPress: () => void; readonly testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.textButton, pressed && styles.pressed]} testID={testID}>
      <LPText size={15} weight="semibold" color={colors.accentText} align="center">
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  cancel: { alignSelf: 'flex-start', minHeight: minTouch, justifyContent: 'center' },
  looking: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  header: { gap: 10 },
  textButton: { minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
