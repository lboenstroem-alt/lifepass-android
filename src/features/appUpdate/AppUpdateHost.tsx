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
 *   The words scroll and the button is pinned below them, so it stays on
 *   screen at the largest font size.
 * - available: "A new version is available", Update or Not now, once per
 *   new version. Shown once the launch screen has gone, so it never flashes
 *   over the splash; either answer retires it for that version.
 * - none: nothing.
 */
import { useEffect, useState } from 'react';
import { AppState, BackHandler, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dialog, LPText, PrimaryButton, Wordmark } from '../../components/ui';
import { useT } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';
import { openPlayStore } from './openStore';
import { checkForUpdate, checkForUpdateIfStale, dismissUpdateAvailable, useAppUpdate } from './updateStore';

export default function AppUpdateHost() {
  const prompt = useAppUpdate((s) => s.prompt);
  const storeUrl = useAppUpdate((s) => s.storeUrl);
  // The soft prompt waits for the launch screen to go.
  const launched = useAppStore((s) => !s.isLoading);

  useEffect(() => {
    void checkForUpdate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForUpdateIfStale();
    });
    return () => subscription.remove();
  }, []);

  if (prompt.kind === 'required') return <UpdateRequiredCover storeUrl={storeUrl} />;
  if (prompt.kind === 'available' && launched) return <UpdateAvailableDialog storeUrl={storeUrl} />;
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
          <LPText serif size={28} weight="medium" align="center" accessibilityRole="header">
            {t('appupdate.required.title')}
          </LPText>
          <LPText size={15} color={colors.paper2} align="center">
            {t('appupdate.required.body')}
          </LPText>
          {storeFailed ? (
            <LPText size={13} color={colors.destructive} align="center" accessibilityLiveRegion="polite" testID="appupdate.required.storeFailed">
              {t('appupdate.store_failed')}
            </LPText>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
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
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
});
