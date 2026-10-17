/**
 * The proof, full screen, with Done (iOS `fullScreenCover` around
 * `CheckInProofDisplay`: the live success screen, and Home's re-offered
 * proof). One layout for both, so staff read one shape at every desk.
 *
 * The way out gives its margin up at the accessibility sizes like every
 * other margin on the proof, so the guest receipt above it stays on the
 * phone rather than under the button. Its label is the member's own control
 * and keeps growing with the text size.
 *
 * Android: edge to edge (it draws under the status and navigation bars and
 * pads for them), and hardware back is Done, the only way out iOS offers.
 */
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../../components/ui';
import { useA11ySize } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import CheckInProofDisplay, { type CheckInProofDisplayProps } from './CheckInProofDisplay';

export interface CheckInProofCoverProps {
  readonly visible: boolean;
  /** What the proof shows; null draws nothing (the cover is closing). */
  readonly proof: CheckInProofDisplayProps | null;
  /** Done, or hardware back. */
  readonly onDone: () => void;
  readonly testID?: string;
}

export default function CheckInProofCover({ visible, proof, onDone, testID }: CheckInProofCoverProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const compact = useA11ySize().isAccessibilitySize;

  return (
    <Modal
      visible={visible && proof !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDone}
    >
      <View style={[styles.cover, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID={testID}>
        {proof ? <CheckInProofDisplay {...proof} /> : null}
        <View style={[styles.done, { paddingTop: compact ? 8 : 12, paddingBottom: compact ? 14 : 32 }]}>
          <PrimaryButton title={t('common.done')} onPress={onDone} shape="flat" testID={testID ? `${testID}.done` : undefined} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cover: { flex: 1, backgroundColor: colors.ink },
  done: { paddingHorizontal: 24 },
});
