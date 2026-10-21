/**
 * The result of "Delete all health data" (iOS `DeletedEverythingSheet`):
 * "Deleted", then what went, line by line ("24 weight entries", "58 meals",
 * "Your calorie goal"), or "There was nothing stored to delete.", and Done.
 *
 * FULL HEIGHT, as iOS's `.large` detent: at a medium height a small phone cut
 * the last lines off a list whose entire job is to say what was deleted.
 *
 * THE LOCAL WIPE WAITS FOR THIS SHEET TO GO (`onClosed`). Body and goals runs
 * it then, because on Plan's stack the wipe takes the page with it; the
 * server has already deleted everything, so nothing is at risk in the gap.
 *
 * iOS adds a line about the iPhone's Health app when Apple Health was
 * connected; Android never shows it (owner decision: nothing here names
 * Apple Health), and the day summaries line is worded without it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { hiddenFromAccessibility, LPText, PrimaryButton, Sheet } from '../../../components/ui';
import { HealthFormat, useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AccountCard, AccountRowDivider } from '../../account';

import { deletionLines, isNothingDeleted, type HealthDeletionCounts } from './deletionCounts';

export type DeletedEverythingSheetProps = {
  readonly visible: boolean;
  /** The counts the withdrawal answered with; kept while the sheet slides away. */
  readonly counts: HealthDeletionCounts | null;
  /** Done, back or a swipe down. */
  readonly onClose: () => void;
  /** The sheet has fully gone: run the local wipe now. */
  readonly onClosed: () => void;
};

export default function DeletedEverythingSheet({ visible, counts, onClose, onClosed }: DeletedEverythingSheetProps) {
  const { t, tp, language } = useT();
  const titleRef = useRef<Text>(null);
  const lines = counts ? deletionLines(counts, tp, t, (value) => HealthFormat.integer(value, language)) : [];
  const nothing = counts ? isNothingDeleted(counts) : true;

  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} fullHeight initialFocusRef={titleRef} testID="bodygoals.deleted">
      <View style={styles.page}>
        <View {...hiddenFromAccessibility}>
          <Ionicons name="checkmark-circle" size={28} color={colors.rust} />
        </View>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {t('bodygoals.deleted.title')}
        </LPText>
        {nothing ? (
          <LPText size={14} color={colors.paper2} testID="bodygoals.deleted.nothing">
            {t('bodygoals.deleted.nothing')}
          </LPText>
        ) : (
          <>
            <LPText size={15} color={colors.paper2}>
              {t('bodygoals.deleted.body')}
            </LPText>
            <AccountCard testID="bodygoals.deleted.list">
              {lines.map((line) => (
                <View key={line}>
                  <AccountRowDivider />
                  <View style={styles.line} accessible accessibilityLabel={line} testID="bodygoals.deleted.line">
                    <View {...hiddenFromAccessibility}>
                      <Ionicons name="remove-circle-outline" size={14} color={colors.paper3} />
                    </View>
                    <LPText size={14} color={colors.paper} style={styles.lineText}>
                      {line}
                    </LPText>
                  </View>
                </View>
              ))}
            </AccountCard>
          </>
        )}
        <PrimaryButton title={t('common.done')} onPress={onClose} style={styles.done} testID="bodygoals.deleted.done" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  lineText: { flex: 1 },
  done: { marginTop: 4 },
});
