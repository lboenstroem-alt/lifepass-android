/**
 * "Quick add calories" on a meal being reviewed or edited (iOS
 * `QuickAddSheet(target: .meal(onAdd:))`, ios-ux.md 15.5): calories, and
 * any macros, as one item that joins this meal.
 *
 * The capture page's own quick add (`.capture`, which saves at once with an
 * empty tray) is MEAL-2's; this is the editor's target only, so the meal
 * editor works on its own. Same fields, rules and words.
 *
 * Calories 1 to 5,000 (else the field turns red and says so); a macro 0 to
 * 500 g, anything else is left unknown; a blank name is "Quick add".
 */
import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { LPText, PrimaryButton, Sheet, SheetTextInput } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline, minTouch, radius } from '../../../theme';
import type { MealItemDraft } from '../types/draft';
import { quickAddDraft } from '../types/draftFactory';
import { trimWhitespace } from '../types/text';

import { quickAddKcal, quickAddMacro } from './mealEditorRules';

export interface QuickAddToMealSheetProps {
  readonly visible: boolean;
  readonly onAdd: (item: MealItemDraft) => void;
  readonly onClose: () => void;
}

const KCAL_UNIT = 'kcal';
const GRAM_UNIT = 'g';

export default function QuickAddToMealSheet({ visible, onAdd, onClose }: QuickAddToMealSheetProps) {
  const { t } = useT();
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [name, setName] = useState('');
  const [showError, setShowError] = useState(false);
  const title = useRef(null);
  const kcalInput = useRef<TextInput>(null);

  const reset = (): void => {
    setKcal('');
    setProtein('');
    setCarbs('');
    setFat('');
    setName('');
    setShowError(false);
  };

  const submit = (): void => {
    Keyboard.dismiss();
    const value = quickAddKcal(kcal);
    if (value === null) {
      setShowError(true);
      return;
    }
    const trimmed = trimWhitespace(name);
    const item = quickAddDraft({
      label: trimmed === '' ? t('food.quick.default_name') : trimmed,
      kcal: value,
      protein: quickAddMacro(protein),
      carbs: quickAddMacro(carbs),
      fat: quickAddMacro(fat),
      servingLabel: t('food.create.serving_default'),
    });
    track('food_added', { from: 'quick_add', quick: true });
    onAdd(item);
    onClose();
  };

  const macro = (key: string, value: string, onChange: (text: string) => void, testID: string) => (
    <View style={styles.macro}>
      <LPText size={11} weight="semibold" color={colors.paper2}>
        {t(key)}
      </LPText>
      <View style={styles.macroBox}>
        <SheetTextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.paper3}
          accessibilityLabel={`${t(key)}, ${GRAM_UNIT}`}
          style={styles.macroInput}
          testID={testID}
        />
        <LPText size={12} color={colors.paper2}>
          {GRAM_UNIT}
        </LPText>
      </View>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={reset}
      snapPoints={SNAP_POINTS}
      initialFocusRef={title}
      testID="quickAdd"
    >
      <View style={styles.toolbar}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} style={styles.toolbarButton}>
          <LPText size={15} color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
      <LPText ref={title} serif size={22} accessibilityRole="header">
        {t('food.quick.title')}
      </LPText>
      <View style={styles.form}>
        <View style={[styles.kcalBox, showError && styles.kcalBoxError]}>
          <SheetTextInput
            ref={kcalInput}
            value={kcal}
            onChangeText={(text) => {
              setKcal(text);
              if (showError) setShowError(false);
            }}
            keyboardType="number-pad"
            autoFocus
            placeholder="0"
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('food.quick.kcal')}
            style={styles.kcalInput}
            testID="quickAdd.kcal"
          />
          <LPText size={15} color={colors.paper2}>
            {KCAL_UNIT}
          </LPText>
        </View>
        {showError ? (
          <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite">
            {t('food.create.err.kcal')}
          </LPText>
        ) : null}
        <View style={styles.macros}>
          {macro('meal.macro.protein', protein, setProtein, 'quickAdd.protein')}
          {macro('meal.macro.carbs', carbs, setCarbs, 'quickAdd.carbs')}
          {macro('meal.macro.fat', fat, setFat, 'quickAdd.fat')}
        </View>
        <SheetTextInput
          value={name}
          onChangeText={setName}
          placeholder={t('food.quick.default_name')}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={t('food.create.name')}
          returnKeyType="done"
          style={styles.nameInput}
          testID="quickAdd.name"
        />
        <PrimaryButton title={t('food.quick.add')} onPress={submit} shape="flat" testID="quickAdd.add" />
      </View>
    </Sheet>
  );
}

const SNAP_POINTS = ['55%', '100%'];

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', marginTop: -8 },
  toolbarButton: { minHeight: minTouch, justifyContent: 'center', paddingRight: 12 },
  form: { gap: 14, paddingTop: 16, paddingBottom: 20 },
  kcalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 60,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  kcalBoxError: { borderWidth: 1, borderColor: colors.destructive },
  kcalInput: { flex: 1, fontSize: 28, fontWeight: '600', color: colors.paper, padding: 0 },
  macros: { flexDirection: 'row', gap: 8 },
  macro: { flex: 1, gap: 4 },
  macroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: minTouch,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  macroInput: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.paper, padding: 0 },
  nameInput: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    fontSize: 15,
    color: colors.paper,
  },
});
