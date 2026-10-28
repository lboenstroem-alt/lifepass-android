/**
 * The re-offered proof's mark: the still rust seal iOS
 * `HomeView.checkInProofScreen` hands `CheckInProofDisplay` (the live success
 * screen's pulsing green tick is the walk-in flow's, CHECKIN-2).
 *
 * THE MARK IS DECORATION AND GIVES UP ITS ROOM FIRST. A member who has turned
 * the text up wants the WORDS bigger, not the seal: at the accessibility
 * sizes the lines under it are three to four times body size and need every
 * point on the phone, so the seal is drawn at 26 dp there (56 dp otherwise),
 * beside the eyebrow. Its size is the caller's business, never the font
 * scale's: an icon is a glyph, and Android would scale it with the text
 * unless told not to. Hidden from TalkBack: the eyebrow says what it says.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility } from '../../../components/ui';
import { colors } from '../../../theme';

/** The re-offered proof's seal: 56 dp, or 26 dp at the accessibility sizes. */
export function sealMarkSize(isAccessibilitySize: boolean): number {
  return isAccessibilitySize ? 26 : 56;
}

export function SealMark({ size }: { readonly size: number }) {
  return (
    <View {...hiddenFromAccessibility} style={styles.mark} testID="checkin.proof.sealMark">
      <MaterialCommunityIcons name="check-decagram" size={size} color={colors.rust} allowFontScaling={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
