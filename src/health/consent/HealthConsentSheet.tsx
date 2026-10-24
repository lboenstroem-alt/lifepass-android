/**
 * The separate, explicit consent for health and fitness data (iOS
 * Views/Health/HealthConsentSheet.swift, ios-ux.md 4). The rules are in
 * ./consent.ts; this is the sheet.
 *
 * A full-height sheet: what is stored, what the AI sees (and never sees),
 * the promises, the disclaimer, the privacy policy, then a panel pinned to
 * the bottom with the 18+ row (only for an account whose age the server
 * cannot read), the consent box, "Turn on tracking" and Not now. At the
 * accessibility text sizes the pinned panel would eat the page, so it
 * becomes the last block of the scroll instead.
 *
 * ANDROID SHOWS NO APPLE HEALTH LINES. The text is iOS's, word for word, and
 * the grant is recorded under the same version, but "Sleep, steps ... from
 * Apple Health" and "Apple Health data is never sent to the AI" are about a
 * connection Android does not offer (owner decision: no Health Connect), so
 * they are left out rather than reworded.
 *
 * ONE SHEET, ONE KEY. The Idempotency-Key is minted per presentation, so a
 * member who taps Turn on twice (or retries after a 500) writes one consent
 * row, not two. While the grant is in flight the sheet cannot be closed.
 *
 * A VERIFIED account under 18 is refused outright and no attestation can
 * override it: the server answers 403 and the sheet turns into the under-18
 * card. The local wipe and the profile read after it wait until the card is
 * closed: either can take down the screen this sheet was opened from.
 *
 * KEEP IT MOUNTED AND DRIVE `visible`. What runs after the sheet has gone
 * (`onGranted`, the minor wipe) runs from the Sheet's `onClosed`, which an
 * unmounted sheet never reports. A caller with no screen of its own uses
 * `openHealthConsent` (./presenter.ts) instead.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View, type Text } from 'react-native';

import { newIdempotencyKey, type ApiError } from '../../api';
import { announce, Card, CheckboxRow, hiddenFromAccessibility, Kicker, LPText, PrimaryButton, Sheet } from '../../components/ui';
import { useA11ySize } from '../../hooks/useA11ySize';
import { useT } from '../../i18n';
import { track } from '../../lib/analytics';
import { selectIsKennitalaVerified, selectSupportsMealDescribe, selectSupportsPlanEdit, useAppStore } from '../../stores/appStore';
import { colors, hairline, radius } from '../../theme';
import { grantedConsent, setHealthConsent } from '../api';
import MinorCard from '../minor/MinorCard';
import { useHealthStore } from '../store';

import {
  consentFailure,
  consentGrantBody,
  consentToApply,
  needsAgeAttestation as ageRowNeeded,
  PRIVACY_POLICY_URL,
  type HealthConsentEntry,
} from './consent';

export type HealthConsentSheetProps = {
  visible: boolean;
  entry: HealthConsentEntry;
  /** The member closed it (Not now, back, pan down, Done on the under-18 card), or it closed after a grant. */
  onClose: () => void;
  /**
   * What runs after consent is granted AND the sheet has gone (the action the
   * member tapped, run again; the Coach wizard; the meal capture page). Never
   * while the sheet is still on screen: a sheet presented from inside one
   * that is still closing is dropped.
   */
  onGranted?: () => void | Promise<void>;
  /** Shown with the pending-deletion line, when the caller has an Account to open. */
  onOpenAccount?: () => void;
  testID?: string;
};

type ErrorState = { key: string; showOpenAccount: boolean } | null;

/**
 * EACH PRESENTATION IS A FRESH SHEET (iOS makes new @State per sheet): the
 * ticks, the error line, the under-18 card and the Idempotency-Key belong to
 * one presentation. The host keeps this mounted between presentations, so
 * the body is keyed by a counter that moves when `visible` turns true. The
 * counter moves DURING the render that sees `visible` turn true, so the
 * first frame of a re-opened sheet is already the fresh one; a reset in an
 * effect ran after that frame had shown the last presentation's under-18
 * card or ticked box. Closing keeps the same body, which slides away and
 * reports `onClosed`.
 */
export default function HealthConsentSheet(props: HealthConsentSheetProps) {
  const [presentation, setPresentation] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setPresentation((count) => count + 1);
  }
  return <ConsentPresentation key={presentation} {...props} />;
}

function ConsentPresentation({ visible, entry, onClose, onGranted, onOpenAccount, testID }: HealthConsentSheetProps) {
  const { t } = useT();
  const { isAccessibilitySize } = useA11ySize();
  const kennitalaVerified = useAppStore(selectIsKennitalaVerified);
  const supportsMealDescribe = useAppStore(selectSupportsMealDescribe);
  const supportsPlanEdit = useAppStore(selectSupportsPlanEdit);

  const [ageTicked, setAgeTicked] = useState(false);
  const [consentTicked, setConsentTicked] = useState(false);
  const [isPosting, setPosting] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [ageErrored, setAgeErrored] = useState(false);
  const [serverAskedToAttest, setServerAskedToAttest] = useState(false);
  const [refusedAsMinor, setRefusedAsMinor] = useState(false);

  const idempotencyKey = useRef(newIdempotencyKey());
  const granted = useRef(false);
  const minorWipeOwed = useRef<ApiError | null>(null);
  const continuation = useRef<(() => void | Promise<void>) | null>(null);
  const titleRef = useRef<Text>(null);

  // This instance is one presentation (see HealthConsentSheet above), so its
  // state and key start fresh; it is counted once, when it shows.
  useEffect(() => {
    if (visible) track('health_consent_viewed', { entry });
  }, [visible, entry]);

  const needsAge = ageRowNeeded(kennitalaVerified, serverAskedToAttest);
  const canSubmit = consentTicked && (!needsAge || ageTicked);

  const fail = useCallback(
    (caught: unknown) => {
      const failure = consentFailure(caught);
      switch (failure.kind) {
        case 'attest': {
          // The refusal turns the row ON: the server is the only one that
          // knows whether the kennitala it holds yields an age.
          setServerAskedToAttest(true);
          setAgeErrored(true);
          setError({ key: 'healthconsent.err.attest', showOpenAccount: false });
          announce(t('healthconsent.err.attest'));
          return;
        }
        case 'minor':
          track('health_consent_minor_refused', { entry });
          minorWipeOwed.current = failure.error;
          setRefusedAsMinor(true);
          return;
        case 'pendingDeletion':
          setError({ key: 'health.err.pending_deletion', showOpenAccount: !!onOpenAccount });
          announce(t('health.err.pending_deletion'));
          return;
        case 'message':
          setError({ key: failure.key, showOpenAccount: false });
          announce(t(failure.key));
          return;
        case 'silent':
          return;
      }
    },
    [entry, onOpenAccount, t],
  );

  const grant = useCallback(async () => {
    if (!canSubmit || isPosting) return;
    setPosting(true);
    setError(null);
    setAgeErrored(false);
    try {
      const result = await setHealthConsent(
        consentGrantBody({ entry, ageRowShown: needsAge, supportsMealDescribe, supportsPlanEdit }),
        idempotencyKey.current,
      );
      granted.current = true;
      track('health_consent_granted', { entry, source: needsAge ? 'attestation' : 'kennitala' });
      // THE SERVER'S ANSWER FIRST, THEN THE READ: a failed read keeps the
      // old profile, and the member must not close this sheet onto a switch
      // that still reads Off.
      useAppStore
        .getState()
        .applyHealthConsentGranted(
          consentToApply(grantedConsent(result), { ageRowShown: needsAge, supportsMealDescribe, supportsPlanEdit }),
        );
      await useAppStore.getState().loadProfile();
      setPosting(false);
      continuation.current = onGranted ?? null;
      onClose();
    } catch (caught) {
      setPosting(false);
      fail(caught);
    }
  }, [canSubmit, entry, fail, isPosting, needsAge, onClose, onGranted, supportsMealDescribe, supportsPlanEdit]);

  /** The sheet has gone: what was owed runs now, never while it was on screen. */
  const onClosed = useCallback(() => {
    const owed = minorWipeOwed.current;
    minorWipeOwed.current = null;
    if (owed) {
      // The store wipes what this phone still holds; the profile read is what
      // makes `access` read `minor` everywhere else.
      useHealthStore.getState().handle(owed, { foreground: true });
      void useAppStore.getState().loadProfile();
    }
    const next = continuation.current;
    continuation.current = null;
    if (next) {
      void Promise.resolve()
        .then(next)
        .catch(() => undefined);
      return;
    }
    // A swipe down and Not now are the same answer, and both are worth
    // knowing about: a consent sheet people close asks at the wrong moment.
    if (!granted.current && !owed) track('health_consent_dismissed', { entry });
  }, [entry]);

  const panel = (
    <View style={styles.panel}>
      {needsAge ? (
        <View style={styles.ageRow}>
          <CheckboxRow
            title={t('healthconsent.check.age')}
            checked={ageTicked}
            onChange={setAgeTicked}
            outlined={ageErrored}
            disabled={isPosting}
            testID="healthconsent.age"
          />
          {ageErrored && error?.key === 'healthconsent.err.attest' ? (
            <LPText size={13} color={colors.destructive}>
              {t('healthconsent.err.attest')}
            </LPText>
          ) : null}
        </View>
      ) : null}
      <CheckboxRow
        title={t('healthconsent.check.consent')}
        checked={consentTicked}
        onChange={setConsentTicked}
        disabled={isPosting}
        testID="healthconsent.consent"
      />
      {isPosting || canSubmit ? (
        <PrimaryButton title={t('healthconsent.cta')} onPress={grant} loading={isPosting} testID="healthconsent.cta" />
      ) : (
        // A DISABLED BUTTON THAT IS STILL LEGIBLE: a muted fill with ink on
        // it reads as "not yet" without becoming a ghost, and TalkBack hears
        // a disabled button with a hint, not a live one that does nothing.
        <Pressable
          disabled
          accessibilityRole="button"
          accessibilityLabel={t('healthconsent.cta')}
          accessibilityHint={t('healthconsent.a11y.tick_first')}
          accessibilityState={{ disabled: true }}
          style={styles.held}
          testID="healthconsent.cta.held"
        >
          <LPText size={15} weight="semibold" color={colors.paper2} tracking={-0.1} align="center">
            {t('healthconsent.cta')}
          </LPText>
        </Pressable>
      )}
      {error && !(error.key === 'healthconsent.err.attest' && needsAge) ? (
        <View style={styles.errorBlock}>
          <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite">
            {t(error.key)}
          </LPText>
          {error.showOpenAccount && onOpenAccount ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onOpenAccount();
              }}
              style={styles.quiet}
            >
              <LPText size={13} weight="semibold" color={colors.paper2}>
                {t('health.err.open_account')}
              </LPText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        disabled={isPosting}
        accessibilityState={{ disabled: isPosting }}
        style={[styles.quiet, styles.notNow]}
        testID="healthconsent.not_now"
      >
        <LPText size={13} weight="semibold" color={colors.paper2} align="center">
          {t('healthconsent.not_now')}
        </LPText>
      </Pressable>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      busy={isPosting}
      fullHeight
      initialFocusRef={titleRef}
      footer={refusedAsMinor || isAccessibilitySize ? undefined : panel}
      testID={testID}
    >
      {refusedAsMinor ? (
        <MinorCard ref={titleRef} variant="sheet" onDone={onClose} testID="healthconsent.minor" />
      ) : (
        <View style={styles.page}>
          <View style={styles.header}>
            <Kicker text={t('healthconsent.kicker')} />
            <LPText ref={titleRef} serif size={28} color={colors.paper} accessibilityRole="header">
              {t('healthconsent.title')}
            </LPText>
            <LPText size={15} color={colors.paper2}>
              {t('healthconsent.intro')}
            </LPText>
          </View>

          <ConsentCard kicker={t('healthconsent.store.kicker')}>
            <IconLine icon="body-outline" text={t('healthconsent.store.body')} />
            <IconLine icon="flag-outline" text={t('healthconsent.store.goals')} />
            <IconLine icon="barbell-outline" text={t('healthconsent.store.workouts')} />
            <IconLine icon="restaurant-outline" text={t('healthconsent.store.meals')} />
          </ConsentCard>

          <ConsentCard kicker={t('healthconsent.ai.kicker')}>
            <LPText size={14} color={colors.paper2}>
              {t('healthconsent.ai.body')}
            </LPText>
            <IconLine icon="remove-circle-outline" text={t('healthconsent.ai.never_identity')} />
            <IconLine icon="remove-circle-outline" text={t('healthconsent.ai.never_numbers')} />
            <IconLine
              icon="remove-circle-outline"
              text={t(supportsPlanEdit ? 'healthconsent.ai.never_text_v4' : 'healthconsent.ai.never_text')}
            />
            <IconLine icon="remove-circle-outline" text={t('healthconsent.ai.never_location')} />
            <IconLine icon="camera-outline" text={t('healthconsent.ai.photo')} />
            {supportsMealDescribe || supportsPlanEdit ? (
              // Shown exactly when the version sent is one that names it (v3,
              // and v4, which is v3 and one line more).
              <IconLine icon="chatbubble-ellipses-outline" text={t('healthconsent.ai.describe')} />
            ) : null}
            {supportsPlanEdit ? (
              // v4: a plan change asked of the Coach goes to Anthropic with the plan.
              <IconLine icon="barbell-outline" text={t('healthconsent.ai.plan_edit')} />
            ) : null}
            <LPText size={14} color={colors.paper2}>
              {t('healthconsent.ai.saved_once')}
            </LPText>
          </ConsentCard>

          <ConsentCard kicker={t('healthconsent.promise.kicker')}>
            <LPText size={14} color={colors.paper2}>
              {t('healthconsent.promise.no_marketing')}
            </LPText>
            <LPText size={14} color={colors.paper2}>
              {t('healthconsent.promise.control')}
            </LPText>
          </ConsentCard>

          <View style={styles.footnotes}>
            <LPText size={13} color={colors.paper2}>
              {t('health.disclaimer')}
            </LPText>
            <LPText size={13} color={colors.paper2}>
              {t('healthconsent.optional')}
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

          {isAccessibilitySize ? <View style={styles.inlinePanel}>{panel}</View> : null}
        </View>
      )}
    </Sheet>
  );
}

function ConsentCard({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <Card style={styles.card} accessibilityLabel={kicker}>
      <Kicker text={kicker} color={colors.paper3} />
      {children}
    </Card>
  );
}

function IconLine({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.iconLine}>
      <View {...hiddenFromAccessibility} style={styles.icon}>
        <Ionicons name={icon} size={16} color={colors.signal} />
      </View>
      <LPText size={14} color={colors.paper2} style={styles.lineText}>
        {text}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18, paddingTop: 4, paddingBottom: 12 },
  header: { gap: 10 },
  card: { padding: 14, gap: 12 },
  iconLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 18, alignItems: 'center', paddingTop: 1 },
  lineText: { flex: 1 },
  footnotes: { gap: 6 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  panel: { gap: 12 },
  inlinePanel: { paddingTop: 8 },
  ageRow: { gap: 6 },
  held: {
    minHeight: 52,
    borderRadius: radius.card,
    backgroundColor: colors.ink4,
    borderWidth: hairline,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorBlock: { gap: 8 },
  quiet: { minHeight: 44, justifyContent: 'center' },
  notNow: { alignSelf: 'stretch' },
});
