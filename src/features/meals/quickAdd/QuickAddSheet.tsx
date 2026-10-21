/**
 * Quick add (iOS `QuickAddSheet`, ios-ux.md 15.5): calories for something
 * with no row to pick, with optional macros and a name.
 *
 * WHERE IT GOES (`target`):
 *   capture  the meal page. With an EMPTY tray (and not the editor's Add
 *            food page) the button reads "Save to diary" and saves at once
 *            as a meal of its own (source quick_add), closing the page; else
 *            it reads "Add to meal" and joins the tray ("Added").
 *   meal     a meal editor (MEAL-4): the item joins that meal.
 *
 * The kcal field has the keyboard when the sheet opens. A comma or a dot
 * both work as the decimal separator.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View, type Text, type TextInput } from 'react-native';

import { LPText, Sheet, SheetTextInput } from '../../../components/ui';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline } from '../../../theme';
import { useCaptureIfAny } from '../capture/capturePages';
import { showMealToast } from '../capture/saveFeedback';

import { quickAddItem, quickAddKcal, savesAtOnce, type QuickAddTarget } from './quickAddRules';

export type { QuickAddTarget } from './quickAddRules';


export interface QuickAddSheetProps {
  readonly visible: boolean;
  readonly target: QuickAddTarget;
  /** Cancel, back, a pan down, or after the item went where it goes. */
  readonly onClose: () => void;
  /** The in-page toast's distance from the bottom (the meal page's, by its tray). */
  readonly toastOffset?: number;
}

export default function QuickAddSheet(props: QuickAddSheetProps) {
  // Each opening is a fresh form (iOS makes new @State per sheet).
  const [presentation, setPresentation] = useState(0);
  const wasVisible = useRef(props.visible);
  useEffect(() => {
    if (props.visible && !wasVisible.current) setPresentation((n) => n + 1);
    wasVisible.current = props.visible;
  }, [props.visible]);
  return <QuickAddForm key={presentation} {...props} />;
}

function QuickAddForm({ visible, target, onClose, toastOffset }: QuickAddSheetProps) {
  const { t } = useT();
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [name, setName] = useState('');
  const [showError, setShowError] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const titleRef = useRef<Text>(null);
  const kcalRef = useRef<TextInput>(null);
  const trayCount = useTrayCount(target);
  const atOnce = savesAtOnce(target, trayCount);

  // The kcal field has the keyboard on open (iOS `focus = 0`).
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => kcalRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [visible]);

  const submit = async () => {
    Keyboard.dismiss();
    if (isSaving) return;
    const kcalValue = quickAddKcal(kcal);
    if (kcalValue === null) {
      setShowError(true);
      return;
    }
    const item = quickAddItem({
      kcal: kcalValue,
      protein,
      carbs,
      fat,
      name,
      defaultName: t('food.quick.default_name'),
      servingLabel: t('food.create.serving_default'),
    });
    track('food_added', { from: 'quick_add', quick: true });
    if (target.kind === 'meal') {
      target.onAdd(item);
      onClose();
      return;
    }
    const { model } = target;
    model.add([item], 'quick_add');
    if (atOnce) {
      setSaving(true);
      await model.commitTray();
      setSaving(false);
      onClose();
      return;
    }
    showMealToast(t('food.added'), { bottomOffset: toastOffset });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} busy={isSaving} initialFocusRef={titleRef} testID="quickAdd.sheet">
      <View style={styles.page}>
        <Pressable onPress={onClose} disabled={isSaving} accessibilityRole="button" style={styles.cancel} hitSlop={6}>
          <LPText size={15} color={colors.accentText}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
        <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header">
          {t('food.quick.title')}
        </LPText>

        <View style={[styles.kcalBox, showError && styles.kcalError]}>
          <SheetTextInput
            ref={kcalRef}
            value={kcal}
            onChangeText={setKcal}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('food.quick.kcal')}
            style={styles.kcalInput}
            testID="quickAdd.kcal"
          />
          <Unit unit="kcal" size={15} />
        </View>
        {showError ? (
          <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite" testID="quickAdd.error">
            {t('food.create.err.kcal')}
          </LPText>
        ) : null}

        <View style={styles.macros}>
          <MacroField titleKey="meal.macro.protein" text={protein} onChangeText={setProtein} testID="quickAdd.protein" />
          <MacroField titleKey="meal.macro.carbs" text={carbs} onChangeText={setCarbs} testID="quickAdd.carbs" />
          <MacroField titleKey="meal.macro.fat" text={fat} onChangeText={setFat} testID="quickAdd.fat" />
        </View>

        <SheetTextInput
          value={name}
          onChangeText={setName}
          placeholder={t('food.quick.default_name')}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={t('food.create.name')}
          style={styles.nameInput}
          maxLength={200}
          testID="quickAdd.name"
        />

        <Pressable
          onPress={() => void submit()}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving, busy: isSaving }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          testID="quickAdd.submit"
        >
          {isSaving ? <ActivityIndicator color={colors.onAccent} /> : null}
          <LPText size={15} weight="semibold" color={colors.onAccent}>
            {t(atOnce ? 'meal.tray.save' : 'food.quick.add')}
          </LPText>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** The tray's size, for a capture target (0 for a meal). */
function useTrayCount(target: QuickAddTarget): number {
  return useCaptureIfAny(target.kind === 'capture' ? target.model : null, (s) => s.tray.length);
}

/** A unit after a number ("kcal", "g"): the same in both languages, as iOS writes it. */
function Unit({ unit, size }: { readonly unit: string; readonly size: number }) {
  return (
    <LPText size={size} color={colors.paper2}>
      {unit}
    </LPText>
  );
}

/** The gram sign (iOS writes "g" in both languages). */
const GRAMS = 'g';

function MacroField({
  titleKey,
  text,
  onChangeText,
  testID,
}: {
  readonly titleKey: string;
  readonly text: string;
  readonly onChangeText: (text: string) => void;
  readonly testID: string;
}) {
  const { t } = useT();
  return (
    <View style={styles.macro}>
      <LPText size={11} weight="semibold" color={colors.paper2}>
        {t(titleKey)}
      </LPText>
      <View style={styles.macroBox}>
        <SheetTextInput
          value={text}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.paper3}
          accessibilityLabel={[t(titleKey), GRAMS].join(', ')}
          style={styles.macroInput}
          testID={testID}
        />
        <Unit unit={GRAMS} size={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14, paddingBottom: 20 },
  cancel: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  kcalBox: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  kcalError: { borderWidth: 1, borderColor: colors.destructive },
  kcalInput: { flex: 1, fontSize: 28, fontWeight: '600', color: colors.paper, paddingVertical: 0 },
  macros: { flexDirection: 'row', gap: 8 },
  macro: { flex: 1, gap: 4 },
  macroBox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  macroInput: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.paper, paddingVertical: 0 },
  nameInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.paper,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  button: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.actionFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: { opacity: 0.85 },
});
