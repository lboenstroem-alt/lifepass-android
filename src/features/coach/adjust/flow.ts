/* eslint lifepass/no-literal-copy: "error" */
/**
 * Adjust my plan (`SPEC` 6.7): the Android port of iOS `extension
 * CoachViewModel` "Adjust my plan" (ViewModels/CoachViewModel.swift).
 * ../flows/adjust.ts plugs it into COACH-1's store as the `adjust` flow.
 *
 * Tap to choose, NO AI: no model call, no Coach question, nothing typed is
 * read. Every bubble is `isHealth` (out of the saved chat, out of every model
 * request, wiped with the rest of the health data), and no bubble or chip
 * carries a weight: the numbers live on the sheets.
 *
 * THE SHAPE OF A RUN
 * 1. An entry: the empty state's "Adjust my plan", a feedback line's Adjust
 *    (both `startAdjust`), or a programme gate bubble's "Adjust my plan" or
 *    "Make a new plan" (`beginAdjust`, through COACH-4's handoff). Anything
 *    short of "entitled, tracking on, a plan running, a server that revises"
 *    is the wizard's own gate to answer.
 * 2. The menu, on the running plan from the Today read (or read itself):
 *    goal (and target), days a week, training days, length, a new plan
 *    instead, never mind.
 * 3. Each choice asks what it needs and comes back to a confirmation that
 *    says, one line per change, what would change. A change INTO lose or
 *    gain weight asks the safety question again first; a yes ends the flow
 *    on the phone and nothing is sent.
 * 4. The confirmation sends: a target alone is `PUT /health/target-weight`;
 *    anything else is a revision (`POST /health/programs/{id}/revise`) that
 *    lands as the proposal card in revision mode; the same number of days
 *    moved is saved by the day sheet itself.
 *
 * A key is kept for a retry and cleared by any change (./model.ts).
 */
import { isApiError } from '../../../api';
import { reviseProgram, setTargetWeight } from '../../../api/targetWeight';
import { fetchProgram, isLiveStatus, isTargetReached, knownDirection, type ProgramDetail } from '../../../health';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import type { QuestionOption } from '../../../types/coach';
import {
  appendProgramBubble,
  appendProgramQuestion,
  appendProgramUser,
  appendProposalMessage,
  applyFeedbackSafetyHook,
  isProgramQuestion,
  markProgramAnswered,
  programStoreChanged,
  readProgramContext,
  startProgram,
  weekdayList,
  type ProgramContext,
} from '../program';
import { closeProgramQuestions } from '../program/messages';
import {
  DAY_CHOICES,
  defaultTrainingDays,
  goalLabelKey,
  lengthLabelKey,
  PROGRAM_GOALS,
  PROGRAM_LENGTHS,
  targetDirection,
  type ProgramGoal,
  type ProgramLength,
} from '../program/model';
import { coachHost } from '../store/host';
import { isOpenQuestion, type CoachMessage } from '../store/messages';

import {
  networkFailure,
  OPEN_PLAN_CHIP,
  resendsRevision,
  revisionFailurePlan,
  targetFailurePlan,
  type AdjustChip,
  type AdjustFailurePlan,
} from './failure';
import {
  adjustCurrentFrom,
  AdjustOptionValue as V,
  changeAdjust,
  changeKinds,
  daysChange,
  effectiveDaysPerWeek,
  effectiveTrainingDays,
  effectiveWeeks,
  isEmpty,
  isTargetOnly,
  keyForSubmit,
  newAdjustFlow,
  parseAdjustAnswer,
  revisionInput,
  summaryLines,
  TARGET_REMOVE,
  TARGET_UNCHANGED,
  targetOnlyValue,
  targetSet,
  type AdjustChangeKind,
  type AdjustCurrent,
  type AdjustFlowState,
  type AdjustSummaryLine,
  type TargetChange,
} from './model';
import { presentDaysSheet, presentTargetSheet } from './platform';

// ---------------------------------------------------------------------------
// State

/** What the member has chosen so far, or null when no adjust flow is open (iOS `adjustFlow`). */
let flow: AdjustFlowState | null = null;
/** The question on screen, so typed text can repeat it under the hint (iOS `adjustOpenQuestion`). */
let openQuestion: { readonly text: string; readonly options: readonly QuestionOption[] } | null = null;
/** The typed-text hint is shown once per flow. */
let typedHintShown = false;
/**
 * Bumped whenever a flow begins or ends. A sheet's answer is taken only by
 * the run that opened it: a sign-out or a wipe while the target sheet is up
 * must not land its choice in whatever comes next.
 */
let run = 0;
/**
 * Bumped by `resetAdjust` alone: a sign-out, a new chat and the health data
 * wiped. A revision, a target save or a plan read still out then lands
 * nowhere. The wipe keeps the chat (only its health turns go), so the chat
 * generation alone would let the proposal card, a "Saved." or the menu back
 * into the chat the member just cleared (the same rule COACH-4 keeps for a
 * build).
 */
let resets = 0;

function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  return coachHost().t(key, params);
}

function chip(labelKey: string, value: string, params?: Readonly<Record<string, string | number>>): QuestionOption {
  return { label: t(labelKey, params), value };
}

function chipsOf(chips: readonly AdjustChip[]): QuestionOption[] {
  return chips.map((entry) => chip(entry.labelKey, entry.value));
}

function setFlow(next: AdjustFlowState): void {
  flow = next;
}

/** Applies a change through the key rule (`changeAdjust`). */
function change(mutate: (current: AdjustFlowState) => AdjustFlowState): void {
  if (flow) flow = changeAdjust(flow, mutate);
}

/** The flow ends: answered, cancelled, abandoned or wiped (iOS `endAdjustFlow`). */
function endAdjustFlow(): void {
  flow = null;
  openQuestion = null;
  typedHintShown = false;
  run += 1;
}

// ---------------------------------------------------------------------------
// Bubbles

/** A question this flow asks: a tap on it comes back to the `adjust` flow. */
function appendAdjustQuestion(text: string, options: readonly QuestionOption[]): void {
  openQuestion = { text, options };
  coachHost().append({ role: 'assistant', text, options, isHealth: true, flow: 'adjust' });
}

/**
 * A problem bubble: with chips when there is something to tap, as the flow's
 * open question while the flow is still open, else as a programme question
 * that outlives it (its gate chips, Open Plan or See memberships, are the
 * wizard's to answer).
 */
function appendAdjustProblem(key: string, chips: readonly AdjustChip[]): void {
  if (chips.length === 0) appendProgramBubble(key);
  else if (flow) appendAdjustQuestion(t(key), chipsOf(chips));
  else appendProgramQuestion(t(key), chipsOf(chips));
}

/** Every open adjust question, and every open programme one (iOS closes every `isProgramQuestion`). */
function closeOpenQuestions(): void {
  const host = coachHost();
  for (const message of host.messages()) {
    if (message.flow === 'adjust' && isOpenQuestion(message)) host.update(message.id, (current) => ({ ...current, answered: true }));
  }
  closeProgramQuestions(isProgramQuestion);
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * The empty state's "Adjust my plan" chip, and a monthly feedback line's
 * Adjust (iOS `startAdjust`). The store has refused a tap while a reply is in
 * flight and abandoned every open question first. `userText` is the chip's
 * label: nothing from a report comes with it.
 */
export async function startAdjust(userText: string): Promise<void> {
  const host = coachHost();
  if (host.isTyping()) return;
  appendProgramUser(userText);
  const context = readProgramContext();
  // Anything short of "entitled, tracking on, a plan running, a server that
  // revises" is the wizard's own gate to answer, in its own words.
  if (context.access !== 'entitled' || !context.hasConsent || !context.hasLiveProgram || !context.supportsPlanRevision) {
    await startProgram({ entry: 'chip', showUserBubble: false });
    return;
  }
  await beginAdjust(context, 'chip');
}

/**
 * Opens the menu on the running plan (iOS `beginAdjust`). `entry` is the
 * analytics word: `chip` (the empty state, a feedback line) or `gate` (a
 * bubble that offered it).
 */
export async function beginAdjust(context: ProgramContext, entry: 'chip' | 'gate'): Promise<void> {
  track('program_adjust_started', { entry });
  endAdjustFlow();
  const live = context.liveProgram;
  if (live && isLiveStatus(live.status)) {
    const current = adjustCurrentFrom(live);
    if (current) {
      openAdjust(live.id, current);
      return;
    }
  }
  // The Today read has not answered yet: read the plan itself.
  const programId = context.liveProgramId ?? live?.id ?? null;
  if (!programId) {
    appendAdjustProblem('program.adjust.err.changed', [OPEN_PLAN_CHIP]);
    return;
  }
  const host = coachHost();
  const busy = host.busy();
  const opened = resets;
  try {
    let detail: ProgramDetail | null = null;
    try {
      detail = await fetchProgram(programId, host.language());
    } catch {
      detail = null;
    }
    if (!busy.isCurrent() || opened !== resets) return;
    const program = detail?.program ?? null;
    // A plan with no status is taken as the one the profile says is live; a
    // plan that has ended, finished or been replaced meanwhile is not.
    const current = program && (program.status === null || isLiveStatus(program.status)) ? adjustCurrentFrom(program) : null;
    if (!program || !current) {
      appendAdjustProblem('program.adjust.err.changed', [OPEN_PLAN_CHIP]);
      return;
    }
    openAdjust(program.id, current);
  } finally {
    busy.end();
  }
}

function openAdjust(programId: string, current: AdjustCurrent): void {
  flow = newAdjustFlow(programId, current);
  openQuestion = null;
  typedHintShown = false;
  run += 1;
  showAdjustMenu();
}

// ---------------------------------------------------------------------------
// The menu

function showAdjustMenu(): void {
  if (!flow) return;
  const context = readProgramContext();
  let text = t('program.adjust.title');
  const summary = flow.current.summaryTitle?.trim() ?? '';
  if (summary) text += `\n${t('program.adjust.now', { summary })}`;
  appendAdjustQuestion(text, [
    chip(context.supportsTargetWeight ? 'program.adjust.opt.goal' : 'program.adjust.opt.goal_only', V.goal),
    chip('program.adjust.opt.days', V.days),
    chip('program.adjust.opt.weekdays', V.weekdays),
    chip('program.adjust.opt.length', V.length),
    chip('program.adjust.opt.new_plan', V.newPlan),
    chip('program.adjust.opt.cancel', V.cancel),
  ]);
}

// ---------------------------------------------------------------------------
// Answering

/**
 * Every `adjust.` chip lands here (iOS `selectAdjustOption`). The store has
 * already refused a tap on a bubble that was answered: every chip answers
 * once, so a second quick tap never opens a second menu or says "replaces
 * your plan" twice.
 */
export async function selectAdjustOption(messageId: string, value: string, label: string): Promise<void> {
  const host = coachHost();
  const message = host.messages().find((candidate) => candidate.id === messageId);

  // The two chips a gate bubble offers belong to no flow yet. "Start a new
  // plan instead" on the menu is the second of them.
  switch (value) {
    case V.open:
      if (!message || message.answered) return;
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      await beginAdjust(readProgramContext(), 'gate');
      return;
    case V.newPlan:
      if (!message || message.answered) return;
      markProgramAnswered(messageId, label);
      appendProgramUser(label);
      endAdjustFlow();
      appendProgramBubble('program.make_new.replaces_running');
      await startProgram({ entry: 'intent', showUserBubble: false, skipExistingPlanGates: true });
      return;
    default:
      break;
  }

  // Only the open question of the open flow may answer: a chip left on an
  // abandoned bubble must not change a later flow.
  if (!flow || !message || message.answered) return;
  markProgramAnswered(messageId, label);
  appendProgramUser(label);
  openQuestion = null;

  switch (value) {
    case V.cancel:
      appendProgramBubble('program.adjust.cancelled');
      endAdjustFlow();
      return;
    case V.more:
      showAdjustMenu();
      return;
    case V.goal:
      askAdjustGoal();
      return;
    case V.days:
      askAdjustDays();
      return;
    case V.weekdays:
      openAdjustWeekdays();
      return;
    case V.length:
      askAdjustLength();
      return;
    case V.safetyOk:
      adjustSafetyCleared();
      return;
    case V.safetyStop:
      // REFUSED ON THE PHONE, as in the wizard: nothing is sent, stored or
      // counted beyond the bare event (`SPEC` D16). Which of the two it was
      // is the health fact the question promised not to keep.
      track('program_refused_local');
      appendProgramBubble('program.adjust.safety_stop');
      applyFeedbackSafetyHook();
      endAdjustFlow();
      return;
    case V.targetSet: {
      const goal = flow.pendingGoal;
      if (!goal) {
        showAdjustMenu();
        return;
      }
      openTargetPicker(goal);
      return;
    }
    case V.targetKeep:
      recordAdjustTarget(TARGET_UNCHANGED);
      return;
    case V.targetNone:
      adjustNoTarget();
      return;
    case V.weekdaysDefault: {
      const days = defaultTrainingDays(effectiveDaysPerWeek(flow));
      change((current) => ({ ...current, trainingDays: days }));
      showAdjustConfirmation();
      return;
    }
    case V.weekdaysChoose:
      openDaysPicker();
      return;
    case V.show:
      await submitRevision();
      return;
    case V.saveTarget:
      await submitTargetOnly();
      return;
    default: {
      const answer = parseAdjustAnswer(value);
      switch (answer?.kind) {
        case 'goal':
          adjustGoalChosen(answer.goal);
          return;
        case 'days':
          adjustDaysChosen(answer.days);
          return;
        case 'length':
          adjustLengthChosen(answer.length);
          return;
        default:
          showAdjustMenu();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Goal and target weight

function askAdjustGoal(): void {
  appendAdjustQuestion(
    t('program.adjust.q.goal'),
    PROGRAM_GOALS.map((goal) => chip(goalLabelKey(goal), V.goalPrefix + goal)),
  );
}

function adjustGoalChosen(goal: ProgramGoal): void {
  if (!flow) return;
  const context = readProgramContext();
  const takesTarget = targetDirection(goal) !== null;
  // A new goal answer starts its target over: a target chosen for the other
  // goal no longer means anything.
  change((current) => ({ ...current, target: TARGET_UNCHANGED, pendingGoal: goal }));

  if (goal === flow.current.goal) {
    // The plan's own goal: only its target can change.
    if (!takesTarget || !context.supportsTargetWeight) {
      change((current) => ({ ...current, goal: null, pendingGoal: null }));
      appendProgramBubble('program.adjust.same_goal');
      showAdjustMenu();
      return;
    }
    change((current) => ({ ...current, goal: null }));
    askAdjustTarget(goal);
    return;
  }
  if (!takesTarget) {
    commitAdjustGoal(goal);
    return;
  }
  // INTO lose or gain from another goal: the two safety answers are never
  // stored, so they are asked again, here, and never sent.
  appendAdjustQuestion(t('program.adjust.q.safety'), [
    chip('program.adjust.safety.no', V.safetyOk),
    chip('program.adjust.safety.yes', V.safetyStop),
  ]);
}

function adjustSafetyCleared(): void {
  const goal = flow?.pendingGoal ?? null;
  if (!goal) {
    showAdjustMenu();
    return;
  }
  if (readProgramContext().supportsTargetWeight) askAdjustTarget(goal);
  else commitAdjustGoal(goal);
}

/**
 * Set, keep or none. "Keep my current target" only when the standing target
 * points the same way as the goal and has not been reached.
 */
function askAdjustTarget(goal: ProgramGoal): void {
  const standing = readProgramContext().standingTarget;
  const options = [chip('program.adjust.target.set', V.targetSet)];
  if (standing && knownDirection(standing) === targetDirection(goal) && !isTargetReached(standing)) {
    options.push(chip('program.adjust.target.keep', V.targetKeep));
  }
  options.push(chip('program.adjust.target.none', V.targetNone));
  appendAdjustQuestion(t('program.adjust.q.target'), options);
}

/** "Set a target weight": the sheet in pick mode. Nothing is sent from it; the Coach confirms first. */
function openTargetPicker(goal: ProgramGoal): void {
  const opener = run;
  presentTargetSheet({
    kind: 'pick',
    goal,
    existing: readProgramContext().standingTarget,
    onPicked: (kg) => {
      if (opener === run) recordAdjustTarget(targetSet(kg));
    },
    onRemove: () => {
      if (opener === run) recordAdjustTarget(TARGET_REMOVE);
    },
    onCancel: () => {
      if (opener === run) cancelAdjustTargetPicker();
    },
  });
}

/**
 * "No target": with a new goal, the plan the member switches to clears the
 * standing target; with the same goal, the standing target is removed on its
 * own, if there is one to remove. With the same goal and no target stored,
 * the target is simply left out: whatever else was chosen goes to its
 * confirmation, and with nothing else it is "nothing to update".
 */
function adjustNoTarget(): void {
  const goal = flow?.pendingGoal ?? null;
  if (!flow || !goal) {
    showAdjustMenu();
    return;
  }
  if (goal === flow.current.goal && readProgramContext().standingTarget === null) {
    recordAdjustTarget(TARGET_UNCHANGED);
    return;
  }
  recordAdjustTarget(TARGET_REMOVE);
}

/** The target sheet (pick mode) returned, or keep / no target was tapped. */
export function recordAdjustTarget(target: TargetChange): void {
  const goal = flow?.pendingGoal ?? null;
  if (!flow || !goal) return;
  change((current) => ({ ...current, target }));
  commitAdjustGoal(goal);
}

/** The target sheet was closed without a choice: ask again. */
export function cancelAdjustTargetPicker(): void {
  const goal = flow?.pendingGoal ?? null;
  if (goal) askAdjustTarget(goal);
}

function commitAdjustGoal(goal: ProgramGoal): void {
  change((current) => ({ ...current, goal: goal === current.current.goal ? null : goal, pendingGoal: null }));
  showAdjustConfirmation();
}

// ---------------------------------------------------------------------------
// Days, weekdays, length

function askAdjustDays(): void {
  if (!flow) return;
  const now = effectiveDaysPerWeek(flow);
  appendAdjustQuestion(
    t('program.adjust.q.days'),
    DAY_CHOICES.filter((count) => count !== now).map((count) =>
      chip('program.days_n', V.daysPrefix + String(count), { count: String(count) }),
    ),
  );
}

function adjustDaysChosen(days: number): void {
  if (!flow) return;
  change((current) => ({
    ...current,
    daysPerWeek: days === current.current.daysPerWeek ? null : days,
    trainingDays: null,
  }));
  if (!flow || !daysChange(flow)) {
    showAdjustConfirmation();
    return;
  }
  askAdjustWeekdays();
}

function askAdjustWeekdays(): void {
  if (!flow) return;
  const defaults = defaultTrainingDays(effectiveDaysPerWeek(flow));
  appendAdjustQuestion(t('program.adjust.q.weekdays'), [
    chip('program.days.default_chip', V.weekdaysDefault, { days: weekdayList(defaults) }),
    chip('program.days.choose', V.weekdaysChoose),
  ]);
}

/** "Choose days" for a new count: the day picker, which hands the days back with no call. */
function openDaysPicker(): void {
  if (!flow) return;
  const opener = run;
  presentDaysSheet({
    kind: 'select',
    daysPerWeek: effectiveDaysPerWeek(flow),
    selected: [...effectiveTrainingDays(flow)],
    onPicked: (days) => {
      if (opener === run) recordAdjustWeekdays(days);
    },
    onCancel: () => {
      if (opener === run) cancelAdjustDaysPicker();
    },
  });
}

/**
 * "Training days": the same number of days on other weekdays is a plain
 * OP-14 save, made by the day sheet's own Save (that Save is the
 * confirmation). With a new count already chosen, it picks the new count's
 * days instead, for the revision.
 */
function openAdjustWeekdays(): void {
  if (!flow) return;
  if (daysChange(flow)) {
    openDaysPicker();
    return;
  }
  const opener = run;
  presentDaysSheet({
    kind: 'program',
    programId: flow.programId,
    daysPerWeek: flow.current.daysPerWeek,
    selected: [...flow.current.trainingDays],
    onSaved: (saved) => {
      if (opener === run) adjustWeekdaysSaved(saved.days);
    },
    onChanged: () => {
      if (opener === run) adjustPlanChangedElsewhere();
    },
    onCancel: () => {
      if (opener === run) cancelAdjustWeekdays();
    },
  });
}

/** The day picker returned the weekdays for a new count. A picking that does not fit asks again. */
export function recordAdjustWeekdays(days: readonly number[]): void {
  if (!flow) return;
  const picked = [...new Set(days)].sort((a, b) => a - b);
  if (picked.length !== effectiveDaysPerWeek(flow) || !picked.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    askAdjustWeekdays();
    return;
  }
  change((current) => ({ ...current, trainingDays: picked }));
  appendProgramUser(weekdayList(picked));
  showAdjustConfirmation();
}

export function cancelAdjustDaysPicker(): void {
  if (flow) askAdjustWeekdays();
}

/** The day sheet saved the running plan's weekdays through OP-14. */
export function adjustWeekdaysSaved(days: readonly number[]): void {
  if (!flow) return;
  track('program_adjust_submitted', { change: 'weekdays' satisfies AdjustChangeKind });
  appendProgramBubble(null, t('program.adjust.days_saved', { days: weekdayList(days) }));
  programStoreChanged();
  const saved = [...new Set(days)].sort((a, b) => a - b);
  // The plan the flow measures against moved: not a change of the request.
  setFlow({ ...flow, current: { ...flow.current, trainingDays: saved } });
  if (isEmpty(flow)) endAdjustFlow();
  else showAdjustConfirmation();
}

/** The day sheet was closed without saving: back to the menu. */
export function cancelAdjustWeekdays(): void {
  if (flow) showAdjustMenu();
}

/** The day sheet's save found the plan changed under it. */
export function adjustPlanChangedElsewhere(): void {
  if (!flow) return;
  endAdjustFlow();
  appendAdjustProblem('program.adjust.err.changed', [OPEN_PLAN_CHIP]);
  programStoreChanged();
}

function askAdjustLength(): void {
  if (!flow) return;
  const now = effectiveWeeks(flow);
  appendAdjustQuestion(
    t('program.adjust.q.length'),
    PROGRAM_LENGTHS.filter((weeks) => weeks !== now).map((weeks) => chip(lengthLabelKey(weeks), V.lengthPrefix + String(weeks))),
  );
}

function adjustLengthChosen(length: ProgramLength): void {
  change((current) => ({ ...current, weeks: length === current.current.weeks ? null : length }));
  showAdjustConfirmation();
}

// ---------------------------------------------------------------------------
// Confirmation

function showAdjustConfirmation(): void {
  if (!flow) return;
  if (isEmpty(flow)) {
    appendProgramBubble('program.adjust.nothing');
    showAdjustMenu();
    return;
  }
  if (isTargetOnly(flow)) {
    appendAdjustQuestion(
      t(flow.target.kind === 'remove' ? 'program.adjust.confirm_target_remove' : 'program.adjust.confirm_target'),
      [chip('program.adjust.save_target', V.saveTarget), chip('common.cancel', V.cancel)],
    );
    return;
  }
  const lines = [t('program.adjust.confirm'), ...summaryLines(flow).map(renderAdjustLine), t('program.adjust.confirm_note')];
  if (readProgramContext().hasSavedProposal) lines.push(t('program.adjust.replaces_saved'));
  appendAdjustQuestion(lines.join('\n'), [
    chip('program.adjust.show', V.show),
    chip('program.adjust.change_more', V.more),
    chip('program.adjust.opt.cancel', V.cancel),
  ]);
}

/** One confirmation line in the Coach's language. */
export function renderAdjustLine(line: AdjustSummaryLine): string {
  const params: Record<string, string> = { ...line.params };
  for (const [placeholder, key] of Object.entries(line.paramKeys)) params[placeholder] = t(key);
  if (line.weekdays) params.days = weekdayList(line.weekdays);
  return t(line.key, params);
}

// ---------------------------------------------------------------------------
// Sending

/**
 * "Show me the updated plan": `POST /health/programs/{id}/revise`. The key is
 * minted here and kept for "Try again", so a retry never makes a second
 * revision.
 */
export async function submitRevision(): Promise<void> {
  const host = coachHost();
  if (!flow || host.isTyping()) return;
  if (!readProgramContext().supportsPlanRevision) {
    adjustUnsupported();
    return;
  }
  const input = revisionInput(flow);
  if (!input) {
    appendProgramBubble('program.adjust.nothing');
    showAdjustMenu();
    return;
  }
  let minted = keyForSubmit(flow);
  setFlow(minted.flow);
  const { programId } = minted.flow;
  const kinds = changeKinds(minted.flow);

  appendProgramBubble('program.adjust.building');
  const busy = host.busy();
  const opened = resets;
  const stillHere = () => busy.isCurrent() && opened === resets;
  let resentOnce = false;
  try {
    for (;;) {
      try {
        const response = await reviseProgram(programId, input, minted.key, host.language());
        if (!stillHere()) return;
        applyRevision(response.program, kinds);
        return;
      } catch (error) {
        if (!stillHere()) return;
        if (!isApiError(error)) {
          carryOut(networkFailure(V.show));
          return;
        }
        if (error.isCancellation) return;
        // A key the server has already spent (on a build, or on a revision
        // since discarded): nothing for the member to decide, so it is resent
        // once under a new key.
        if (!resentOnce && resendsRevision(error)) {
          resentOnce = true;
          minted = keyForSubmit({ ...minted.flow, idempotencyKey: null });
          setFlow(minted.flow);
          continue;
        }
        carryOut(revisionFailurePlan(error));
        return;
      }
    }
  } finally {
    busy.end();
  }
}

function applyRevision(program: ProgramDetail, kinds: readonly AdjustChangeKind[]): void {
  for (const kind of kinds) track('program_adjust_submitted', { change: kind });
  endAdjustFlow();
  const intro = program.program.intro?.trim() ?? '';
  if (intro) appendProgramBubble(null, intro);
  // The same card a build lands as, in revision mode (`SPEC` 6.8).
  appendProposalMessage(program);
  programStoreChanged();
}

/**
 * "Yes, save it" on a target-only change: `PUT /health/target-weight`. The
 * plan and its workouts stay exactly as they are.
 */
export async function submitTargetOnly(): Promise<void> {
  const host = coachHost();
  if (!flow || host.isTyping()) return;
  const value = targetOnlyValue(flow);
  if (value === undefined) return;
  if (!readProgramContext().supportsTargetWeight) {
    adjustUnsupported();
    return;
  }
  const minted = keyForSubmit(flow);
  setFlow(minted.flow);

  const busy = host.busy();
  const opened = resets;
  const stillHere = () => busy.isCurrent() && opened === resets;
  try {
    const response = await setTargetWeight(value, minted.key, host.language());
    if (!stillHere()) return;
    useAppStore.getState().noteServerFeatures(response.features);
    track('program_adjust_submitted', { change: 'target' });
    track('target_weight_saved', { outcome: value === null ? 'cleared' : 'set', surface: 'coach' });
    endAdjustFlow();
    appendProgramBubble(value === null ? 'program.adjust.target_removed' : 'program.adjust.target_saved');
    programStoreChanged();
  } catch (error) {
    if (!stillHere()) return;
    if (!isApiError(error)) {
      carryOut(networkFailure(V.saveTarget));
      return;
    }
    if (error.isCancellation) return;
    carryOut(targetFailurePlan(error));
  } finally {
    busy.end();
  }
}

/** A failure table row, carried out in the order ./failure.ts gives. */
function carryOut(failure: AdjustFailurePlan): void {
  if (failure.unsupported) {
    adjustUnsupported();
    return;
  }
  if (failure.targetRefused) track('target_weight_saved', { outcome: 'refused', surface: 'coach' });
  if (failure.endsFlow) endAdjustFlow();
  appendAdjustProblem(failure.copyKey, failure.chips);
  if (failure.thenMenu) showAdjustMenu();
  if (failure.storeChanged) programStoreChanged();
}

/**
 * The route answered 404 as a missing PAGE, not a problem: the server was
 * rolled back after its features were read. Hide what they gated.
 */
function adjustUnsupported(): void {
  useAppStore.getState().clearServerFeatures();
  endAdjustFlow();
  appendProgramBubble('program.err.network');
}

// ---------------------------------------------------------------------------
// Typed text

/**
 * Typed text while the flow is open: the hint once, then the open question
 * again, exactly as the wizard does. The words themselves go nowhere.
 */
export function repeatOpenAdjustQuestion(): void {
  if (!flow) return;
  if (!typedHintShown) {
    typedHintShown = true;
    appendProgramBubble('program.typed_hint');
  }
  const open = openQuestion;
  if (!open) return;
  closeOpenQuestions();
  appendAdjustQuestion(open.text, open.options);
}

// ---------------------------------------------------------------------------
// Lifecycle (the flow contract)

export function isAdjustActive(): boolean {
  return flow !== null;
}

export function hasOpenAdjustQuestion(): boolean {
  return flow !== null && coachHost().messages().some((message: CoachMessage) => message.flow === 'adjust' && isOpenQuestion(message));
}

/** Part of the store's `abandonOpenQuestions`: the flow ends (the store closes the chip questions itself). */
export function abandonAdjust(): void {
  endAdjustFlow();
}

/** Forget everything (sign-out, a new chat, a wipe): a call still out lands nowhere. */
export function resetAdjust(): void {
  resets += 1;
  endAdjustFlow();
}

/** Tests: the flow's state. */
export function adjustFlowForTests(): AdjustFlowState | null {
  return flow;
}
