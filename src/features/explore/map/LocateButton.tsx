// The map's locate button (iOS `MapUserLocationButton`, top trailing over
// the map): it brings the member's own position into view. It shows while
// location is allowed, or not yet decided (a tap then asks, as MapKit's
// button does); while location is off, the "Location is off" banner under
// the legend is the way back instead.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';

export interface LocateButtonProps {
  readonly onPress: () => void;
}

export default function LocateButton({ onPress }: LocateButtonProps) {
  const { t } = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('explore.android.map.locate')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID="explore.map.locate"
    >
      <Ionicons name="navigate" size={18} color={colors.accentText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.field,
    // lpInk at 94 %, as the legend's plate.
    backgroundColor: 'rgba(248,246,241,0.94)',
    borderWidth: 1,
    borderColor: colors.line,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.18)' }],
  },
  pressed: { opacity: 0.85 },
});
