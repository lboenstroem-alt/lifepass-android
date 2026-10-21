/**
 * "Create my food" (iOS `CreateFoodSheet`, ios-ux.md 14.5): a food the
 * library does not have, typed from its label. The rules are in
 * ./createFoodRules.ts.
 *
 * Opened from Search ("Create my food"), and by MEAL-3 from a barcode with
 * no product or no nutrition facts: then the barcode is shown read-only, the
 * name and brand may come prefilled (cut to 60 characters), and the caller
 * passes the Open Food Facts attribution to show under the note.
 *
 * "Add to meal" hands the item to the caller and closes; nothing is sent
 * until the meal is saved, and the food then shows under My foods.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type KeyboardTypeOptions, type Text } from 'react-native';

import { LPText, PrimaryButton, SegmentedControl, Sheet, SheetTextInput } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';
import type { MealItemDraft } from '../types/draft';
import { characterPrefix } from '../types/text';

import {
  createFoodErrors,
  createFoodItem,
  EMPTY_CREATE_FOOD,
  NAME_MAX,
  type CreateFoodBasis,
  type CreateFoodFields,
} from './createFoodRules';

export interface CreateFoodSheetProps {
  readonly visible: boolean;
  /** A scanned barcode: shown read-only and kept. Null: an optional typed one. */
  readonly barcode: string | null;
  readonly prefillName?: string | null;
  readonly prefillBrand?: string | null;
  /** The Open Food Facts attribution (MEAL-3), shown under the note. */
  readonly attribution?: ReactNode;
  readonly onAdd: (item: MealItemDraft) => void;
  readonly onClose: () => void;
}

export default function CreateFoodSheet(props: CreateFoodSheetProps) {
  // Each opening is a fresh form (iOS makes new @State per sheet).
  const [presentation, setPresentation] = useState(0);
  const wasVisible = useRef(props.visible);
  useEffect(() => {
    if (props.visible && !wasVisible.current) setPresentation((n) => n + 1);
    wasVisible.current = props.visible;
  }, [props.visible]);
  return <CreateFoodForm key={presentation} {...props} />;
}

function CreateFoodForm({ visible, barcode, prefillName, prefillBrand, attribution, onAdd, onClose }: CreateFoodSheetProps) {
  const { t } = useT();
  const [fields, setFields] = useState<CreateFoodFields>(() => ({
    ...EMPTY_CREATE_FOOD,
    name: prefillName ? characterPrefix(prefillName, NAME_MAX) : '',
    brand: prefillBrand ? characterPrefix(prefillBrand, NAME_MAX) : '',
  }));
  const [showErrors, setShowErrors] = useState(false);
  const titleRef = useRef<Text>(null);
  const errors = createFoodErrors(fields);
  const set = (patch: Partial<CreateFoodFields>) => setFields((current) => ({ ...current, ...patch }));
  const per100g = fields.basis === 'per100g';

  const submit = () => {
    Keyboard.dismiss();
    setShowErrors(true);
    const item = createFoodItem(fields, { scannedBarcode: barcode, defaultServingLabel: t('food.create.serving_default') });
    if (!item) return;
    onAdd(item);
    onClose();
  };

  const row = (
    key: string,
    field: keyof CreateFoodFields,
    keyboard: KeyboardTypeOptions,
    options: { readonly error?: string | null; readonly placeholder?: string } = {},
  ) => (
    <FieldRow
      title={t(key)}
      value={fields[field]}
      onChangeText={(value) => set({ [field]: value } as Partial<CreateFoodFields>)}
      keyboard={keyboard}
      placeholder={options.placeholder ?? (keyboard === 'default' ? '' : '0')}
      error={showErrors && options.error ? t(options.error) : null}
      testID={`createFood.${field}`}
    />
  );

  const servingRows = (
    <>
      {row('food.create.serving_label', 'servingLabel', 'default', { placeholder: t('food.create.serving_default') })}
      <Divider />
      {row('food.create.serving_grams', 'servingGrams', 'decimal-pad')}
    </>
  );

  return (
    <Sheet visible={visible} onClose={onClose} fullHeight initialFocusRef={titleRef} testID="createFood.sheet">
      <View style={styles.page}>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel} hitSlop={6}>
          <LPText size={15} color={colors.accentText}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {t('food.create.title')}
        </LPText>

        <View style={styles.card}>
          {row('food.create.name', 'name', 'default', { error: errors.name })}
          <Divider />
          {row('food.create.brand', 'brand', 'default')}
          <Divider />
          {barcode !== null ? (
            <View style={styles.fixedRow} accessible accessibilityLabel={`${t('food.create.barcode')}, ${barcode}`}>
              <LPText size={14} color={colors.paper2} style={styles.grow}>
                {t('food.create.barcode')}
              </LPText>
              <LPText size={15} weight="semibold" color={colors.paper} style={styles.digits} testID="createFood.scannedBarcode">
                {barcode}
              </LPText>
            </View>
          ) : (
            row('food.create.barcode', 'typedBarcode', 'number-pad', { placeholder: '' })
          )}
        </View>

        <SegmentedControl<CreateFoodBasis>
          segments={[
            { value: 'per100g', label: t('food.create.basis_100g'), testID: 'createFood.basis.per100g' },
            { value: 'perServing', label: t('food.create.basis_serving'), testID: 'createFood.basis.perServing' },
          ]}
          value={fields.basis}
          onChange={(basis) => set({ basis })}
          testID="createFood.basis"
        />

        <View style={styles.card}>
          {per100g ? (
            <>
              {row('food.create.kcal_100g', 'kcal', 'decimal-pad', { error: errors.kcal })}
              <Divider />
              {row('food.create.protein_100g', 'protein', 'decimal-pad')}
              <Divider />
              {row('food.create.carbs_100g', 'carbs', 'decimal-pad')}
              <Divider />
              {row('food.create.fat_100g', 'fat', 'decimal-pad', { error: errors.macro })}
              <Divider />
              {servingRows}
            </>
          ) : (
            <>
              {servingRows}
              <Divider />
              {row('food.create.kcal', 'kcal', 'decimal-pad', { error: errors.kcal })}
              <Divider />
              {row('food.create.protein', 'protein', 'decimal-pad')}
              <Divider />
              {row('food.create.carbs', 'carbs', 'decimal-pad')}
              <Divider />
              {row('food.create.fat', 'fat', 'decimal-pad', { error: errors.macro })}
            </>
          )}
        </View>

        <LPText size={12} color={colors.paper2}>
          {t('food.create.note')}
        </LPText>

        {attribution ?? null}

        <PrimaryButton title={t('food.create.add')} onPress={submit} testID="createFood.add" />
      </View>
    </Sheet>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function FieldRow({
  title,
  value,
  onChangeText,
  keyboard,
  placeholder,
  error,
  testID,
}: {
  readonly title: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly keyboard: KeyboardTypeOptions;
  readonly placeholder: string;
  readonly error: string | null;
  readonly testID: string;
}) {
  const text = keyboard === 'default';
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldLine}>
        <LPText size={14} color={colors.paper2} style={styles.grow}>
          {title}
        </LPText>
        <SheetTextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboard}
          placeholder={placeholder}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={title}
          autoCorrect={text}
          style={[styles.input, text ? styles.textInput : styles.numberInput]}
          testID={testID}
        />
      </View>
      {error ? (
        <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite" testID={`${testID}.error`}>
          {error}
        </LPText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16, paddingBottom: 24 },
  cancel: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  card: { backgroundColor: colors.ink2, borderRadius: radius.card, borderWidth: hairline, borderColor: colors.line, overflow: 'hidden' },
  divider: { height: hairline, backgroundColor: colors.line },
  fieldRow: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 48, gap: 4, justifyContent: 'center' },
  fieldLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fixedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 48 },
  grow: { flex: 1 },
  digits: { fontVariant: ['tabular-nums'] },
  input: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.ink3,
    fontSize: 15,
    fontWeight: '600',
    color: colors.paper,
    textAlign: 'right',
  },
  textInput: { width: 170 },
  numberInput: { width: 96 },
});
