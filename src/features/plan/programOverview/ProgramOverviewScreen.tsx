/* eslint lifepass/no-literal-copy: "error" */
/**
 * Route `ProgramOverview`: every week of a plan (iOS ProgramOverviewView,
 * `ios-ux.md` 3.9.2), in three modes. One screen rather than three, because
 * the difference between a live plan, a proposal and a finished plan is which
 * buttons sit at the bottom: the weeks, the notes and the day rows are the
 * same thing seen at different moments.
 *
 *   header      ("Past plan" kicker), the title, the dates, the intro, the disclaimer
 *   week picker "Week 1" ... "Week 4", opening on the plan's current week
 *   week note   the week's own note, and the deload line on the LAST week only
 *   day rows    weekday, date (not for a proposal: it has none yet), kind,
 *               title, length, status mark; a rest row is dimmed and not a
 *               button; a session loads and opens its preview (Start only
 *               for today's planned session of a live plan)
 *   changes     live:     the changes made in chat (OP-62), with Undo on those
 *                         the server can still undo (COACH-6; ./PlanEditChanges.tsx)
 *   actions     live:     Change training days (not on a custom plan),
 *                         Pause (asks) / Resume, End (asks)
 *               proposal: Start this plan (Switch to this plan), Discard
 *               past:     none
 *
 * `GET /health/programs/{id}` in the account language, again when it
 * changes; a skeleton while there is nothing, the error with Try again when
 * that read failed.
 *
 * A PROPOSAL'S START AND DISCARD depend on who opened the screen, as on iOS:
 * - a proposal card's "See all weeks" (`fromCard`): the card's own flow
 *   (../proposal/useProposalFlow.ts, iOS the weeks sheet's `onStart` calling
 *   the card's `adopt`): a revision asks to switch, anything else adopts at
 *   once and the server's 409 asks to replace; Discard asks, then discards.
 *   The outcome reaches the card (`reportProposalOutcome`).
 * - Plan's "A new plan is ready" row (iOS PlanView `.proposalReview`): both
 *   only go back (`onStart: { pop() }`, `onDiscard: { pop() }`). Nothing is
 *   posted and no permission is asked there.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, isCancellation, newIdempotencyKey } from '../../../api';
import {
  Card,
  ErrorState,
  hiddenFromAccessibility,
  Kicker,
  LPText,
  PrimaryButton,
  showDialog,
  SkeletonCard,
  TopBar,
} from '../../../components/ui';
import {
  fetchProgram,
  fetchSession,
  isCustomProgram,
  updateProgram,
  useHealthStore,
  type ProgramDetail,
  type ProgramSummary,
  type SessionBrief,
} from '../../../health';
import { useT } from '../../../i18n';
import { duration, shortDay, todayServerDay, weekdayAbbreviation } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import type { SharedRouteProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors, hairline } from '../../../theme';
import { hasPendingWorkoutNow } from '../../runner';
import { openChangeDays } from '../days';
import { dateRange, dayRowLabel, isRestRow, rowTitle, rowWeekday } from '../overview/planCopy';
import { ProgramUpdate, type ProgramStatusChange } from '../overview/programUpdate';
import { loadReminderPreferences, reminderDraft, reportProposalOutcome } from '../proposal/proposalActions';
import { overviewStartDecision, startKey, type ProposalOutcome } from '../proposal/proposalRules';
import { useProposalFlow } from '../proposal/useProposalFlow';
import { currentPlanView, popPlanToRoot, presentPlanRunner, reloadPlan } from '../shell';
import { sessionKindIcon } from '../shell/sessionKindIcon';
import StatusMark from '../week/StatusMark';

import { clampWeek, initialWeek, showsDeloadNote, shownWeek, sortedWeeks, weekNote } from './overviewRules';
import PlanEditChanges from './PlanEditChanges';
import { canStartToday, useSessionPreview } from './sessionPreview';

/** iOS leaves 140 pt under the page: the tab bar floats over it, plus room to breathe. */
const BOTTOM_ROOM = 64;

export default function ProgramOverviewScreen({ route, navigation }: SharedRouteProps<'ProgramOverview'>) {
  const { programId, mode, fromCard } = route.params;
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const alive = useRef(true);
  /** Which read is the newest: an older one that answers late is dropped (iOS `.task(id:)` cancels it). */
  const loadGeneration = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const isCurrent = () => alive.current && generation === loadGeneration.current;
    setLoadFailed(false);
    setLoading(true);
    try {
      const loaded = await fetchProgram(programId, language);
      if (!isCurrent()) return;
      setDetail(loaded);
      setSelectedWeek(initialWeek(loaded));
      setLoading(false);
    } catch (error) {
      // A cancelled read keeps the skeleton: iOS returns before it clears
      // `isLoading`, so the page never sits empty with neither a skeleton
      // nor Try again.
      if (!isCurrent() || isCancellation(error)) return;
      setLoadFailed(true);
      setLoading(false);
    }
  }, [programId, language]);

  // Every appearance in a new language reads again: the titles are server copy.
  useEffect(() => {
    void load();
  }, [load]);

  const program = detail?.program ?? null;
  const weeks = sortedWeeks(detail);
  const shown = shownWeek(weeks, selectedWeek);

  /** The programme came back from a change: drawn at once, on a week it still has. */
  const applyDetail = useCallback((updated: ProgramDetail) => {
    setDetail(updated);
    setSelectedWeek((current) => clampWeek(current, sortedWeeks(updated)));
  }, []);

  let body;
  if (!detail && isLoading) {
    body = (
      <View style={styles.skeleton} testID="programOverview.loading">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={3} showsHeader={false} />
      </View>
    );
  } else if (!detail && loadFailed) {
    body = <ErrorState onRetry={() => void load()} testID="programOverview.error" />;
  } else if (program) {
    body = (
      <>
        <Header program={program} mode={mode} />
        <WeekPicker weeks={weeks.map((week) => week.weekNo)} selected={shown?.weekNo ?? selectedWeek} onSelect={setSelectedWeek} />
        <WeekNotes note={weekNote(shown)} deload={showsDeloadNote(weeks, shown)} />
        <DayRows days={shown?.days ?? []} mode={mode} />
        {mode === 'live' ? <PlanEditChanges program={program} onPlanChanged={() => void load()} /> : null}
        {mode === 'live' ? <LiveActions program={program} onUpdated={applyDetail} /> : null}
        {mode === 'proposal' ? (
          fromCard ? (
            <CardProposalActions program={program} programId={programId} fromCard={fromCard} navigation={navigation} />
          ) : (
            <ReviewProposalActions program={program} navigation={navigation} />
          )
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.screen} testID="programOverview.screen">
      <TopBar
        title={t(mode === 'past' ? 'plan.past_plan' : 'plan.overview.title')}
        onBack={() => navigation.goBack()}
        testID="programOverview.topBar"
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + BOTTOM_ROOM }]}
        showsVerticalScrollIndicator={false}
        testID="programOverview.scroll"
      >
        {body}
      </ScrollView>
    </View>
  );
}

function Header({ program, mode }: { program: ProgramSummary; mode: 'live' | 'proposal' | 'past' }) {
  const { t, language } = useT();
  const dates = dateRange(program, t, language);
  return (
    <View style={styles.header}>
      {mode === 'past' ? <Kicker text={t('plan.past_plan')} /> : null}
      <LPText serif size={24} color={colors.paper} accessibilityRole="header">
        {program.summaryTitle ?? ''}
      </LPText>
      {dates ? (
        <LPText size={13} color={colors.paper2}>
          {dates}
        </LPText>
      ) : null}
      {program.intro ? (
        <LPText size={14} color={colors.paper}>
          {program.intro}
        </LPText>
      ) : null}
      <LPText size={12} color={colors.paper3}>
        {t('health.disclaimer')}
      </LPText>
    </View>
  );
}

function WeekPicker({ weeks, selected, onSelect }: { weeks: number[]; selected: number; onSelect: (week: number) => void }) {
  const { t } = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekPicker}>
      {weeks.map((week) => {
        const on = week === selected;
        const label = t('plan.week_n', { n: String(week) });
        return (
          <Pressable
            key={week}
            onPress={() => onSelect(week)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.weekChip, on ? styles.weekChipOn : styles.weekChipOff, pressed && styles.pressed]}
            testID={`programOverview.week.${week}`}
          >
            <LPText size={13} weight={on ? 'semibold' : 'medium'} color={on ? colors.onAccent : colors.paper2}>
              {label}
            </LPText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function WeekNotes({ note, deload }: { note: string | null; deload: boolean }) {
  const { t } = useT();
  if (!note && !deload) return null;
  return (
    <View style={styles.notes}>
      {note ? (
        <LPText size={14} color={colors.paper2}>
          {note}
        </LPText>
      ) : null}
      {deload ? (
        <LPText size={14} color={colors.paper2} testID="programOverview.deload">
          {t('plan.deload_note')}
        </LPText>
      ) : null}
    </View>
  );
}

function DayRows({ days, mode }: { days: readonly SessionBrief[]; mode: 'live' | 'proposal' | 'past' }) {
  const { t, language } = useT();
  const preview = useSessionPreview('programOverview.preview');
  const previewAvailable = preview.available;
  const opening = useRef(false);

  const open = async (day: SessionBrief) => {
    if (opening.current) return;
    opening.current = true;
    try {
      const session = await fetchSession(day.id, language);
      const view = currentPlanView();
      // Only a live plan's overview offers Start (iOS `mode == .live && canStartSession`).
      const canStart =
        mode === 'live' &&
        canStartToday(session, {
          readOnly: view.isReadOnly,
          programPaused: view.shownDay?.program?.status === 'paused',
          outboxPending: hasPendingWorkoutNow(session.id),
          today: todayServerDay(),
        });
      preview.open({
        session,
        canStart,
        // Back to Plan, then the runner (iOS: `planPath` reset, `presentRunner`).
        onStart: () => {
          popPlanToRoot();
          void presentPlanRunner(session);
        },
      });
    } catch {
      // A preview that cannot load opens nothing, as on iOS.
    } finally {
      opening.current = false;
    }
  };

  // The sheet draws in the UI kit's portal: where it sits here adds nothing to the page.
  if (days.length === 0) return preview.element;
  return (
    <>
      <Card style={styles.dayCard}>
        {days.map((day, index) => {
          const rest = isRestRow(day);
          const tappable = !rest && previewAvailable;
          return (
            <Pressable
              key={day.id}
              onPress={() => void open(day)}
              disabled={!tappable}
              accessible
              accessibilityRole={tappable ? 'button' : undefined}
              accessibilityLabel={dayRowLabel(day, index, t, language)}
              style={({ pressed }) => [styles.dayRow, index > 0 && styles.divider, rest && styles.rest, pressed && styles.pressed]}
              testID={`programOverview.day.${index}`}
            >
              <View style={styles.dayWhen}>
                <LPText size={10} tracking={1.1} color={colors.paper3} numberOfLines={1}>
                  {weekdayAbbreviation(rowWeekday(day, index), language).toUpperCase()}
                </LPText>
                {mode !== 'proposal' && day.scheduledFor ? (
                  <LPText size={10} color={colors.paper4} numberOfLines={1}>
                    {shortDay(day.scheduledFor, language)}
                  </LPText>
                ) : null}
              </View>
              <View {...hiddenFromAccessibility} style={styles.kind}>
                <MaterialCommunityIcons name={sessionKindIcon(day.kind ?? 'rest')} size={17} color={colors.paper2} />
              </View>
              <LPText size={15} color={colors.paper} numberOfLines={2} style={styles.grow}>
                {rowTitle(day, t)}
              </LPText>
              {day.minutes !== null && day.minutes > 0 ? (
                <LPText size={12} color={colors.paper3}>
                  {duration(day.minutes, language)}
                </LPText>
              ) : null}
              <StatusMark status={day.status ?? 'planned'} />
            </Pressable>
          );
        })}
      </Card>
      {preview.element}
    </>
  );
}

/** Change training days, Pause (asks) or Resume, End (asks): each reads Plan again. */
function LiveActions({ program, onUpdated }: { program: ProgramSummary; onUpdated: (detail: ProgramDetail) => void }) {
  const { t } = useT();
  const [isActing, setActing] = useState(false);
  const acting = useRef(false);
  const paused = program.status === 'paused';

  const setStatus = async (status: ProgramStatusChange) => {
    if (acting.current) return;
    acting.current = true;
    setActing(true);
    try {
      const response = await updateProgram(program.id, ProgramUpdate.status(status), newIdempotencyKey());
      track(status === 'paused' ? 'program_paused' : status === 'active' ? 'program_resumed' : 'program_ended');
      if (response.program) onUpdated(response.program);
    } catch (error) {
      if (error instanceof ApiError) useHealthStore.getState().handle(error, { foreground: true });
      else useHealthStore.getState().setToast('health.err.changed');
    } finally {
      acting.current = false;
      setActing(false);
    }
    void reloadPlan({ force: true });
  };

  const ask = (kind: 'pause' | 'end') =>
    showDialog({
      presentation: 'actionSheet',
      titleVisibility: 'visible',
      title: t(kind === 'pause' ? 'plan.pause.title' : 'plan.end.title'),
      message: t(kind === 'pause' ? 'plan.pause.body' : 'plan.end.body'),
      buttons: [
        {
          label: t(kind === 'pause' ? 'plan.pause.confirm' : 'plan.end.confirm'),
          role: kind === 'end' ? 'destructive' : 'default',
          onPress: () => void setStatus(kind === 'pause' ? 'paused' : 'abandoned'),
        },
        { label: t('common.cancel'), role: 'cancel' },
      ],
      testID: `programOverview.${kind}Dialog`,
    });

  const changeDays = () =>
    openChangeDays({
      kind: 'program',
      programId: program.id,
      daysPerWeek: program.daysPerWeek ?? 3,
      selected: program.trainingDays ?? [],
      onSaved: ({ program: updated }) => {
        if (updated) onUpdated(updated);
        void reloadPlan({ force: true });
      },
      onChanged: () => {
        useHealthStore.getState().setToast('health.err.changed');
        void reloadPlan({ force: true });
      },
    });

  return (
    <View style={styles.actions}>
      {/* A custom plan's days are the member's cycle: the server refuses Change days on it. */}
      {!isCustomProgram(program) ? (
        <QuietButton title={t('plan.overview.change_days')} onPress={changeDays} disabled={isActing} testID="programOverview.changeDays" />
      ) : null}
      <QuietButton
        title={t(paused ? 'plan.overview.resume' : 'plan.overview.pause')}
        onPress={() => (paused ? void setStatus('active') : ask('pause'))}
        disabled={isActing}
        testID={`programOverview.${paused ? 'resume' : 'pause'}`}
      />
      <QuietButton
        title={t('plan.overview.end')}
        colour={colors.destructive}
        onPress={() => ask('end')}
        disabled={isActing}
        testID="programOverview.end"
      />
    </View>
  );
}

/**
 * Plan's "A new plan is ready" row opened this (iOS PlanView `.proposalReview`
 * passes `onStart: { pop() }` and `onDiscard: { pop() }`): both go back to
 * Plan, where the plan is still waiting. Nothing is posted, and no
 * notification permission is asked for a reminder choice nobody showed.
 */
function ReviewProposalActions({
  program,
  navigation,
}: {
  program: ProgramSummary;
  navigation: SharedRouteProps<'ProgramOverview'>['navigation'];
}) {
  const { t } = useT();
  const back = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };
  return (
    <View style={styles.proposalActions}>
      <PrimaryButton title={t(startKey(program))} onPress={back} testID="overview.proposal.start" />
      <QuietButton title={t('program.proposal.discard')} colour={colors.destructive} onPress={back} testID="programOverview.discard" />
    </View>
  );
}

/**
 * A proposal card's "See all weeks" opened this: Start and Discard are that
 * card's (iOS the weeks sheet's `onStart` runs the card's `adopt`, its
 * `onDiscard` the card's discard question), with the card's reminder choice.
 */
function CardProposalActions({
  program,
  programId,
  fromCard,
  navigation,
}: {
  program: ProgramSummary;
  programId: string;
  fromCard: 'coach' | 'plan';
  navigation: SharedRouteProps<'ProgramOverview'>['navigation'];
}) {
  const { t } = useT();
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  // On Plan's own stack (the Plan card), or over the Coach's.
  const onPlanStack = navigation.getState?.()?.routeNames?.includes('PlanMain' as never) === true;

  const onOutcome = (outcome: ProposalOutcome) => {
    reportProposalOutcome(programId, outcome);
    // A start parks Plan's banner, which reads again itself; anything else
    // changed what Plan shows (the proposal card).
    if (outcome !== 'started') void reloadPlan({ force: true });
    if (outcome === 'started' && onPlanStack) {
      popPlanToRoot();
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  };

  const flow = useProposalFlow({
    program,
    entry: fromCard,
    // The card that opened this is still mounted under it: its toggle as it stands.
    reminders: () => reminderDraft(programId) ?? loadReminderPreferences(profileId),
    onOutcome,
  });

  return (
    <View style={styles.proposalActions}>
      {flow.errorKey ? (
        <LPText size={13} color={colors.destructive} accessibilityLiveRegion="polite" testID="programOverview.error.line">
          {t(flow.errorKey)}
        </LPText>
      ) : null}
      <PrimaryButton
        title={t(startKey(program))}
        onPress={() => flow.start(overviewStartDecision(program))}
        loading={flow.isBusy}
        testID="overview.proposal.start"
      />
      <QuietButton
        title={t('program.proposal.discard')}
        colour={colors.destructive}
        onPress={flow.askDiscard}
        disabled={flow.isBusy}
        testID="programOverview.discard"
      />
    </View>
  );
}

function QuietButton({
  title,
  onPress,
  disabled = false,
  colour = colors.paper2,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  colour?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.quiet, disabled && styles.disabled, pressed && styles.pressed]}
      testID={testID}
    >
      <LPText size={13} weight="semibold" color={colour} align="center">
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  content: { paddingTop: 16, gap: 22 },
  skeleton: { gap: 20, paddingHorizontal: 20 },
  header: { gap: 10, paddingHorizontal: 24 },
  weekPicker: { gap: 8, paddingHorizontal: 20 },
  weekChip: { minHeight: 40, borderRadius: 20, borderWidth: hairline, paddingHorizontal: 14, justifyContent: 'center' },
  weekChipOn: { backgroundColor: colors.rust, borderColor: colors.rust },
  weekChipOff: { backgroundColor: colors.ink2, borderColor: colors.line },
  notes: { gap: 6, paddingHorizontal: 24 },
  dayCard: { marginHorizontal: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  divider: { borderTopWidth: hairline, borderTopColor: colors.line },
  rest: { opacity: 0.55 },
  dayWhen: { width: 58, gap: 2 },
  kind: { width: 22, alignItems: 'center' },
  grow: { flex: 1 },
  actions: { gap: 14, paddingHorizontal: 20, alignItems: 'center' },
  proposalActions: { gap: 12, paddingHorizontal: 20 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
