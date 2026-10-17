/* eslint lifepass/no-literal-copy: "error" */
/**
 * What a route shows before its package has landed (plan 3.0, rule 5).
 *
 * F4 creates a file for every screen and slot at its final path, with its
 * final exported signature, so packages can navigate to and mount each
 * other's work before it exists. Each such file starts with the marker
 * `@f4-stub`; the owner replaces the body (and the marker) and keeps the
 * signature. REL-1 checks that no `@f4-stub` file ships.
 *
 * A stub SCREEN shows "Not in this build yet" with a way back in development
 * builds, so a developer who opens it knows why it is empty; a release build
 * renders nothing (hardware back still leaves). A stub SLOT renders nothing.
 */
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';

import { TopBar } from '../components/ui';
import { useT } from '../i18n';
import { colors, sans } from '../theme';

export interface StubScreenProps {
  /** The route's name, shown to the developer. */
  readonly route: string;
  /** The package that fills it (plan 3.0.2), shown to the developer. */
  readonly owner: string;
}

/** A route whose screen is not built yet: a development placeholder, nothing in a release build. */
export function StubScreen({ route, owner }: StubScreenProps) {
  const { t } = useT();
  const navigation = useNavigation();
  if (!__DEV__) return null;
  const goBack = navigation.canGoBack() ? () => navigation.goBack() : undefined;
  return (
    <View style={styles.page} testID={`stub.${route}`}>
      <TopBar title={route} onBack={goBack} safeAreaTop />
      <View style={styles.body}>
        <Text style={styles.title}>{t('nav.stub.not_in_build')}</Text>
        <Text style={styles.owner}>{`${route} · ${owner}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: {
    ...sans(16, 'semibold'),
    color: colors.paper,
    textAlign: 'center',
  },
  owner: {
    ...sans(13),
    color: colors.paper3,
    textAlign: 'center',
  },
});
