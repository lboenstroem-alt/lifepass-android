/**
 * The Kenni eID sheet (iOS Views/Auth/KenniVerificationView.swift): verify
 * the member's kennitala once with Icelandic electronic ID (rafræn
 * skilríki). The flow and its rules are in ./model.ts; this is the page.
 *
 * WHAT IT SHOWS, top to bottom, as iOS does: the shield, "Verify with
 * Icelandic eID", the body (`kenni.body` for the membership gate, or
 * `kenni.onboarding_body` for the sign-up nudge and a refusal's "Verify
 * identity"), "Identity verified!" once it is, the one sentence saying why a
 * round trip ended unverified (spoken to TalkBack as soon as it ends), the
 * note on what verifying stores with the privacy policy (GDPR Art. 13:
 * before the first try and every retry, never once verified or for a
 * kennitala already on another account), then the main button: Verify with
 * eID, Try again with eID after a failure another try can fix, or Continue
 * once verified. A kennitala that may be on another account adds Contact
 * support and Sign in with another account (which signs out). While
 * unverified it always says visitor passes need no eID, with "See visitor
 * passes" when the plans screen opened it.
 *
 * Cancel (top left, iOS's toolbar) closes it at any time, as on iOS: a
 * completion already on its way still lands, and the profile is still
 * re-read when it does.
 *
 * EACH PRESENTATION IS A FRESH SHEET (iOS makes new @State per sheet): the
 * model, its failure and the sign-out lock belong to one presentation. The
 * body is keyed by a counter that moves in the render that sees `visible`
 * turn true (the HealthConsentSheet pattern), so a re-opened sheet never
 * shows the last one's failure for a frame.
 *
 * Callers do not mount this themselves: `openKenniSheet` (./sheetRequests.ts)
 * asks the host the tabs shell mounts once (./KenniNudgeHost.tsx).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, StyleSheet, View, type Text } from 'react-native';

import { announce, hiddenFromAccessibility, LPText, PrimaryButton, Sheet } from '../../components/ui';
import { MerchantInfo } from '../../config/merchantInfo';
import { useT } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

import {
  failureMessageKey,
  failureOffersSignInOther,
  failureOffersSupport,
  KenniVerificationModel,
  offersVerifyButton,
  isRetry,
  showsDataNote,
  type KenniModelState,
} from './model';
import type { KenniService } from './service';
import { authenticateWithCustomTab, type Authenticate } from './webAuth';

/** Where Contact support writes (iOS hard-codes the same address on this sheet). */
export const KENNI_SUPPORT_URL = 'mailto:support@lifepass.is';

/**
 * "Identity verified!": iOS draws it in the system green. This is iOS's own
 * darker green, so the 16 pt line reads at 4.5:1 on the sheet's paper.
 */
export const KENNI_VERIFIED_GREEN = '#1E7B34';

/** How a presentation ended, reported once it has left the screen. */
export interface KenniSheetOutcome {
  /** The kennitala was verified while this sheet was up (or already was). */
  readonly verified: boolean;
}

export type KenniSheetProps = {
  visible: boolean;
  /** `kenni.body` (the default: the membership gate) or `kenni.onboarding_body`. */
  bodyKey?: string;
  /** Plans only: "See visitor passes" runs this, then closes the sheet. */
  onSeePasses?: () => void;
  /** The member asked to close (Cancel, Continue, back, a pan down). Set `visible` to false. */
  onClose: () => void;
  /** The sheet has fully left the screen (once per presentation). */
  onClosed?: (outcome: KenniSheetOutcome) => void;
  /** The browser step; the Custom Tab by default (tests pass a stand-in). */
  authenticate?: Authenticate;
  /** The API calls; the app's own by default. */
  service?: KenniService;
  /**
   * Opened by a `lifepass://kenni-callback` link whose tab Android had
   * closed with the app (./callbackLink.ts): the sheet completes it at once.
   */
  resumeUrl?: string;
  testID?: string;
};

export default function KenniSheet(props: KenniSheetProps) {
  const [presentation, setPresentation] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setPresentation((count) => count + 1);
  }
  return <KenniPresentation key={presentation} {...props} />;
}

function KenniPresentation({
  visible,
  bodyKey = 'kenni.body',
  onSeePasses,
  onClose,
  onClosed,
  authenticate,
  service,
  resumeUrl,
  testID = 'kenni.sheet',
}: KenniSheetProps) {
  const { t } = useT();
  const [model] = useState(
    () =>
      new KenniVerificationModel({
        service,
        authenticate: authenticate ?? authenticateWithCustomTab,
        // iOS `onVerified: { await appState.loadProfile() }`: the openers
        // read `kennitalaVerified` from the profile once the sheet has gone.
        onVerified: () => useAppStore.getState().loadProfile(),
      }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [signingOut, setSigningOut] = useState(false);
  const titleRef = useRef<Text>(null);
  const stateRef = useRef<KenniModelState>(state);
  stateRef.current = state;

  // The resume link completes once, when this presentation first shows.
  const resumed = useRef(false);
  useEffect(() => {
    if (!visible || !resumeUrl || resumed.current) return;
    resumed.current = true;
    void model.resume(resumeUrl);
  }, [visible, resumeUrl, model]);

  // TalkBack hears how the round trip ended as soon as it does (iOS posts an
  // announcement for the failure). Every ending is a new state object.
  const tRef = useRef(t);
  tRef.current = t;
  const announced = useRef<KenniModelState | null>(null);
  useEffect(() => {
    if (announced.current === state) return;
    announced.current = state;
    if (state.failure) announce(tRef.current(failureMessageKey(state.failure)));
    else if (state.phase === 'verified') announce(tRef.current('kenni.verified'));
  }, [state]);

  const verified = state.phase === 'verified';
  const working = state.phase === 'working';
  const failure = state.failure;

  function seePasses() {
    onSeePasses?.();
    onClose();
  }

  function signInWithAnotherAccount() {
    if (signingOut) return;
    // Signing in with the other account means signing out of this one first
    // (the sign-in screen follows). As on iOS, the sheet goes and the
    // sign-out runs at once.
    setSigningOut(true);
    onClose();
    void useAppStore.getState().signOut();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => onClosed?.({ verified: stateRef.current.phase === 'verified' })}
      fullHeight
      initialFocusRef={titleRef}
      testID={testID}
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={8}
          style={styles.cancel}
          testID="kenni.cancel"
        >
          <LPText size={16} color={colors.paper}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>

      <View style={styles.page}>
        <View {...hiddenFromAccessibility} style={styles.badge}>
          <Ionicons name="shield-checkmark" size={32} color={colors.rust} />
        </View>

        <LPText ref={titleRef} size={24} weight="bold" color={colors.paper} align="center" accessibilityRole="header">
          {t('kenni.title')}
        </LPText>

        <LPText size={15} color={colors.mutedTextStrong} align="center" style={styles.body}>
          {t(bodyKey)}
        </LPText>

        {verified ? (
          <View style={styles.verifiedRow} testID="kenni.verified">
            <View {...hiddenFromAccessibility}>
              <Ionicons name="checkmark-circle" size={18} color={KENNI_VERIFIED_GREEN} />
            </View>
            <LPText size={16} weight="semibold" color={KENNI_VERIFIED_GREEN}>
              {t('kenni.verified')}
            </LPText>
          </View>
        ) : null}

        {failure ? (
          <View
            accessible
            accessibilityLabel={t(failureMessageKey(failure))}
            style={styles.failure}
            testID="kenni.failure"
          >
            <View {...hiddenFromAccessibility} style={styles.failureIcon}>
              <Ionicons name="alert-circle" size={15} color={colors.destructive} />
            </View>
            <LPText size={14} color={colors.destructive} style={styles.failureText}>
              {t(failureMessageKey(failure))}
            </LPText>
          </View>
        ) : null}

        {showsDataNote(state) ? (
          <LPText size={13} color={colors.mutedTextStrong} align="center" style={styles.body} testID="kenni.data_note">
            {`${t('kenni.data_note')} `}
            <LPText
              size={13}
              color={colors.accentText}
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(MerchantInfo.privacyURL).catch(() => undefined);
              }}
              style={styles.link}
              testID="kenni.privacy_link"
            >
              {t('kenni.privacy_link')}
            </LPText>
          </LPText>
        ) : null}

        <View style={styles.actions}>
          {verified ? (
            <PrimaryButton title={t('common.continue')} onPress={onClose} shape="flat" testID="kenni.continue" />
          ) : offersVerifyButton(state) ? (
            <PrimaryButton
              title={t(isRetry(state) ? 'kenni.retry' : 'kenni.cta')}
              icon="shield-half-outline"
              onPress={() => void model.start()}
              loading={working}
              shape="flat"
              testID="kenni.verify"
            />
          ) : null}

          {failure && failureOffersSupport(failure) ? (
            <>
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(KENNI_SUPPORT_URL).catch(() => undefined);
                }}
                style={({ pressed }) => [styles.support, pressed && styles.pressed]}
                testID="kenni.support"
              >
                <LPText size={15} weight="semibold" color={colors.accentText} align="center">
                  {t('kenni.support')}
                </LPText>
              </Pressable>
              {failureOffersSignInOther(failure) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t('kenni.sign_in_other_hint')}
                  accessibilityState={{ disabled: signingOut }}
                  disabled={signingOut}
                  onPress={signInWithAnotherAccount}
                  style={({ pressed }) => [styles.signInOther, pressed && styles.pressed]}
                  testID="kenni.sign_in_other"
                >
                  <LPText size={15} weight="semibold" color={colors.paper} align="center">
                    {t('kenni.sign_in_other')}
                  </LPText>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {!verified ? (
            <View style={styles.passes}>
              <LPText size={13} color={colors.mutedTextStrong} align="center">
                {t('kenni.passes_note')}
              </LPText>
              {onSeePasses ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={seePasses}
                  style={({ pressed }) => [styles.seePasses, pressed && styles.pressed]}
                  testID="kenni.see_passes"
                >
                  <LPText size={14} weight="semibold" color={colors.accentText} align="center">
                    {t('kenni.see_passes')}
                  </LPText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', justifyContent: 'flex-start', paddingBottom: 4 },
  cancel: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  page: { alignItems: 'center', gap: 20, paddingHorizontal: 8, paddingBottom: 12 },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rust3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  body: { paddingHorizontal: 8 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  failure: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(208,37,37,0.08)',
  },
  failureIcon: { paddingTop: 2 },
  failureText: { flex: 1 },
  link: { textDecorationLine: 'underline' },
  actions: { alignSelf: 'stretch', gap: 12, paddingTop: 12 },
  support: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signInOther: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  passes: { alignItems: 'center', gap: 4, paddingTop: 4 },
  seePasses: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  pressed: { opacity: 0.6 },
});
