/**
 * The history in its own sheet, from Body and goals (iOS
 * `FeedbackHistorySheet`, `SPEC` 9.4): its own small stack, so a report opens
 * inside the sheet, and NO ACTIONS. An action there would have to tear down
 * the sheet to reach a screen the member did not ask for. No settings link
 * either: the switches are right under the sheet.
 *
 * Full screen over Body and goals. The hardware back (and the top bar's back)
 * goes back one report, then closes the sheet.
 *
 * Like iOS's stack, the list stays alive under an open report (its rows, its
 * "Show more" pages and where it was scrolled), hidden from touch and
 * TalkBack, and reads its first page again in place when the report closes.
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
  const [historyReturns, setHistoryReturns] = useState(0);
  const top = path.length > 0 ? path[path.length - 1] : null;

  const close = () => {
    setPath([]);
    onClose();
  };
  const back = () => {
    if (path.length === 0) {
      close();
      return;
    }
    // The last report closes: the list shows again (iOS `.task` runs again).
    if (path.length === 1) setHistoryReturns((n) => n + 1);
    setPath(path.slice(0, -1));
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
          <View
            style={styles.page}
            pointerEvents={top === null ? 'auto' : 'none'}
            importantForAccessibility={top === null ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={top !== null}
          >
            <FeedbackHistoryView
              onBack={close}
              onOpen={(id) => setPath([...path, id])}
              reloadKey={historyReturns}
              testID={`${testID}.history`}
            />
          </View>
          {top !== null ? (
            <View style={styles.over}>
              <FeedbackReportView key={top} reportId={top} onBack={back} testID={`${testID}.report`} />
            </View>
          ) : null}
        </View>
      </BottomTabBarHeightContext.Provider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  over: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink },
});
