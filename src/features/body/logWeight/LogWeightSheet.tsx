/**
 * "Log weight" from Body and goals: the weekly check-in sheet in its
 * weight-only mode (iOS `WeeklyCheckInSheet(mode: .weightOnly)`), the field
 * and nothing else.
 *
 * - The weight field: typed ("72,5" and "72.5" both read 72.5), stepped by
 *   0.1 kg with the round buttons or a TalkBack swipe, 30 to 300 kg. It opens
 *   on a weight logged in the last three days, else the last weigh-in.
 * - Under it, the error ("Enter a weight between 30 and 300 kg.") or the last
 *   weigh-in, "Last: 72,5 kg on Wed 17 Sept". iOS words a weigh-in from Apple
 *   Health "From Apple Health on {date}"; nothing on Body and goals names it
 *   here (owner decision), so every source reads as "Last: …".
 * - Save: `POST /health/measurements { weightKg, source: 'self_reported' }`
 *   under ONE Idempotency-Key per opening, so a retry after a timeout is one
 *   weigh-in, not two. A weigh-in deleted elsewhere under that key gets a new
 *   key and the "changed on another device" notice; offline says so; a
 *   membership refusal closes the sheet (the store has corrected the access).
 *
 * The weekly mode (rating, height question, the review that follows) is the
 * weekly check-in's own (PLAN-5); this file is only what Body and goals opens.
 */
import { useRef, useState } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { isCancellation, isOffline, isProblem, newIdempotencyKey } from '../../../api';
import { formatDecimalInput, LPText, NumberStepper, PrimaryButton, Sheet } from '../../../components/ui';
import { addMeasurement, useHealthStore, type CheckInState, type Measurement, type WeighInState } from '../../../health';
import { HealthFormat, useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors } from '../../../theme';

import { BODY_WEIGHT_RANGE } from '../sheets';

export type LogWeightSheetProps = {
  readonly visible: boolean;
  /** The member closed it, or it closed itself after a save. Set `visible` to false. */
  readonly onClose: () => void;
  /** The sheet has fully gone. */
  readonly onClosed?: () => void;
  /** From the Today read, when there is one: the last weigh-in. */
  readonly weighIn: WeighInState | null;
  /** From the Today read: a weight logged in the last three days. */
  readonly checkIn: CheckInState | null;
  /** The server stored the weigh-in (the caller re-reads the profile and the page). */
  readonly onWeightLogged: (measurement: Measurement) => void;
};

/** What the field opens with (iOS `prefill`): a recent weight, else the last weigh-in, else empty. */
export function logWeightPrefill(weighIn: WeighInState | null, checkIn: CheckInState | null, lang: 'en' | 'is'): string {
  const recent = checkIn?.recentWeightKg ?? null;
  if (recent !== null) return formatDecimalInput(recent, lang);
  const last = weighIn?.lastWeightKg ?? null;
  return last !== null ? formatDecimalInput(last, lang) : '';
}

/** Valid: empty (nothing to save yet) or a weight in range. */
export function logWeightValidity(text: string): { readonly value: number | null; readonly isValid: boolean } {
  const value = HealthFormat.parseDecimal(text);
  if (value === null) return { value: null, isValid: text.length === 0 };
  return { value, isValid: value >= BODY_WEIGHT_RANGE.min && value <= BODY_WEIGHT_RANGE.max };
}

export default function LogWeightSheet(props: LogWeightSheetProps) {
  // Every opening is a fresh sheet: its field, its error and its key.
  const [opening, setOpening] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setOpening((n) => n + 1);
  }
  return <LogWeightSheetBody key={opening} {...props} />;
}

function LogWeightSheetBody({ visible, onClose, onClosed, weighIn, checkIn, onWeightLogged }: LogWeightSheetProps) {
  const { t, language } = useT();
  const titleRef = useRef<Text>(null);
  const [text, setText] = useState(() => logWeightPrefill(weighIn, checkIn, language));
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());

  const { value, isValid } = logWeightValidity(text);
  const canSave = isValid && value !== null;

  const lastLine = (() => {
    const last = weighIn?.lastWeightKg ?? null;
    const measured = weighIn?.lastMeasuredAt ?? null;
    if (last === null || measured === null) return null;
    return t('checkin.last', { kg: HealthFormat.decimal(last, language), date: HealthFormat.shortDay(measured, language) });
  })();

  const save = async () => {
    if (isSaving || value === null || !canSave) return;
    setIsSaving(true);
    setErrorKey(null);
    try {
      const measurement = await addMeasurement({ weightKg: value, source: 'self_reported' }, keyRef.current);
      track('weigh_in_logged', { with_rating: false });
      setIsSaving(false);
      onWeightLogged(measurement);
      onClose();
    } catch (error) {
      setIsSaving(false);
      if (isCancellation(error)) return;
      if (isProblem(error, 'health_measurement_deleted')) {
        // The weigh-in this key belongs to was deleted elsewhere: a new key,
        // and the member tries again.
        keyRef.current = newIdempotencyKey();
        useHealthStore.getState().setToast('health.err.changed');
        return;
      }
      if (isOffline(error)) {
        setErrorKey('health.offline.action_hint');
        return;
      }
      const outcome = useHealthStore.getState().handle(error, { foreground: true });
      if (outcome === 'gate') onClose();
      else setErrorKey('common.error_body');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      busy={isSaving}
      fullHeight
      initialFocusRef={titleRef}
      testID="bodygoals.logWeight"
    >
      <View style={styles.page}>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {t('checkin.weight_title')}
        </LPText>

        <View style={styles.field}>
          <NumberStepper
            text={text}
            onChangeText={setText}
            step={0.1}
            min={BODY_WEIGHT_RANGE.min}
            max={BODY_WEIGHT_RANGE.max}
            fallback={weighIn?.lastWeightKg ?? 70}
            maxFractionDigits={1}
            unit="kg"
            label={t('body.weight')}
            spokenUnit={t('a11y.unit.kg')}
            decreaseLabel={t('a11y.decrease_weight')}
            increaseLabel={t('a11y.increase_weight')}
            invalid={!isValid}
            testID="bodygoals.logWeight.field"
          />
          {!isValid ? (
            <LPText size={12} color={colors.destructive} accessibilityLiveRegion="polite" testID="bodygoals.logWeight.invalid">
              {t('body.err.weight')}
            </LPText>
          ) : lastLine ? (
            <LPText size={12} color={colors.paper2} testID="bodygoals.logWeight.last">
              {lastLine}
            </LPText>
          ) : null}
        </View>

        {errorKey ? (
          <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="bodygoals.logWeight.error">
            {t(errorKey)}
          </LPText>
        ) : null}

        <PrimaryButton
          title={t('body.save')}
          onPress={() => void save()}
          loading={isSaving}
          disabled={!canSave}
          testID="bodygoals.logWeight.save"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  field: { gap: 8 },
});
