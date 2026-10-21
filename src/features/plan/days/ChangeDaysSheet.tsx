/* eslint lifepass/no-literal-copy: "error" */
/**
 * Which days of the week the plan runs on (iOS ChangeDaysSheet.swift,
 * `ios-ux.md` 3.9.4): "Training days", "Pick {count} days.", the seven
 * weekday chips (Monday to Thursday, then Friday to Sunday), Save days, and
 * "Changes start tomorrow. Sessions you've done stay where they are."
 *
 * SAVE ONLY WITH EXACTLY `daysPerWeek` DAYS. Short of it (or past it) Save
 * is dimmed and the line under the chips says "Pick exactly {count} days."
 * (hidden, but keeping its room, once the count is right, so the sheet does
 * not jump as the member taps).
 *
 * `select` hands the days back with no call (the programme wizard);
 * `program` posts `{ trainingDays }` and nothing else (../overview/
 * programUpdate.ts) with a fresh Idempotency-Key per tap, as iOS mints one
 * per save. A plan ended or deleted elsewhere closes the sheet and the
 * caller says so; offline and other failures keep it open with a line.
 *
 * Drawn only by ./ChangeDaysHost.tsx; open it with `openChangeDays`.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { newIdempotencyKey } from '../../../api';
import { LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { updateProgram } from '../../../health';
import { useT } from '../../../i18n';
import { weekdayAbbreviation } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { colors, hairline } from '../../../theme';
import { ProgramUpdate } from '../overview/programUpdate';

import { DAY_ROWS, daysSaveErrorKey, daysSaveFailure, initialSelection, isValidSelection, toggleDay } from './daysRules';
import type { ChangeDaysMode } from './types';

export type ChangeDaysSheetProps = {
  visible: boolean;
  mode: ChangeDaysMode;
  /** The sheet closes; `after` (the caller's callback) runs once it has gone. */
  onDismiss: (after: (() => void) | null) => void;
  /** The sheet has left the screen. */
  onClosed?: () => void;
};

export default function ChangeDaysSheet({ visible, mode, onDismiss, onClosed }: ChangeDaysSheetProps) {
  const { t, language } = useT();
  const titleRef = useRef<Text>(null);
  const [picked, setPicked] = useState<number[]>(() => initialSelection(mode.selected));
  const [isSaving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const valid = isValidSelection(picked, mode.daysPerWeek);
  const count = String(mode.daysPerWeek);

  /** Closed with nothing delivered (Cancel is the pan, the backdrop or back): the caller hears a cancel. */
  const close = () => {
    if (isSaving) return;
    onDismiss(mode.onCancel ?? null);
  };

  const save = async () => {
    if (!valid || isSaving) return;
    const days = [...picked];
    if (mode.kind === 'select') {
      const onPicked = mode.onPicked;
      onDismiss(() => onPicked(days));
      return;
    }
    setSaving(true);
    setErrorKey(null);
    try {
      const response = await updateProgram(mode.programId, ProgramUpdate.trainingDays(days), newIdempotencyKey());
      track('training_days_changed');
      if (!alive.current) return;
      setSaving(false);
      const onSaved = mode.onSaved;
      onDismiss(onSaved ? () => onSaved({ program: response.program, days }) : null);
    } catch (error) {
      if (!alive.current) return;
      setSaving(false);
      const failure = daysSaveFailure(error);
      if (failure === 'changed') {
        onDismiss(mode.onChanged ?? null);
        return;
      }
      setErrorKey(daysSaveErrorKey(failure));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      onClosed={onClosed}
      busy={isSaving}
      initialFocusRef={titleRef}
      testID="days.sheet"
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            title={t('plan.days.save')}
            onPress={() => void save()}
            disabled={!valid}
            loading={isSaving}
            testID="days.save"
          />
          <LPText size={12} color={colors.paper3} align="center">
            {t('plan.days.note')}
          </LPText>
        </View>
      }
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('plan.days.title')}
          </LPText>
          <LPText size={14} color={colors.paper2}>
            {t('plan.days.body', { count })}
          </LPText>
        </View>

        <View style={styles.rows}>
          {DAY_ROWS.map((row) => (
            <View key={row.join('-')} style={styles.row}>
              {row.map((weekday) => (
                <DayChip
                  key={weekday}
                  label={weekdayAbbreviation(weekday, language)}
                  selected={picked.includes(weekday)}
                  disabled={isSaving}
                  onPress={() => setPicked((current) => toggleDay(current, weekday))}
                  testID={`days.chip.${weekday}`}
                />
              ))}
              {/* The short row keeps the chips the width of the long one (iOS Spacer). */}
              {row.length < 4 ? <View style={styles.chipSpacer} /> : null}
            </View>
          ))}
        </View>

        <View
          style={!valid ? undefined : styles.hidden}
          accessibilityElementsHidden={valid}
          importantForAccessibility={valid ? 'no-hide-descendants' : 'auto'}
        >
          <LPText size={13} color={valid ? colors.paper3 : colors.destructive} testID="days.pickN">
            {t('plan.days.pick_n', { count })}
          </LPText>
        </View>

        {errorKey ? (
          <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="days.error">
            {t(errorKey)}
          </LPText>
        ) : null}
      </View>
    </Sheet>
  );
}

/** One weekday: rust and white when picked, the card colour otherwise; a 44 dp target. */
function DayChip({
  label,
  selected,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
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
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.chip, selected ? styles.chipOn : styles.chipOff, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={14} weight={selected ? 'semibold' : 'medium'} color={selected ? colors.onAccent : colors.paper} maxScale={1.6}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18, paddingTop: 8, paddingBottom: 8 },
  header: { gap: 8 },
  rows: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  chipOn: { backgroundColor: colors.rust, borderColor: colors.rust },
  chipOff: { backgroundColor: colors.ink2, borderColor: colors.line },
  chipSpacer: { flex: 1 },
  hidden: { opacity: 0 },
  footer: { gap: 10 },
  pressed: { opacity: 0.85 },
});
