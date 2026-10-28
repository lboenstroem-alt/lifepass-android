/**
 * What a member sees while the app restores their session and reads their
 * profile at launch: the wordmark on the page colour with a spinner under it
 * (iOS `LaunchScreen` in App/ContentView.swift). Shown while the app store's
 * `isLoading` is true, which covers the session restore AND the first
 * profile read, so the first screen already has the member's name, caps and
 * language.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useT } from '../i18n';
import { colors } from '../theme';

import Wordmark from './ui/Wordmark';

export default function LaunchScreen() {
  const { t } = useT();
  return (
    <View style={styles.page} testID="launch-screen">
      <Wordmark height={28} />
      <ActivityIndicator
        color={colors.rust}
        accessibilityLabel={t('a11y.loading')}
        style={styles.spinner}
        testID="launch-screen-spinner"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginTop: 20,
  },
});
