/* eslint lifepass/no-literal-copy: "error" */
/**
 * The four-week programme wizard and its build: the Android port of iOS
 * `extension CoachViewModel` "The programme wizard (ios-ux.md 5)"
 * (ViewModels/CoachViewModel.swift). ../flows/program.ts plugs it into
 * COACH-1's store as the `program` flow.
 *
 * A second wizard beside the day plan. Eight preset questions, NO network
 * until the final tap (the next block's prefill aside), and a plan that is
 * saved as a proposal before anything becomes the member's live plan
 * (ruling 2). Every turn it adds is `isHealth` (./messages.ts).
 *
 * THE ORDER OF A RUN
 * 1. Gates, BEFORE the first question, from a context read fresh
 *    (./context.ts): under 18, payment past due, no membership, a pass only,
 *    a company plan not activated, no consent; then a saved proposal or a
 *    live plan. "Make a new plan" answers its gate once and never meets it
 *    again (the loop fix, `SPEC` 6.6).
 * 2. Question 1's silent answers: four weeks, every place the membership
 *    covers. Then goal, focus, days, experience, what to plan around (a
 *    multi-select; "an injury" asks where), body details (the body sheet, or
 *    Skip), training days (the default chip, or the day picker sheet).
 * 3. A pregnancy or an eating-disorder answer ends it ON THE PHONE: nothing
 *    is kept, sent or counted, and the monthly feedback's food switch is
 *    turned off (`applyFeedbackSafetyHook`).
 * 4. The summary: every row re-asks its question and comes back to a fresh
 *    summary; Build my plan; Start over.
 * 5. The build (`submitProgram`): one `POST /coach`, its key kept while the
 *    answers do not change, and the error table (./buildFailure.ts).
 * 6. The proposal card; its outcome ends the wizard unless it was "Not now".
 *
 * NOTHING TYPED IS READ. While the wizard is in progress the words are
 * dropped: the hint says so once and the open question is asked again under
 * it (`repeatOpenQuestion`).
 */
import { isApiError, type ApiError } from '../../../api';
import { fetchProgram, useHealthStore, type ProgramDetail } from '../../../health';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import type { CoachProgramEntry } from '../../../stores/intentStore';
import type { QuestionOption } from '../../../types/coach';
import type { BodyDetails, BodyIntakeResult } from '../../body/sheets';
import type { ProposalOutcome } from '../../plan/proposal/ProgramProposalCard';
import { dayPlanFlow } from '../flows/dayPlan';
import type { CoachStartContext } from '../flows/types';
import { programIntentMatches } from '../routing/intents';
import { coachHost, type CoachBusyToken } from '../store/host';

import { canRevise, programAdjustHandoff } from './adjustHandoff';
import { postProgramBuild, type ProgramBuildResponse } from './buildApi';
import { buildFailurePlan, NETWORK_FAILURE, silentRetry, type BuildFailurePlan } from './buildFailure';
import { readProgramContext, type ProgramContext } from './context';
import {
  appendProgramBubble,
  appendProgramMultiSelect,
  appendProgramQuestion,
  appendProgramSummaryMessage,
  appendProgramUser,
  appendProposalMessage,
  closeProgramQuestions,
  isOpenProgramQuestion,
  isProgramQuestion,
  markProgramAnswered,
  multiSelectOf,
  ProgramMessageKind,
  updatePayload,
  type ProgramProposalPayload,
} from './messages';
import {
  bodyPartLabelKey,
  changeFlow,
  DAY_CHOICES,
  defaultTrainingDays,
  EMPTY_ANSWERS,
  experienceLabelKey,
  focusLabelKey,
  givesTarget,
  goalLabelKey,
  keyForBuild,
  kindLabelKey,
  lengthLabelKey,
  localRefusalCopyKey,
  MAX_INJURIES,
  newFlow,
  nextQuestion,
  oneOf,
  PROGRAM_BODY_PARTS,
  PROGRAM_EXPERIENCES,
  PROGRAM_FOCUSES,
  PROGRAM_GOALS,
  PROGRAM_KINDS,
  PROGRAM_LENGTHS,
  ProgramOptionValue,
  questionAnalyticsField,
  questionStepNumber,
  recordAnswer,
  recordBody,
  recordInjuries,
  recordKinds,
  recordSafety,
  recordTrainingDays as recordTrainingDaysAnswer,
  requestBody,
  SAFETY_OPTIONS,
  safetyLabelKey,
  safetySelected,
  type ProgramAnswers,
  type ProgramBodyPart,
  type ProgramEntry,
  type ProgramFlowState,
  type ProgramKind,
  type ProgramQuestion,
  type SafetyOption,
} from './model';
import { canConfirm, MAX_HINT_MS, toggleSelection, type ProgramMultiSelect } from './multiSelect';
import { presentBodySheet, presentDaysSheet, turnFeedbackFoodOff } from './platform';
import { weekdayListIn } from './summaryRows';

// ---------------------------------------------------------------------------
// State

/** The wizard in progress (iOS `programFlow`), or null. */
let flow: ProgramFlowState | null = null;
/**
 * Bumped whenever a flow begins or ends. A sheet's answer is taken only by
 * the run that opened it: a sign-out or a wipe while the body sheet is up
 * must not land its numbers in whatever comes next.
 */
let run = 0;
/** The "You can pick up to 3." timers, by message. */
const hintTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setFlow(next: ProgramFlowState | null): void {
  flow = next;
}

function endFlow(): void {
  flow = null;
  run += 1;
}

function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  return coachHost().t(key, params);
}

/** "Mon, Wed, Fri" in the Coach's language (iOS `weekdayList`). */
export function weekdayList(isoWeekdays: readonly number[]): string {
  return weekdayListIn(isoWeekdays, coachHost().language());
}

function chip(labelKey: string, value: string, params?: Readonly<Record<string, string | number>>): QuestionOption {
  return { label: t(labelKey, params), value };
}

// ---------------------------------------------------------------------------
// Entry points

export interface StartProgramOptions {
  readonly entry: ProgramEntry;
  /** The member's "Get a 4-week plan" bubble (off when a chip already said it). */
  readonly showUserBubble?: boolean;
  /** The end of a block: the finished block's answers become the starting point. */
  readonly previousProgramId?: string | null;
  /**
   * The loop fix. "Make a new plan" on the saved-proposal or running-plan
   * bubble used to start again with the gates on, and the same bubble came
   * back with the same chip, forever. The member has answered that gate by
   * tapping it, so the wizard starts.
   */
  readonly skipExistingPlanGates?: boolean;
}

/**
 * The empty state's chip, a typed request's offer, the Plan tab's intro
 * card, Home, the end of a block, and Adjust my plan's "start a new plan"
 * (iOS `startProgram(entry:showUserBubble:previousProgramId:skipExistingPlanGates:)`).
 */
export async function startProgram(options: StartProgramOptions): Promise<void> {
  const host = coachHost();
  if (host.isTyping()) return;
  host.abandonOpenQuestions();
  if (options.showUserBubble ?? true) appendProgramUser(t('coach.chip.program'));
  track('program_wizard_started', { entry: options.entry });

  const context = readProgramContext();

  // The access check comes BEFORE the first question, so nobody answers
  // eight questions to be told at the end that plans need a membership.
  switch (context.access) {
    case 'minor':
      // The under-18 answer is a statement, not an offer: no chip.
      appendProgramBubble('health.minor.body');
      return;
    case 'past_due':
      appendProgramQuestion(t('program.gate.past_due'), [chip('health.past_due.cta', ProgramOptionValue.gateAccount)]);
      return;
    case 'not_member':
    case 'unknown':
      appendProgramQuestion(t('program.gate.not_member'), [
        chip('plan.gate.cta_choose', ProgramOptionValue.gatePlans),
        chip('coach.chip.plan_day', ProgramOptionValue.planDay),
      ]);
      return;
    case 'pass_only':
      appendProgramQuestion(t('program.gate.pass'), [
        chip('plan.gate.cta_choose', ProgramOptionValue.gatePlans),
        chip('coach.chip.plan_day', ProgramOptionValue.planDay),
      ]);
      return;
    case 'company_inactive':
      appendProgramQuestion(t('program.gate.company'), [chip('plan.gate.cta_company', ProgramOptionValue.gateAccount)]);
      return;
    case 'entitled':
      break;
  }

  if (!context.hasConsent) {
    // iOS 2.5.6 answers with this bubble and the chip its copy promises
    // ("tap below when you're ready"); the chip runs this gate again.
    appendProgramQuestion(t('program.consent_skipped'), [chip('coach.chip.program', ProgramOptionValue.intentProgram)]);
    return;
  }

  if (!options.skipExistingPlanGates) {
    if (context.hasSavedProposal) {
      appendProgramQuestion(t('program.proposal_exists'), [
        chip('program.chip.review_saved', ProgramOptionValue.gateReviewSaved),
        chip('program.chip.make_new', ProgramOptionValue.gateMakeNew),
      ]);
      return;
    }
    if (context.hasLiveProgram) {
      if (canRevise(context)) {
        // A running plan can be adjusted rather than replaced (`SPEC` 6.6):
        // the gentler change is offered first.
        appendProgramQuestion(t('program.active_exists_adjust'), [
          chip('coach.chip.adjust_plan', ProgramOptionValue.adjustOpen),
          chip('program.chip.start_new', ProgramOptionValue.adjustNewPlan),
          chip('program.chip.open_plan', ProgramOptionValue.gatePlanTab),
        ]);
      } else {
        appendProgramQuestion(t('program.active_exists'), [
          chip('program.chip.open_plan', ProgramOptionValue.gatePlanTab),
          chip('program.chip.make_new', ProgramOptionValue.gateMakeNew),
        ]);
      }
      return;
    }
  }

  if (options.previousProgramId) {
    await beginNextBlock(options.previousProgramId, context);
  } else {
    beginProgramFlow(options.entry, context);
  }
}

/** The Plan tab, Home and the end of a block park an entry; this is where it lands (iOS `startProgram(parked:)`). */
export async function startParkedProgram(entry: CoachProgramEntry): Promise<void> {
  switch (entry.kind) {
    case 'planTab':
      return startProgram({ entry: 'plan_tab' });
    case 'home':
      return startProgram({ entry: 'chip' });
    case 'nextBlock':
      return startProgram({ entry: 'next_block', previousProgramId: entry.programId });
    case 'adjust':
      // Adjust my plan's own entry: the store hands it to that flow.
      return;
  }
}

/**
 * A typed request that asks for weeks rather than a day OFFERS the wizard
 * rather than starting it, because "a workout plan" is said by people who
 * mean a month and people who mean this evening. Costs nothing either way
 * (5.2). True when the words were taken.
 */
export function offerFromTyped(text: string, context: CoachStartContext): boolean {
  if (!programIntentMatches(text)) return false;
  context.abandonOpenQuestions();
  appendProgramUser(text);
  appendProgramQuestion(t('program.intent.offer'), [
    chip('coach.chip.program', ProgramOptionValue.intentProgram),
    chip('coach.chip.plan_day', ProgramOptionValue.intentDay),
  ]);
  return true;
}

/**
 * After a local safety refusal: turn food and weight out of the monthly
 * feedback and say so, in the health lane (`SPEC` 9.8). Only when the server
 * has the feedback, consent stands and the switch is on, or off only by
 * default (the context works that out; this file never sees a setting).
 * Adjust my plan (COACH-5) runs it on its own safety stop too.
 */
export function applyFeedbackSafetyHook(): void {
  if (!readProgramContext().turnsOffFeedbackFoodOnRefusal) return;
  void turnFeedbackFoodOff().catch(() => undefined);
  appendProgramBubble('program.refused.feedback_food_off');
}

/**
 * The member's plan changed on the server (a proposal was built, started or
 * discarded): the profile block and the Today read are read again (iOS
 * `onProgramStoreChanged`).
 */
export function programStoreChanged(): void {
  void (async () => {
    try {
      await useAppStore.getState().loadProfile();
      await useHealthStore.getState().load({ force: true });
    } catch {
      // Both reads keep what they had; the next appearance reads again.
    }
  })();
}

/** 5.7: the finished block's answers become the starting point; safety and body are asked again. */
async function beginNextBlock(previousProgramId: string, context: ProgramContext): Promise<void> {
  const host = coachHost();
  const busy = host.busy();
  try {
    let answers = EMPTY_ANSWERS;
    try {
      const detail = await fetchProgram(previousProgramId, host.language());
      if (!busy.isCurrent()) return;
      answers = prefillFrom(detail);
    } catch {
      // The block cannot be read: the wizard asks everything.
    }
    if (!busy.isCurrent()) return;
    // Safety answers are never stored, so question 5 is always asked again,
    // and the body sheet is offered again with the profile's own latest
    // values.
    beginProgramFlow('next_block', context, answers, previousProgramId, 'program.next.title');
  } finally {
    busy.end();
  }
}

/** The finished block's goal, focus, days, experience, length, places and weekdays. */
export function prefillFrom(detail: ProgramDetail): ProgramAnswers {
  const program = detail.program;
  let answers: ProgramAnswers = EMPTY_ANSWERS;
  const goal = oneOf(PROGRAM_GOALS, program.goal);
  if (goal) answers = { ...answers, goal };
  const focus = oneOf(PROGRAM_FOCUSES, program.focus);
  if (focus) answers = { ...answers, focus };
  if (program.daysPerWeek !== null) answers = { ...answers, daysPerWeek: program.daysPerWeek };
  const experience = oneOf(PROGRAM_EXPERIENCES, program.experience);
  if (experience) answers = { ...answers, experience };
  const weeks = oneOf<number>(PROGRAM_LENGTHS, program.weeks);
  if (weeks !== null) answers = { ...answers, weeks: weeks as ProgramAnswers['weeks'] };
  // As iOS reads it: the plan's kinds decode as session kinds, which share
  // no value with the places (`gym`, `pool`...), so in practice this keeps
  // nothing and the membership's places fill the row.
  const kinds = (program.kinds ?? []).flatMap((kind) => {
    const place = oneOf(PROGRAM_KINDS, kind);
    return place ? [place] : [];
  });
  if (kinds.length > 0) answers = { ...answers, kinds };
  if (program.trainingDays && program.trainingDays.length > 0) {
    answers = { ...answers, trainingDays: [...program.trainingDays], trainingDaysAnswered: true };
  }
  return answers;
}

function beginProgramFlow(
  entry: ProgramEntry,
  context: ProgramContext,
  answers: ProgramAnswers = EMPTY_ANSWERS,
  previousProgramId: string | null = null,
  titleKey: string | null = null,
): void {
  // Question 1's silent answers: four weeks, and every place the membership
  // covers (5.4). A next block that carried its own answer in keeps it.
  const withKinds = answers.kinds.length === 0 ? { ...answers, kinds: [...context.kinds] } : answers;
  run += 1;
  setFlow(newFlow(entry, withKinds, previousProgramId));
  if (titleKey) appendProgramBubble(titleKey);
  advance();
}

// ---------------------------------------------------------------------------
// Asking

function advance(): void {
  if (!flow) return;
  const next = nextQuestion(flow.answers);
  if (next) askQuestion(next);
  else appendProgramSummary();
}

function appendProgramSummary(): void {
  if (!flow) return;
  appendProgramSummaryMessage(flow.answers);
}

function multiSelect(
  question: ProgramQuestion,
  textKey: string,
  noteKey: string | null,
  options: ProgramMultiSelect['options'],
  maxSelection: number | null,
  selection: readonly string[],
): void {
  appendProgramMultiSelect({
    question,
    text: t(textKey),
    noteKey,
    options,
    maxSelection,
    selection,
    closed: false,
    showsMaxHint: false,
  });
}

function askQuestion(question: ProgramQuestion): void {
  const step = questionStepNumber(question);
  if (step !== null) track('program_wizard_step', { step });
  const answers = flow?.answers ?? EMPTY_ANSWERS;
  switch (question) {
    case 'goal':
      appendProgramQuestion(t('program.q.goal'), PROGRAM_GOALS.map((goal) => chip(goalLabelKey(goal), goal)));
      return;
    case 'focus':
      appendProgramQuestion(t('program.q.focus'), PROGRAM_FOCUSES.map((focus) => chip(focusLabelKey(focus), focus)));
      return;
    case 'days':
      appendProgramQuestion(
        t('program.q.days'),
        DAY_CHOICES.map((count) => chip('program.days_n', String(count), { count: String(count) })),
      );
      return;
    case 'experience':
      appendProgramQuestion(
        t('program.q.experience'),
        PROGRAM_EXPERIENCES.map((experience) => chip(experienceLabelKey(experience), experience)),
      );
      return;
    case 'length':
      appendProgramQuestion(t('program.q.length'), PROGRAM_LENGTHS.map((weeks) => chip(lengthLabelKey(weeks), String(weeks))));
      return;
    case 'safety':
      multiSelect(
        'safety',
        'program.q.safety',
        'program.q.safety_note',
        SAFETY_OPTIONS.map((option) => ({
          value: option,
          labelKey: safetyLabelKey(option),
          ...(option === 'nothing' ? { isExclusive: true } : {}),
        })),
        null,
        safetySelected(answers.safety),
      );
      return;
    case 'injuryWhere':
      multiSelect(
        'injuryWhere',
        'program.q.injury_where',
        null,
        PROGRAM_BODY_PARTS.map((part) => ({ value: part, labelKey: bodyPartLabelKey(part) })),
        MAX_INJURIES,
        answers.injuries,
      );
      return;
    case 'kinds':
      multiSelect(
        'kinds',
        'program.q.where',
        null,
        PROGRAM_KINDS.map((kind) => ({ value: kind, labelKey: kindLabelKey(kind) })),
        null,
        answers.kinds,
      );
      return;
    case 'body':
      appendProgramQuestion(t('program.q.body'), [
        chip('program.body.add', ProgramOptionValue.bodyAdd),
        chip('program.body.skip', ProgramOptionValue.bodySkip),
      ]);
      return;
    case 'trainingDays': {
      const count = answers.daysPerWeek ?? 3;
      const days = answers.trainingDays.length > 0 ? answers.trainingDays : defaultTrainingDays(count);
      appendProgramQuestion(t('program.q.training_days'), [
        chip('program.days.default_chip', ProgramOptionValue.daysDefault, { days: weekdayList(days) }),
        chip('program.days.choose', ProgramOptionValue.daysChoose),
      ]);
      return;
    }
  }
}

/**
 * Typed text while the wizard is in progress: the hint once, then the open
 * question again under it (5.4). The words themselves go nowhere.
 */
export function repeatOpenQuestion(): void {
  if (!flow) return;
  if (!flow.typedHintShown) {
    setFlow({ ...flow, typedHintShown: true });
    appendProgramBubble('program.typed_hint');
  }
  // Close whatever is open so only the repeat can answer.
  closeProgramQuestions(isProgramQuestion);
  advance();
}

// ---------------------------------------------------------------------------
// Answering

/** The Plan my day chip on a gate or a refusal (iOS `startPlan(labelKey: "coach.chip.plan_day")`). */
function startDayPlan(): void {
  const host = coachHost();
  if (host.isTyping()) return;
  host.abandonOpenQuestions();
  void dayPlanFlow.enter?.({ kind: 'chip', userText: t('coach.chip.plan_day') });
}

/** Question 6, or the refused target again: the body sheet in intake mode. */
function openBodyIntake(): void {
  if (!flow) return;
  const context = readProgramContext();
  const previous = flow.answers.body;
  const opener = run;
  presentBodySheet({
    kind: 'intake',
    prefill: {
      weightKg: previous?.weightKg ?? context.latestWeightKg,
      heightCm: previous?.heightCm ?? context.latestHeightCm,
      kennitalaVerified: context.isKennitalaVerified,
      goal: flow.answers.goal,
      target: context.standingTarget,
      details: previous,
    },
    onResult: (result: BodyIntakeResult) => {
      if (opener !== run) return;
      switch (result.kind) {
        case 'used':
          recordBodyDetails(result.details);
          return;
        case 'skipped':
          recordBodyDetails(null);
          return;
        case 'cancelled':
          cancelBodySheet();
          return;
      }
    },
  });
}

/** Question 7's "Choose days": the day picker, which hands the days back with no call. */
function openDaysPicker(): void {
  if (!flow) return;
  const count = flow.answers.daysPerWeek ?? 3;
  const selected = flow.answers.trainingDays.length > 0 ? flow.answers.trainingDays : defaultTrainingDays(count);
  const opener = run;
  presentDaysSheet({
    kind: 'select',
    daysPerWeek: count,
    selected,
    onPicked: (days) => {
      if (opener === run) recordTrainingDays(days);
    },
    onCancel: () => {
      if (opener === run) cancelDaysSheet();
    },
  });
}

/**
 * A chip on a programme question (iOS `selectProgramOption`). The store has
 * already refused a tap on a bubble that was answered: every chip answers
 * once, so a second quick tap never starts a second wizard or opens a second
 * menu.
 */
export async function selectProgramOption(messageId: string, value: string, label: string): Promise<void> {
  const host = coachHost();
  // Routing chips first: they are not answers and may arrive from a bubble
  // that belongs to no flow at all.
  if (value.startsWith(ProgramOptionValue.adjustPrefix)) {
    await selectAdjustGateOption(messageId, value, label);
    return;
  }

  switch (value) {
    case ProgramOptionValue.intentProgram:
      markProgramAnswered(messageId, label);
      await startProgram({ entry: 'intent', showUserBubble: false });
      return;
    case ProgramOptionValue.gateMakeNew: {
      // THE LOOP FIX (`SPEC` 6.6). This chip sits on the gate bubble that
      // `startProgram` draws, so it must not run that gate again.
      markProgramAnswered(messageId, label);
      const context = readProgramContext();
      const handoff = programAdjustHandoff();
      if (context.hasLiveProgram && canRevise(context) && handoff) {
        await handoff.begin(context, 'gate');
        return;
      }
      // Say what the new plan will do to the old one. A deleted plan's own
      // "Make a new one?" has neither to replace.
      if (context.hasLiveProgram) appendProgramBubble('program.make_new.replaces_running');
      else if (context.hasSavedProposal) appendProgramBubble('program.make_new.replaces_saved');
      await startProgram({ entry: 'intent', showUserBubble: false, skipExistingPlanGates: true });
      return;
    }
    case ProgramOptionValue.changeTarget:
      // A build refused over the target: the body sheet again, with
      // everything the wizard already has, so only the target changes.
      markProgramAnswered(messageId, label);
      openBodyIntake();
      return;
    case ProgramOptionValue.intentDay:
    case ProgramOptionValue.planDay:
      markProgramAnswered(messageId, label);
      startDayPlan();
      return;
    case ProgramOptionValue.gatePlans:
      markProgramAnswered(messageId, label);
      host.route({ kind: 'plans' });
      return;
    case ProgramOptionValue.gateAccount:
      markProgramAnswered(messageId, label);
      host.route({ kind: 'account' });
      return;
    case ProgramOptionValue.gatePlanTab:
      markProgramAnswered(messageId, label);
      host.route({ kind: 'planTab' });
      return;
    case ProgramOptionValue.gateReviewSaved:
      markProgramAnswered(messageId, label);
      host.route({ kind: 'savedProposal' });
      return;
    case ProgramOptionValue.openPastPlans:
      markProgramAnswered(messageId, label);
      host.route({ kind: 'pastPlans' });
      return;
    case ProgramOptionValue.tryAgain:
      markProgramAnswered(messageId, label);
      await submitProgram();
      return;
    case ProgramOptionValue.getFitterInstead: {
      markProgramAnswered(messageId, label);
      if (!flow) return;
      setFlow(changeFlow(flow, (answers) => recordAnswer(answers, 'get_fitter', 'goal')) ?? flow);
      appendProgramSummary();
      return;
    }
    default:
      break;
  }

  if (!flow) return;
  // Only an open question may answer: a leftover bubble from an abandoned
  // flow must not inject a value into this one.
  const message = host.messages().find((candidate) => candidate.id === messageId);
  if (!message || message.answered) return;

  const question = flow.editingQuestion ?? nextQuestion(flow.answers);

  switch (value) {
    case ProgramOptionValue.bodyAdd:
      markProgramAnswered(messageId, label);
      openBodyIntake();
      return;
    case ProgramOptionValue.bodySkip:
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      recordBodyDetails(null, false);
      return;
    case ProgramOptionValue.daysChoose:
      markProgramAnswered(messageId, label);
      openDaysPicker();
      return;
    case ProgramOptionValue.daysDefault: {
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      recordTrainingDays(defaultTrainingDays(flow.answers.daysPerWeek ?? 3), false);
      return;
    }
    default:
      break;
  }

  if (!question) return;
  const changed = changeFlow(flow, (answers) => recordAnswer(answers, value, question));
  if (!changed) return;
  setFlow(changed);
  markProgramAnswered(messageId, label);
  appendProgramUser(label);
  finishAnswer();
}

/**
 * The two chips the running-plan gate offers on a server that revises. Each
 * answers once (the store refuses a tap on an answered bubble).
 */
async function selectAdjustGateOption(messageId: string, value: string, label: string): Promise<void> {
  switch (value) {
    case ProgramOptionValue.adjustOpen: {
      const handoff = programAdjustHandoff();
      if (!handoff) return;
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      await handoff.begin(readProgramContext(), 'gate');
      return;
    }
    case ProgramOptionValue.adjustNewPlan:
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      appendProgramBubble('program.make_new.replaces_running');
      await startProgram({ entry: 'intent', showUserBubble: false, skipExistingPlanGates: true });
      return;
    default:
      // Every other `adjust.` chip is Adjust my plan's own (its bubbles carry `flow: 'adjust'`).
      return;
  }
}

/** What the member's bubble says after question 5: words, never a diagnosis (the refusing answers never reach it). */
function safetyLabel(options: ReadonlySet<SafetyOption>): string {
  return SAFETY_OPTIONS.filter((option) => options.has(option))
    .map((option) => t(safetyLabelKey(option)))
    .join(', ');
}

/** Question 5, 5b and the summary's "where" row: Continue. */
export function confirmMultiSelect(messageId: string): void {
  const message = coachHost().messages().find((candidate) => candidate.id === messageId);
  const state = multiSelectOf(message);
  if (!message || !state || state.closed || !canConfirm(state) || !flow) return;
  const close = () => closeProgramQuestions((candidate) => candidate.id === messageId);

  switch (state.question) {
    case 'safety': {
      const options = new Set(state.selection.flatMap((value) => {
        const option = oneOf(SAFETY_OPTIONS, value);
        return option ? [option] : [];
      }));
      const result = recordSafety(flow.answers, options);
      close();
      if (result.refusal) {
        // REFUSED ON THE PHONE. Nothing about this answer is recorded, sent
        // or counted: `program_refused_local` carries no params at all,
        // because which of the two it was is the health fact the screen
        // promised not to keep (C16, P9).
        track('program_refused_local');
        endFlow();
        if (result.refusal === 'pregnant') {
          // No chip: a day plan pairs days with hot tubs (P12).
          appendProgramBubble(localRefusalCopyKey(result.refusal));
        } else {
          appendProgramQuestion(t(localRefusalCopyKey(result.refusal)), [chip('coach.chip.plan_day', ProgramOptionValue.planDay)]);
        }
        applyFeedbackSafetyHook();
        return;
      }
      const recorded = result.answers;
      setFlow(changeFlow(flow, () => recorded) ?? flow);
      appendProgramUser(safetyLabel(options));
      finishAnswer();
      return;
    }
    case 'injuryWhere': {
      const parts = state.selection.flatMap((value) => {
        const part = oneOf(PROGRAM_BODY_PARTS, value);
        return part ? [part] : [];
      });
      const changed = changeFlow(flow, (answers) => recordInjuries(answers, parts));
      if (!changed) return;
      setFlow(changed);
      close();
      appendProgramUser(
        PROGRAM_BODY_PARTS.filter((part: ProgramBodyPart) => parts.includes(part))
          .map((part) => t(bodyPartLabelKey(part)))
          .join(', '),
      );
      finishAnswer();
      return;
    }
    case 'kinds': {
      const kinds = state.selection.flatMap((value) => {
        const kind = oneOf(PROGRAM_KINDS, value);
        return kind ? [kind] : [];
      });
      const changed = changeFlow(flow, (answers) => recordKinds(answers, kinds));
      if (!changed) return;
      setFlow(changed);
      close();
      appendProgramUser(
        PROGRAM_KINDS.filter((kind: ProgramKind) => kinds.includes(kind))
          .map((kind) => t(kindLabelKey(kind)))
          .join(', '),
      );
      finishAnswer();
      return;
    }
    default:
      return;
  }
}

/** A chip on a multi-select: toggled with the exclusivity and ceiling rules; over the ceiling, the hint for 3 s. */
export function toggleProgramOption(messageId: string, value: string): void {
  const message = coachHost().messages().find((candidate) => candidate.id === messageId);
  const state = multiSelectOf(message);
  if (!message || !state) return;
  const result = toggleSelection(state, value);
  if (result.accepted) {
    updatePayload<ProgramMultiSelect>(messageId, () => ({ ...result.state, showsMaxHint: false }));
    return;
  }
  // Over the ceiling: say so for three seconds and select nothing.
  updatePayload<ProgramMultiSelect>(messageId, (current) => ({ ...current, showsMaxHint: true }));
  const previous = hintTimers.get(messageId);
  if (previous) clearTimeout(previous);
  hintTimers.set(
    messageId,
    setTimeout(() => {
      hintTimers.delete(messageId);
      if (!coachHost().messages().some((candidate) => candidate.id === messageId)) return;
      updatePayload<ProgramMultiSelect>(messageId, (current) => ({ ...current, showsMaxHint: false }));
    }, MAX_HINT_MS),
  );
}

/**
 * The body sheet returned (question 6, or the summary's body row). NEVER the
 * numbers in a bubble: it says only that details were added, and that a
 * target was given, never which (5.4, question 6).
 */
export function recordBodyDetails(details: BodyDetails | null, announce = true): void {
  if (!flow) return;
  setFlow(changeFlow(flow, (answers) => recordBody(answers, details)) ?? flow);
  if (announce) {
    const key = details ? (givesTarget(details) ? 'program.body.added_target' : 'program.body.added') : 'program.body.skip';
    appendProgramUser(t(key));
  }
  finishAnswer();
}

/** The body sheet was closed without an answer: the question is asked again. */
export function cancelBodySheet(): void {
  if (!flow) return;
  advance();
}

/** The day picker returned (question 7). A picking the answers refuse asks again. */
export function recordTrainingDays(days: readonly number[], announce = true): void {
  if (!flow) return;
  const changed = changeFlow(flow, (answers) => recordTrainingDaysAnswer(answers, days));
  if (!changed) {
    advance();
    return;
  }
  setFlow(changed);
  if (announce) appendProgramUser(weekdayList(days));
  finishAnswer();
}

/** The day picker was cancelled. */
export function cancelDaysSheet(): void {
  if (!flow) return;
  advance();
}

/**
 * After any answer: an edit returns to the summary, a forward pass walks on.
 * One code path for both, because an edit that opens a follow-up (ticking "an
 * injury" in question 5) has to ask 5b before it goes back.
 */
function finishAnswer(): void {
  if (!flow) return;
  setFlow({ ...flow, editingQuestion: null });
  advance();
}

/** A summary row tapped: its question again, and a fresh summary once it is answered. */
export function editProgramRow(question: ProgramQuestion): void {
  if (!flow || coachHost().isTyping()) return;
  track('program_summary_row_edited', { field: questionAnalyticsField(question) });
  // The old summary stops answering the moment a new question opens.
  closeProgramQuestions((message) => message.flow === 'program' && message.kind === ProgramMessageKind.summary);
  setFlow({ ...flow, editingQuestion: question });
  askQuestion(question);
}

/** Start over: the same entry, the gates again (iOS `startProgramOver`). */
export function startProgramOver(): void {
  if (!flow) return;
  void startProgram({ entry: flow.entry, showUserBubble: false });
}

// ---------------------------------------------------------------------------
// Build (OP-10)

/** Build my plan, and Try again (iOS `submitProgram`). */
export async function submitProgram(): Promise<void> {
  const host = coachHost();
  if (!flow || host.isTyping()) return;
  track('program_build_tapped');

  // A free account has no plan to build (the programme is a membership
  // feature): the membership prompt, not a daily cap it does not have.
  if (host.freeLimitReached()) {
    appendProgramQuestion(t('coach.free.limit.body'), [chip('coach.free.limit.cta', ProgramOptionValue.gatePlans)]);
    return;
  }
  // The daily cap is already known to be spent: the call would only come
  // back 429, so it is not made and the answers are kept (5.10).
  if (host.limitReached()) {
    appendProgramQuestion(t('program.err.daily_cap'), [chip('program.chip.try_again', ProgramOptionValue.tryAgain)]);
    track('program_created', { outcome: 'daily_cap' });
    return;
  }
  const includeTarget = readProgramContext().supportsTargetWeight;
  const body = requestBody(flow.answers, flow.previousProgramId, includeTarget);
  if (!body) return;

  closeProgramQuestions((message) => message.flow === 'program' && message.kind === ProgramMessageKind.summary);

  const minted = keyForBuild(flow);
  setFlow(minted.flow);

  appendProgramBubble('program.building');
  const busy = host.busy();
  try {
    const response = await postProgramBuild(body, host.language(), minted.key);
    if (!busy.isCurrent()) return;
    applyBuiltProgram(response);
  } catch (error) {
    if (!busy.isCurrent()) return;
    if (isApiError(error)) {
      if (error.isCancellation) return;
      await handleBuildFailure(error, true, busy);
    } else {
      appendBuildError(NETWORK_FAILURE);
    }
  } finally {
    busy.end();
  }
}

function applyBuiltProgram(response: ProgramBuildResponse): void {
  // The key is cleared on every 201 and every 200 replay: the next build is
  // a new plan, never a replay of this one (5.4).
  if (flow) setFlow({ ...flow, idempotencyKey: null });
  track('program_created', { outcome: 'proposed' });
  const intro = response.program.program.intro?.trim() ?? '';
  if (intro) appendProgramBubble(null, intro);
  appendProposalMessage(response.program);
  // The proposal now exists on the server; Plan reads it from the Today
  // read, and the profile block carries `proposalId`.
  programStoreChanged();
}

async function handleBuildFailure(error: ApiError, allowSilentRetry: boolean, busy: CoachBusyToken): Promise<void> {
  const host = coachHost();
  // Two failures are resent once without telling the member, because there
  // is nothing for them to decide (5.5).
  const retry = allowSilentRetry && flow ? silentRetry(error, flow) : null;
  if (retry && flow) {
    const cleared: ProgramFlowState = {
      ...flow,
      idempotencyKey: null,
      previousProgramId: retry === 'previousGone' ? null : flow.previousProgramId,
    };
    const retryBody = requestBody(cleared.answers, cleared.previousProgramId, readProgramContext().supportsTargetWeight);
    setFlow(cleared);
    if (!retryBody) {
      appendBuildError(NETWORK_FAILURE);
      return;
    }
    const minted = keyForBuild(cleared);
    setFlow(minted.flow);
    try {
      const response = await postProgramBuild(retryBody, host.language(), minted.key);
      if (!busy.isCurrent()) return;
      applyBuiltProgram(response);
    } catch (retryError) {
      if (!busy.isCurrent()) return;
      if (isApiError(retryError)) {
        if (retryError.isCancellation) return;
        await handleBuildFailure(retryError, false, busy);
      } else {
        appendBuildError(NETWORK_FAILURE);
      }
    }
    return;
  }

  const plan = buildFailurePlan(error);
  if (plan.outcome) track('program_created', { outcome: plan.outcome });
  if (plan.targetRefused) track('target_weight_saved', { outcome: 'refused', surface: 'coach' });
  if (plan.appliesCoachLimit) host.applyCoachLimit(error, busy);
  if (plan.clearsKey && flow) setFlow({ ...flow, idempotencyKey: null });
  appendBuildError(plan);
  if (plan.thenSummary) appendProgramSummary();
}

function appendBuildError(plan: BuildFailurePlan): void {
  if (!plan.keepFlow) endFlow();
  if (plan.chips.length === 0) appendProgramBubble(plan.copyKey);
  else appendProgramQuestion(t(plan.copyKey), plan.chips.map((entry) => chip(entry.labelKey, entry.value)));
}

// ---------------------------------------------------------------------------
// The proposal card's outcomes

/**
 * Called by the proposal card once it knows what happened, so the card stays
 * collapsed through every redraw and a member who comes back to the Coach
 * sees what they did. Anything but "Not now" ends the wizard.
 */
export function setProposalOutcome(messageId: string, outcome: ProposalOutcome): void {
  if (!coachHost().messages().some((message) => message.id === messageId)) return;
  updatePayload<ProgramProposalPayload>(messageId, (payload) => ({ ...payload, outcome }));
  if (outcome !== 'saved') endFlow();
  programStoreChanged();
}

/** The proposal card changed the plan's days: redraw from the response. */
export function replaceProposal(messageId: string, detail: ProgramDetail): void {
  if (!coachHost().messages().some((message) => message.id === messageId)) return;
  updatePayload<ProgramProposalPayload>(messageId, (payload) => ({ ...payload, detail }));
}

// ---------------------------------------------------------------------------
// Lifecycle (the flow contract)

export function isProgramActive(): boolean {
  return flow !== null;
}

export function hasOpenProgramQuestion(): boolean {
  return flow !== null && coachHost().messages().some(isOpenProgramQuestion);
}

/**
 * Part of the store's `abandonOpenQuestions`: the wizard ends, and a
 * multi-select or a summary left open stops answering (the store closes the
 * chip questions itself).
 */
export function abandonProgram(): void {
  endFlow();
  closeProgramQuestions(
    (message) =>
      message.flow === 'program' &&
      (message.kind === ProgramMessageKind.multiSelect || message.kind === ProgramMessageKind.summary),
  );
}

/** Forget everything (sign-out, a new chat, a wipe). */
export function resetProgram(): void {
  endFlow();
  for (const timer of hintTimers.values()) clearTimeout(timer);
  hintTimers.clear();
}

/** Tests: the wizard's state. */
export function programFlowForTests(): ProgramFlowState | null {
  return flow;
}

/** Tests: a flow in a given state (a summary waiting for Build, say). */
export function setProgramFlowForTests(next: ProgramFlowState | null): void {
  run += 1;
  flow = next;
}
