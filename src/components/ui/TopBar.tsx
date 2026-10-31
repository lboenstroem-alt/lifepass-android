// The top bar (iOS BrandedTopBar): wordmark or a back chevron on the left, a
// centred kicker title (and optional subtitle), and on the right an optional
// small busy spinner plus one 36 pt circle button: a person or a gear.
//
// Where the buttons GO is the caller's business (navigation is F4's). What
// they SAY is not optional, which is why the labels are keys with the iOS
// defaults:
//   - The person button opens Profile on Explore, Scan and Saved since the
//     Coach release, and says so with `a11y.open_profile`; elsewhere it opens
//     Account (`a11y.open_account`, the default). "Open account" on a button
//     that lands in Profile is a lie told only to people who cannot see where
//     they landed.
//   - The person button can be disabled without being removed (Scan, while
//     the camera is live), drawn at 40 %.
//   - The gear is "Settings" by default; Plan's gear opens Body and goals and
//     passes `a11y.body_goals`.
//   - `onBack` replaces the wordmark with a back chevron: a pushed screen that
//     hides the navigation header has no other way back.
//   - `busy` shows a small spinner while cached content refreshes, without
//     covering what the member is reading; it is decoration to TalkBack.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import { colors, hairline } from '../../theme';
import { hiddenFromAccessibility } from './a11y';
import Kicker from './Kicker';
import Wordmark from './Wordmark';

export type TopBarTrailing =
  | {
      kind: 'person';
      onPress: () => void;
      /** `a11y.open_profile` where it opens Profile; `a11y.open_account` (default) where it opens Account. */
      labelKey?: string;
      disabled?: boolean;
    }
  | {
      kind: 'gear';
      onPress: () => void;
      /** `a11y.settings` (default), or `a11y.body_goals` on Plan. */
      labelKey?: string;
    };

export type TopBarProps = {
  title: string;
  subtitle?: string;
  /** Replaces the wordmark with a back chevron (`common.back`). */
  onBack?: () => void;
  /** The trailing button; omitted, there is none. */
  trailing?: TopBarTrailing;
  busy?: boolean;
  /** Pads for the status bar (edge to edge). Off when a parent already does. */
  safeAreaTop?: boolean;
  testID?: string;
};

const SIDE_WIDTH = 80;

export default function TopBar({ title, subtitle, onBack, trailing, busy = false, safeAreaTop = true, testID }: TopBarProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();

  return (
    <View testID={testID} style={[styles.bar, safeAreaTop && { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.leading}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={6}
              style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={18} color={colors.paper2} />
            </Pressable>
          ) : (
            <View style={styles.wordmark}>
              <Wordmark height={19} />
            </View>
          )}
        </View>

        <View style={styles.center}>
          <Kicker text={title} color={colors.paper2} accessibilityRole="header" />
          {subtitle ? <Kicker text={subtitle} color={colors.paper3} /> : null}
        </View>

        <View style={styles.trailing}>
          {busy ? (
            <View {...hiddenFromAccessibility} style={styles.spinner} testID={testID ? `${testID}.busy` : 'topbar.busy'}>
              <ActivityIndicator size="small" color={colors.paper3} />
            </View>
          ) : null}
          {trailing?.kind === 'gear' ? (
            <Pressable
              onPress={trailing.onPress}
              accessibilityRole="button"
              accessibilityLabel={t(trailing.labelKey ?? 'a11y.settings')}
              hitSlop={6}
              style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
            >
              <Ionicons name="settings-outline" size={17} color={colors.paper2} />
            </Pressable>
          ) : null}
          {trailing?.kind === 'person' ? (
            <Pressable
              onPress={trailing.onPress}
              disabled={trailing.disabled}
              accessibilityRole="button"
              accessibilityLabel={t(trailing.labelKey ?? 'a11y.open_account')}
              accessibilityState={{ disabled: !!trailing.disabled }}
              hitSlop={6}
              style={({ pressed }) => [styles.circle, trailing.disabled && styles.disabled, pressed && styles.pressed]}
            >
              <Ionicons name="person-circle-outline" size={21} color={colors.paper2} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.ink,
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  leading: { width: SIDE_WIDTH, alignItems: 'flex-start' },
  wordmark: { paddingTop: 3 },
  center: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 2 },
  trailing: { width: SIDE_WIDTH, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  spinner: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.7 }] },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
