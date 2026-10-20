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
 *
 * THE PROOF STAYS DRAWN WHILE THE COVER SLIDES OUT. A caller closes it by
 * dropping `proof` and `visible` together; iOS clears its snapshot only in
 * the cover's `onDismiss`, after it has gone, and Android's Modal has no
 * such callback. So the last proof shown is kept and drawn through the
 * close animation, rather than an empty page with only Done sliding away.
 */
import { useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../../components/ui';
import { useA11ySize } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import CheckInProofDisplay, { type CheckInProofDisplayProps } from './CheckInProofDisplay';

export interface CheckInProofCoverProps {
  readonly visible: boolean;
  /** What the proof shows; null closes the cover (the last proof stays drawn while it slides out). */
  readonly proof: CheckInProofDisplayProps | null;
  /** Done, or hardware back. */
  readonly onDone: () => void;
  readonly testID?: string;
}

export default function CheckInProofCover({ visible, proof, onDone, testID }: CheckInProofCoverProps) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const compact = useA11ySize().isAccessibilitySize;
  const lastShown = useRef<CheckInProofDisplayProps | null>(null);
  useEffect(() => {
    if (proof) lastShown.current = proof;
  }, [proof]);
  const drawn = proof ?? lastShown.current;

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
        {drawn ? <CheckInProofDisplay {...drawn} /> : null}
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
