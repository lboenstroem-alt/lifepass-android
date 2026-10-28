// Route `ClassesDiscoveryModal`: the classes feed as a sheet, from Plan's
// class session (iOS PlanView `.classes(session)`, ios-ux.md 3.7).
//
// It opens on the session's category (a catalogue slug, possibly not one of
// the featured chips) and day, applied before the first load, and without the
// Venues / Classes switch: presented from Plan there is nothing to switch
// back to. iOS dismisses the sheet with a swipe; an Android modal cannot be
// swiped away, so a close button sits at the top, and hardware back closes it
// too. Plan re-reads when it is back in front (iOS reloads the Plan when the
// sheet disappears).
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import type { RootModalProps } from '../../navigation/types';
import { colors, hairline, radius } from '../../theme';
import ClassesDiscovery from './ClassesDiscovery';

export default function ClassesDiscoveryModalScreen({ navigation, route }: RootModalProps<'ClassesDiscoveryModal'>) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="classes.modal">
      <View style={styles.bar}>
        <Pressable
          testID="classes.modal.close"
          onPress={() => navigation.goBack()}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={18} color={colors.paper2} />
        </Pressable>
      </View>
      <ClassesDiscovery
        initialCategory={route.params?.initialCategory}
        initialDate={route.params?.initialDate}
        showsModeToggle={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  bar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
