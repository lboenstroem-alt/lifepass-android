/* eslint lifepass/no-literal-copy: "error" */
/**
 * The built plan, before it is anyone's plan (iOS ProgramProposalCard.swift,
 * `ios-ux.md` 5.5 and 3.6.4): shared by the Coach (its dark palette, a chat
 * bubble) and the Plan tab (paper), so the replace rule lives in ONE card.
 *
 *   Your 4-week plan (Updated plan · 4 weeks)
 *   {summary title}
 *   Mon, Wed, Fri · about 40 min
 *   week one: weekday, kind, title, length (a rest row dimmed, not a button;
 *             a session opens its preview)
 *   See all weeks                       the programme overview, proposal mode
 *   the targets line [Estimate]
 *   General fitness guidance, not medical advice.
 *   Remind me on workout days [on]  07:00
 *   Start this plan (Switch to this plan)
 *   Change days    Not now    Discard
 *
 * START: a revision always asks "Switch to the updated plan?"; a live plan
 * asks "Replace your current plan?"; otherwise it adopts at once, and the
 * server's 409 `program_already_active` asks the replace question then.
 * With the reminders on it first asks for notifications (and a refusal is
 * written for Plan's banner). Started: Plan opens with "Your plan starts...".
 * Change days posts the days alone and the card redraws from the answer.
 * Not now keeps the plan; Discard asks, then removes it.
 *
 * COLLAPSED, the card is one line: "Started. It's on your Plan tab." /
 * "Saved. Start it from the Plan tab..." / "Plan discarded." / "This plan was
 * changed on another device.", with Open Plan except after a discard. The
 * Coach keeps the outcome on its message (`outcome`, `onOutcome`) so the card
 * stays collapsed on every redraw; on Plan the card never collapses (iOS
 * passes no outcome there): what happened is Plan's next read.
 *
 * WHICH PROPOSAL: `proposal` when the host has it (a Coach message), else the
 * member's current one from the Today read (when `programId` is omitted or
 * names it), else `programId` read from `GET /health/programs/{id}`. Draws
 * nothing until it has one.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { EstimateChip, hiddenFromAccessibility, Kicker, LPText, MenuPicker } from '../../../components/ui';
import {
  fetchProgram,
  fetchSession,
  selectHasLiveProgram,
  selectProposal,
  useHealthStore,
  type HealthProposal,
  type ProgramDetail,
  type SessionBrief,
} from '../../../health';
import { useT } from '../../../i18n';
import { duration, weekdayAbbreviation } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { navigateInCurrentTab } from '../../../navigation/navigationRef';
import { openSharedRoute } from '../../../navigation/sharedSheet';
import type { AppNavigation } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import { colors } from '../../../theme';
import { openChangeDays } from '../days';
import { isRestRow, proposalMetaLine, proposalRowLabel, rowTitle, rowWeekday, targetsLine, targetsText } from '../overview/planCopy';
import { openSessionPreview, useSessionPreviewAvailable } from '../programOverview/sessionPreview';
import { reloadPlan } from '../shell/planShell';
import { sessionKindIcon } from '../shell/sessionKindIcon';

import { PROPOSAL_COLOURS, type ProposalColours } from './palette';
import { loadReminderPreferences, noteReminderDraft, onProposalOutcome } from './proposalActions';
import {
  DEFAULT_REMINDER_MINUTES,
  kickerKey,
  offersOpenPlan,
  outcomeCopyKey,
  REMINDER_CHOICES,
  reminderTimeLabel,
  startDecision,
  startKey,
  type ProposalOutcome,
} from './proposalRules';
import { useProposalFlow } from './useProposalFlow';

export type { ProposalOutcome } from './proposalRules';

/** The Coach's dark chat, or Plan's paper. */
export type ProposalPalette = 'coach' | 'plan';

export interface ProgramProposalCardProps {
  readonly palette: ProposalPalette;
  /** A specific proposal; the member's current one when omitted. */
  readonly programId?: string;
  /** Open Plan from a collapsed card. Plan's tab when omitted. */
  readonly onOpenPlan?: () => void;
  /** The proposal itself, when the host carries it (a Coach message). Optional (PLAN-4). */
  readonly proposal?: HealthProposal | null;
  /**
   * What already became of it (the Coach keeps it on the message): the card
   * shows one line instead. Controlled when given; omitted, the Coach
   * palette remembers it itself and Plan's never collapses. Optional (PLAN-4).
   */
  readonly outcome?: ProposalOutcome | null;
  /** Reported so the host can remember it (here or from the weeks screen). Optional (PLAN-4). */
  readonly onOutcome?: (outcome: ProposalOutcome) => void;
  /** A change of days answered with the whole programme again. Optional (PLAN-4). */
  readonly onProgramUpdated?: (detail: ProgramDetail) => void;
  readonly testID?: string;
}

/** Week one of a programme read whole (the first week there is, when none is numbered 1). */
export function weekOneOf(detail: ProgramDetail): SessionBrief[] {
  const weeks = [...(detail.weekPlans ?? [])].sort((a, b) => a.weekNo - b.weekNo);
  const first = weeks.find((week) => week.weekNo === 1) ?? weeks[0];
  return [...(first?.days ?? [])];
}

export default function ProgramProposalCard(props: ProgramProposalCardProps) {
  const { palette, programId, testID = 'program.proposal' } = props;
  const colours = PROPOSAL_COLOURS[palette];
  const proposal = useShownProposal(props);
  const [localOutcome, setLocalOutcome] = useState<ProposalOutcome | null>(null);
  const outcome = props.outcome !== undefined ? props.outcome : palette === 'coach' ? localOutcome : null;

  const latestProps = useRef(props);
  latestProps.current = props;
  const handleOutcome = useCallback(
    (next: ProposalOutcome) => {
      const current = latestProps.current;
      if (current.outcome === undefined && current.palette === 'coach') setLocalOutcome(next);
      current.onOutcome?.(next);
      if (current.palette === 'plan') void reloadPlan({ force: true });
    },
    [],
  );

  // What the weeks screen decided about this proposal reaches the card too.
  const shownId = proposal.shown?.program.id ?? programId ?? null;
  useEffect(() => (shownId ? onProposalOutcome(shownId, handleOutcome) : undefined), [shownId, handleOutcome]);

  const openPlan = () => {
    if (props.onOpenPlan) props.onOpenPlan();
    else useIntentStore.getState().requestTab('Plan');
  };

  let body = null;
  if (outcome) {
    body = <Collapsed outcome={outcome} colours={colours} onOpenPlan={openPlan} testID={testID} />;
  } else if (proposal.shown) {
    body = (
      <FullCard
        proposal={proposal.shown}
        palette={palette}
        colours={colours}
        onOutcome={handleOutcome}
        onUpdated={(detail) => {
          proposal.setUpdated(detail);
          const current = latestProps.current;
          current.onProgramUpdated?.(detail);
          if (current.palette === 'plan') void reloadPlan({ force: true });
        }}
        testID={testID}
      />
    );
  }
  if (!body) return null;
  return <View style={{ paddingLeft: colours.leadingInset }}>{body}</View>;
}

/** Which proposal the card draws (see the header), and the redraw after a change of days. */
function useShownProposal(props: ProgramProposalCardProps): {
  shown: HealthProposal | null;
  setUpdated: (detail: ProgramDetail) => void;
} {
  const { language } = useT();
  const storeProposal = useHealthStore(selectProposal);
  const fromStore = storeProposal && (!props.programId || storeProposal.program.id === props.programId) ? storeProposal : null;
  const given = props.proposal ?? fromStore;
  const [fetched, setFetched] = useState<HealthProposal | null>(null);
  const [updated, setUpdatedState] = useState<HealthProposal | null>(null);
  const needsRead = !given && !!props.programId;

  useEffect(() => {
    if (!needsRead || !props.programId) return;
    let live = true;
    fetchProgram(props.programId, language)
      .then((detail) => {
        if (live) setFetched({ program: detail.program, week1: weekOneOf(detail) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [needsRead, props.programId, language]);

  const base = given ?? (fetched && fetched.program.id === props.programId ? fetched : null);
  // A newer proposal from the host (the Coach redrew its message, Plan read again) replaces a local redraw.
  useEffect(() => setUpdatedState(null), [base]);

  const shown = updated && base && updated.program.id === base.program.id ? updated : base;
  const setUpdated = useCallback(
    (detail: ProgramDetail) => setUpdatedState({ program: detail.program, week1: weekOneOf(detail) }),
    [],
  );
  return { shown, setUpdated };
}

function Collapsed({
  outcome,
  colours,
  onOpenPlan,
  testID,
}: {
  outcome: ProposalOutcome;
  colours: ProposalColours;
  onOpenPlan: () => void;
  testID: string;
}) {
  const { t } = useT();
  const openPlan = t('program.chip.open_plan');
  return (
    <View style={[styles.tile, styles.collapsed, { backgroundColor: colours.tile, borderColor: colours.stroke }]} testID={`${testID}.collapsed`}>
      <LPText size={14} color={colours.text} style={styles.grow}>
        {t(outcomeCopyKey(outcome))}
      </LPText>
      {offersOpenPlan(outcome) ? (
        <Pressable
          onPress={onOpenPlan}
          accessibilityRole="button"
          accessibilityLabel={openPlan}
          style={({ pressed }) => [styles.openPlan, pressed && styles.pressed]}
          testID={`${testID}.openPlan`}
        >
          <LPText size={13} weight="semibold" color={colors.onAccent}>
            {openPlan}
          </LPText>
        </Pressable>
      ) : null}
    </View>
  );
}

function FullCard({
  proposal,
  palette,
  colours,
  onOutcome,
  onUpdated,
  testID,
}: {
  proposal: HealthProposal;
  palette: ProposalPalette;
  colours: ProposalColours;
  onOutcome: (outcome: ProposalOutcome) => void;
  onUpdated: (detail: ProgramDetail) => void;
  testID: string;
}) {
  const { t, language } = useT();
  const navigation = useContext(NavigationContext) as AppNavigation | undefined;
  const program = proposal.program;
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const hasLiveProgram = useHealthStore(selectHasLiveProgram);
  const previewAvailable = useSessionPreviewAvailable();

  // The reminder toggle and time: the stored choice, else on at 07:00 (iOS `loadReminderPreferences`).
  const [remindersOn, setRemindersOn] = useState(true);
  const [reminderMinutes, setReminderMinutes] = useState(DEFAULT_REMINDER_MINUTES);
  const reminders = useRef({ remindersOn: true, minutes: DEFAULT_REMINDER_MINUTES });
  useEffect(() => {
    let live = true;
    void loadReminderPreferences(profileId).then((stored) => {
      if (!live) return;
      setRemindersOn(stored.remindersOn);
      setReminderMinutes(stored.minutes);
    });
    return () => {
      live = false;
    };
  }, [profileId]);
  useEffect(() => {
    reminders.current = { remindersOn, minutes: reminderMinutes };
    noteReminderDraft(program.id, reminders.current);
  }, [program.id, remindersOn, reminderMinutes]);

  const flow = useProposalFlow({
    program,
    entry: palette === 'coach' ? 'coach' : 'plan',
    reminders: () => reminders.current,
    onOutcome,
  });
  const busy = flow.isBusy;

  const seeAllWeeks = () => {
    const params = { programId: program.id, mode: 'proposal' as const };
    if (navigation) openSharedRoute(navigation, 'ProgramOverview', params);
    else navigateInCurrentTab('ProgramOverview', params);
  };

  // A proposal's rows are readable, so a member can look at a session before deciding.
  const opening = useRef(false);
  const openSession = async (brief: SessionBrief) => {
    if (busy || opening.current) return;
    opening.current = true;
    try {
      const session = await fetchSession(brief.id, language);
      openSessionPreview({ session, canStart: false, onStart: () => undefined });
    } catch {
      // Nothing opens: a preview that cannot load is not worth an error over the card.
    } finally {
      opening.current = false;
    }
  };

  const changeDays = () =>
    openChangeDays({
      kind: 'program',
      programId: program.id,
      daysPerWeek: program.daysPerWeek ?? 3,
      selected: program.trainingDays ?? [],
      onSaved: ({ program: detail }) => {
        if (detail) onUpdated(detail);
        track('program_proposal_action', { action: 'change_days' });
      },
      onChanged: () => {
        useHealthStore.getState().setToast('health.err.changed');
        onOutcome('changed');
      },
    });

  const notNow = () => {
    track('program_proposal_action', { action: 'not_now' });
    onOutcome('saved');
  };

  const targets = targetsLine(program);
  const timeOptions = useMemo(
    () => REMINDER_CHOICES.map((minutes) => ({ value: String(minutes), label: reminderTimeLabel(minutes) })),
    [],
  );
  const startLabel = t(startKey(program));

  return (
    <View style={[styles.tile, styles.card, { backgroundColor: colours.tile, borderColor: colours.stroke }]} testID={testID}>
      <View style={styles.heading}>
        <Kicker text={t(kickerKey(program), { weeks: String(program.weeks ?? 4) })} color={colours.text3} />
        <LPText serif size={22} color={colours.text} accessibilityRole="header">
          {program.summaryTitle ?? ''}
        </LPText>
        <LPText size={13} color={colours.text2}>
          {proposalMetaLine(program, t, language)}
        </LPText>
      </View>

      <View style={[styles.weekOne, { backgroundColor: colours.rows }]}>
        {proposal.week1.map((session, index) => {
          const rest = isRestRow(session);
          const tappable = !rest && previewAvailable;
          return (
            <Pressable
              key={session.id}
              onPress={() => void openSession(session)}
              disabled={!tappable || busy}
              accessible
              accessibilityRole={tappable ? 'button' : undefined}
              accessibilityLabel={proposalRowLabel(session, index, t, language)}
              accessibilityState={tappable ? { disabled: busy } : undefined}
              style={({ pressed }) => [
                styles.weekRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colours.stroke },
                rest && styles.restRow,
                pressed && styles.pressed,
              ]}
              testID={`${testID}.week1.${index}`}
            >
              <LPText size={10} tracking={1.1} color={colours.text3} style={styles.weekday} numberOfLines={1}>
                {weekdayAbbreviation(rowWeekday(session, index), language).toUpperCase()}
              </LPText>
              <View {...hiddenFromAccessibility} style={styles.kindIcon}>
                <MaterialCommunityIcons name={sessionKindIcon(session.kind ?? 'rest')} size={15} color={colours.text2} />
              </View>
              <LPText size={14} color={colours.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.grow}>
                {rowTitle(session, t)}
              </LPText>
              {session.minutes !== null && session.minutes > 0 ? (
                <LPText size={12} color={colours.text3}>
                  {duration(session.minutes, language)}
                </LPText>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <QuietButton title={t('program.proposal.see_all')} colour={colours.text2} onPress={seeAllWeeks} testID={`${testID}.seeAll`} />

      <View style={styles.targets}>
        <LPText size={13} color={colours.text2} style={styles.shrink} testID={`${testID}.targets`}>
          {targetsText(targets, t, language)}
        </LPText>
        {targets.kind === 'targets' ? palette === 'plan' ? <EstimateChip /> : <GlassEstimateChip /> : null}
      </View>

      <LPText size={12} color={colours.text3}>
        {t('health.disclaimer')}
      </LPText>

      <View style={styles.reminders}>
        <Pressable
          onPress={() => setRemindersOn((on) => !on)}
          accessibilityRole="switch"
          accessibilityLabel={t('program.proposal.reminders')}
          accessibilityState={{ checked: remindersOn }}
          style={styles.reminderToggle}
          testID={`${testID}.reminders`}
        >
          <LPText size={14} color={colours.text} style={styles.shrink}>
            {t('program.proposal.reminders')}
          </LPText>
          <Switch
            value={remindersOn}
            onValueChange={setRemindersOn}
            trackColor={{ true: colors.rust, false: colors.line2 }}
            thumbColor={colors.onAccent}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
        </Pressable>
        <MenuPicker
          options={timeOptions}
          value={String(reminderMinutes)}
          onChange={(value) => setReminderMinutes(Number(value))}
          label={t('plan4.reminder_time')}
          disabled={!remindersOn}
          renderTrigger={(selected) => (
            <View style={styles.timeTrigger}>
              <LPText size={13} weight="semibold" color={colours.text2}>
                {selected?.label ?? reminderTimeLabel(reminderMinutes)}
              </LPText>
            </View>
          )}
          testID={`${testID}.reminderTime`}
        />
      </View>

      {flow.errorKey ? (
        <LPText size={13} color={colours.error} accessibilityLiveRegion="polite" testID={`${testID}.error`}>
          {t(flow.errorKey)}
        </LPText>
      ) : null}

      <Pressable
        onPress={() => flow.start(startDecision(program, hasLiveProgram))}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={startLabel}
        accessibilityHint={t('a11y.opens_plan')}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [styles.start, pressed && styles.pressed]}
        testID={program.revisionOf !== null ? 'program.revision.start' : 'program.proposal.start'}
      >
        {busy ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <LPText size={15} weight="semibold" color={colors.onAccent}>
            {startLabel}
          </LPText>
        )}
      </Pressable>

      <View style={styles.textButtons}>
        <QuietButton title={t('program.proposal.change_days')} colour={colours.text2} onPress={changeDays} disabled={busy} testID={`${testID}.changeDays`} />
        <QuietButton title={t('program.proposal.not_now')} colour={colours.text2} onPress={notNow} disabled={busy} testID={`${testID}.notNow`} />
        <QuietButton title={t('program.proposal.discard')} colour={colours.text2} onPress={flow.askDiscard} disabled={busy} testID={`${testID}.discard`} />
      </View>
    </View>
  );
}

/**
 * "Estimate" on the Coach's glass: the shared chip is deep glacier on a pale
 * wash, right on paper and all but invisible on the photograph, and this
 * chip is the one thing on the card that must not be missable.
 */
function GlassEstimateChip() {
  const { t } = useT();
  return (
    <View style={styles.glassChip}>
      <LPText size={10} weight="semibold" tracking={0.4} color={colors.onAccent}>
        {t('health.estimate')}
      </LPText>
    </View>
  );
}

function QuietButton({
  title,
  colour,
  onPress,
  disabled = false,
  testID,
}: {
  title: string;
  colour: string;
  onPress: () => void;
  disabled?: boolean;
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
      <LPText size={13} weight="semibold" color={colour}>
        {title}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 16, borderWidth: 0.8, padding: 14 },
  card: { gap: 14 },
  collapsed: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { gap: 6 },
  weekOne: { borderRadius: 12, overflow: 'hidden' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44 },
  restRow: { opacity: 0.55 },
  weekday: { width: 34 },
  kindIcon: { width: 20, alignItems: 'center' },
  targets: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  reminders: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reminderToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 },
  timeTrigger: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  start: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  textButtons: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  quiet: { minHeight: 44, justifyContent: 'center' },
  openPlan: { minHeight: 36, borderRadius: 18, backgroundColor: colors.rust, paddingHorizontal: 14, justifyContent: 'center' },
  glassChip: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
