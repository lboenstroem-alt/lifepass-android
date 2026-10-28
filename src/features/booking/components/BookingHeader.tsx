// The booking flow's navigation bar: iOS shows it as an inline title, "Book
// {name}" / "Bóka {name}", with the system back button. The tab stacks hide
// React Navigation's header, so the flow draws its own: a back chevron and
// the centred title, clear of the status bar. Back goes through the
// navigator, so the busy guard (useBusyGuard) holds it while a booking or a
// payment is in flight.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';

export interface BookingHeaderProps {
  readonly title: string;
  readonly onBack: () => void;
}

export default function BookingHeader({ title, onBack }: BookingHeaderProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          testID="booking.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.accentText} />
        </Pressable>
        <View style={styles.titleWrap}>
          <LPText size={17} weight="semibold" align="center" numberOfLines={1} accessibilityRole="header">
            {title}
          </LPText>
        </View>
        <View style={styles.back} />
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
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    paddingHorizontal: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
