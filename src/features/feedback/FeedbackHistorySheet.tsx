/**
 * The history in its own sheet, from Body and goals (iOS
 * `FeedbackHistorySheet`, `SPEC` 9.4): its own small stack, so a report opens
 * inside the sheet, and NO ACTIONS. An action there would have to tear down
 * the sheet to reach a screen the member did not ask for. No settings link
 * either: the switches are right under the sheet.
 *
 * Full screen over Body and goals. The hardware back (and the top bar's back)
 * goes back one report, then closes the sheet.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../theme';

import FeedbackHistoryView from './FeedbackHistoryView';
import FeedbackReportView from './FeedbackReportView';

export type FeedbackHistorySheetProps = {
  visible: boolean;
  onClose: () => void;
  testID?: string;
};

export default function FeedbackHistorySheet({ visible, onClose, testID = 'feedback.historySheet' }: FeedbackHistorySheetProps) {
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState<readonly string[]>([]);
  const top = path.length > 0 ? path[path.length - 1] : null;

  const close = () => {
    setPath([]);
    onClose();
  };
  const back = () => {
    if (path.length > 0) setPath(path.slice(0, -1));
    else close();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={back}
      statusBarTranslucent
      navigationBarTranslucent
      testID={testID}
    >
      {/* The tab bar is under the sheet: only the system bar takes room at the bottom. */}
      <BottomTabBarHeightContext.Provider value={insets.bottom}>
        <View style={styles.page}>
          {top === null ? (
            <FeedbackHistoryView onBack={close} onOpen={(id) => setPath([...path, id])} testID={`${testID}.history`} />
          ) : (
            <FeedbackReportView key={top} reportId={top} onBack={back} testID={`${testID}.report`} />
          )}
        </View>
      </BottomTabBarHeightContext.Provider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
});
