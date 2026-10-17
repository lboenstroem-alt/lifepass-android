/**
 * Weight, height and the calorie goal (`ios-ux.md` 6): the Android port of
 * iOS Views/Health/BodySheet.swift.
 *
 * THREE MODES. `intake` is the programme wizard's body question: it returns
 * the values and sends nothing. `update` is Plan's overview and nutrition
 * card: a weigh-in, and for a live programme the sex, age band and activity
 * it plans with. `goal` is a calorie goal without a workout plan.
 *
 * WHAT THIS SHEET PROMISES, IN ITS OWN FOOTER: the exact numbers stay in the
 * account and the AI never sees them. That is not decoration. The wizard
 * hands these values straight to the build request, where the SERVER turns
 * them into bands before any model call, and nothing on the phone ever puts
 * a weight or a height into a chat bubble, a note, an analytics param or a
 * saved session. The optional TARGET WEIGHT (a lose or gain goal, on a
 * server that advertises `target_weight`) is the same promise: the bubble
 * says "with a target weight", never which.
 *
 * Every field holds TEXT parsed with F1's HealthFormat port, never a number
 * input: "72,5" and "72.5" both mean 72.5 whatever the phone's region.
 *
 * SAVE ORDER: the weigh-in first (when the weight or height changed), so the
 * server has the numbers before it recomputes any target from them; then the
 * calorie goal (`PUT /health/nutrition-goal`) or the live programme's
 * changed details (`POST /health/programs/{id}`). A `422 program_refused`
 * keeps the sheet open and clears nothing, with a line saying why: the
 * member must be able to change the refused goal without typing their body
 * in again.
 *
 * Android: the sheet cannot be closed by hand while a save is in flight (on
 * iOS a swipe could hide a refusal that then arrived unseen).
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type Text } from 'react-native';

import {
  isApiError,
  isCancellation,
  isOffline as isOfflineError,
  isProblem,
  newIdempotencyKey,
  problemOf,
} from '../../../api';
import { setNutritionGoal } from '../../../api/nutritionGoal';
import { formatDecimalInput } from '../../../components/ui/numberInput';
import { Chip, ChipRow, Dialog, LPText, PrimaryButton, Sheet, ToggleRow } from '../../../components/ui';
import {
  addMeasurement,
  fetchNutritionGoalEnvelope,
  livePlanGoal,
  mayTakeTarget,
  selectHasLiveProgram,
  updateProgram,
  useHealthStore,
  type NutritionGoalView,
  type TargetWeightView,
} from '../../../health';
import { decimal } from '../../../i18n/format';
import { useT, type Lang } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { selectIsKennitalaVerified, selectSupportsTargetWeight, useAppStore } from '../../../stores/appStore';
import { colors, hairline, radius } from '../../../theme';
import { bodyShowsReachedNote, bodyTargetPrefillKg } from '../target/logic';
import { TargetWeightRules, type TargetDirection } from '../target/rules';

import {
  bodyCanSubmit,
  bodyTargetProblem,
  clearGoalInput,
  customKcalError,
  CUSTOM_KCAL_RANGE,
  detailsSnapshot,
  goalSaveInput,
  heightFieldError,
  parseHeight,
  parseWeight,
  programBodyUpdate,
  refusalKeyFor,
  targetAnalyticsWord,
  targetValueOf,
  weightErrorKey,
  type DetailsSnapshot,
} from './model';
import { NoteBox, NumberField, PrivacyLine, QuietButton, useAnnounceChange } from './parts';
import {
  activityLabelKey,
  ageBandLabelKey,
  BODY_HEIGHT_RANGE,
  BODY_WEIGHT_RANGE,
  CALORIE_GOALS,
  calorieGoalLabelKey,
  knownValue,
  PROGRAM_ACTIVITIES,
  PROGRAM_AGE_BANDS,
  PROGRAM_SEXES,
  sexLabelKey,
  type BodyDetails,
  type BodySheetMode,
  type ProgramActivity,
  type ProgramAgeBand,
  type ProgramSex,
} from './types';

export type BodySheetProps = {
  visible: boolean;
  mode: BodySheetMode;
  /** The sheet closes; `after` (the caller's callback) runs once it has gone. */
  onDismiss: (after: (() => void) | null) => void;
  /** The sheet has left the screen. */
  onClosed?: () => void;
};

/** What the sheet opens with (iOS `prepare`, the part that needs no network). */
interface Opening {
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly kennitalaVerified: boolean;
  readonly sex: ProgramSex | null;
  readonly ageBand: ProgramAgeBand | null;
  readonly activity: ProgramActivity;
  readonly storedTarget: TargetWeightView | null;
  readonly targetPrefillKg: number | null;
  readonly targetText: string;
}

function targetDirectionFor(mode: BodySheetMode, goal: string | null): TargetDirection | null {
  switch (mode.kind) {
    case 'intake':
      return TargetWeightRules.directionForProgramGoal(mode.prefill.goal);
    case 'goal':
      return TargetWeightRules.directionForCalorieGoal(goal);
    case 'update':
      return null;
  }
}

function kgText(kg: number | null, language: Lang): string {
  return kg === null ? '' : formatDecimalInput(kg, language, 1);
}

function openingValues(
  mode: BodySheetMode,
  latest: {
    readonly weightKg: number | null;
    readonly heightCm: number | null;
  } | null,
  accountVerified: boolean,
  language: Lang,
): Opening {
  if (mode.kind !== 'intake') {
    return {
      weightKg: latest?.weightKg ?? null,
      heightCm: latest?.heightCm ?? null,
      kennitalaVerified: accountVerified,
      sex: null,
      ageBand: null,
      activity: 'light',
      storedTarget: null,
      targetPrefillKg: null,
      targetText: '',
    };
  }
  const { prefill } = mode;
  // Opened again from the summary or "Change the target": what this wizard
  // was already told, not a blank form.
  const details = prefill.details ?? null;
  const storedTarget = prefill.target ?? null;
  const prefillKg = bodyTargetPrefillKg(TargetWeightRules.directionForProgramGoal(prefill.goal), storedTarget);
  // A target this wizard already took wins over the stored one in the FIELD,
  // while "touched" is still judged against the stored one: that is what
  // decides whether the build sends it.
  const targetText = details?.targetWeightTouched
    ? kgText(details.targetWeightKg, language)
    : kgText(prefillKg, language);
  return {
    weightKg: details ? details.weightKg : (prefill.weightKg ?? null),
    heightCm: details ? details.heightCm : (prefill.heightCm ?? null),
    kennitalaVerified: prefill.kennitalaVerified,
    sex: details?.sex ?? null,
    ageBand: details?.ageBand ?? null,
    activity: details?.activity ?? 'light',
    storedTarget,
    targetPrefillKg: prefillKg,
    targetText,
  };
}

/** The answer a close with nothing chosen gives (an intake's `cancelled`). */
function cancelOf(mode: BodySheetMode): (() => void) | null {
  return mode.kind === 'intake' ? () => mode.onResult({ kind: 'cancelled' }) : null;
}

export default function BodySheet({ visible, mode, onDismiss, onClosed }: BodySheetProps) {
  const { t, language } = useT();
  const supportsTargetWeight = useAppStore(selectSupportsTargetWeight);
  const accountVerified = useAppStore(selectIsKennitalaVerified);
  const profileProgram = useAppStore((s) => s.profile?.health?.program ?? null);
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const dayProgram = useHealthStore((s) => s.today?.program ?? null);
  const isOffline = useHealthStore((s) => s.lastError?.isOffline === true);

  const isIntake = mode.kind === 'intake';
  const isGoal = mode.kind === 'goal';
  const programId = mode.kind === 'update' ? mode.programId : null;

  // Read once per presentation: the host gives every opening its own sheet.
  const [opening] = useState(() =>
    openingValues(mode, useAppStore.getState().profile?.health?.latest ?? null, accountVerified, language),
  );
  const kennitalaVerified = opening.kennitalaVerified;

  const [weightText, setWeightText] = useState(() => kgText(opening.weightKg, language));
  const [heightText, setHeightText] = useState(() => (opening.heightCm === null ? '' : String(opening.heightCm)));
  const [ageBand, setAgeBand] = useState<ProgramAgeBand | null>(opening.ageBand);
  const [sex, setSex] = useState<ProgramSex | null>(opening.sex);
  const [activity, setActivity] = useState<ProgramActivity>(opening.activity);
  const [goal, setGoal] = useState<string | null>(null);
  const [customOn, setCustomOn] = useState(false);
  const [customKcalText, setCustomKcalText] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [isLoadingGoal, setLoadingGoal] = useState(isGoal);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refusalKey, setRefusalKey] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [existingGoal, setExistingGoal] = useState<NutritionGoalView | null>(null);
  const [initialDetails, setInitialDetails] = useState<DetailsSnapshot>(() =>
    detailsSnapshot(opening, opening.kennitalaVerified),
  );
  // The target weight (`SPEC` 6.1). `targetPrefillKg` is the value the field
  // opened with from the STORED target, so Save can tell "left alone" from
  // "changed" and send the key only for the latter.
  const [targetText, setTargetText] = useState(opening.targetText);
  const [targetPrefillKg, setTargetPrefillKg] = useState<number | null>(opening.targetPrefillKg);
  const [storedTarget, setStoredTarget] = useState<TargetWeightView | null>(opening.storedTarget);

  const idempotencyKey = useRef(newIdempotencyKey());
  const saving = useRef(false);
  const alive = useRef(true);
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Prefill from the stored target when it points this goal's way and is not reached; else empty. */
  const applyStoredTargetPrefill = useCallback(
    (direction: TargetDirection | null, stored: TargetWeightView | null) => {
      const kg = bodyTargetPrefillKg(direction, stored);
      setTargetPrefillKg(kg);
      setTargetText(kgText(kg, language));
    },
    [language],
  );

  // Counted once per presentation.
  useEffect(() => {
    track('body_sheet_opened', { mode: mode.kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Goal mode reads the standing goal and target first. A failed read leaves
  // an empty form, as iOS's `try?` does: the member can still set a goal.
  useEffect(() => {
    if (mode.kind !== 'goal') return;
    let current = true;
    (async () => {
      try {
        const envelope = await fetchNutritionGoalEnvelope(language);
        if (!current) return;
        useAppStore.getState().noteServerFeatures(envelope.features);
        const stored = envelope.targetWeight;
        setStoredTarget(stored);
        const loaded = envelope.goal;
        if (!loaded) {
          applyStoredTargetPrefill(null, stored);
          return;
        }
        setExistingGoal(loaded);
        setGoal(loaded.goal);
        const loadedSex = knownValue(PROGRAM_SEXES, loaded.sex);
        const loadedBand = knownValue(PROGRAM_AGE_BANDS, loaded.ageBand);
        const loadedActivity = knownValue(PROGRAM_ACTIVITIES, loaded.activity);
        if (loadedSex) setSex(loadedSex);
        if (loadedBand) setAgeBand(loadedBand);
        if (loadedActivity) setActivity(loadedActivity);
        if (loaded.customKcal !== null) {
          setCustomOn(true);
          setCustomKcalText(String(loaded.customKcal));
        }
        applyStoredTargetPrefill(TargetWeightRules.directionForCalorieGoal(loaded.goal), stored);
        setInitialDetails(
          detailsSnapshot(
            {
              sex: loadedSex ?? null,
              ageBand: loadedBand ?? null,
              activity: loadedActivity ?? 'light',
            },
            kennitalaVerified,
          ),
        );
      } catch {
        // Nothing to prefill.
      } finally {
        if (current) setLoadingGoal(false);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Derived (iOS computed properties)

  const showsDetails = isIntake || isGoal || programId !== null;
  const needsAgeBand = !kennitalaVerified;
  const weightValue = parseWeight(weightText);
  const heightValue = parseHeight(heightText);
  const weightError = weightErrorKey({
    weightText,
    heightText,
    prefilledHeightCm: opening.heightCm,
    isIntake,
  });
  const heightError = heightFieldError(heightText);
  const customError = customKcalError(customOn, customKcalText);

  const direction = targetDirectionFor(mode, goal);
  // Never in update mode, never against a server that has not shipped it.
  const showsTarget = supportsTargetWeight && direction !== null;
  const targetValue = targetValueOf(targetText);
  const targetProblem = bodyTargetProblem({
    showsTarget,
    direction,
    targetText,
    weightText,
    heightText,
  });
  const targetErrorText = targetProblem
    ? t(
        TargetWeightRules.problemKey(targetProblem),
        targetProblem.kind === 'bmiLow' ? { kg: decimal(targetProblem.minKg, language) } : undefined,
      )
    : null;
  // Emptying a prefilled field is a change too: it removes the target.
  const targetTouched = showsTarget && targetValue !== targetPrefillKg;
  const reachedNote = bodyShowsReachedNote(showsTarget, direction, storedTarget);

  const currentDetails = detailsSnapshot({ sex, ageBand, activity }, kennitalaVerified);
  const canSubmit = bodyCanSubmit({
    kind: mode.kind,
    weightErrorKey: weightError,
    heightError,
    customError,
    targetErrorKey: targetProblem ? TargetWeightRules.problemKey(targetProblem) : null,
    weightText,
    heightText,
    needsAgeBand,
    ageBand,
    goal,
  });

  // 6.8: a red line under a field says nothing to TalkBack.
  useAnnounceChange(weightError ? t(weightError) : null);
  useAnnounceChange(heightError ? t('body.err.height') : null);
  useAnnounceChange(customError ? t('goal.err.custom') : null);
  useAnnounceChange(errorKey ? t(errorKey) : null);
  useAnnounceChange(refusalKey ? t(refusalKey) : null);
  useAnnounceChange(targetErrorText);

  // ---- Actions

  const close = () => {
    if (saving.current) return;
    onDismiss(cancelOf(mode));
  };

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setSaving(true);
    setErrorKey(null);
    setRefusalKey(null);
    const finish = () => {
      saving.current = false;
      if (alive.current) setSaving(false);
    };
    try {
      // The weigh-in first, so the server has the numbers before it
      // recomputes any target from them.
      const weightChanged = weightValue !== null && weightValue !== opening.weightKg;
      const heightChanged = heightValue !== null && heightValue !== opening.heightCm;
      if ((weightChanged || heightChanged) && weightValue !== null) {
        await addMeasurement(
          {
            weightKg: weightValue,
            heightCm: heightValue ?? undefined,
            source: 'self_reported',
          },
          idempotencyKey.current,
        );
      }

      if (mode.kind === 'goal') {
        const envelope = await setNutritionGoal(
          goalSaveInput({
            goal,
            sex,
            ageBand,
            kennitalaVerified,
            activity,
            customOn,
            customKcalText,
            targetTouched,
            targetValue,
          }),
          newIdempotencyKey(),
        );
        useAppStore.getState().noteServerFeatures(envelope.features);
        track('nutrition_goal_saved', { outcome: 'set' });
        if (targetTouched) {
          track('target_weight_saved', {
            outcome: targetValue === null ? 'cleared' : 'set',
            surface: 'body_sheet',
          });
        }
      } else if (programId !== null) {
        // 6.5: only the fields that changed, and no call at all when none did.
        const update = programBodyUpdate(initialDetails, currentDetails);
        if (update) await updateProgram(programId, update, newIdempotencyKey());
      }

      track('body_sheet_saved', {
        mode: isGoal ? 'goal' : 'update',
        field: isGoal ? 'goal' : 'weight_height',
        target: targetAnalyticsWord(targetTouched, targetValue),
      });
      finish();
      onDismiss(mode.kind === 'intake' ? null : (mode.onSaved ?? null));
    } catch (error) {
      finish();
      if (!alive.current) return;
      handleSaveError(error);
    }
  };

  function handleSaveError(error: unknown): void {
    if (!isApiError(error)) {
      setErrorKey('common.error_body');
      return;
    }
    if (isCancellation(error)) return;
    if (isProblem(error, 'program_refused')) {
      // The sheet STAYS OPEN and clears nothing.
      const reason = error.reason;
      track('nutrition_goal_saved', { outcome: 'refused' });
      setRefusalKey(refusalKeyFor(reason));
      if (reason?.startsWith('target_weight_')) {
        track('target_weight_saved', {
          outcome: 'refused',
          surface: 'body_sheet',
        });
      }
      return;
    }
    if (
      isProblem(error, 'invalid_nutrition_goal') &&
      (problemOf(error)?.errors ?? []).some((entry) => entry.field?.endsWith('targetWeightKg'))
    ) {
      setErrorKey('target.err.server');
      return;
    }
    if (isOfflineError(error)) {
      setErrorKey('health.offline.action_hint');
      return;
    }
    if (isProblem(error, 'idempotency_key_reused')) {
      idempotencyKey.current = newIdempotencyKey();
      setErrorKey('common.error_body');
      return;
    }
    const outcome = useHealthStore.getState().handle(error, { foreground: true });
    if (outcome === 'gate' || outcome === 'minor') onDismiss(null);
    else setErrorKey('common.error_body');
  }

  const primaryAction = () => {
    Keyboard.dismiss();
    if (!canSubmit) return;
    if (mode.kind === 'intake') {
      if (weightValue === null || heightValue === null) return;
      track('body_sheet_saved', {
        mode: 'intake',
        field: 'details',
        target: targetAnalyticsWord(targetTouched, targetValue),
      });
      // Nothing is sent from here: the target travels with the build and is
      // stored only if the member starts the plan it made.
      const details: BodyDetails = {
        weightKg: weightValue,
        heightCm: heightValue,
        ageBand: kennitalaVerified ? null : ageBand,
        sex,
        activity,
        targetWeightKg: showsTarget ? targetValue : null,
        targetWeightTouched: targetTouched,
      };
      const { onResult } = mode;
      onDismiss(() => onResult({ kind: 'used', details }));
      return;
    }
    void save();
  };

  const skip = () => {
    if (mode.kind !== 'intake') return;
    track('body_sheet_skipped');
    const { onResult } = mode;
    onDismiss(() => onResult({ kind: 'skipped' }));
  };

  const clearGoal = async () => {
    if (saving.current) return;
    saving.current = true;
    setSaving(true);
    try {
      const liveProgramTakesTarget = mayTakeTarget(livePlanGoal(dayProgram, profileProgram));
      const envelope = await setNutritionGoal(
        clearGoalInput({
          supportsTargetWeight,
          hasStoredTarget: storedTarget !== null,
          liveProgramTakesTarget,
        }),
        newIdempotencyKey(),
      );
      useAppStore.getState().noteServerFeatures(envelope.features);
      track('nutrition_goal_saved', { outcome: 'cleared' });
      saving.current = false;
      if (alive.current) setSaving(false);
      onDismiss(mode.kind === 'goal' ? (mode.onSaved ?? null) : null);
    } catch {
      saving.current = false;
      if (!alive.current) return;
      setSaving(false);
      setErrorKey('common.error_body');
    }
  };

  /** A goal chip: a change of direction invalidates whatever the target field held; keep my weight hides it. */
  const pickGoal = (value: string) => {
    const before = TargetWeightRules.directionForCalorieGoal(goal);
    const after = TargetWeightRules.directionForCalorieGoal(value);
    setGoal(value);
    setRefusalKey(null);
    if (after !== before) applyStoredTargetPrefill(after, storedTarget);
  };

  const primaryTitle = isIntake ? t('body.use') : t(isGoal ? 'goal.save' : 'body.save');
  const busy = isSaving || isLoadingGoal;
  const targetFallback = weightValue ?? opening.weightKg ?? 70;

  const ageBlock = kennitalaVerified ? (
    <LPText size={13} color={colors.paper2}>
      {t('body.age_from_kennitala')}
    </LPText>
  ) : (
    <View style={styles.block}>
      <LPText size={13} weight="semibold" color={colors.paper2} accessibilityRole="header">
        {t('body.age')}
      </LPText>
      <ChipRow>
        {PROGRAM_AGE_BANDS.map((band) => (
          <Chip
            key={band}
            label={t(ageBandLabelKey(band))}
            selected={ageBand === band}
            onPress={() => setAgeBand(band)}
            testID={`body.age.${band}`}
          />
        ))}
      </ChipRow>
      {ageBand === null && (isIntake || isGoal) ? (
        <LPText size={12} color={colors.paper2}>
          {t('body.err.age')}
        </LPText>
      ) : null}
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={close}
      onClosed={onClosed}
      busy={isSaving}
      fullHeight
      initialFocusRef={titleRef}
      testID="body.sheet"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t(isGoal ? 'goal.title' : 'body.title')}
          </LPText>
          <LPText size={14} color={colors.paper2}>
            {t(isGoal ? 'goal.why' : 'body.why')}
          </LPText>
        </View>

        {isGoal ? (
          <View style={styles.goalChips}>
            <View style={styles.chipLine}>
              {CALORIE_GOALS.map((value) => (
                <Chip
                  key={value}
                  label={t(calorieGoalLabelKey(value))}
                  selected={goal === value}
                  onPress={() => pickGoal(value)}
                  shape="rounded"
                  grow
                  testID={`body.goal.${value}`}
                />
              ))}
            </View>
            {hasLiveProgram ? (
              <LPText size={12} color={colors.paper2}>
                {t('goal.overridden')}
              </LPText>
            ) : null}
          </View>
        ) : null}

        <NumberField
          label={t('body.weight')}
          text={weightText}
          onChangeText={setWeightText}
          unit="kg"
          spokenUnit={t('a11y.unit.kg')}
          step={0.1}
          min={BODY_WEIGHT_RANGE.min}
          max={BODY_WEIGHT_RANGE.max}
          fallback={opening.weightKg ?? 70}
          error={weightError ? t(weightError) : null}
          testID="body.weight"
        />
        <NumberField
          label={t('body.height')}
          text={heightText}
          onChangeText={setHeightText}
          unit="cm"
          spokenUnit={t('a11y.unit.cm')}
          step={1}
          min={BODY_HEIGHT_RANGE.min}
          max={BODY_HEIGHT_RANGE.max}
          fallback={opening.heightCm ?? 170}
          integer
          error={heightError ? t('body.err.height') : null}
          testID="body.height"
        />

        {showsTarget ? (
          // Directly under the height field (`SPEC` 6.1).
          <View style={styles.block}>
            {reachedNote ? <NoteBox text={t('target.reached_prefill_note')} testID="body.target.reached" /> : null}
            <NumberField
              label={t('target.field')}
              text={targetText}
              onChangeText={setTargetText}
              unit="kg"
              spokenUnit={t('a11y.unit.kg')}
              step={0.1}
              min={TargetWeightRules.range.min}
              max={TargetWeightRules.range.max}
              fallback={targetFallback}
              error={targetErrorText}
              testID="body.target"
            />
            <LPText size={13} color={colors.paper2}>
              {t('target.field_hint')}
            </LPText>
          </View>
        ) : null}

        {showsDetails ? (
          <>
            {ageBlock}
            <View style={styles.block}>
              <LPText size={13} weight="semibold" color={colors.paper2} accessibilityRole="header">
                {t('body.sex')}
              </LPText>
              <View style={styles.chipLine}>
                {PROGRAM_SEXES.map((option) => (
                  <Chip
                    key={option}
                    label={t(sexLabelKey(option))}
                    selected={sex === option}
                    onPress={() => setSex(option)}
                    shape="rounded"
                    grow
                    testID={`body.sex.${option}`}
                  />
                ))}
              </View>
              <LPText size={12} color={colors.paper2}>
                {t('body.sex_why')}
              </LPText>
            </View>
            <View style={styles.block}>
              <LPText size={13} weight="semibold" color={colors.paper2} accessibilityRole="header">
                {t('body.activity')}
              </LPText>
              <View style={styles.card} accessibilityRole="radiogroup">
                {PROGRAM_ACTIVITIES.map((option, index) => (
                  <ActivityRow
                    key={option}
                    label={t(activityLabelKey(option))}
                    selected={activity === option}
                    first={index === 0}
                    onPress={() => setActivity(option)}
                    testID={`body.activity.${option}`}
                  />
                ))}
              </View>
            </View>
          </>
        ) : (
          <LPText size={13} color={colors.paper2}>
            {t('body.more_with_goal')}
          </LPText>
        )}

        {isGoal ? (
          <View style={styles.block}>
            <ToggleRow title={t('goal.custom')} value={customOn} onValueChange={setCustomOn} testID="body.custom" />
            {customOn ? (
              <>
                <NumberField
                  label={t('goal.custom_kcal')}
                  text={customKcalText}
                  onChangeText={setCustomKcalText}
                  unit="kcal"
                  step={50}
                  min={CUSTOM_KCAL_RANGE.min}
                  max={CUSTOM_KCAL_RANGE.max}
                  fallback={2000}
                  integer
                  error={customError ? t('goal.err.custom') : null}
                  testID="body.custom_kcal"
                />
                <LPText size={12} color={colors.paper2}>
                  {t('goal.custom_note')}
                </LPText>
              </>
            ) : null}
          </View>
        ) : null}

        <PrivacyLine text={t('body.privacy')} />

        {refusalKey ? <NoteBox text={t(refusalKey)} testID="body.refusal" /> : null}
        {errorKey ? (
          <LPText size={13} color={colors.destructive} testID="body.error">
            {t(errorKey)}
          </LPText>
        ) : null}

        <View style={styles.buttons}>
          <PrimaryButton
            title={primaryTitle}
            onPress={primaryAction}
            disabled={!canSubmit}
            loading={busy}
            testID="body.primary"
          />
          {isIntake ? (
            <QuietButton title={t('body.skip')} onPress={skip} testID="body.skip" />
          ) : (
            <QuietButton title={t('common.cancel')} onPress={close} disabled={isSaving} testID="body.cancel" />
          )}
          {isGoal && existingGoal?.goal != null ? (
            <QuietButton
              title={t('goal.clear')}
              onPress={() => setShowClearDialog(true)}
              disabled={isSaving}
              destructive
              testID="body.clear"
            />
          ) : null}
          {isOffline && !isIntake ? (
            <LPText size={12} color={colors.paper3} align="center">
              {t('health.offline.action_hint')}
            </LPText>
          ) : null}
        </View>
      </View>

      <Dialog
        visible={showClearDialog}
        onClose={() => setShowClearDialog(false)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('goal.clear_title')}
        buttons={[
          {
            label: t('goal.clear'),
            role: 'destructive',
            onPress: () => void clearGoal(),
            testID: 'body.clear.confirm',
          },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
    </Sheet>
  );
}

function ActivityRow({
  label,
  selected,
  first,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  first: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }}
      style={({ pressed }) => [styles.radioRow, !first && styles.radioDivider, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={selected ? colors.rust : colors.paper3}
        importantForAccessibility="no"
      />
      <LPText size={14} color={colors.paper} style={styles.flex}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, paddingTop: 8, paddingBottom: 32 },
  header: { gap: 8 },
  goalChips: { gap: 10 },
  chipLine: { flexDirection: 'row', gap: 8 },
  block: { gap: 8 },
  card: {
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    paddingVertical: 8,
  },
  radioDivider: { borderTopWidth: hairline, borderTopColor: colors.line },
  flex: { flex: 1 },
  buttons: { gap: 12 },
  pressed: { opacity: 0.7 },
});
