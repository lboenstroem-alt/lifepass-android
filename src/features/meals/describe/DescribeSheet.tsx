/**
 * "Describe what you ate" (OP-56): the Android port of iOS
 * `MealDescribeSheet` (Views/Meals/MealDescribeSheet.swift).
 *
 * The member types or dictates what they ate ("focaccia sandwich with
 * mozzarella and pesto", "skyr með bláberjum"; Gboard's voice typing needs no
 * permission here), the server asks the model for the foods and amounts, and
 * saves them as an UNCONFIRMED draft, exactly like a photo estimate. The
 * draft opens in the result editor, where every item can be changed or
 * removed before Save.
 *
 * Behind three locks, so nothing is ever sent before the owner says so:
 * - the entry exists only while the server advertises `meal_describe`
 *   (./availability.ts);
 * - the server refuses with 409 `meal_describe_consent_required` until the
 *   member has accepted the text that names a description (one tap, here);
 * - a 404 hides the entry again at once.
 *
 * THE WORDS STAY IN MEMORY. They live in this sheet's model, travel once in
 * the POST body, and are never written to disk, a URL, a log or analytics.
 * What comes back is the list of foods, which is what the diary keeps.
 *
 * Android: the sheet cannot be closed by hand while an estimate or the
 * consent is in flight (iOS `interactiveDismissDisabled(model.isBusy)`);
 * hardware back closes it otherwise.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View, type Text, type TextInput } from 'react-native';

import type { ApiError } from '../../../api';
import { announce, hiddenFromAccessibility, LPText, Sheet, SheetTextInput } from '../../../components/ui';
import { openHealthConsent, presentMealGate, PRIVACY_POLICY_URL, useHealthStore } from '../../../health';
import { HealthConsentSheet } from '../../../health/ui';
import { useT } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { selectHasHealthConsent, ServerFeature, useAppStore } from '../../../stores/appStore';
import { colors, hairline, radius } from '../../../theme';
import { autoSlot } from '../math/itemMath';

import {
  describeFailureAnalyticsOutcome,
  describeFailureCopyKey,
  describeFailureCopyParams,
  describeFailureOffersSearch,
  MealDescribeModel,
  type MealDescribeFailure,
  type MealDescribeModelOptions,
} from './describeModel';
import { DESCRIBE_MAX_LENGTH, describeCounter } from './describeText';
import { closeDescribe, type DescribeRequest } from './presenter';

export interface DescribeSheetProps {
  readonly request: DescribeRequest;
  readonly visible: boolean;
  /** The sheet has gone. */
  readonly onClosed?: () => void;
  /** Tests: the model's API, consent grant and keys. */
  readonly modelOptions?: MealDescribeModelOptions;
}

/** How long after the sheet opens the field takes the keyboard (the slide-up takes about 250 ms). */
const FOCUS_DELAY_MS = 350;

function useModel(model: MealDescribeModel): void {
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
}

export default function DescribeSheet({ request, visible, onClosed, modelOptions }: DescribeSheetProps) {
  const { t, tp, language } = useT();
  const [model] = useState(() => new MealDescribeModel(request.text ?? '', modelOptions));
  useModel(model);
  // A cap that left the words as they were still has to put the field back.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [refusalKey, setRefusalKey] = useState<string | null>(null);
  const [localConsent, setLocalConsent] = useState(false);
  const titleRef = useRef<Text>(null);
  const fieldRef = useRef<TextInput>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // The slot and day are the meal page's, fixed for this sheet.
  const [slot] = useState(() => request.slot ?? autoSlot());
  const [date] = useState(() => request.date ?? todayServerDay());

  // An empty field takes the keyboard (iOS `fieldFocused = model.text.isEmpty`).
  useEffect(() => {
    if (!visible || model.text !== '') return;
    const timer = setTimeout(() => fieldRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, model]);

  const phase = model.phase;
  const consentShowing = phase.kind === 'needsConsent' || phase.kind === 'grantingConsent';
  const estimating = phase.kind === 'estimating';
  const canEstimate = model.canEstimate;
  const counter = describeCounter(model.text);

  const close = useCallback(() => {
    closeDescribe();
  }, []);

  const searchInstead = useCallback(() => {
    const words = model.cleanedText;
    close();
    request.onSearch?.(words);
  }, [close, model, request]);

  // Defined below; the consent sheet's retry calls back into it.
  const estimateRef = useRef<() => Promise<void>>(async () => undefined);

  const showFullConsent = useCallback(() => {
    const opened = openHealthConsent({ entry: 'scan', onGranted: () => estimateRef.current() });
    // No app-wide host to draw it (or one already up): this sheet draws its own.
    if (!opened) setLocalConsent(true);
  }, []);

  /** The refusals every health screen answers the same way. */
  const answer = useCallback(
    (error: ApiError) => {
      switch (useHealthStore.getState().handle(error, { foreground: true })) {
        case 'presentConsent':
          showFullConsent();
          return;
        case 'gate': {
          close();
          const access = useAppStore.getState().healthAccess;
          if (request.onGate) request.onGate(access);
          else presentMealGate(access);
          return;
        }
        case 'minor':
        case 'reconciling':
        case 'wiped':
          close();
          request.onClosePage?.();
          return;
        case 'pendingDeletion':
          setRefusalKey('health.err.pending_deletion');
          return;
        case 'rateLimited':
          setRefusalKey('health.err.rate_limited');
          return;
        default:
          setRefusalKey('common.error_body');
      }
    },
    [close, request, showFullConsent],
  );

  const estimate = useCallback(async () => {
    if (!model.canEstimate) return;
    fieldRef.current?.blur();
    setRefusalKey(null);
    track('meal_describe_submitted');
    const outcome = await model.estimate(slot, date, language);
    if (!mounted.current) return;
    switch (outcome.kind) {
      case 'draft':
        track('meal_describe_result', { outcome: 'ok' });
        announce(t('meal.describe.ready'));
        request.onDraft(outcome.meal.id, outcome.meal);
        close();
        return;
      case 'needsConsent':
        track('meal_describe_result', { outcome: 'consent' });
        return;
      case 'failed':
        track('meal_describe_result', { outcome: describeFailureAnalyticsOutcome(outcome.failure) });
        return;
      case 'featureOff': {
        // The server no longer has the route: the entry hides, and the words
        // go to search. The next Today read brings the server's own list.
        const app = useAppStore.getState();
        app.dropServerFeature(ServerFeature.mealDescribe);
        if (selectHasHealthConsent(app)) void useHealthStore.getState().load({ force: true });
        searchInstead();
        return;
      }
      case 'refused':
        answer(outcome.error);
    }
  }, [answer, close, date, language, model, request, searchInstead, slot, t]);
  estimateRef.current = estimate;

  const grantConsent = useCallback(async () => {
    const standing = useAppStore.getState().profile?.health?.consent ?? null;
    const outcome = await model.grantDescribeConsent(standing);
    if (!mounted.current) return;
    switch (outcome.kind) {
      case 'granted': {
        track('health_consent_granted', {
          entry: 'describe',
          source: outcome.consent.ageSource === 'attestation' ? 'attestation' : 'kennitala',
        });
        const app = useAppStore.getState();
        app.applyHealthConsentGranted(outcome.consent);
        void app.loadProfile();
        // The same words, the same key.
        await estimate();
        return;
      }
      case 'needsFullSheet':
        showFullConsent();
        return;
      case 'failed':
        return;
      case 'refused':
        answer(outcome.error);
    }
  }, [answer, estimate, model, showFullConsent]);

  const onChangeText = useCallback(
    (value: string) => {
      model.text = value;
      // Counted as the server counts (UTF-16, after cleaning) and cut
      // between whole characters; a cut that changed nothing in the model
      // still has to put the field back to it.
      if (model.text !== value) redraw();
      model.textChanged();
    },
    [model],
  );

  return (
    <>
      <Sheet
        visible={visible}
        onClose={close}
        onClosed={onClosed}
        busy={model.isBusy}
        fullHeight
        initialFocusRef={titleRef}
        testID="meal.describe.sheet"
      >
        <View style={styles.page}>
          <View style={styles.toolbar}>
            <Pressable
              onPress={close}
              disabled={phase.kind === 'grantingConsent'}
              accessibilityRole="button"
              accessibilityState={{ disabled: phase.kind === 'grantingConsent' }}
              hitSlop={8}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              testID="meal.describe.cancel"
            >
              <LPText size={16} color={phase.kind === 'grantingConsent' ? colors.paper4 : colors.accentText}>
                {t('common.cancel')}
              </LPText>
            </Pressable>
          </View>

          <LPText ref={titleRef} serif size={22} color={colors.paper} accessibilityRole="header">
            {t('meal.describe.title')}
          </LPText>

          <View style={styles.field}>
            <SheetTextInput
              ref={fieldRef}
              value={model.text}
              onChangeText={onChangeText}
              multiline
              editable={!model.isBusy}
              placeholder={t('meal.describe.placeholder')}
              placeholderTextColor={colors.paper3}
              accessibilityLabel={t('meal.describe.title')}
              textAlignVertical="top"
              autoCorrect
              style={styles.input}
              testID="meal.describe.field"
            />
            {counter !== null ? (
              <LPText size={11} color={colors.paper3} style={styles.counter} testID="meal.describe.counter">
                {`${counter}/${DESCRIBE_MAX_LENGTH}`}
              </LPText>
            ) : null}
          </View>

          <LPText size={13} color={colors.paper2}>
            {t('meal.describe.hint')}
          </LPText>

          {consentShowing ? (
            <ConsentBlock
              granting={phase.kind === 'grantingConsent'}
              errorKey={model.consentErrorKey}
              onGrant={() => void grantConsent()}
            />
          ) : (
            <EstimateButton estimating={estimating} enabled={canEstimate} onPress={() => void estimate()} />
          )}

          {phase.kind === 'failed' ? (
            <FailureBlock failure={phase.failure} onSearch={searchInstead} />
          ) : refusalKey ? (
            <LPText size={14} color={colors.paper} testID="meal.describe.refusal">
              {t(refusalKey)}
            </LPText>
          ) : null}

          {model.describesLeft !== null && model.describesLeft <= 5 ? (
            <LPText size={12} color={colors.paper2} testID="meal.describe.remaining">
              {tp('meal.describe.remaining', model.describesLeft)}
            </LPText>
          ) : null}

          {!consentShowing ? (
            // The consent block says it in full.
            <LPText size={11} color={colors.paper3} style={styles.notice}>
              {t('meal.describe.notice')}
            </LPText>
          ) : null}
        </View>
      </Sheet>
      {localConsent ? (
        <HealthConsentSheet
          visible={localConsent}
          entry="scan"
          onClose={() => setLocalConsent(false)}
          onGranted={() => estimateRef.current()}
          testID="meal.describe.fullConsent"
        />
      ) : null}
    </>
  );
}

/** Estimate, and "One moment" with a spinner while it works. Never pressed twice. */
function EstimateButton({ estimating, enabled, onPress }: { estimating: boolean; enabled: boolean; onPress: () => void }) {
  const { t } = useT();
  const title = t(estimating ? 'meal.describe.estimating' : 'meal.describe.submit');
  return (
    <Pressable
      onPress={onPress}
      // Not dimmed while estimating: the button keeps its colour and says
      // "One moment"; a second press does nothing.
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !enabled, busy: estimating }}
      style={({ pressed }) => [
        styles.button,
        !enabled && !estimating && styles.dimmed,
        pressed && enabled && styles.pressed,
      ]}
      testID="meal.describe.submit"
    >
      {estimating ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
      <LPText size={15} weight="semibold" color={colors.onAccent}>
        {title}
      </LPText>
    </Pressable>
  );
}

/** The text this estimate needs the member to accept, and one button. */
function ConsentBlock({ granting, errorKey, onGrant }: { granting: boolean; errorKey: string | null; onGrant: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.consent} testID="meal.describe.consentBlock">
      <View style={styles.consentLine}>
        <View {...hiddenFromAccessibility} style={styles.consentIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.signal} />
        </View>
        <LPText size={14} color={colors.paper} style={styles.grow}>
          {t('healthconsent.ai.describe')}
        </LPText>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined);
        }}
        style={styles.link}
      >
        <LPText size={13} weight="semibold" color={colors.accentText}>
          {t('healthconsent.privacy_link')}
        </LPText>
      </Pressable>
      <Pressable
        onPress={onGrant}
        disabled={granting}
        accessibilityRole="button"
        accessibilityState={{ disabled: granting, busy: granting }}
        style={({ pressed }) => [styles.button, pressed && !granting && styles.pressed]}
        testID="meal.describe.consent"
      >
        {granting ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
        <LPText size={15} weight="semibold" color={colors.onAccent}>
          {t('meal.describe.consent.cta')}
        </LPText>
      </Pressable>
      {errorKey ? (
        <LPText size={13} color={colors.destructive} testID="meal.describe.consentError">
          {t(errorKey)}
        </LPText>
      ) : null}
    </View>
  );
}

function FailureBlock({ failure, onSearch }: { failure: MealDescribeFailure; onSearch: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.failure}>
      <LPText size={14} color={colors.paper} accessibilityLiveRegion="polite" testID="meal.describe.error">
        {t(describeFailureCopyKey(failure), describeFailureCopyParams(failure))}
      </LPText>
      {describeFailureOffersSearch(failure) ? (
        <Pressable
          onPress={onSearch}
          accessibilityRole="button"
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
          testID="meal.describe.searchInstead"
        >
          <Ionicons name="search" size={15} color={colors.accentText} {...hiddenFromAccessibility} />
          <LPText size={14} weight="semibold" color={colors.accentText}>
            {t('meal.describe.search_instead')}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14, paddingBottom: 24 },
  toolbar: { flexDirection: 'row', minHeight: 44, alignItems: 'center' },
  cancel: { minHeight: 44, justifyContent: 'center' },
  field: {
    minHeight: 120,
    maxHeight: 180,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  input: {
    minHeight: 120,
    maxHeight: 180,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 26,
    fontSize: 16,
    color: colors.paper,
  },
  counter: { position: 'absolute', right: 8, bottom: 8 },
  button: {
    minHeight: 52,
    borderRadius: radius.card,
    backgroundColor: colors.rust,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  consent: {
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  consentLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consentIcon: { width: 18, alignItems: 'center', paddingTop: 1 },
  grow: { flex: 1 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  failure: { gap: 6 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  notice: { paddingTop: 4 },
});
