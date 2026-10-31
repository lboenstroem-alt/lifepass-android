/**
 * "Why today looks like this" (iOS `NoteWhySheet`, Views/Plan/PlanTodayCard.swift,
 * `ios-ux.md` 3.7 and 3.11): the reasons behind the daily note, the recovery
 * estimate, then the accuracy line.
 *
 * The note itself is one or two sentences; this sheet is where the RULES
 * behind it are spelled out, because "your plan went easier today" with no
 * reason reads as the app deciding things about you in private.
 */
import { useRef } from 'react';
import { StyleSheet, View, type Text } from 'react-native';

import { hiddenFromAccessibility, LPText, Sheet } from '../../../components/ui';
import type { DailyNote, HealthScores } from '../../../health';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

import { noteReasonLines } from './copy';

export type NoteWhySheetProps = {
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  note: DailyNote | null;
  scores: HealthScores | null;
};

export default function NoteWhySheet({ visible, onClose, onClosed, note, scores }: NoteWhySheetProps) {
  const { t } = useT();
  const titleRef = useRef<Text>(null);
  const band = scores?.recoveryBand;
  const knownBand = band && ['low', 'ok', 'high'].includes(band) ? band : null;
  const reasons = noteReasonLines(note, t);
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed} initialFocusRef={titleRef} testID="plan.noteWhy">
      <View style={styles.content}>
        <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
          {t('note.why.title')}
        </LPText>

        {note?.body ? (
          <LPText size={15} color={colors.paper}>
            {note.body}
          </LPText>
        ) : null}

        {reasons.length > 0 ? (
          <View style={styles.reasons}>
            {reasons.map((line) => (
              <View key={line} style={styles.reason}>
                <View style={styles.bullet} {...hiddenFromAccessibility} />
                <LPText size={14} color={colors.paper2} style={styles.flex}>
                  {line}
                </LPText>
              </View>
            ))}
          </View>
        ) : null}

        {knownBand ? (
          <View style={styles.recovery}>
            <LPText size={14} weight="semibold" color={colors.paper}>
              {t('ah.recovery.row', { band: t(`ah.band.${knownBand}`) })}
            </LPText>
            <LPText size={12} color={colors.paper2}>
              {t('ah.recovery.estimate_line')}
            </LPText>
          </View>
        ) : null}

        <LPText size={12} color={colors.paper3}>
          {t('ah.accuracy')}
        </LPText>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 8, paddingBottom: 16 },
  reasons: { gap: 10 },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.rust, marginTop: 7 },
  recovery: { gap: 6 },
  flex: { flex: 1 },
});
