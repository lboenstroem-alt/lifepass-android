/**
 * The weekly re-ask (iOS Views/Health/WeeklyCheckInSheet.swift, `ios-ux.md`
 * 9): one weight, one rating, then the week.
 *
 * TWO STEPS IN ONE SHEET on purpose. A check-in that asks for a number and
 * then thanks you is a chore; a check-in that answers with your week is a
 * reason to do it again next Sunday. Nothing is mandatory: a weight alone, a
 * rating alone, or a weight skipped entirely all save (./rules.ts).
 *
 * TWO MODES. `weekly` posts OP-23 `POST /health/checkin` and cross-fades to
 * the fresh review, with TalkBack moved onto its title. `weightOnly` is Body
 * and goals' "Log weight": the field only, "Save", OP-24
 * `POST /health/measurements` with `source: self_reported`, then it closes.
 *
 * ONE IDEMPOTENCY-KEY PER PRESENTATION, so a Save tapped again after a
 * timeout is the same weigh-in, never a second one. A weigh-in deleted on
 * another device since this key was used (`health_measurement_deleted`)
 * mints a new key and says the data changed, and the member saves again.
 * Offline says the action needs a connection; a refusal for want of a
 * membership closes the sheet (the gate is what answers it).
 *
 * Controlled, like every sheet: `visible`, and `onClose` when the member or
 * the sheet asks to close. Each opening starts afresh (its fields, its key,
 * the first step), so a caller need not remount it.
 *
 *   <WeeklyCheckInSheet visible={open} mode="weightOnly" weighIn={day?.weighIn ?? null}
 *     checkIn={day?.checkIn ?? null} onClose={() => setOpen(false)} onWeightLogged={reload} />
 */
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type HostInstance,
  type Text,
} from 'react-native';

import {
  addMeasurement,
  useHealthStore,
  type CheckinResponse,
  type CheckInState,
  type Measurement,
  type WeighInState,
} from '../../../health';
import {
  isApiError,
  isCancellation,
  isOffline,
  isProblem,
  newIdempotencyKey,
} from '../../../api';
import { announce, LPText, NumberStepper, PrimaryButton, Sheet } from '../../../components/ui';
import { useReduceMotion } from '../../../hooks/useReduceMotion';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { colors, hairline, radius } from '../../../theme';
import { BODY_HEIGHT_RANGE, BODY_WEIGHT_RANGE } from '../../body/sheets';
import WeeklyReviewCard from '../review/WeeklyReviewCard';

import { postWeeklyCheckIn, WEEK_RATINGS, type WeekRating } from './api';
import {
  canSaveCheckIn,
  checkInBody,
  checkInWeight,
  heightQuestionCm,
  lastWeightLine,
  prefillCheckIn,
  stepFallbackKg,
  stepRating,
  weightIsValid,
  type CheckInForm,
  type WeeklyCheckInMode,
} from './rules';

export type WeeklyCheckInSheetProps = {
  visible: boolean;
  /** Default `weekly`. */
  mode?: WeeklyCheckInMode;
  /** The Today read's weigh-in state (the last weight, the height question). */
  weighIn: WeighInState | null;
  /** The Today read's check-in state (a weight from the last three days). */
  checkIn: CheckInState | null;
  /** The member or the sheet asks to close: set `visible` to false. */
  onClose: () => void;
  /** The sheet has left the screen. */
  onClosed?: () => void;
  /** The weekly check-in was saved; the answer carries the fresh review (the caller re-reads). */
  onSaved?: (response: CheckinResponse) => void;
  /** Log weight saved the weight (the caller re-reads). The sheet closes. */
  onWeightLogged?: (measurement: Measurement) => void;
  testID?: string;
};

/**
 * A fresh presentation every time `visible` turns true (iOS makes new
 * @State per sheet), while a close keeps the one on screen so it can slide
 * away with its content.
 */
export default function WeeklyCheckInSheet(props: WeeklyCheckInSheetProps) {
  const [presentation, setPresentation] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setPresentation((n) => n + 1);
  }
  return <CheckInPresentation key={presentation} {...props} />;
}

/** A focus move into a view that is still fading in is dropped (iOS waits 0.3 s). */
const REVIEW_FOCUS_DELAY_MS = 300;
const CROSS_FADE_MS = 250;

function CheckInPresentation({
  visible,
  mode = 'weekly',
  weighIn,
  checkIn,
  onClose,
  onClosed,
  onSaved,
  onWeightLogged,
  testID = 'checkin.sheet',
}: WeeklyCheckInSheetProps) {
  const { t, language } = useT();
  const reduceMotion = useReduceMotion();
  const [form, setForm] = useState<CheckInForm>(() => prefillCheckIn(mode, weighIn, checkIn, language));
  const [isSaving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [review, setReview] = useState<CheckinResponse['review']>(null);

  const idempotencyKey = useRef(newIdempotencyKey());
  const saving = useRef(false);
  const alive = useRef(true);
  const titleRef = useRef<Text>(null);
  const reviewTitleRef = useRef<Text>(null);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const update = (patch: Partial<CheckInForm>) => setForm((current) => ({ ...current, ...patch }));

  // ---- Derived

  const valid = weightIsValid(form);
  const canSave = canSaveCheckIn(form, mode);
  const weightLine = lastWeightLine(form, weighIn, checkIn, language);
  const heightCm = heightQuestionCm(mode, weighIn, form);
  const weightError = valid ? null : t('body.err.weight');
  const errorText = errorKey ? t(errorKey) : null;

  useAnnounceChange(weightError);
  useAnnounceChange(errorText);

  // ---- The review step's arrival: cross-fade, then TalkBack onto its title.

  useEffect(() => {
    if (!review) return undefined;
    if (!reduceMotion) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: CROSS_FADE_MS, useNativeDriver: true }).start();
    }
    const timer = setTimeout(() => {
      const node = reviewTitleRef.current as unknown as HostInstance | null;
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, REVIEW_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
    // Once per review: the fade and the focus belong to its arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  // ---- Actions

  const close = () => {
    if (saving.current) return;
    onClose();
  };

  const save = async () => {
    if (saving.current || !canSave) return;
    Keyboard.dismiss();
    saving.current = true;
    setSaving(true);
    setErrorKey(null);
    const finish = () => {
      saving.current = false;
      if (alive.current) setSaving(false);
    };
    try {
      if (mode === 'weightOnly') {
        const weightKg = checkInWeight(form);
        if (weightKg === null) {
          finish();
          return;
        }
        const measurement = await addMeasurement({ weightKg, source: 'self_reported' }, idempotencyKey.current);
        track('weigh_in_logged', { with_rating: false });
        finish();
        onWeightLogged?.(measurement);
        onClose();
        return;
      }
      const response = await postWeeklyCheckIn(checkInBody(form), idempotencyKey.current);
      track('weigh_in_logged', { with_rating: form.rating !== null });
      track('weekly_review_viewed');
      finish();
      onSaved?.(response);
      if (!alive.current) return;
      if (response.review) setReview(response.review);
      else onClose();
    } catch (error) {
      finish();
      if (alive.current) handleSaveError(error);
    }
  };

  function handleSaveError(error: unknown): void {
    if (!isApiError(error)) {
      setErrorKey('common.error_body');
      return;
    }
    if (isCancellation(error)) return;
    if (isProblem(error, 'health_measurement_deleted')) {
      // The weigh-in this key belongs to was deleted elsewhere: a new key,
      // and the member tries again.
      idempotencyKey.current = newIdempotencyKey();
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

  const toggleSkip = () => {
    if (form.weightSkipped) {
      update({ weightSkipped: false });
      return;
    }
    Keyboard.dismiss();
    // Nothing can carry the height now, so nothing pretends to have been answered.
    update({ weightSkipped: true, heightConfirmed: false, showHeightField: false, heightText: '' });
  };

  // ---- Layout

  return (
    <Sheet
      visible={visible}
      onClose={close}
      onClosed={onClosed}
      busy={isSaving}
      fullHeight
      initialFocusRef={titleRef}
      testID={testID}
    >
      {review ? (
        <Animated.View style={[styles.page, { opacity: fade }]} testID={`${testID}.review`}>
          <LPText ref={reviewTitleRef} serif size={24} color={colors.paper} accessible accessibilityRole="header">
            {t('review.title')}
          </LPText>
          <WeeklyReviewCard review={review} showsKicker={false} testID={`${testID}.review.card`} />
          <PrimaryButton title={t('common.done')} onPress={onClose} testID={`${testID}.done`} />
        </Animated.View>
      ) : (
        <View style={styles.page}>
          <View style={styles.header}>
            <LPText ref={titleRef} serif size={24} color={colors.paper} accessible accessibilityRole="header">
              {t(mode === 'weightOnly' ? 'checkin.weight_title' : 'checkin.title')}
            </LPText>
            {mode === 'weekly' ? (
              <LPText size={14} color={colors.paper2}>
                {t('checkin.sub')}
              </LPText>
            ) : null}
          </View>

          <View style={styles.block}>
            <NumberStepper
              text={form.weightText}
              onChangeText={(text) => update({ weightText: text, weightSkipped: false })}
              step={0.1}
              min={BODY_WEIGHT_RANGE.min}
              max={BODY_WEIGHT_RANGE.max}
              fallback={stepFallbackKg(weighIn)}
              maxFractionDigits={1}
              unit="kg"
              label={t('body.weight')}
              spokenUnit={t('a11y.unit.kg')}
              decreaseLabel={t('a11y.decrease_weight')}
              increaseLabel={t('a11y.increase_weight')}
              invalid={!valid}
              dimmed={form.weightSkipped}
              // A tap on the dimmed field brings the weight back (iOS onTapGesture).
              onFocus={() => {
                if (form.weightSkipped) update({ weightSkipped: false });
              }}
              testID={`${testID}.weight`}
            />
            {weightError ? (
              <LPText size={12} color={colors.destructive} testID={`${testID}.weight.error`}>
                {weightError}
              </LPText>
            ) : weightLine ? (
              <LPText size={12} color={colors.paper2} testID={`${testID}.weight.line`}>
                {t(weightLine.key, weightLine.params)}
              </LPText>
            ) : null}
            {mode === 'weekly' ? (
              <Pressable
                onPress={toggleSkip}
                accessibilityRole="switch"
                accessibilityLabel={t('checkin.skip_weight')}
                accessibilityState={{ checked: form.weightSkipped }}
                style={styles.textButton}
                testID={`${testID}.skip`}
              >
                <LPText size={13} weight="semibold" color={form.weightSkipped ? colors.rust : colors.paper2}>
                  {t('checkin.skip_weight')}
                </LPText>
              </Pressable>
            ) : null}
          </View>

          {heightCm !== null ? (
            <HeightRow
              cm={heightCm}
              form={form}
              onYes={() => update({ heightConfirmed: true, showHeightField: false, heightText: '' })}
              onChange={() => update({ showHeightField: true, heightConfirmed: false })}
              onChangeText={(text) => update({ heightText: text })}
              testID={`${testID}.height`}
            />
          ) : null}

          {mode === 'weekly' ? (
            <RatingRow rating={form.rating} onChange={(rating) => update({ rating })} testID={`${testID}.rating`} />
          ) : null}

          {errorText ? (
            <LPText size={13} color={colors.destructive} testID={`${testID}.error`}>
              {errorText}
            </LPText>
          ) : null}

          <PrimaryButton
            title={t(mode === 'weightOnly' ? 'body.save' : 'checkin.save')}
            onPress={() => void save()}
            disabled={!canSave}
            loading={isSaving}
            testID={`${testID}.save`}
          />
        </View>
      )}
    </Sheet>
  );
}

// MARK: - Height

function HeightRow({
  cm,
  form,
  onYes,
  onChange,
  onChangeText,
  testID,
}: {
  cm: number;
  form: CheckInForm;
  onYes: () => void;
  onChange: () => void;
  onChangeText: (text: string) => void;
  testID: string;
}) {
  const { t } = useT();
  const yes = t('checkin.height_yes');
  const change = t('checkin.height_change');
  return (
    <View style={styles.block} testID={testID}>
      <LPText size={14} color={colors.paper}>
        {t('checkin.height_q', { cm: String(cm) })}
      </LPText>
      <View style={styles.heightButtons}>
        <Pressable
          onPress={onYes}
          accessibilityRole="button"
          accessibilityLabel={yes}
          accessibilityState={{ selected: form.heightConfirmed }}
          style={[styles.yesChip, form.heightConfirmed && styles.chipOn]}
          testID={`${testID}.yes`}
        >
          <LPText size={13} weight="semibold" color={form.heightConfirmed ? colors.onAccent : colors.paper}>
            {yes}
          </LPText>
        </Pressable>
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel={change}
          style={styles.textButton}
          testID={`${testID}.change`}
        >
          <LPText size={13} weight="semibold" color={colors.paper2}>
            {change}
          </LPText>
        </Pressable>
      </View>
      {form.showHeightField ? (
        <NumberStepper
          text={form.heightText}
          onChangeText={onChangeText}
          step={1}
          min={BODY_HEIGHT_RANGE.min}
          max={BODY_HEIGHT_RANGE.max}
          fallback={cm}
          integer
          unit="cm"
          label={t('body.height')}
          spokenUnit={t('a11y.unit.cm')}
          decreaseLabel={t('body.height')}
          increaseLabel={t('body.height')}
          showButtons={false}
          size="regular"
          testID={`${testID}.field`}
        />
      ) : null}
    </View>
  );
}

// MARK: - Rating

function RatingRow({
  rating,
  onChange,
  testID,
}: {
  rating: WeekRating | null;
  onChange: (rating: WeekRating | null) => void;
  testID: string;
}) {
  const { t } = useT();
  // The three chips are a rating, so they step like one: a TalkBack swipe up
  // or down moves Great to OK to Tough without hunting for the chip (the
  // same affordance the weight field has, iOS 9.8).
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') onChange(stepRating(rating, 1));
    if (event.nativeEvent.actionName === 'decrement') onChange(stepRating(rating, -1));
  };
  return (
    <View style={styles.ratingBlock} testID={testID}>
      <LPText size={14} color={colors.paper}>
        {t('checkin.week_q')}
      </LPText>
      <View style={styles.chips}>
        {WEEK_RATINGS.map((value) => {
          const isOn = rating === value;
          const label = t(`checkin.rating.${value}`);
          return (
            <Pressable
              key={value}
              // Tap again to clear: the rating is optional.
              onPress={() => onChange(isOn ? null : value)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: isOn }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={onAction}
              style={[styles.ratingChip, isOn && styles.chipOn]}
              testID={`${testID}.${value}`}
            >
              <LPText size={14} weight={isOn ? 'semibold' : 'medium'} color={isOn ? colors.onAccent : colors.paper}>
                {label}
              </LPText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Says a line that appears where the member's focus is not (an error under a field). */
function useAnnounceChange(text: string | null): void {
  const previous = useRef(text);
  useEffect(() => {
    if (text === previous.current) return;
    previous.current = text;
    if (text) announce(text);
  }, [text]);
}

const styles = StyleSheet.create({
  page: { gap: 20, paddingTop: 8, paddingBottom: 32 },
  header: { gap: 8 },
  block: { gap: 8 },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  heightButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  yesChip: {
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  ratingBlock: { gap: 10 },
  chips: { flexDirection: 'row', gap: 10 },
  ratingChip: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.rust, borderColor: colors.rust },
});
