/**
 * In-app account deletion: the Android port of iOS
 * Views/Profile/AccountDeletionSheet.swift (Google Play's account-deletion
 * policy asks for the same thing App Store guideline 5.1.1(v) does: an
 * account made in the app can be deleted in the app).
 *
 * It opens on `GET /account/deletion` (a skeleton while it loads) and shows
 * one of two states:
 *
 * - ACTIVE: what deletion does, the health line, a red "Delete my account"
 *   that asks once more in an alert, and Cancel. The request has no body
 *   and one Idempotency-Key per request (see `keys` below for how that
 *   differs from iOS, and why).
 * - PENDING (`deletion_pending`): the erasure date in the account language,
 *   one line per obligation still to settle, "Keep my account" and the note
 *   that deleted health data does not come back.
 *
 * DELETION IS NOT ERASURE, AND THE COPY SAYS SO. Renewal stops and future
 * bookings are cancelled at once, but the account is erased only when
 * nothing is left to settle (a subscription's paid-through end, an open
 * checkout, a charge in flight), which is what the obligation lines are for.
 * Health data does NOT wait: the server deletes it in the same transaction
 * as the request.
 *
 * THE ANSWER IS SHOWN BEFORE THE PHONE IS WIPED. After a successful request
 * the sheet turns to the pending state at once and health data leaves every
 * screen (`applyHealthDataDeleted`), but the local wipe waits until the
 * sheet has gone (./localWipe.ts says why), or until it unmounts.
 *
 * While a request runs, nothing closes the sheet (pan down, the backdrop,
 * hardware back, Cancel): iOS `interactiveDismissDisabled(isWorking)`.
 * Errors: offline reads "This needs a connection.", anything else the common
 * error line; a cancelled call says nothing.
 *
 * The footer link opens the web ACCOUNT page, where the same control lives
 * (`MerchantInfo.accountDeletionURL`, `/profile`), never the bare sign-in
 * form iOS retired.
 *
 * KEEP IT MOUNTED AND DRIVE `visible`: the wipe runs from the Sheet's
 * `onClosed`, which an unmounted sheet never reports. A caller with no
 * screen of its own uses `openAccountDeletion` (./presenter.ts).
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View, type Text } from 'react-native';

import {
  isDeletionPending,
  stateOfRequestResult,
  type AccountDeletionState,
} from '../../../api/accountDeletion';
import { ActionKeys, isCancellation, isOffline, newIdempotencyKey } from '../../../api';
import { Dialog, hiddenFromAccessibility, LPText, PrimaryButton, Sheet, SkeletonCard } from '../../../components/ui';
import { MerchantInfo } from '../../../config/merchantInfo';
import { useT } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline, radius } from '../../../theme';

import { finishAccountDeletionOnPhone, memberForDeletionWipe } from './localWipe';
import { obligationLines, pendingSentence } from './obligations';
import { accountDeletionService } from './service';

export type AccountDeletionSheetProps = {
  visible: boolean;
  /** The member closed it (Cancel, pan down, the backdrop, back). Set `visible` to false. */
  onClose: () => void;
  /** The sheet has gone (after the owed local wipe has started). */
  onClosed?: () => void;
  /** Where TalkBack focus goes back to once the sheet has gone (the row that opened it). */
  returnFocusRef?: RefObject<unknown>;
  testID?: string;
};

/** The one action that keeps its key across retries (iOS: one key per presentation). */
type KeyedAction = 'request';

/** What a failed call says (iOS: offline → `health.offline.action_hint`, else `common.error_body`). */
export function deletionErrorKey(error: unknown): string {
  return isOffline(error) ? 'health.offline.action_hint' : 'common.error_body';
}

/**
 * EACH PRESENTATION IS A FRESH SHEET (iOS makes new @State per sheet): the
 * state read, the error line, the confirm and the Idempotency-Key belong to
 * one presentation. The parent keeps this mounted between presentations, so
 * the body is keyed by a counter that moves in the render that sees
 * `visible` turn true. Closing keeps the same body, which slides away and
 * reports `onClosed`.
 */
export default function AccountDeletionSheet(props: AccountDeletionSheetProps) {
  const [presentation, setPresentation] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setPresentation((count) => count + 1);
  }
  return <DeletionPresentation key={presentation} {...props} />;
}

function DeletionPresentation({ visible, onClose, onClosed, returnFocusRef, testID = 'deletion.sheet' }: AccountDeletionSheetProps) {
  const { t, language } = useT();

  const [state, setState] = useState<AccountDeletionState | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isWorking, setWorking] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  /** Read synchronously by the actions, so a double tap starts one call. */
  const working = useRef(false);
  /**
   * The request's Idempotency-Key: a member who taps Delete twice, or
   * retries after a timeout or an error, makes one request (iOS: one key per
   * presentation).
   *
   * AN ANDROID ADAPTATION (DECISIONS.md, engineering adaptations). The key
   * is spent once the server has ANSWERED, so a Delete made again after
   * "Keep my account" in the same sheet is a new request with a new key.
   * iOS keeps one key for the whole presentation, and the server replays a
   * key's cached answer to the same member (the backend's 05_MOBILE_API.md,
   * "Idempotent Writes": discard the key once the action is observed
   * complete): the second Delete would request nothing and show the stale
   * pending answer for an account the cancel had made active again.
   */
  const [keys] = useState(() => new ActionKeys<KeyedAction>());
  /** The local wipe this phone owes once the sheet has gone, and whose it is. */
  const wipeOwed = useRef<{ readonly profileId: string | null } | null>(null);
  const alive = useRef(true);
  const titleRef = useRef<Text>(null);

  const runOwedWipe = useCallback(() => {
    const owed = wipeOwed.current;
    if (!owed) return;
    wipeOwed.current = null;
    void finishAccountDeletionOnPhone(owed.profileId);
  }, []);

  // Unmounted while a wipe is owed (the screen that held the sheet went
  // away): the sheet is gone, so the wipe runs now (iOS `onDisappear`).
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      runOwedWipe();
    };
  }, [runOwedWipe]);

  // Shown: count it and read the state. Closing drops a read still in flight.
  useEffect(() => {
    if (!visible) return;
    track('account_deletion_viewed');
    const controller = new AbortController();
    setLoading(true);
    accountDeletionService.read(controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setState(next);
        setLoading(false);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (isCancellation(error)) return;
        setErrorKey(deletionErrorKey(error));
      },
    );
    return () => controller.abort();
  }, [visible]);

  const begin = (): boolean => {
    if (working.current) return false;
    working.current = true;
    setWorking(true);
    setErrorKey(null);
    return true;
  };

  const end = () => {
    working.current = false;
    if (alive.current) setWorking(false);
  };

  const fail = (error: unknown) => {
    if (isCancellation(error) || !alive.current) return;
    setErrorKey(deletionErrorKey(error));
  };

  const requestDeletion = async () => {
    if (!begin()) return;
    const profileId = memberForDeletionWipe();
    try {
      const result = await accountDeletionService.request(keys.keyFor('request'));
      keys.settle('request');
      track('account_deletion_requested');
      // What the phone SHOWS goes now: the same request deleted every health
      // row, and a profile read that fails after this sheet closes must not
      // leave the old weigh-in and plan on screen.
      useAppStore.getState().applyHealthDataDeleted();
      wipeOwed.current = { profileId };
      if (alive.current) setState(stateOfRequestResult(result));
      // Already gone (the screen holding it went away mid-request): wipe now.
      else runOwedWipe();
    } catch (error) {
      fail(error);
    } finally {
      end();
    }
  };

  const cancelDeletion = async () => {
    if (!begin()) return;
    try {
      const next = await accountDeletionService.cancel(newIdempotencyKey());
      track('account_deletion_cancelled');
      if (alive.current) setState(next);
      // Nothing of the health data comes back (`deletion.cancel_note` says so
      // before the tap); the member re-consents from Body and goals.
      await useAppStore.getState().loadProfile();
    } catch (error) {
      fail(error);
    } finally {
      end();
    }
  };

  const handleClosed = useCallback(() => {
    runOwedWipe();
    onClosed?.();
  }, [onClosed, runOwedWipe]);

  const openWeb = () => {
    // The web ACCOUNT page, where the same control lives (it sends a
    // signed-out browser to sign-in and back by itself). One constant, so
    // the sheet and the store listing cannot drift apart.
    void Linking.openURL(MerchantInfo.accountDeletionURL).catch(() => undefined);
  };

  const pending = isDeletionPending(state);
  const lines = pending ? obligationLines(state, language) : [];

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        onClosed={handleClosed}
        busy={isWorking}
        initialFocusRef={titleRef}
        returnFocusRef={returnFocusRef}
        contentStyle={styles.sheetContent}
        testID={testID}
      >
        <View style={styles.page}>
          {isLoading && state === null ? (
            <SkeletonCard rows={3} testID="deletion.loading" />
          ) : pending ? (
            <View style={styles.block} testID="deletion.pending">
              <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
                {t('deletion.title')}
              </LPText>
              <LPText size={15} color={colors.paper2}>
                {pendingSentence(state, language)}
              </LPText>
              {lines.length > 0 ? (
                <View style={styles.obligations} testID="deletion.obligations">
                  {lines.map((line, index) => (
                    <View key={index} style={styles.obligationRow}>
                      <View {...hiddenFromAccessibility} style={styles.obligationIcon}>
                        <Ionicons name="time-outline" size={13} color={colors.paper3} />
                      </View>
                      <LPText size={14} color={colors.paper2} style={styles.obligationText}>
                        {line}
                      </LPText>
                    </View>
                  ))}
                </View>
              ) : null}
              {isWorking ? (
                <View
                  accessible
                  accessibilityLabel={t('deletion.cancel')}
                  accessibilityState={{ busy: true, disabled: true }}
                  style={styles.spinner}
                  testID="deletion.keep.working"
                >
                  <ActivityIndicator color={colors.rust} />
                </View>
              ) : (
                <PrimaryButton title={t('deletion.cancel')} onPress={() => void cancelDeletion()} testID="deletion.keep" />
              )}
              <LPText size={13} color={colors.paper2}>
                {t('deletion.cancel_note')}
              </LPText>
            </View>
          ) : (
            <View style={styles.block} testID="deletion.active">
              <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
                {t('deletion.title')}
              </LPText>
              <LPText size={15} color={colors.paper2}>
                {t('deletion.body')}
              </LPText>
              <LPText size={14} color={colors.paper2}>
                {t('deletion.health_line')}
              </LPText>
              <PrimaryButton
                title={t('deletion.confirm')}
                tone="destructive"
                shape="flat"
                loading={isWorking}
                onPress={() => setShowConfirm(true)}
                accessibilityHint={t('deletion.health_line')}
                style={isWorking ? styles.workingFill : undefined}
                testID="deletion.confirm"
              />
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                disabled={isWorking}
                accessibilityState={{ disabled: isWorking }}
                style={styles.quiet}
                testID="deletion.dismiss"
              >
                <LPText size={13} weight="semibold" color={colors.paper2} align="center">
                  {t('common.cancel')}
                </LPText>
              </Pressable>
            </View>
          )}

          {errorKey ? (
            <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="deletion.error">
              {t(errorKey)}
            </LPText>
          ) : null}

          <Pressable accessibilityRole="link" onPress={openWeb} style={styles.webLink} testID="deletion.web">
            <LPText size={12} color={colors.paper3}>
              {t('deletion.web_alt')}
            </LPText>
          </Pressable>
        </View>
      </Sheet>

      {/*
        An alert, not an action sheet, for iOS's reason: the last question
        before an account is deleted is the worst place to hide the way out,
        and an alert always shows Cancel.
      */}
      <Dialog
        visible={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={t('deletion.confirm_title')}
        buttons={[
          { label: t('common.cancel'), role: 'cancel', testID: 'deletion.confirm.cancel' },
          {
            label: t('deletion.confirm'),
            role: 'destructive',
            onPress: () => void requestDeletion(),
            testID: 'deletion.confirm.delete',
          },
        ]}
        testID="deletion.confirm.dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheetContent: { paddingTop: 26 },
  page: { gap: 18 },
  block: { gap: 16 },
  obligations: {
    gap: 8,
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  obligationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  obligationIcon: { paddingTop: 3 },
  obligationText: { flex: 1 },
  spinner: { height: 52, alignItems: 'center', justifyContent: 'center' },
  workingFill: { opacity: 0.7 },
  quiet: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  webLink: { minHeight: 44, justifyContent: 'center' },
});
