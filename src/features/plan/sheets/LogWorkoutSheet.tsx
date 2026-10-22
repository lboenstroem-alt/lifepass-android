/**
 * Log a workout on any day of the plan (iOS `LogWorkoutSheet`,
 * Views/Plan/LogWorkoutSheet.swift, API 0.34.0).
 *
 * WHY IT EXISTS. A rest day offered a soak, a walk and sometimes a later
 * session pulled forward, and that was all: a member who trained anyway had
 * no way to say so. The server already kept hand-logged extras on a day's
 * row; this is the door to them.
 *
 * THE PLAN DOES NOT REACT. A workout logged here is an EXTRA on the day's
 * row: a rest row stays a rest row, nothing later in the week moves, and no
 * fatigue rule reads it. The sheet says so in one line pinned above Save,
 * because "what did that do to my plan?" is the first thing a member wonders.
 *
 * THE SERVER DECIDES WHERE IT IS OFFERED (`SessionView.canLogExtra`, read by
 * the Today card through `offersLogWorkout`). This sheet only takes the
 * workout: what (six chips), how long (four presets or 1 to 300 typed), an
 * optional note (cleaned and capped at 140 UTF-16 units as the server does),
 * then `done` with `asExtra: true`. A past card sends `clientCompletedAt` at
 * noon of its date, so the server files it on that day's row.
 *
 * ONE KEY PER SUBMIT (../logWorkout/form.ts): a retry of the same Save is the
 * same request; a change, or a success, mints a new one.
 *
 * Controlled (plan 3.0.3): the Today card shows it and closes it. The sheet
 * asks to close after an answer (the card's own close follows the answer
 * too, and closing twice is harmless). Locked while a Save is in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, useWindowDimensions, View, type Text, type TextInput } from 'react-native';

import { announce, hiddenFromAccessibility, LPText, PrimaryButton, Sheet, SheetTextInput } from '../../../components/ui';
import { EXTRA_WORKOUT_CHIPS, extraWorkoutLabelKey, postSessionAction, useHealthStore } from '../../../health';
import { useT } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { colors, hairline, sans } from '../../../theme';
import ChoiceChip from '../logWorkout/ChoiceChip';
import { alreadyLoggedKey, dateLine, logWorkoutEntry, minutesSuffix, pullLine, showsPullLine } from '../logWorkout/copy';
import {
  beginSave,
  canSave,
  chooseDuration,
  chooseKind,
  CUSTOM_DURATION,
  customMinutesInvalid,
  logWorkoutBody,
  newLogWorkoutForm,
  noteLength,
  PRESET_MINUTES,
  presetDuration,
  sameDuration,
  saveFailed,
  saveSucceeded,
  setCustomMinutes,
  setNote,
  showsNoteCounter,
  type LogWorkoutForm,
} from '../logWorkout/form';
import { logWorkoutErrorKey, logWorkoutFailure } from '../logWorkout/save';
import { spokenMinutes } from '../today/copy';

import type { PlanSessionRef } from './types';

export interface LogWorkoutSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly session: PlanSessionRef;
  /** The `YYYY-MM-DD` of the card the sheet was opened from. */
  readonly cardDate: string;
  /** A later session this week a rest day could pull forward instead. */
  readonly pullCandidate?: PlanSessionRef | null;
  readonly onPull?: () => void;
  /** The server's answer: a decoded `SessionActionResponse` from the health API. */
  readonly onResult: (result: unknown) => void;
  readonly onChangedElsewhere: () => void;
}

/** The note grows to four lines, then scrolls (iOS `lineLimit(1...4)`). */
const NOTE_MAX_LINES = 4;
/** One line of the 15 pt note, and the field's vertical padding. */
const NOTE_LINE_HEIGHT = 20;
const NOTE_PADDING = 28;

export default function LogWorkoutSheet({
  visible,
  onClose,
  session,
  cardDate,
  pullCandidate = null,
  onPull,
  onResult,
  onChangedElsewhere,
}: LogWorkoutSheetProps) {
  const { t, language } = useT();
  const { fontScale } = useWindowDimensions();
  const noteMaxHeight = NOTE_PADDING + NOTE_MAX_LINES * NOTE_LINE_HEIGHT * fontScale;
  const titleRef = useRef<Text>(null);
  const minutesRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);

  // The form lives in a ref too, so a second tap in the same frame as the
  // first Save already sees `isSaving` (a double tap posts once).
  const [form, setFormState] = useState<LogWorkoutForm>(newLogWorkoutForm);
  const formRef = useRef(form);
  const update = useCallback((change: (current: LogWorkoutForm) => LogWorkoutForm) => {
    const next = change(formRef.current);
    if (next === formRef.current) return;
    formRef.current = next;
    setFormState(next);
  }, []);

  const [errorKey, setErrorKey] = useState<string | null>(null);
  // "Other" minutes puts the caret in the field once it has been drawn.
  const [minutesFocusRequest, setMinutesFocusRequest] = useState(0);
  useEffect(() => {
    if (minutesFocusRequest > 0) minutesRef.current?.focus();
  }, [minutesFocusRequest]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const today = todayServerDay();
  const saving = form.isSaving;

  const close = () => {
    if (formRef.current.isSaving) return;
    onClose();
  };

  const save = async () => {
    const day = todayServerDay();
    const current = formRef.current;
    const body = logWorkoutBody(current, cardDate, day);
    const started = beginSave(current);
    if (!body || !started) return;
    update(() => started.form);
    Keyboard.dismiss();
    setErrorKey(null);
    const kind = current.kind ?? 'other';
    try {
      const response = await postSessionAction(session.id, body, started.key);
      update(saveSucceeded);
      track('plan_extra_logged', {
        kind,
        entry: logWorkoutEntry(session),
        relative: cardDate === day ? 'today' : 'past',
      });
      onResult(response);
      // The toast says it (and TalkBack hears every toast as it appears).
      useHealthStore.getState().setToast('logworkout.saved');
      onClose();
    } catch (error) {
      update(saveFailed);
      const failure = logWorkoutFailure(error);
      if (failure === 'cancelled') return;
      if (failure === 'changed') {
        onChangedElsewhere();
        onClose();
        return;
      }
      if (alive.current) setErrorKey(logWorkoutErrorKey(failure));
      // Five on one day: the row is full until one is removed.
      if (failure === 'limit') announce(t('logworkout.limit'));
    }
  };

  // ---- The lines about this day ------------------------------------------

  const pullDate = pullCandidate?.scheduledFor ?? null;
  const pull = pullDate && showsPullLine(session, { cardDate, today }) ? pullLine(pullDate, t) : null;
  const alreadyKey = alreadyLoggedKey(session);

  // ---- Minutes -----------------------------------------------------------

  const isCustom = form.duration?.kind === 'custom';
  const minutesInvalid = customMinutesInvalid(form);

  const choosePreset = (minutes: number) => {
    update((current) => chooseDuration(current, presetDuration(minutes)));
    if (minutesRef.current?.isFocused()) minutesRef.current.blur();
    setErrorKey(null);
  };

  const chooseOther = () => {
    update((current) => chooseDuration(current, CUSTOM_DURATION));
    setErrorKey(null);
    setMinutesFocusRequest((count) => count + 1);
  };

  const typeNote = (typed: string) => {
    // Return is the keyboard's Done here: a line break would otherwise
    // become a space while the keyboard stays up.
    if (typed.endsWith('\n')) {
      update((current) => setNote(current, typed.slice(0, -1)));
      noteRef.current?.blur();
    } else {
      update((current) => setNote(current, typed));
    }
  };

  const footer = (
    <View style={styles.footer}>
      {/* Always in view: what Save does to the plan (nothing) is the question a rest day raises. */}
      <LPText size={12} color={colors.paper2}>
        {t('logworkout.footer')}
      </LPText>
      {errorKey ? (
        <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="logworkout.error">
          {t(errorKey)}
        </LPText>
      ) : null}
      <PrimaryButton
        title={t('logworkout.save')}
        onPress={() => void save()}
        disabled={!canSave(form) && !saving}
        loading={saving}
        shape="flat"
        style={styles.capsule}
        testID="logworkout.save"
      />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={close} busy={saving} initialFocusRef={titleRef} footer={footer} testID="logworkout.sheet">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleColumn}>
              <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header" testID="logworkout.title">
                {t('logworkout.title')}
              </LPText>
              <LPText size={13} color={colors.paper2} testID="logworkout.date">
                {dateLine(cardDate, today, t, language)}
              </LPText>
            </View>
            <Pressable
              onPress={close}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              accessibilityState={{ disabled: saving }}
              hitSlop={8}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              testID="logworkout.cancel"
            >
              <LPText size={14} weight="semibold" color={colors.paper2}>
                {t('common.cancel')}
              </LPText>
            </Pressable>
          </View>

          {/* What this day already holds, read before anything is chosen:
              a later session it could be, or the watch or a visit counted it.
              The sheet's whole width, so a long weekday never breaks. */}
          {pull ? (
            <Pressable
              onPress={() => {
                onClose();
                onPull?.();
              }}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={pull}
              style={({ pressed }) => [styles.pull, pressed && styles.pressed]}
              testID="logworkout.pull"
            >
              <LPText size={13} weight="semibold" color={colors.rust}>
                {pull}
              </LPText>
            </Pressable>
          ) : null}
          {alreadyKey ? (
            <LPText size={13} color={colors.paper2} style={styles.already} testID="logworkout.already">
              {t(alreadyKey)}
            </LPText>
          ) : null}
        </View>

        <View style={styles.section}>
          <LPText size={14} weight="semibold" color={colors.paper} accessibilityRole="header">
            {t('logworkout.kind_q')}
          </LPText>
          <View style={styles.flow}>
            {EXTRA_WORKOUT_CHIPS.map((kind) => (
              <ChoiceChip
                key={kind}
                title={t(extraWorkoutLabelKey(kind))}
                selected={form.kind === kind}
                disabled={saving}
                onPress={() => {
                  update((current) => chooseKind(current, kind));
                  setErrorKey(null);
                }}
                testID={`logworkout.kind.${kind}`}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <LPText size={14} weight="semibold" color={colors.paper} accessibilityRole="header">
            {t('logworkout.minutes_q')}
          </LPText>
          <View style={styles.flow}>
            {PRESET_MINUTES.map((minutes) => (
              <ChoiceChip
                key={minutes}
                title={t('logworkout.minutes_chip', { minutes: `${minutes}` })}
                spoken={spokenMinutes(minutes, t, language)}
                selected={sameDuration(form.duration, presetDuration(minutes))}
                disabled={saving}
                onPress={() => choosePreset(minutes)}
                testID={`logworkout.minutes.${minutes}`}
              />
            ))}
            <ChoiceChip
              title={t('logworkout.minutes_other')}
              selected={isCustom}
              disabled={saving}
              onPress={chooseOther}
              testID="logworkout.minutes.other"
            />
          </View>

          {isCustom ? (
            <View style={styles.customBlock}>
              <View style={[styles.field, styles.minutesRow, minutesInvalid && styles.fieldInvalid]}>
                <SheetTextInput
                  ref={minutesRef}
                  value={form.customMinutesText}
                  onChangeText={(raw) => update((current) => setCustomMinutes(current, raw))}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  editable={!saving}
                  placeholder={t('logworkout.minutes_field')}
                  placeholderTextColor={colors.paper3}
                  accessibilityLabel={t('logworkout.minutes_field')}
                  accessibilityState={{ disabled: saving }}
                  style={[styles.input, styles.minutesInput]}
                  testID="logworkout.minutes.field"
                />
                <LPText size={15} color={colors.paper2} {...hiddenFromAccessibility}>
                  {minutesSuffix(t)}
                </LPText>
              </View>
              {minutesInvalid ? (
                <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite" testID="logworkout.minutes.range">
                  {t('logworkout.minutes_range')}
                </LPText>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.noteSection}>
          <LPText size={14} weight="semibold" color={colors.paper} accessibilityRole="header">
            {t('logworkout.note_label')}
          </LPText>
          <SheetTextInput
            ref={noteRef}
            value={form.note}
            onChangeText={typeNote}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            editable={!saving}
            placeholder={t('logworkout.note_placeholder')}
            placeholderTextColor={colors.paper3}
            accessibilityLabel={t('logworkout.note_label')}
            accessibilityState={{ disabled: saving }}
            style={[styles.field, styles.input, styles.note, { maxHeight: noteMaxHeight }]}
            testID="logworkout.note"
          />
          {showsNoteCounter(form) ? (
            <LPText size={12} color={colors.paper3} align="right" testID="logworkout.note.count">
              {t('logworkout.note_count', { count: `${noteLength(form)}` })}
            </LPText>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { gap: 22, paddingTop: 8, paddingBottom: 16 },
  header: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleColumn: { flex: 1, gap: 4 },
  cancel: { minHeight: 44, justifyContent: 'center' },
  pull: { minHeight: 44, justifyContent: 'center' },
  already: { paddingTop: 4 },
  section: { gap: 10 },
  noteSection: { gap: 8 },
  flow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customBlock: { gap: 6 },
  field: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    paddingHorizontal: 14,
  },
  fieldInvalid: { borderWidth: 1, borderColor: colors.destructive },
  minutesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { ...sans(15), color: colors.paper },
  minutesInput: { ...sans(17), flex: 1, paddingVertical: 12 },
  note: { paddingVertical: 14, textAlignVertical: 'top' },
  footer: { gap: 8 },
  capsule: { borderRadius: 999 },
  pressed: { opacity: 0.75 },
});
