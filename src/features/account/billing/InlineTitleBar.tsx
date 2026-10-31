/* eslint lifepass/no-literal-copy: "error" */
// The navigation bar of the pages ACCT-2 pushes from Account (Receipts, Plan
// and usage). iOS shows each with an inline navigation title and the system
// back button; the tab stacks hide React Navigation's header, so the page
// draws its own: a back chevron and the centred title, clear of the status
// bar. Hardware back leaves the page through the navigator as well.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';

export interface InlineTitleBarProps {
  readonly title: string;
  readonly onBack: () => void;
  /** The page's own background, so the bar reads as part of it (iOS's bar is transparent at rest). */
  readonly background?: string;
  readonly testID?: string;
}

export default function InlineTitleBar({ title, onBack, background = colors.ink, testID }: InlineTitleBarProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: background }]} testID={testID}>
      <View style={styles.row}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          style={({ pressed }) => [styles.side, pressed && styles.pressed]}
          testID={testID ? `${testID}.back` : undefined}
        >
          <Ionicons name="chevron-back" size={22} color={colors.accentText} />
        </Pressable>
        <View style={styles.title}>
          <LPText size={17} weight="semibold" align="center" numberOfLines={1} accessibilityRole="header">
            {title}
          </LPText>
        </View>
        <View style={styles.side} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
  },
  side: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    paddingHorizontal: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
