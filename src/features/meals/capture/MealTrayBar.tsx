/**
 * The tray bar (iOS `MealTrayBar`, ios-ux.md 12.3): what has been picked so
 * far, "Review >" to the meal editor, and "Save to diary" (or "Add to meal"
 * when the page was opened from a meal that already exists). A line above it
 * says why the last Save did not go through, when nothing else here can.
 *
 * Hidden while the tray is empty. The Save button waits while a save is in
 * flight, and while ten meals are already waiting to sync and that is what
 * the line says (a new offline Save could only be refused again).
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import { useIsMealOutboxFull } from '../outbox/mealOutbox';
import { mealTotals } from '../math/itemMath';

import type { MealCaptureModel } from './captureModel';
import { useCapture } from './capturePages';
import { traySummary } from './mealText';

export interface MealTrayBarProps {
  readonly model: MealCaptureModel;
  readonly onSave: () => void;
  readonly onReview: () => void;
}

export default function MealTrayBar({ model, onSave, onReview }: MealTrayBarProps) {
  const { t, tp, language } = useT();
  const tray = useCapture(model, (s) => s.tray);
  const isSaving = useCapture(model, (s) => s.isSaving);
  const saveErrorKey = useCapture(model, (s) => s.saveErrorKey);
  const outboxFull = useIsMealOutboxFull();
  if (tray.length === 0) return null;

  const summary = traySummary(mealTotals(tray), tray.length, language, t, tp);
  const isEditor = model.origin === 'editor';
  const saveTitle = t(isEditor ? 'meal.tray.add_to_meal' : 'meal.tray.save');
  const saveDisabled = isSaving || (outboxFull && !isEditor && saveErrorKey === 'meal.outbox.full');

  return (
    <View style={styles.wrap} testID="meal.trayBar">
      {saveErrorKey ? (
        <View style={styles.errorPill}>
          <LPText size={12} color={colors.paper} align="center" accessibilityLiveRegion="polite" testID="meal.saveError">
            {t(saveErrorKey)}
          </LPText>
        </View>
      ) : null}
      <View style={styles.bar}>
        <Pressable
          onPress={onReview}
          accessibilityRole="button"
          accessibilityLabel={`${summary}. ${t('meal.tray.review')}`}
          style={styles.review}
          testID="meal.tray.review"
        >
          <LPText size={14} weight="semibold" color={colors.paper} numberOfLines={1}>
            {summary}
          </LPText>
          <View style={styles.reviewRow}>
            <LPText size={12} weight="semibold" color={colors.accentText}>
              {t('meal.tray.review')}
            </LPText>
            <Ionicons name="chevron-forward" size={11} color={colors.accentText} />
          </View>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={saveDisabled}
          accessibilityRole="button"
          accessibilityLabel={saveTitle}
          accessibilityState={{ disabled: saveDisabled, busy: isSaving }}
          style={({ pressed }) => [styles.save, saveDisabled && styles.dimmed, pressed && styles.pressed]}
          testID="meal.tray.save"
        >
          {isSaving ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
          <LPText size={14} weight="semibold" color={colors.onAccent} numberOfLines={1}>
            {saveTitle}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, gap: 6, alignItems: 'stretch' },
  errorPill: {
    alignSelf: 'center',
    backgroundColor: colors.ink2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 10,
    backgroundColor: colors.ink,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: colors.line,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  review: { flex: 1, minHeight: 48, justifyContent: 'center', gap: 2 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  save: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 16,
    backgroundColor: colors.actionFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
