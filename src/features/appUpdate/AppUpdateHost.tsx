/* eslint lifepass/no-literal-copy: "error" */
/**
 * The update prompt, mounted once by the app root (App.tsx), above the
 * navigator: it asks at launch and on returns to the foreground
 * (./updateStore.ts says when), and shows what ./policy.ts decided.
 *
 * - required: a full-screen cover over everything (its own window, so no
 *   sheet, dialog or tab bar sits on top of it): "Please update LifePass",
 *   why, and one Update button to Google Play. Nothing else can be reached.
 *   Hardware back leaves the app, as back does on any app's first screen.
 *   The words scroll and the button is pinned below them, OUTSIDE the
 *   scroll, so at the largest font size on a small phone the title and the
 *   body can be scrolled through and Update is always on screen. The title
 *   stops growing at iOS's accessibility1 size: past it the longest
 *   Icelandic word ("Vinsamlegast") no longer fits a 360 dp wide phone and
 *   would break in the middle.
 * - available: "A new version is available", Update or Not now, once per
 *   new version. It waits for its moment (./policy.ts `softPromptMayShow`,
 *   iOS `AppUpdatePrompts`): not over the launch screen (the same test
 *   RootNavigator draws it by, src/navigation/launchScreen.ts), not while
 *   the Kenni nudge or the new-password screen is armed, not while a
 *   check-in is on its way (a door link parked, a walk-in in the scanner in
 *   front, the Scan camera live: intent store `isCheckInUnderway`), not in
 *   the background; and only once all that has held for
 *   `SOFT_PROMPT_SETTLE_MS`. A check-in that starts while it is up (a door
 *   link arrives) sends it away unanswered, to come back once the member is
 *   through. Only an answer retires it for that version: Update, Not now, or
 *   back and a tap outside, which press Not now. A prompt that was never
 *   answered (the app closed under it, a block took its place) comes back
 *   at the next launch. The block never waits (iOS holds only the alert).
 * - none: nothing.
 */
import { useEffect, useState } from 'react';
import { AppState, BackHandler, Modal, ScrollView, StyleSheet, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dialog, LPText, PrimaryButton, Wordmark } from '../../components/ui';
import { FONT_SCALE_CAP } from '../../hooks/useA11ySize';
import { useT } from '../../i18n';
import { useLaunchScreenShowing } from '../../navigation/launchScreen';
import { useAppStore } from '../../stores/appStore';
import { isCheckInUnderway, useIntentStore } from '../../stores/intentStore';
import { colors } from '../../theme';
import { openPlayStore } from './openStore';
import { SOFT_PROMPT_SETTLE_MS, softPromptMayShow } from './policy';
import { checkForUpdate, checkForUpdateIfStale, dismissUpdateAvailable, useAppUpdate } from './updateStore';

/**
 * Whether an AppState reading means the foreground. Android reports `active`
 * and `background`, and `unknown` before its first reading at launch, when
 * the app is in fact starting in front.
 */
function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

/**
 * True once `free` has held for `ms` without a break; false the moment it
 * stops, and the wait starts over (iOS `waitToShowSoftAlert`'s `freeSince`).
 * `turn` starts it over too: a different version waits afresh.
 */
function useStayedTrue(free: boolean, ms: number, turn: string | null): boolean {
  const [settled, setSettled] = useState<{ readonly turn: string | null } | null>(null);
  useEffect(() => {
    if (!free) {
      setSettled(null);
      return undefined;
    }
    const timer = setTimeout(() => setSettled({ turn }), ms);
    return () => clearTimeout(timer);
  }, [free, ms, turn]);
  // Read with `free` too: the render that turns it false comes before the
  // effect that clears `settled`.
  return free && settled !== null && settled.turn === turn;
}

export default function AppUpdateHost() {
  const prompt = useAppUpdate((s) => s.prompt);
  const storeUrl = useAppUpdate((s) => s.storeUrl);
  const launching = useLaunchScreenShowing();
  const sheetPending = useAppStore((s) => s.pendingKennitalaPrompt || s.pendingPasswordRecovery);
  const checkInUnderway = useIntentStore(isCheckInUnderway);
  const [appActive, setAppActive] = useState(() => isForeground(AppState.currentState));

  useEffect(() => {
    void checkForUpdate();
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(isForeground(state));
      if (state === 'active') void checkForUpdateIfStale();
    });
    return () => subscription.remove();
  }, []);

  const availableVersion = prompt.kind === 'available' ? prompt.latestVersion : null;
  const mayShow =
    availableVersion !== null && softPromptMayShow({ launching, appActive, sheetPending, checkInUnderway });
  const showsAvailable = useStayedTrue(mayShow, SOFT_PROMPT_SETTLE_MS, availableVersion);

  if (prompt.kind === 'required') return <UpdateRequiredCover storeUrl={storeUrl} />;
  if (showsAvailable) return <UpdateAvailableDialog storeUrl={storeUrl} />;
  return null;
}

function UpdateAvailableDialog({ storeUrl }: { readonly storeUrl: string }) {
  const { t } = useT();
  return (
    <Dialog
      visible
      onClose={dismissUpdateAvailable}
      title={t('appupdate.available.title')}
      message={t('appupdate.available.body')}
      buttons={[
        { label: t('appupdate.not_now'), role: 'cancel', testID: 'appupdate.available.notNow' },
        {
          label: t('appupdate.update'),
          onPress: () => void openPlayStore(storeUrl),
          testID: 'appupdate.available.update',
        },
      ]}
      testID="appupdate.available"
    />
  );
}

export function UpdateRequiredCover({ storeUrl }: { readonly storeUrl: string }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [storeFailed, setStoreFailed] = useState(false);
  const update = async () => {
    setStoreFailed(!(await openPlayStore(storeUrl)));
  };
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Blocked: back leaves the app instead of reaching anything behind.
      onRequestClose={() => BackHandler.exitApp()}
      testID="appupdate.required"
    >
      <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="appupdate.required.scroll">
          <Wordmark height={22} />
          <LPText
            serif
            size={28}
            weight="medium"
            align="center"
            accessibilityRole="header"
            maxScale={FONT_SCALE_CAP.accessibility1}
            testID="appupdate.required.title"
          >
            {t('appupdate.required.title')}
          </LPText>
          <LPText size={15} color={colors.paper2} align="center" testID="appupdate.required.body">
            {t('appupdate.required.body')}
          </LPText>
          {storeFailed ? (
            <LPText size={13} color={colors.destructive} align="center" accessibilityLiveRegion="polite" testID="appupdate.required.storeFailed">
              {t('appupdate.store_failed')}
            </LPText>
          ) : null}
        </ScrollView>
        <View style={styles.footer} testID="appupdate.required.footer">
          <PrimaryButton title={t('appupdate.update')} onPress={() => void update()} testID="appupdate.required.update" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
});
