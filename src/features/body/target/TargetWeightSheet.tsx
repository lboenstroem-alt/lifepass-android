/**
 * The target weight on its own (`SPEC` 6.3): the Android port of iOS
 * Views/Health/TargetWeightSheet.swift. Opened from Body and goals, from the
 * Plan tab's nutrition card, and from the Coach's Adjust my plan.
 *
 * TWO MODES, ONE FIELD. `save` writes the standing target through
 * `PUT /health/target-weight` and is used where the member is looking at
 * their numbers. `pick` sends nothing and hands the value back: the Coach
 * confirms a change before anything is saved, so the sheet it opens must not
 * save on its own.
 *
 * WHAT THE SHEET PROMISES, ON ITS OWN FACE: the target is optional, it only
 * ever eases the calorie range as the member gets close (never makes it
 * stricter), it is stored in the account, and the AI never sees it. The same
 * validation as the body sheet runs on the field (./rules.ts), so the server
 * rarely has to refuse; when it does (`program_refused`), the sheet stays
 * open with the reason. A 404 that is not a problem document means the route
 * is gone from this server: the feature list is stale and everything it
 * gated hides.
 *
 * Which goal the target serves, and what the field opens with, is ./logic.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View, type Text } from 'react-native';

import { isApiError, isCancellation, isOffline as isOfflineError, isProblem, newIdempotencyKey } from '../../../api';
import { isMissingRoute, setTargetWeight } from '../../../api/targetWeight';
import { formatDecimalInput } from '../../../components/ui/numberInput';
import { Dialog, LPText, PrimaryButton, Sheet } from '../../../components/ui';
import {
  fetchNutritionGoalEnvelope,
  livePlanGoal,
  useHealthStore,
  type LivePlanGoal,
  type TargetWeightView,
} from '../../../health';
import { decimal } from '../../../i18n/format';
import { useT, type Lang } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { selectSupportsTargetWeight, useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { targetValueOf } from '../sheet/model';
import { NoteBox, NumberField, PrivacyLine, QuietButton, useAnnounceChange } from '../sheet/parts';
import type { TargetSheetMode } from '../sheet/types';

import {
  acceptsTarget as acceptsTargetFor,
  goalWordKey as goalWordKeyFor,
  showsReachedNote as showsReachedNoteFor,
  targetGoalUnknown,
  targetPrefillKg,
  validationDirection as validationDirectionFor,
  type TargetSheetFacts,
} from './logic';
import { TargetWeightRules } from './rules';

export type TargetWeightSheetProps = {
  visible: boolean;
  mode: TargetSheetMode;
  /** The sheet closes; `after` (the caller's callback) runs once it has gone. */
  onDismiss: (after: (() => void) | null) => void;
  /** The sheet has left the screen. */
  onClosed?: () => void;
};

function kgText(kg: number | null, language: Lang): string {
  return kg === null ? '' : formatDecimalInput(kg, language, 1);
}

/** The live plan's goal from what the stores hold right now. */
function currentLivePlan(): LivePlanGoal {
  return livePlanGoal(
    useHealthStore.getState().today?.program ?? null,
    useAppStore.getState().profile?.health?.program ?? null,
  );
}

function factsFor(
  mode: TargetSheetMode,
  livePlan: LivePlanGoal,
  storedTarget: TargetWeightView | null,
  standingGoal: string | null,
): TargetSheetFacts {
  return {
    mode: mode.kind === 'pick' ? { kind: 'pick', goal: mode.goal } : { kind: 'save' },
    livePlan,
    storedTarget,
    standingGoal,
  };
}

/** What a close with nothing stored or chosen answers. */
function cancelOf(mode: TargetSheetMode): (() => void) | null {
  return mode.onCancel ?? null;
}

export default function TargetWeightSheet({ visible, mode, onDismiss, onClosed }: TargetWeightSheetProps) {
  const { t, language } = useT();
  const supportsTargetWeight = useAppStore(selectSupportsTargetWeight);
  const latest = useAppStore((s) => s.profile?.health?.latest ?? null);
  const profileProgram = useAppStore((s) => s.profile?.health?.program ?? null);
  const dayProgram = useHealthStore((s) => s.today?.program ?? null);
  const isOffline = useHealthStore((s) => s.lastError?.isOffline === true);
  const isPick = mode.kind === 'pick';

  // Pick mode: the standing target the Coach passed. Save mode: the caller's,
  // else the Today read's, until the goal read below answers.
  const [storedTarget, setStoredTarget] = useState<TargetWeightView | null>(() =>
    mode.kind === 'pick'
      ? (mode.existing ?? null)
      : (mode.existing ?? useHealthStore.getState().today?.targetWeight ?? null),
  );
  const [standingGoal, setStandingGoal] = useState<string | null>(null);
  const [targetText, setTargetText] = useState(() =>
    kgText(targetPrefillKg(factsFor(mode, currentLivePlan(), storedTarget, null)), language),
  );
  const [isLoading, setLoading] = useState(mode.kind === 'save');
  const [isSaving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refusalKey, setRefusalKey] = useState<string | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

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

  // Save mode reads the goal envelope: the calorie goal the target may serve
  // and the stored target as the server holds it now. A plan runs whose goal
  // is not in hand (Body and goals opened before Plan, or a failed read):
  // read the day now, rather than tell a member with a lose-weight plan to
  // set a goal. Offline this fails fast, and the field shows anyway.
  useEffect(() => {
    if (mode.kind !== 'save') return;
    let current = true;
    (async () => {
      let stored = storedTarget;
      let goal: string | null = null;
      try {
        const envelope = await fetchNutritionGoalEnvelope(language);
        if (!current) return;
        useAppStore.getState().noteServerFeatures(envelope.features);
        goal = envelope.goal?.goal ?? null;
        stored = envelope.targetWeight;
        setStandingGoal(goal);
        setStoredTarget(stored);
      } catch {
        // Keep what the caller gave.
      }
      if (!current) return;
      if (targetGoalUnknown(factsFor(mode, currentLivePlan(), stored, goal))) {
        await useHealthStore.getState().load({ force: true });
        if (!current) return;
      }
      setTargetText(kgText(targetPrefillKg(factsFor(mode, currentLivePlan(), stored, goal)), language));
      setLoading(false);
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Derived

  const facts = factsFor(mode, livePlanGoal(dayProgram, profileProgram), storedTarget, standingGoal);
  const acceptsTarget = acceptsTargetFor(facts);
  const weightKg = latest?.weightKg ?? null;
  const heightCm = latest?.heightCm ?? null;
  const targetValue = targetValueOf(targetText);
  const direction = validationDirectionFor(facts, targetValue, weightKg);
  const problem = direction ? TargetWeightRules.validateText(targetText, direction, weightKg, heightCm) : null;
  const problemText = problem
    ? t(
        TargetWeightRules.problemKey(problem),
        problem.kind === 'bmiLow' ? { kg: decimal(problem.minKg, language) } : undefined,
      )
    : null;
  const canSubmit = acceptsTarget && targetValue !== null && problem === null && !isSaving;
  const reachedNote = showsReachedNoteFor(facts);
  const wordKey = goalWordKeyFor(facts);

  useAnnounceChange(problemText);
  useAnnounceChange(errorKey ? t(errorKey) : null);
  useAnnounceChange(refusalKey ? t(refusalKey) : null);

  // ---- Actions

  const close = () => {
    if (saving.current) return;
    onDismiss(cancelOf(mode));
  };

  const save = async (value: number | null) => {
    if (saving.current) return;
    if (!supportsTargetWeight) {
      setErrorKey('common.error_body');
      return;
    }
    saving.current = true;
    setSaving(true);
    setErrorKey(null);
    setRefusalKey(null);
    const finish = () => {
      saving.current = false;
      if (alive.current) setSaving(false);
    };
    try {
      const response = await setTargetWeight(value, idempotencyKey.current, language);
      useAppStore.getState().noteServerFeatures(response.features);
      track('target_weight_saved', {
        outcome: value === null ? 'cleared' : 'set',
        surface: 'sheet',
      });
      finish();
      if (mode.kind !== 'save') return;
      const { onSaved, onRemove } = mode;
      onDismiss(() => {
        onSaved?.();
        if (value === null) onRemove?.();
      });
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
    if (isMissingRoute(error)) {
      // The server does not have this route after all: whatever the feature
      // list said is stale, and the UI it gated hides.
      useAppStore.getState().clearServerFeatures();
      setErrorKey('common.error_body');
      return;
    }
    if (isProblem(error, 'program_refused')) {
      // The sheet STAYS OPEN, as the body sheet does on a refusal.
      track('target_weight_saved', { outcome: 'refused', surface: 'sheet' });
      setRefusalKey(
        error.reason === 'target_weight_bmi_high'
          ? 'program.refused.target_bmi_high'
          : 'program.refused.target_bmi_low',
      );
      return;
    }
    if (isProblem(error, 'invalid_target_weight')) {
      setErrorKey('target.err.server');
      return;
    }
    if (isOfflineError(error)) {
      setErrorKey('health.offline.action_hint');
      return;
    }
    const outcome = useHealthStore.getState().handle(error, { foreground: true });
    if (outcome === 'gate' || outcome === 'minor') onDismiss(cancelOf(mode));
    else setErrorKey('common.error_body');
  }

  const submit = () => {
    Keyboard.dismiss();
    if (!canSubmit || targetValue === null) return;
    if (mode.kind === 'pick') {
      const { onPicked } = mode;
      const value = targetValue;
      onDismiss(() => onPicked(value));
      return;
    }
    void save(targetValue);
  };

  const remove = () => {
    if (mode.kind === 'pick') {
      onDismiss(mode.onRemove ?? null);
      return;
    }
    void save(null);
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      onClosed={onClosed}
      busy={isSaving}
      fullHeight
      initialFocusRef={titleRef}
      testID="target.sheet"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('target.sheet.title')}
          </LPText>
          <LPText size={14} color={colors.paper2}>
            {t('target.sheet.why')}
          </LPText>
          {wordKey ? (
            <LPText size={13} weight="semibold" color={colors.paper} testID="target.sheet.for_goal">
              {t('target.sheet.for_goal', { goal: t(wordKey) })}
            </LPText>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.rust} />
          </View>
        ) : !acceptsTarget ? (
          <NoteBox text={t('target.sheet.needs_goal')} size={14} testID="target.sheet.needs_goal" />
        ) : (
          <View style={styles.block}>
            {reachedNote ? <NoteBox text={t('target.reached_prefill_note')} testID="target.sheet.reached" /> : null}
            <NumberField
              label={t('target.field')}
              text={targetText}
              onChangeText={setTargetText}
              unit="kg"
              spokenUnit={t('a11y.unit.kg')}
              step={0.1}
              min={TargetWeightRules.range.min}
              max={TargetWeightRules.range.max}
              fallback={weightKg ?? 70}
              error={problemText}
              testID="target.sheet.field"
            />
          </View>
        )}

        <PrivacyLine text={t('target.privacy')} />

        {refusalKey ? <NoteBox text={t(refusalKey)} testID="target.sheet.refusal" /> : null}
        {errorKey ? (
          <LPText size={13} color={colors.destructive} testID="target.sheet.error">
            {t(errorKey)}
          </LPText>
        ) : null}

        <View style={styles.buttons}>
          {isSaving || acceptsTarget ? (
            <PrimaryButton
              title={t(isPick ? 'target.sheet.use' : 'target.sheet.save')}
              onPress={submit}
              disabled={!canSubmit}
              loading={isSaving}
              testID="target.sheet.save"
            />
          ) : null}
          <QuietButton title={t('common.cancel')} onPress={close} disabled={isSaving} testID="target.sheet.cancel" />
          {storedTarget !== null && !isSaving ? (
            <QuietButton
              title={t('target.sheet.remove')}
              onPress={() => setShowRemoveDialog(true)}
              destructive
              testID="target.sheet.remove"
            />
          ) : null}
          {isOffline && !isPick ? (
            <LPText size={12} color={colors.paper3} align="center">
              {t('health.offline.action_hint')}
            </LPText>
          ) : null}
        </View>
      </View>

      <Dialog
        visible={showRemoveDialog}
        onClose={() => setShowRemoveDialog(false)}
        presentation="actionSheet"
        titleVisibility="visible"
        title={t('target.sheet.remove_title')}
        buttons={[
          {
            label: t('target.sheet.remove'),
            role: 'destructive',
            onPress: remove,
            testID: 'target.sheet.remove.confirm',
          },
          { label: t('common.cancel'), role: 'cancel' },
        ]}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, paddingTop: 8, paddingBottom: 32 },
  header: { gap: 8 },
  block: { gap: 6 },
  buttons: { gap: 12 },
  loading: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
