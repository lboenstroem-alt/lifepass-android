/**
 * Today's block and its state table (iOS `PlanTodayCard`, `ios-ux.md` 3.7).
 *
 * The block always follows the SELECTED date (R14): tapping Thursday on the
 * week strip changes THIS card and nothing else on the page, so there is
 * never a screen showing Thursday's workout under a "Today" heading.
 *
 *   header (outside the card): the kicker, the title, "45 min · Moderate",
 *     the recovery chip (today only, opening the note's Why)
 *   the card: the rows `todayRowOrder` chose, a hairline between each
 *
 * READ ONLY IS WIDER THAN past_due: every member who is not entitled reads
 * the card and writes nothing (`isReadOnly`). OFFLINE dims every action but
 * the runner's and says "This needs a connection.". ONE ACTION AT A TIME:
 * a busy key locks every write while one is in flight (./sessionActions.ts).
 *
 * THE CARD OWNS ITS SHEETS, one at a time: No energy and Log a workout
 * (PLAN-3's slots), the session preview, the note's Why and the pool picker.
 * Everything that leaves the card (the runner, class discovery, a venue, a
 * sight, the Coach, Profile's bookings) goes through `handlers`, which the
 * Today section wires to the Plan shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Kicker, LPText } from '../../../components/ui';
import { useHealthStore, type HealthDay, type SessionActionResponse, type SessionView } from '../../../health';
import { useA11ySize } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import {
  hasPendingWorkoutNow,
  selectHasPendingWorkout,
  useRunnerProgress,
  useWorkoutOutbox,
} from '../../runner';
import { colors, hairline } from '../../../theme';
import LogWorkoutSheet from '../sheets/LogWorkoutSheet';
import NoEnergySheet from '../sheets/NoEnergySheet';
import SessionPreviewSheet from '../preview/SessionPreviewSheet';
import PlanVenuePickerSheet from '../venuePicker/PlanVenuePickerSheet';

import { metaLine, noteHasContent, recoveryBandWord, todayKicker, todayTitle } from './copy';
import NoteWhySheet from './NoteWhySheet';
import { todayRowOrder, todayRunnerProgress, type TodayRow } from './rowOrder';
import { canStartRunnerToday, restPullCandidate } from './rules';
import { loadSessionForPreview, sendCardAction, useBusyAction } from './sessionActions';
import { SessionRows } from './SessionRows';
import { TodayCardProvider, type TodayCardActions, type TodayCardContextValue } from './TodayCardContext';
import { BlockDoneRows, CheckInRow, InProgressOtherRow, InProgressRow, MovedAwayRow, NoteRow, PausedRows } from './TodayRows';

/** Where the card's taps leave it (iOS `PlanTodayCard`'s closures). */
export interface TodayCardHandlers {
  /** An action answered: the host patches day, week and upcoming. */
  readonly onActionResult: (response: SessionActionResponse) => void;
  /** A refusal that means "read again". */
  readonly onReload: () => void;
  readonly onPresentRunner: (session: SessionView) => void;
  readonly onResumeSavedRunner: () => void;
  readonly onPresentCheckIn: () => void;
  readonly onOpenClasses: (session: SessionView) => void;
  readonly onOpenBookings: () => void;
  readonly onOpenSight: (slug: string) => void;
  readonly onOpenVenue: (slug: string) => void;
  readonly onStartNextBlock: () => void;
  readonly onResumePlan: () => void;
}

export type TodayCardProps = {
  /** The read for the SELECTED date (today unless the week strip moved it). */
  day: HealthDay;
  isReadOnly: boolean;
  isOffline: boolean;
  /** The programme ran to its end and no proposal is waiting. */
  isBlockFinished: boolean;
  handlers: TodayCardHandlers;
};

/**
 * One sheet at a time, chosen by a value rather than by five booleans.
 *
 * EVERY OPENING IS A NEW SHEET. `opening` counts presentations and keys the
 * sheet, so each one mounts fresh (iOS `.sheet(item:)` builds a new view,
 * with new @State, every time): a No energy sheet cancelled in skip mode on
 * Tuesday never reopens in skip mode with Tuesday's form, busy flag or
 * Idempotency-Key on today's card. It also scopes each sheet's close to
 * itself: an answer that lands after the member opened another sheet applies,
 * and leaves the newer sheet up.
 */
type TodaySheet = SheetRequest & { readonly opening: number };

/** A sheet as the taps ask for it; `openSheet` numbers the opening. */
type SheetRequest =
  | { readonly kind: 'noEnergy'; readonly session: SessionView; readonly skipMode: boolean }
  | { readonly kind: 'preview'; readonly session: SessionView; readonly entry: string }
  | { readonly kind: 'noteWhy' }
  | { readonly kind: 'logWorkout'; readonly session: SessionView }
  | { readonly kind: 'pool' };

type SheetKind = TodaySheet['kind'];
type SheetOf<K extends SheetKind> = Extract<TodaySheet, { kind: K }>;

/**
 * How long a sheet takes to leave before the next one comes up (iOS hands
 * the Log a workout sheet's pull to the preview after 0.45 s).
 */
export const SHEET_HANDOVER_MS = 450;

export default function TodayCard({ day, isReadOnly, isOffline, isBlockFinished, handlers }: TodayCardProps) {
  const { t, language } = useT();
  const { isAccessibilitySize } = useA11ySize();
  const { busy, run } = useBusyAction();
  const [blockDoneDismissed, setBlockDoneDismissed] = useState(false);

  const session = day.day?.session ?? null;
  const isToday = day.day?.relative === 'today' || day.date === day.today;
  const isFuture = day.day?.relative === 'future';
  const isPaused = day.program?.status === 'paused';
  const readOnly = isReadOnly;

  const outboxPending = useWorkoutOutbox(selectHasPendingWorkout(session?.id));
  const progressSummary = useRunnerProgress((s) => s.summary);
  const progress = todayRunnerProgress(progressSummary, { readOnly, session });

  // ---- Sheets -------------------------------------------------------------

  const [sheet, setSheet] = useState<TodaySheet | null>(null);
  // Each sheet's last content stays while it slides away.
  const shown = useRef<{ [K in SheetKind]?: SheetOf<K> }>({});
  if (sheet) (shown.current as Record<string, TodaySheet>)[sheet.kind] = sheet;
  const openings = useRef(0);
  const handover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterPoolClose = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (handover.current) clearTimeout(handover.current);
    },
    [],
  );

  // The sheet on screen, readable at once (a tap in the same frame as a close).
  const sheetRef = useRef<TodaySheet | null>(null);
  const show = useCallback((next: TodaySheet | null) => {
    sheetRef.current = next;
    setSheet(next);
  }, []);
  const openSheet = useCallback(
    (request: SheetRequest) => {
      openings.current += 1;
      const next: TodaySheet = { ...request, opening: openings.current };
      if (handover.current) clearTimeout(handover.current);
      if (sheetRef.current === null) {
        show(next);
        return;
      }
      // A sheet is up: it goes first, and the next comes up once it has.
      show(null);
      handover.current = setTimeout(() => {
        handover.current = null;
        show(next);
      }, SHEET_HANDOVER_MS);
    },
    [show],
  );
  /** Closes that opening's sheet if it is still the one up (a late close never takes a newer sheet down). */
  const closeSheet = useCallback(
    (opening: number) => {
      if (sheetRef.current?.opening === opening) show(null);
    },
    [show],
  );

  // ---- Actions ------------------------------------------------------------

  // The card's own writes answer through the same handlers as its sheets'.
  const post = useCallback<TodayCardContextValue['post']>(
    (busyKey, request) =>
      run(busyKey, () => sendCardAction(request, { onApplied: handlers.onActionResult, onReload: handlers.onReload })),
    [run, handlers],
  );

  const loadAndPreview = useCallback(
    (sessionId: string, entry: string) =>
      run(`pull-${sessionId}`, async () => {
        const loaded = await loadSessionForPreview(sessionId, language);
        if (loaded) openSheet({ kind: 'preview', session: loaded, entry });
      }),
    [run, language, openSheet],
  );

  const actions = useMemo<TodayCardActions>(
    () => ({
      onPresentRunner: handlers.onPresentRunner,
      onResumeSavedRunner: handlers.onResumeSavedRunner,
      onPresentCheckIn: handlers.onPresentCheckIn,
      onOpenClasses: handlers.onOpenClasses,
      onOpenBookings: handlers.onOpenBookings,
      onOpenSight: handlers.onOpenSight,
      onOpenVenue: handlers.onOpenVenue,
      onStartNextBlock: handlers.onStartNextBlock,
      onResumePlan: handlers.onResumePlan,
      onOpenPoolPicker: () => openSheet({ kind: 'pool' }),
      onOpenNoteWhy: () => openSheet({ kind: 'noteWhy' }),
      onOpenNoEnergy: (target, skipMode) => openSheet({ kind: 'noEnergy', session: target, skipMode }),
      onOpenPreview: (target, entry) => openSheet({ kind: 'preview', session: target, entry }),
      onLoadAndPreview: loadAndPreview,
      onOpenLogWorkout: (target) => openSheet({ kind: 'logWorkout', session: target }),
    }),
    [handlers, openSheet, loadAndPreview],
  );

  const context = useMemo<TodayCardContextValue>(
    () => ({
      day,
      t,
      language,
      isToday,
      isFuture,
      isPaused,
      readOnly,
      isOffline,
      busy,
      runBusy: run,
      post,
      actionsStack: isAccessibilitySize,
      outboxPending,
      actions,
    }),
    [day, t, language, isToday, isFuture, isPaused, readOnly, isOffline, busy, run, post, isAccessibilitySize, outboxPending, actions],
  );

  // ---- Rows ---------------------------------------------------------------

  const order = todayRowOrder({
    isToday,
    readOnly,
    isPaused,
    isBlockFinished,
    blockDoneDismissed,
    hasNote: noteHasContent(day.note),
    checkInDue: day.checkIn?.due === true,
    hasRunnerProgress: progress.mine !== null,
    hasOtherRunnerProgress: progress.other !== null,
    hasMovedAway: day.day?.movedAway != null,
    hasSession: session !== null,
  });

  const renderRow = (row: TodayRow) => {
    switch (row) {
      case 'note':
        return day.note ? <NoteRow note={day.note} /> : null;
      case 'checkIn':
        return <CheckInRow />;
      case 'inProgress':
        return session && progress.mine ? <InProgressRow session={session} progress={progress.mine} /> : null;
      case 'inProgressOther':
        return progress.other ? <InProgressOtherRow progress={progress.other} /> : null;
      case 'movedAway':
        return day.day?.movedAway ? <MovedAwayRow moved={day.day.movedAway} /> : null;
      case 'paused':
        return <PausedRows />;
      case 'blockDone':
        return <BlockDoneRows onDismiss={() => setBlockDoneDismissed(true)} />;
      case 'session':
        return session ? <SessionRows session={session} hasRunnerProgress={progress.mine !== null} /> : null;
    }
  };

  const meta = metaLine(session, t);
  const band = recoveryBandWord(day, isToday, t);
  const today = todayServerDay();

  const { noEnergy, preview, noteWhy, logWorkout, pool } = shown.current;

  return (
    <TodayCardProvider value={context}>
      <View style={styles.wrap} testID="plan.today">
        <View style={styles.header}>
          <Kicker text={todayKicker(day, isToday, t, language)} testID="plan.today.kicker" />
          <LPText serif size={24} color={colors.paper} accessibilityRole="header" testID="plan.today.title">
            {todayTitle(session, t)}
          </LPText>
          {meta || band ? (
            <View style={styles.metaRow}>
              {meta ? (
                <LPText size={13} color={colors.paper2}>
                  {meta}
                </LPText>
              ) : null}
              {band ? (
                <Pressable
                  onPress={() => openSheet({ kind: 'noteWhy' })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.recovery, pressed && styles.pressed]}
                  testID="plan.today.recovery"
                >
                  <LPText size={11} weight="semibold" color={colors.signal}>
                    {t('plan.recovery.chip', { band })}
                  </LPText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {order.length > 0 ? (
          <Card style={styles.card}>
            {order.map((row, index) => (
              <View key={row}>
                {index > 0 ? <View style={styles.rule} /> : null}
                <View style={styles.row}>{renderRow(row)}</View>
              </View>
            ))}
          </Card>
        ) : null}
      </View>

      {/* PLAN-3's two sheets are controlled: the card closes them once they
          have answered, as iOS's dismiss() after onResult and after
          onChangedElsewhere (a close the sheet also makes is harmless). */}
      {noEnergy ? (
        <NoEnergySheet
          key={`noEnergy-${noEnergy.opening}`}
          visible={sheet?.opening === noEnergy.opening}
          onClose={() => closeSheet(noEnergy.opening)}
          session={noEnergy.session}
          tomorrowTitle={day.day?.tomorrow?.title ?? null}
          startsInSkipMode={noEnergy.skipMode}
          onResult={(result) => {
            handlers.onActionResult(result as SessionActionResponse);
            closeSheet(noEnergy.opening);
          }}
          onChangedElsewhere={() => {
            useHealthStore.getState().setToast('health.err.changed');
            handlers.onReload();
            closeSheet(noEnergy.opening);
          }}
        />
      ) : null}

      {preview ? (
        <SessionPreviewSheet
          key={`preview-${preview.opening}`}
          visible={sheet?.opening === preview.opening}
          onClose={() => closeSheet(preview.opening)}
          session={preview.session}
          entry={preview.entry}
          canStart={canStartRunnerToday(preview.session, {
            readOnly,
            programPaused: isPaused,
            outboxPending: hasPendingWorkoutNow(preview.session.id),
            today,
          })}
          onStart={() => handlers.onPresentRunner(preview.session)}
          onPulled={handlers.onActionResult}
        />
      ) : null}

      {noteWhy ? (
        <NoteWhySheet
          key={`noteWhy-${noteWhy.opening}`}
          visible={sheet?.opening === noteWhy.opening}
          onClose={() => closeSheet(noteWhy.opening)}
          note={day.note}
          scores={day.scores}
        />
      ) : null}

      {logWorkout ? (
        <LogWorkoutSheet
          key={`logWorkout-${logWorkout.opening}`}
          visible={sheet?.opening === logWorkout.opening}
          onClose={() => closeSheet(logWorkout.opening)}
          session={logWorkout.session}
          cardDate={day.date}
          pullCandidate={isToday ? restPullCandidate(day) : null}
          onPull={() => {
            // The sheet's "Was it Saturday's session? Do it today instead":
            // the rest row's own pull, once the sheet has gone.
            const candidate = restPullCandidate(day);
            closeSheet(logWorkout.opening);
            if (!candidate) return;
            if (handover.current) clearTimeout(handover.current);
            handover.current = setTimeout(() => {
              handover.current = null;
              loadAndPreview(candidate.id, 'log_sheet');
            }, SHEET_HANDOVER_MS);
          }}
          onResult={(result) => {
            handlers.onActionResult(result as SessionActionResponse);
            closeSheet(logWorkout.opening);
          }}
          onChangedElsewhere={() => {
            handlers.onReload();
            closeSheet(logWorkout.opening);
          }}
        />
      ) : null}

      {pool ? (
        <PlanVenuePickerSheet
          key={`pool-${pool.opening}`}
          visible={sheet?.opening === pool.opening}
          onClose={() => closeSheet(pool.opening)}
          onOpenVenue={(slug) => {
            afterPoolClose.current = () => handlers.onOpenVenue(slug);
            closeSheet(pool.opening);
          }}
          onClosed={() => {
            const next = afterPoolClose.current;
            afterPoolClose.current = null;
            next?.();
          }}
        />
      ) : null}
    </TodayCardProvider>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  header: { gap: 8, paddingHorizontal: 24 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  recovery: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.rust3 },
  card: { marginHorizontal: 20 },
  rule: { height: hairline, backgroundColor: colors.line },
  row: { paddingHorizontal: 14, paddingVertical: 13 },
  pressed: { opacity: 0.75 },
});
