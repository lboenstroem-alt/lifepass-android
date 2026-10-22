/**
 * The Today card's rows above the session (iOS `PlanTodayCard`: `noteRow`,
 * `checkInRow`, `inProgressRow`, `inProgressOtherRow`, `movedAwayRow`,
 * `pausedRows`, `blockDoneRows`). Which of them a date has is
 * `todayRowOrder` (./rowOrder.ts).
 */
import { Ionicons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { SessionAction, type DailyNote, type DayView, type SessionView } from '../../../health';
import { shortDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import type { RunnerProgressSummary } from '../../runner';
import { colors, minTouch } from '../../../theme';

import { ActionRow, CapsuleButton, PlainTextButton, TextAction } from './TodayButtons';
import { useTodayCard } from './TodayCardContext';

/** A row's leading glyph, 22 dp, decoration only. */
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.icon} {...hiddenFromAccessibility}>
      {children}
    </View>
  );
}

/** The daily note, with "Why?" opening the reasons behind it. */
export function NoteRow({ note }: { note: DailyNote }) {
  const { t, actions } = useTodayCard();
  return (
    <View style={styles.rowTop} testID="plan.today.note">
      <RowIcon>
        <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.rust} />
      </RowIcon>
      <View style={styles.texts}>
        {note.title ? (
          <LPText size={14} weight="semibold" color={colors.paper}>
            {note.title}
          </LPText>
        ) : null}
        {note.body ? (
          <LPText size={13} color={colors.paper2}>
            {note.body}
          </LPText>
        ) : null}
      </View>
      <PlainTextButton
        title={t('plan.note.why')}
        onPress={() => {
          track('note_why_opened');
          actions.onOpenNoteWhy();
        }}
        testID="plan.today.noteWhy"
      />
    </View>
  );
}

/** "Weekly check-in · Under a minute", opening the check-in sheet. */
export function CheckInRow() {
  const { t, actions } = useTodayCard();
  const title = t('plan.checkin_prompt.title');
  const sub = t('plan.checkin_prompt.sub');
  return (
    <Pressable
      onPress={actions.onPresentCheckIn}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      style={({ pressed }) => [styles.row, styles.tappable, pressed && styles.pressed]}
      testID="plan.today.checkIn"
    >
      <RowIcon>
        <MaterialCommunityIcons name="scale-bathroom" size={15} color={colors.rust} />
      </RowIcon>
      <View style={styles.texts}>
        <LPText size={14} weight="semibold" color={colors.paper}>
          {title}
        </LPText>
        <LPText size={12} color={colors.paper2}>
          {sub}
        </LPText>
      </View>
      <View {...hiddenFromAccessibility}>
        <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
      </View>
    </Pressable>
  );
}

/** "Workout in progress · exercise 2 of 4", with Resume. */
export function InProgressRow({ session, progress }: { session: SessionView; progress: RunnerProgressSummary }) {
  const { t, actions } = useTodayCard();
  return (
    <View style={styles.row} testID="plan.today.inProgress">
      <RowIcon>
        <Ionicons name="play-circle-outline" size={15} color={colors.rust} />
      </RowIcon>
      <LPText size={14} color={colors.paper} style={styles.texts}>
        {t('plan.in_progress', { n: `${progress.exercise}`, total: `${progress.total}` })}
      </LPText>
      <CapsuleButton title={t('plan.resume')} allowOffline onPress={() => actions.onPresentRunner(session)} testID="plan.resumeWorkout" />
    </View>
  );
}

/** "In progress: Full body strength · exercise 2 of 4" for another day's workout, with Resume. */
export function InProgressOtherRow({ progress }: { progress: RunnerProgressSummary }) {
  const { t, language, actions } = useTodayCard();
  const line = t('runner.in_progress_other', {
    title: progress.title ?? t('plan.today.rest_title'),
    n: `${progress.exercise}`,
    total: `${progress.total}`,
  });
  const date = progress.scheduledFor ? shortDay(progress.scheduledFor, language) : null;
  return (
    <View style={styles.row} testID="plan.today.inProgressOther">
      <RowIcon>
        <Ionicons name="play-circle-outline" size={15} color={colors.rust} />
      </RowIcon>
      <View style={styles.texts} accessible accessibilityLabel={date ? `${line}, ${date}` : line}>
        <LPText size={14} color={colors.paper}>
          {line}
        </LPText>
        {date ? (
          <LPText size={12} color={colors.paper2}>
            {date}
          </LPText>
        ) : null}
      </View>
      <CapsuleButton title={t('plan.resume')} allowOffline onPress={actions.onResumeSavedRunner} testID="plan.resumeOtherWorkout" />
    </View>
  );
}

/** "{title} moved to tomorrow." with Undo while the server allows it. */
export function MovedAwayRow({ moved }: { moved: NonNullable<DayView['movedAway']> }) {
  const { t, readOnly, post } = useTodayCard();
  return (
    <View style={styles.rowTop} testID="plan.today.movedAway">
      <RowIcon>
        <Ionicons name="arrow-redo-outline" size={15} color={colors.paper2} />
      </RowIcon>
      <LPText size={14} color={colors.paper} style={styles.texts}>
        {t('plan.moved.line', { title: moved.title ?? '' })}
      </LPText>
      {moved.canUndo === true && !readOnly ? (
        <TextAction
          title={t('plan.undo')}
          busyKey="undo-moved"
          onPress={() => post('undo-moved', { sessionId: moved.sessionId, body: SessionAction.undo, event: 'workout_undo' })}
          testID="plan.today.undoMoved"
        />
      ) : null}
    </View>
  );
}

/** "Your plan is paused since {date}." with Resume plan. */
export function PausedRows() {
  const { t, language, day, readOnly, actions } = useTodayCard();
  const pausedOn = day.program?.pausedOn;
  return (
    <View style={styles.stack} testID="plan.today.paused">
      <LPText size={14} color={colors.paper}>
        {t('plan.paused.line', { date: pausedOn ? shortDay(pausedOn, language) : '' })}
      </LPText>
      {!readOnly ? <CapsuleButton title={t('plan.resume_plan')} onPress={actions.onResumePlan} testID="plan.today.resumePlan" /> : null}
    </View>
  );
}

/** "Week 4 done. Start the next block?" with Start the next block and Not now. */
export function BlockDoneRows({ onDismiss }: { onDismiss: () => void }) {
  const { t, day, actions } = useTodayCard();
  return (
    <View style={styles.blockDone} testID="plan.today.blockDone">
      <LPText size={15} weight="semibold" color={colors.paper}>
        {t('plan.block_done.title', { weeks: `${day.program?.weeks ?? 4}` })}
      </LPText>
      <LPText size={13} color={colors.paper2}>
        {t('plan.block_done.sub')}
      </LPText>
      <ActionRow>
        <CapsuleButton title={t('plan.block_done.next')} onPress={actions.onStartNextBlock} testID="plan.today.nextBlock" />
        <PlainTextButton
          title={t('plan.block_done.not_now')}
          onPress={() => {
            track('plan_block_done_dismissed');
            onDismiss();
          }}
          testID="plan.today.blockNotNow"
        />
      </ActionRow>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tappable: { minHeight: minTouch },
  icon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  stack: { gap: 12 },
  blockDone: { gap: 10 },
  pressed: { opacity: 0.75 },
});
