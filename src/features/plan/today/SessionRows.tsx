/**
 * The session row of the Today card, by status (iOS `PlanTodayCard`:
 * `sessionRows`, `plannedRows`, `exerciseLines`, `hikeRows`, `soakRow`,
 * `plannedActions`, `restRows`, `extrasRows`, `doneRows`, `skippedRows`,
 * `missedRows`, `futureRows`).
 *
 * Which body a session gets is `sessionBody`; which actions a planned or
 * missed row offers is `plannedActions` / `missedActions` (./rowOrder.ts).
 * Every write is the server's precondition table read back: a `can*` flag
 * the server did not set hides the action rather than letting it be refused.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import {
  exerciseLine,
  FEELINGS,
  SessionAction,
  type DayView,
  type ExtraWorkoutView,
  type SessionView,
  type SoakPick,
} from '../../../health';
import { localTime, shortDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { colors, minTouch } from '../../../theme';

import {
  doneSourceLine,
  extraLine,
  extraRemoveLabel,
  hikeLine,
  moreExercisesLine,
  skipReasonWord,
} from './copy';
import { futureLines, missedActions, plannedActions, plannedLines, sessionBody, type PlannedLines } from './rowOrder';
import { offersLogWorkout, restPullCandidate } from './rules';
import { ActionRow, CapsuleButton, PlainTextButton, TextAction, TodayChip } from './TodayButtons';
import { useTodayCard } from './TodayCardContext';

/** The session row: one body per status. */
export function SessionRows({ session, hasRunnerProgress }: { session: SessionView; hasRunnerProgress: boolean }) {
  const { isFuture, outboxPending } = useTodayCard();
  const body = sessionBody(session, { isFuture, outboxPending });
  return (
    <View style={styles.stack} testID={`plan.today.session.${body}`}>
      {(() => {
        switch (body) {
          case 'waiting':
            // Saved on this phone, not yet on the server (3.7 "Waiting to
            // sync"): done as far as the member is concerned, with no action
            // that would race the queued Save.
            return <DoneChips waiting />;
          case 'done':
            return <DoneRows session={session} />;
          case 'skipped':
            return <SkippedRows session={session} />;
          case 'missed':
            return <MissedRows session={session} />;
          case 'rest':
            return <RestRows session={session} />;
          case 'future':
            return <FutureRows session={session} />;
          case 'planned':
            return <PlannedRows session={session} hasRunnerProgress={hasRunnerProgress} />;
        }
      })()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Planned

function PlannedRows({ session, hasRunnerProgress }: { session: SessionView; hasRunnerProgress: boolean }) {
  const { t, language, readOnly } = useTodayCard();
  return (
    <>
      {session.movedFrom && session.undoAction === 'pull' ? (
        <LPText size={13} color={colors.paper2}>
          {t('plan.pulled.line', { day: shortDay(session.movedFrom, language) })}
        </LPText>
      ) : null}
      <SessionLines session={session} lines={plannedLines(session.kind)} showsBooking />
      {session.lighter === true ? <TodayChip text={t('plan.lighter_chip')} tone="soft" testID="plan.today.lighter" /> : null}
      {!readOnly ? <PlannedActions session={session} hasRunnerProgress={hasRunnerProgress} /> : null}
    </>
  );
}

/**
 * The lines a session shows for its kind (planned and future rows alike).
 * Only the planned row names a class's booking (`showsBooking`): a future
 * day always reads "A yoga class, 60 min", as iOS `futureRows` does.
 */
function SessionLines({ session, lines, showsBooking = false }: { session: SessionView; lines: PlannedLines; showsBooking?: boolean }) {
  const { t, day } = useTodayCard();
  switch (lines) {
    case 'exercises':
      return <ExerciseLines session={session} />;
    case 'class': {
      const booking = showsBooking ? day.day?.booking : null;
      const text = booking
        ? t('plan.class.booked', {
            activity: booking.activityTitle ?? session.title ?? '',
            venue: booking.venueName ?? '',
            time: booking.startsAt ? localTime(booking.startsAt) : '',
          })
        : t('plan.class.line', { class: session.classLabel ?? session.title ?? '', minutes: `${session.minutes ?? 0}` });
      return (
        <LPText size={14} color={colors.paper}>
          {text}
        </LPText>
      );
    }
    case 'swim':
      return (
        <>
          <LPText size={14} color={colors.paper}>
            {t('plan.swim.line', { minutes: `${session.minutes ?? 0}` })}
          </LPText>
          {/* A pool day's blocks are dosed in metres: the member reads them
              here ("4 × 50 m"), not only "swim 30 min". */}
          {(session.blocks ?? []).length > 0 ? <ExerciseLines session={session} /> : null}
        </>
      );
    case 'hike':
      return <HikeRows session={session} />;
    case 'rest':
      return <RestRows session={session} />;
  }
}

/** The first three blocks in the runner's dose words, then "and N more". */
function ExerciseLines({ session }: { session: SessionView }) {
  const { t, language } = useTodayCard();
  const blocks = session.blocks ?? [];
  return (
    <View style={styles.exercises}>
      {blocks.slice(0, 3).map((block, index) => (
        <View key={`${block.exerciseId ?? 'block'}-${index}`} style={styles.exercise}>
          <LPText size={14} color={colors.paper}>
            {block.name ?? ''}
          </LPText>
          <LPText size={12} color={colors.paper2}>
            {exerciseLine(block, t)}
          </LPText>
        </View>
      ))}
      {blocks.length > 3 ? (
        <LPText size={12} color={colors.paper3}>
          {moreExercisesLine(blocks.length - 3, t, language)}
        </LPText>
      ) : null}
    </View>
  );
}

function HikeRows({ session }: { session: SessionView }) {
  const { t, language, day, actions } = useTodayCard();
  const sight = day.day?.attraction;
  let lead = null;
  if (session.weatherSwap === true) {
    const pool = session.poolAlternative;
    lead = (
      <>
        <LPText size={13} color={colors.paper2}>
          {t('plan.hike.weather_swap')}
        </LPText>
        {pool ? (
          <LPText size={14} color={colors.paper}>
            {pool.title ?? t('plan.swim.line', { minutes: `${pool.minutes ?? 0}` })}
          </LPText>
        ) : null}
      </>
    );
  } else if (sight) {
    const line = hikeLine(sight, t, language);
    lead = (
      <Pressable
        onPress={() => {
          track('plan_sight_opened');
          actions.onOpenSight(sight.slug);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${sight.name ?? ''}, ${line}`}
        style={({ pressed }) => [styles.tapRow, pressed && styles.pressed]}
        testID="plan.today.sight"
      >
        <TrailheadMarker />
        <View style={styles.flex}>
          <LPText size={15} weight="semibold" color={colors.paper}>
            {sight.name ?? ''}
          </LPText>
          <LPText size={12} color={colors.paper2}>
            {line}
          </LPText>
        </View>
      </Pressable>
    );
  }
  return (
    <>
      {lead}
      <SoakRow session={session} />
    </>
  );
}

/**
 * The trailhead mark of the sights map (iOS `AttractionMapMarker` with
 * `isTrailhead`): a hollow sight-blue ring with a dark centre, so it can
 * never be mistaken for a filled venue marker. Decoration only.
 */
function TrailheadMarker() {
  return (
    <View style={styles.markerBox} {...hiddenFromAccessibility}>
      <View style={styles.markerRing}>
        <View style={styles.markerDot} />
      </View>
    </View>
  );
}

/** "Then: {venue}, {minutes} min drive", its price label and the gentle caution. */
function SoakRow({ session }: { session: SessionView }) {
  const { t, day, actions } = useTodayCard();
  const soak = day.day?.soak;
  const slug = soak?.venueSlug;
  if (!soak || !slug) return null;
  return (
    <View style={styles.soak}>
      <Pressable
        onPress={() => {
          track('plan_soak_opened');
          actions.onOpenVenue(slug);
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.tapRowTight, pressed && styles.pressed]}
        testID="plan.today.soakAfter"
      >
        <View {...hiddenFromAccessibility}>
          <Ionicons name="water" size={13} color={colors.aurora} />
        </View>
        <LPText size={14} color={colors.paper} style={styles.flex}>
          {t('plan.hike.soak_after', { venue: soak.venueName ?? '', minutes: `${soak.driveMinutes ?? 0}` })}
        </LPText>
      </Pressable>
      {soak.priceLabel ? (
        <LPText size={12} color={colors.paper2}>
          {soak.priceLabel}
        </LPText>
      ) : null}
      {session.soakCaution === true ? (
        <LPText size={12} color={colors.paper2}>
          {t('plan.soak.gentle_caution')}
        </LPText>
      ) : null}
    </View>
  );
}

function PlannedActions({ session, hasRunnerProgress }: { session: SessionView; hasRunnerProgress: boolean }) {
  const { t, day, isToday, isOffline, actions } = useTodayCard();
  const list = plannedActions(session, {
    hasBooking: day.day?.booking != null,
    hasRunnerProgress,
    isToday,
    isOffline,
  });
  return (
    <>
      <ActionRow testID="plan.today.actions">
        {list.map((action) => {
          switch (action) {
            case 'start':
              return (
                <CapsuleButton
                  key={action}
                  title={t('plan.start')}
                  allowOffline
                  onPress={() => actions.onPresentRunner(session)}
                  testID="plan.today.start"
                />
              );
            case 'viewBooking':
              return <CapsuleButton key={action} title={t('plan.class.view_booking')} onPress={actions.onOpenBookings} testID="plan.today.viewBooking" />;
            case 'bookClass':
              return (
                <CapsuleButton
                  key={action}
                  title={t('plan.class.book')}
                  onPress={() => {
                    track('plan_class_book_opened');
                    actions.onOpenClasses(session);
                  }}
                  testID="plan.today.bookClass"
                />
              );
            case 'findPool':
              return (
                <CapsuleButton
                  key={action}
                  title={t('plan.swim.find_pool')}
                  onPress={() => {
                    track('plan_pool_picker_opened');
                    actions.onOpenPoolPicker();
                  }}
                  testID="plan.today.findPool"
                />
              );
            case 'markDone':
              return <MarkDoneButton key={action} session={session} busyKey="done" title={t('plan.mark_done')} testID="plan.today.markDone" />;
            case 'noEnergy':
              return (
                <PlainTextButton
                  key={action}
                  title={t('plan.no_energy')}
                  onPress={() => {
                    track('workout_no_energy_opened', { entry: 'today' });
                    actions.onOpenNoEnergy(session, false);
                  }}
                  testID="plan.today.noEnergy"
                />
              );
          }
          return null;
        })}
      </ActionRow>
      {isOffline ? <OfflineHint /> : null}
    </>
  );
}

/** "This needs a connection." under actions the network would refuse. */
function OfflineHint() {
  const { t } = useTodayCard();
  return (
    <LPText size={12} color={colors.paper3} testID="plan.today.offlineHint">
      {t('health.offline.action_hint')}
    </LPText>
  );
}

/** Mark as done (or Log as done on a missed row): the member says it happened. */
function MarkDoneButton({ session, busyKey, title, testID }: { session: SessionView; busyKey: string; title: string; testID: string }) {
  const { post } = useTodayCard();
  return (
    <TextAction
      title={title}
      busyKey={busyKey}
      onPress={() =>
        post(busyKey, {
          sessionId: session.id,
          body: SessionAction.done({ minutes: session.minutes }),
          event: 'workout_marked_done',
          params: { kind: session.kind ?? 'strength' },
        })
      }
      testID={testID}
    />
  );
}

// ---------------------------------------------------------------------------
// Rest

function RestRows({ session }: { session: SessionView | null }) {
  const { t, language, day, isToday, isFuture, readOnly, outboxPending, actions } = useTodayCard();
  const soak: SoakPick | null = day.day?.restPick?.soak ?? day.day?.soak ?? null;
  const soakSlug = soak?.venueSlug;
  const walk = day.day?.restPick?.walk ?? null;
  const pull = isToday && !readOnly ? restPullCandidate(day) : null;
  return (
    <>
      <LPText size={14} color={colors.paper}>
        {t('plan.rest.line')}
      </LPText>

      {session ? <ExtrasRows session={session} /> : null}

      {/* Trained anyway? The rest day takes a workout as an extra, and stays
          a rest day: nothing else in the plan moves. */}
      {session && offersLogWorkout(session, { readOnly, isFuture, outboxPending }) ? (
        <CapsuleButton title={t('logworkout.cta.rest')} onPress={() => actions.onOpenLogWorkout(session)} testID="plan.logWorkout" />
      ) : null}

      {soak && soakSlug ? (
        <Pressable
          onPress={() => {
            track('plan_soak_opened');
            actions.onOpenVenue(soakSlug);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.restSoak, pressed && styles.pressed]}
          testID="plan.today.restSoak"
        >
          <View style={styles.tapRowTight}>
            <View {...hiddenFromAccessibility}>
              <Ionicons name="water" size={13} color={colors.aurora} />
            </View>
            <LPText size={15} weight="semibold" color={colors.paper} style={styles.flex}>
              {soak.venueName ?? ''}
            </LPText>
          </View>
          {soak.priceLabel ? (
            <LPText size={12} color={colors.paper2}>
              {soak.priceLabel}
            </LPText>
          ) : null}
          {session?.soakCaution === true ? (
            <LPText size={12} color={colors.paper2}>
              {t('plan.soak.gentle_caution')}
            </LPText>
          ) : null}
        </Pressable>
      ) : null}

      {walk ? (
        <Pressable
          onPress={() => {
            track('plan_sight_opened');
            actions.onOpenSight(walk.slug);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.walk, pressed && styles.pressed]}
          testID="plan.today.restWalk"
        >
          <LPText size={14} color={colors.paper}>
            {t('plan.rest.walk_pick', { sight: walk.name ?? '' })}
          </LPText>
        </Pressable>
      ) : null}

      {pull ? (
        <TextAction
          title={t('plan.do_today_named', { day: shortDay(pull.scheduledFor ?? '', language) })}
          busyKey={`pull-${pull.id}`}
          onPress={() => actions.onLoadAndPreview(pull.id, 'rest_row')}
          testID="plan.today.pullForward"
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Extras

/** The extras on this day's row, in every state: the line, the note, Remove. */
function ExtrasRows({ session }: { session: SessionView }) {
  const extras = session.extras ?? [];
  if (extras.length === 0) return null;
  return (
    <View style={styles.extras} testID="plan.today.extras">
      {extras.map((extra, offset) => (
        <ExtraRow key={extra.id ?? `${offset}`} session={session} extra={extra} offset={offset} />
      ))}
    </View>
  );
}

function ExtraRow({ session, extra, offset }: { session: SessionView; extra: ExtraWorkoutView; offset: number }) {
  const { t, language, readOnly, post } = useTodayCard();
  const busyKey = `rmx-${extra.id ?? `${offset}`}`;
  const line = extraLine(extra, t, language);
  const extraId = extra.id;
  return (
    <View style={styles.extra}>
      <View style={styles.extraTexts} accessible accessibilityLabel={extra.note ? `${line}. ${extra.note}` : line}>
        <LPText size={13} color={colors.paper}>
          {line}
        </LPText>
        {extra.note ? (
          // Plain text: the member's own words, never markup.
          <LPText size={12} color={colors.paper2}>
            {extra.note}
          </LPText>
        ) : null}
      </View>
      {extraId && extra.canRemove === true && !readOnly ? (
        <TextAction
          title={t('logworkout.remove')}
          busyKey={busyKey}
          accessibilityLabel={extraRemoveLabel(extra, t, language)}
          onPress={() =>
            post(busyKey, {
              sessionId: session.id,
              body: SessionAction.removeExtra(extraId),
              event: 'plan_extra_removed',
              toastKey: 'logworkout.removed',
            })
          }
          testID="plan.removeExtra"
        />
      ) : null}
    </View>
  );
}

/**
 * "Log an extra workout" on a done or skipped row, wherever the server's
 * `canLogExtra` says so (never a missed row since API 0.34.0, which is
 * marked done instead; offered there too in case that changes).
 */
function LogExtraButton({ session }: { session: SessionView }) {
  const { t, readOnly, isFuture, outboxPending, actions } = useTodayCard();
  if (!offersLogWorkout(session, { readOnly, isFuture, outboxPending })) return null;
  return (
    <TextAction
      title={t('logworkout.cta.extra')}
      busyKey="log-extra"
      onPress={() => actions.onOpenLogWorkout(session)}
      testID="plan.logExtraWorkout"
    />
  );
}

// ---------------------------------------------------------------------------
// Done, skipped, missed, future

function DoneChips({ waiting }: { waiting: boolean }) {
  const { t } = useTodayCard();
  return (
    <View style={styles.chips}>
      <TodayChip text={t('plan.done.title_chip')} tone="done" testID="plan.today.doneChip" />
      {waiting ? <TodayChip text={t('plan.waiting_sync')} tone="soft" testID="plan.today.waitingChip" /> : null}
    </View>
  );
}

function UndoButton({ session }: { session: SessionView }) {
  const { t, readOnly, post } = useTodayCard();
  if (session.canUndo !== true || readOnly) return null;
  return (
    <TextAction
      title={t('plan.undo')}
      busyKey="undo"
      onPress={() => post('undo', { sessionId: session.id, body: SessionAction.undo, event: 'workout_undo' })}
      testID="plan.today.undo"
    />
  );
}

function DoneRows({ session }: { session: SessionView }) {
  const { t, day, readOnly, outboxPending } = useTodayCard();
  const askFeeling = session.feeling === null || session.feeling === 'unknown';
  const tomorrow: DayView['tomorrow'] = day.day?.tomorrow ?? null;
  const change = day.day?.nextWeekChange?.text;
  const source = doneSourceLine(session, t);
  return (
    <>
      <DoneChips waiting={outboxPending} />
      {askFeeling ? (
        !readOnly ? <FeelingChips session={session} /> : null
      ) : (
        <>
          {session.remark?.text ? (
            <LPText size={13} color={colors.paper2}>
              {session.remark.text}
            </LPText>
          ) : null}
          {tomorrow ? (
            <LPText size={13} color={colors.paper2}>
              {tomorrow.title ? t('plan.tomorrow', { title: tomorrow.title }) : t('plan.tomorrow_rest')}
            </LPText>
          ) : null}
          {change ? (
            <LPText size={13} color={colors.paper2}>
              {t('plan.next_week_change', { change })}
            </LPText>
          ) : null}
        </>
      )}
      {source ? (
        <LPText size={12} color={colors.paper3}>
          {source}
        </LPText>
      ) : null}
      <ExtrasRows session={session} />
      <UndoButton session={session} />
      <LogExtraButton session={session} />
    </>
  );
}

/** "How did it feel?" with Easy, Just right, Hard and Too hard. */
function FeelingChips({ session }: { session: SessionView }) {
  const { t, busy, isOffline, post } = useTodayCard();
  const disabled = busy !== null || isOffline;
  return (
    <>
      <LPText size={14} color={colors.paper}>
        {t('plan.feeling.q')}
      </LPText>
      {/* No label on the row: the question is read just above it, and a
          contentDescription on a plain View is a second stop for TalkBack
          saying it again (iOS's labelled container has no Android twin). */}
      <View style={styles.feelings} testID="plan.today.feelings">
        {FEELINGS.map((feeling) => (
          <Pressable
            key={feeling}
            disabled={disabled}
            onPress={() => post('feeling', { sessionId: session.id, body: SessionAction.feeling(feeling), event: 'workout_feeling_given' })}
            accessibilityRole="button"
            accessibilityLabel={t(`plan.feeling.${feeling}`)}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [styles.feeling, disabled && styles.dimmedChip, pressed && !disabled && styles.pressed]}
            testID={`plan.today.feeling.${feeling}`}
          >
            <LPText size={13} weight="medium" color={colors.paper}>
              {t(`plan.feeling.${feeling}`)}
            </LPText>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function SkippedRows({ session }: { session: SessionView }) {
  const { t, isToday } = useTodayCard();
  return (
    <>
      <LPText size={14} color={colors.paper}>
        {t(isToday ? 'plan.skipped.line' : 'plan.skipped.line_day', { reason: skipReasonWord(session.skipReason, t) })}
      </LPText>
      <ExtrasRows session={session} />
      <UndoButton session={session} />
      <LogExtraButton session={session} />
    </>
  );
}

function MissedRows({ session }: { session: SessionView }) {
  const { t, readOnly, actions } = useTodayCard();
  const { canAct, actions: offered } = missedActions(session, readOnly);
  return (
    <>
      <LPText size={14} color={colors.paper}>
        {t(canAct ? 'plan.missed.line' : 'plan.missed.line_readonly')}
      </LPText>
      {canAct ? (
        <ActionRow>
          {offered.map((action) => {
            switch (action) {
              case 'doItNow':
                return (
                  <CapsuleButton
                    key={action}
                    title={t('plan.do_it_now')}
                    allowOffline
                    onPress={() => actions.onPresentRunner(session)}
                    testID="plan.today.doItNow"
                  />
                );
              case 'logDone':
                return <MarkDoneButton key={action} session={session} busyKey="log-done" title={t('plan.log_done')} testID="plan.today.logDone" />;
              case 'skipIt':
                return (
                  <PlainTextButton
                    key={action}
                    title={t('plan.skip_it')}
                    onPress={() => {
                      track('workout_no_energy_opened', { entry: 'missed' });
                      actions.onOpenNoEnergy(session, true);
                    }}
                    testID="plan.today.skipIt"
                  />
                );
            }
            return null;
          })}
        </ActionRow>
      ) : null}
      <ExtrasRows session={session} />
      <LogExtraButton session={session} />
    </>
  );
}

function FutureRows({ session }: { session: SessionView }) {
  const { t, readOnly, actions } = useTodayCard();
  return (
    <>
      <SessionLines session={session} lines={futureLines(session.kind)} />
      {!readOnly && (session.kind ?? 'rest') !== 'rest' ? (
        <TextAction title={t('plan.preview')} busyKey="preview" onPress={() => actions.onOpenPreview(session, 'preview')} testID="plan.today.preview" />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  exercises: { gap: 10 },
  exercise: { gap: 2 },
  flex: { flex: 1 },
  tapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTouch },
  tapRowTight: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: minTouch },
  markerBox: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  markerRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: colors.attraction,
    backgroundColor: colors.onAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.attraction2 },
  soak: { gap: 4 },
  restSoak: { gap: 3, minHeight: minTouch, justifyContent: 'center' },
  walk: { minHeight: minTouch, justifyContent: 'center' },
  extras: { gap: 6 },
  extra: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  extraTexts: { flex: 1, minHeight: 32, gap: 2, justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8 },
  feelings: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feeling: { minHeight: minTouch, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.ink3, justifyContent: 'center' },
  dimmedChip: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
