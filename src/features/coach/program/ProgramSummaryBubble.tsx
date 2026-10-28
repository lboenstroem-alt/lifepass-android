/* eslint lifepass/no-literal-copy: "error" */
/**
 * What will be built, with every line a button that re-asks its question
 * (iOS `ProgramSummaryBubble`, Views/Coach/ProgramBubbles.swift, 5.4.2).
 *
 *   Here's what I'll build                (serif)
 *   Tap a line to change it.
 *   ┌ Build muscle                      › ┐
 *   │ Full body                         › │
 *   │ 3 days a week: Mon, Wed, Fri      › │
 *   │ Where: Gym, Classes, Pool, ...    › │
 *   │ Length: 4 weeks                   › │
 *   │ Some experience                   › │
 *   │ Without calorie targets           › │
 *   └ Planned around: Knee              › ┘
 *   Building the plan uses one of today's Coach questions. ...
 *   [Build my plan]  Start over
 *
 * Every row is at least 48 dp (iOS 44 pt) and disabled while a build is in
 * flight or once the summary is closed; Build and Start over go when it is.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { CoachMessageRendererProps } from '../flows/types';
import { coachPalette } from '../theme/palette';

import { summaryOf } from './messages';
import { summaryRows } from './summaryRows';
import { editProgramRow, startProgramOver, submitProgram } from './wizard';

function ProgramSummaryBubble({ message, busy }: CoachMessageRendererProps) {
  const { t, language } = useT();
  const summary = summaryOf(message);
  if (!summary) return null;
  const closed = summary.closed;
  const rows = summaryRows(summary.answers, t, language);

  return (
    <View style={styles.root} testID="coach.program.summary">
      <View style={styles.heading}>
        <LPText serif size={20} color={coachPalette.textPrimary} accessibilityRole="header">
          {t('program.summary.title')}
        </LPText>
        <LPText size={12} color={coachPalette.textMeta}>
          {t('program.summary.edit_hint')}
        </LPText>
      </View>

      <View style={styles.rows}>
        {rows.map((row, index) => (
          <Pressable
            key={row.question}
            onPress={() => editProgramRow(row.question)}
            disabled={busy || closed}
            accessibilityRole="button"
            accessibilityLabel={row.value}
            accessibilityState={{ disabled: busy || closed }}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.divider,
              pressed && !busy && !closed && styles.pressed,
            ]}
            testID={`coach.program.summary.${row.question}`}
          >
            <LPText size={14} color={coachPalette.textPrimary} style={styles.rowText}>
              {row.value}
            </LPText>
            <View {...hiddenFromAccessibility}>
              <Ionicons name="chevron-forward" size={14} color={coachPalette.textMeta} />
            </View>
          </Pressable>
        ))}
      </View>

      <LPText size={12} color={coachPalette.textMeta}>
        {t('program.summary.cost_note')}
      </LPText>

      {!closed ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void submitProgram()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('program.summary.build')}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.build, busy && styles.buildBusy, pressed && !busy && styles.pressed]}
            testID="coach.program.build"
          >
            <LPText size={14} weight="semibold" color="#FFFFFF">
              {t('program.summary.build')}
            </LPText>
          </Pressable>
          <Pressable
            onPress={startProgramOver}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('program.summary.start_over')}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.startOver, pressed && !busy && styles.pressed]}
            testID="coach.program.start_over"
          >
            <LPText size={13} weight="semibold" color={coachPalette.textSecondary}>
              {t('program.summary.start_over')}
            </LPText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default memo(ProgramSummaryBubble);

const styles = StyleSheet.create({
  // The bubble sits under the avatar's column (iOS `.padding(.leading, 34)`).
  root: { gap: 12, paddingLeft: 34, alignSelf: 'stretch' },
  heading: { gap: 4 },
  rows: {
    borderRadius: 14,
    backgroundColor: coachPalette.tile,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: coachPalette.stroke },
  rowText: { flex: 1 },
  pressed: { opacity: 0.75 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  build: {
    minHeight: 48,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: coachPalette.accent,
  },
  buildBusy: { opacity: 0.5 },
  startOver: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6 },
});
