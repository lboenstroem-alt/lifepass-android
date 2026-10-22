/**
 * Adjust my plan (`SPEC` 6.7): the Coach's tap-to-choose way to change the
 * running plan. The Android port of iOS Models/CoachAdjustFlow.swift.
 *
 * NO AI: nothing here reaches the model, nothing is typed, and every answer
 * is a chip value.
 *
 * What each choice calls (`SPEC` 5.5):
 *
 * - the target weight alone        -> PUT /health/target-weight
 * - the goal, days a week, length  -> POST /health/programs/{id}/revise, a
 *                                     REVISION proposal the member switches to
 *                                     (no Coach question, its own cap)
 * - the same number of days, moved -> POST /health/programs/{id} (OP-14)
 *
 * Nothing changes until the member confirms: a revision is a proposal that
 * waits on "Switch to this plan", and a target is saved only on "Yes, save
 * it". Like the wizard, every bubble this flow adds is `isHealth`, and no
 * bubble or chip ever carries a weight: "Target weight: a new target", never
 * which one. That is why `summaryLines` hands back copy KEYS and the plan's
 * own numbers of days and weeks, and never a body value.
 *
 * Everything here is immutable: where iOS mutates the struct in place, a
 * change here returns a new state. `changeAdjust` is the one place a change
 * can clear the Idempotency-Key.
 */
import { newIdempotencyKey } from '../../../api';
import { roundTargetKg, type ProgramRevisionInput } from '../../../api/targetWeight';
import type { ProgramSummary } from '../../../health';
import {
  DAY_CHOICES,
  defaultTrainingDays,
  goalLabelKey,
  oneOf,
  PROGRAM_GOALS,
  PROGRAM_LENGTHS,
  targetDirection,
  type ProgramGoal,
  type ProgramLength,
} from '../program/model';

// ---------------------------------------------------------------------------
// Where the flow starts

/** The running plan's answers when the flow opened (iOS `AdjustFlow.Current`). */
export interface AdjustCurrent {
  readonly goal: ProgramGoal | null;
  readonly daysPerWeek: number;
  /** ISO weekdays, 1 = Monday, sorted. */
  readonly trainingDays: readonly number[];
  readonly weeks: ProgramLength | null;
  /** Server copy ("Lose weight, 3 days a week"), for the menu's "Now:". */
  readonly summaryTitle: string | null;
}

/**
 * From the live plan the Today read (or `GET /health/programs/{id}`) answered
 * with. Null when it lacks the days, which every live plan has. A plan with
 * no weekdays of its own trains on the defaults for its count.
 */
export function adjustCurrentFrom(
  program: Pick<ProgramSummary, 'goal' | 'daysPerWeek' | 'trainingDays' | 'weeks' | 'summaryTitle'>,
): AdjustCurrent | null {
  const days = program.daysPerWeek;
  if (days === null) return null;
  const trainingDays = [...(program.trainingDays ?? [])].sort((a, b) => a - b);
  return {
    goal: oneOf(PROGRAM_GOALS, program.goal),
    daysPerWeek: days,
    trainingDays: trainingDays.length === 0 ? defaultTrainingDays(days) : trainingDays,
    weeks: oneOf<number>(PROGRAM_LENGTHS, program.weeks) as ProgramLength | null,
    summaryTitle: program.summaryTitle,
  };
}

// ---------------------------------------------------------------------------
// The target

/** What happens to the standing target (iOS `AdjustFlow.TargetChange`). */
export type TargetChange =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'set'; readonly kg: number }
  | { readonly kind: 'remove' };

export const TARGET_UNCHANGED: TargetChange = { kind: 'unchanged' };
export const TARGET_REMOVE: TargetChange = { kind: 'remove' };
export const targetSet = (kg: number): TargetChange => ({ kind: 'set', kg });

/** Value equality (Swift's `TargetChange: Equatable`). */
export function sameTargetChange(a: TargetChange, b: TargetChange): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'set' || a.kg === (b as { readonly kg: number }).kg;
}

// ---------------------------------------------------------------------------
// The flow

/** The kind of change, for `program_adjust_submitted` (`change`): fixed words only. */
export const ADJUST_CHANGE_KINDS = ['goal', 'days', 'weekdays', 'length', 'target'] as const;
export type AdjustChangeKind = (typeof ADJUST_CHANGE_KINDS)[number];

/**
 * What the adjust flow has been told so far, measured against the running
 * plan it started from (iOS `AdjustFlow`). A null field is "unchanged".
 */
export interface AdjustFlowState {
  readonly programId: string;
  readonly current: AdjustCurrent;
  readonly goal: ProgramGoal | null;
  readonly daysPerWeek: number | null;
  readonly trainingDays: readonly number[] | null;
  readonly weeks: ProgramLength | null;
  readonly target: TargetChange;
  /**
   * A goal chosen but not yet confirmed: it waits on the safety question and
   * the target question before it becomes `goal`.
   */
  readonly pendingGoal: ProgramGoal | null;
  /**
   * Minted at "Show me the updated plan" (or "Yes, save it"), kept for a
   * retry of the same request, cleared by any change (`changeAdjust`).
   */
  readonly idempotencyKey: string | null;
}

export function newAdjustFlow(programId: string, current: AdjustCurrent): AdjustFlowState {
  return {
    programId,
    current,
    goal: null,
    daysPerWeek: null,
    trainingDays: null,
    weeks: null,
    target: TARGET_UNCHANGED,
    pendingGoal: null,
    idempotencyKey: null,
  };
}

// ---------------------------------------------------------------------------
// Effective values

/** The goal the plan would have after this change. */
export const effectiveGoal = (flow: AdjustFlowState): ProgramGoal | null => flow.goal ?? flow.current.goal;
export const effectiveDaysPerWeek = (flow: AdjustFlowState): number => flow.daysPerWeek ?? flow.current.daysPerWeek;
export const effectiveWeeks = (flow: AdjustFlowState): ProgramLength | null => flow.weeks ?? flow.current.weeks;

/**
 * The weekdays the revision would train on: the member's pick, or the
 * defaults for a new count, or the plan's own.
 */
export function effectiveTrainingDays(flow: AdjustFlowState): readonly number[] {
  if (flow.trainingDays !== null) return flow.trainingDays;
  if (flow.daysPerWeek !== null && flow.daysPerWeek !== flow.current.daysPerWeek) {
    return defaultTrainingDays(flow.daysPerWeek);
  }
  return flow.current.trainingDays;
}

export const goalChanges = (flow: AdjustFlowState): boolean => flow.goal !== null && flow.goal !== flow.current.goal;
export const daysChange = (flow: AdjustFlowState): boolean =>
  flow.daysPerWeek !== null && flow.daysPerWeek !== flow.current.daysPerWeek;
export const weeksChange = (flow: AdjustFlowState): boolean => flow.weeks !== null && flow.weeks !== flow.current.weeks;

/** Something only a revision can change. */
export const hasPlanChange = (flow: AdjustFlowState): boolean => goalChanges(flow) || daysChange(flow) || weeksChange(flow);

/**
 * The goal, days and length stay as they are, and only the target changes:
 * that is `PUT /health/target-weight`, no new plan.
 */
export const isTargetOnly = (flow: AdjustFlowState): boolean => !hasPlanChange(flow) && flow.target.kind !== 'unchanged';

/** Nothing at all would change. */
export const isEmpty = (flow: AdjustFlowState): boolean => !hasPlanChange(flow) && flow.target.kind === 'unchanged';

// ---------------------------------------------------------------------------
// The request

/**
 * The revise body, or null when there is nothing to revise (a target-only
 * change goes through `PUT /health/target-weight` instead).
 *
 * A change of days carries its weekdays: the member's pick, or the defaults
 * for the new count. A target is sent only as it was chosen: `set` a number,
 * `remove` a null (the plan the member switches to clears it), `unchanged`
 * nothing at all (the key is left out, so the standing target carries over).
 * A target never rides along with a goal that takes none.
 */
export function revisionInput(flow: AdjustFlowState): ProgramRevisionInput | null {
  if (!hasPlanChange(flow)) return null;
  const body: { -readonly [K in keyof ProgramRevisionInput]: ProgramRevisionInput[K] } = {};
  if (goalChanges(flow) && flow.goal !== null) body.goal = flow.goal;
  if (daysChange(flow) && flow.daysPerWeek !== null) {
    body.daysPerWeek = flow.daysPerWeek;
    body.trainingDays = [...effectiveTrainingDays(flow)];
  }
  if (weeksChange(flow) && flow.weeks !== null) body.weeks = flow.weeks;
  const takesTarget = targetDirection(effectiveGoal(flow)) !== null;
  switch (flow.target.kind) {
    case 'unchanged':
      break;
    case 'set':
      if (takesTarget) body.targetWeightKg = roundTargetKg(flow.target.kg);
      break;
    case 'remove':
      body.targetWeightKg = null;
      break;
  }
  return body;
}

/**
 * What a target-only confirmation saves: a number, null to remove, or
 * `undefined` when the target is not changing (iOS `Double??`'s `.none`).
 */
export function targetOnlyValue(flow: AdjustFlowState): number | null | undefined {
  switch (flow.target.kind) {
    case 'unchanged':
      return undefined;
    case 'set':
      return roundTargetKg(flow.target.kg);
    case 'remove':
      return null;
  }
}

/** The kinds this change carries, for analytics (fixed words only). */
export function changeKinds(flow: AdjustFlowState): AdjustChangeKind[] {
  const kinds: AdjustChangeKind[] = [];
  if (goalChanges(flow)) kinds.push('goal');
  // A new count carries its weekdays, so it is one change, not two;
  // `weekdays` alone is the OP-14 move, reported where it is made.
  if (daysChange(flow)) kinds.push('days');
  if (weeksChange(flow)) kinds.push('length');
  if (flow.target.kind !== 'unchanged') kinds.push('target');
  return kinds;
}

// ---------------------------------------------------------------------------
// The confirmation

/**
 * One line of the confirmation bubble. `paramKeys` are copy keys to be
 * translated into the placeholder (goal words); `weekdays` fills `{days}` as
 * the account's weekday list.
 */
export interface AdjustSummaryLine {
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
  readonly paramKeys: Readonly<Record<string, string>>;
  readonly weekdays: readonly number[] | null;
}

function line(key: string, extra: Partial<Omit<AdjustSummaryLine, 'key'>> = {}): AdjustSummaryLine {
  return { key, params: {}, paramKeys: {}, weekdays: null, ...extra };
}

/**
 * One line per change, in the order the menu lists them. Never a body value:
 * a new target reads "a new target", not its weight.
 */
export function summaryLines(flow: AdjustFlowState): AdjustSummaryLine[] {
  const lines: AdjustSummaryLine[] = [];
  if (goalChanges(flow) && flow.goal !== null) {
    const goal = flow.goal;
    lines.push(
      line('program.adjust.line.goal', {
        // A live plan always has a goal; the fallback only keeps the
        // placeholder from printing as a raw key.
        paramKeys: { new: goalLabelKey(goal), old: goalLabelKey(flow.current.goal ?? goal) },
      }),
    );
  }
  if (daysChange(flow) && flow.daysPerWeek !== null) {
    lines.push(
      line('program.adjust.line.days', {
        params: { new: String(flow.daysPerWeek), old: String(flow.current.daysPerWeek) },
      }),
    );
    lines.push(line('program.adjust.line.weekdays', { weekdays: [...effectiveTrainingDays(flow)] }));
  }
  if (weeksChange(flow) && flow.weeks !== null) {
    lines.push(
      line('program.adjust.line.length', {
        params: { new: String(flow.weeks), old: String(flow.current.weeks ?? flow.weeks) },
      }),
    );
  }
  switch (flow.target.kind) {
    case 'unchanged':
      break;
    case 'set':
      lines.push(line('program.adjust.line.target'));
      break;
    case 'remove':
      lines.push(line('program.adjust.line.target_none'));
      break;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The key

function sameDays(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/**
 * Everything a request is made of, and nothing about where the conversation
 * is (`pendingGoal` is a question still open, `current` the plan it started
 * from).
 */
function sameRequestShape(a: AdjustFlowState, b: AdjustFlowState): boolean {
  return (
    a.goal === b.goal &&
    a.daysPerWeek === b.daysPerWeek &&
    sameDays(a.trainingDays, b.trainingDays) &&
    a.weeks === b.weeks &&
    sameTargetChange(a.target, b.target)
  );
}

/**
 * Applies a change and drops the stored key when it CHANGED anything, so the
 * next submit mints a new one: a retry resends the same request, an edit is
 * a new one. The same rule `changeFlow` keeps for the wizard's builds (the
 * revise route answers a reused key with the revision it already made, so a
 * key kept across an edit would show the member the plan they just changed
 * away from, and a new key on a plain retry would spend one of the six
 * revisions in 30 days on nothing).
 *
 * `mutate` cannot touch the key: whatever it returns there is ignored.
 */
export function changeAdjust(
  flow: AdjustFlowState,
  mutate: (flow: AdjustFlowState) => AdjustFlowState,
): AdjustFlowState {
  const working = { ...mutate(flow), idempotencyKey: flow.idempotencyKey };
  return sameRequestShape(working, flow) ? working : { ...working, idempotencyKey: null };
}

/** The key this submit sends, minting one when there is none. */
export function keyForSubmit(flow: AdjustFlowState): { readonly flow: AdjustFlowState; readonly key: string } {
  if (flow.idempotencyKey !== null) return { flow, key: flow.idempotencyKey };
  const key = newIdempotencyKey();
  return { flow: { ...flow, idempotencyKey: key }, key };
}

// ---------------------------------------------------------------------------
// The chips

/**
 * Every chip value the flow asks with (iOS `ProgramOptionValue.adjust*`).
 * Each starts `adjust.`, so a tap on any of them comes back here even from a
 * bubble the wizard drew. `open` and `newPlan` also sit on the wizard's own
 * running-plan gate (COACH-4 handles them there).
 *
 * Exact values are matched before the prefixes: `adjust.goal` is the menu's
 * row, `adjust.goal.lose_weight` an answer to its question.
 */
export const AdjustOptionValue = {
  prefix: 'adjust.',
  open: 'adjust.open',
  goal: 'adjust.goal',
  days: 'adjust.days',
  weekdays: 'adjust.weekdays',
  length: 'adjust.length',
  newPlan: 'adjust.new_plan',
  cancel: 'adjust.cancel',
  goalPrefix: 'adjust.goal.',
  daysPrefix: 'adjust.days.',
  lengthPrefix: 'adjust.length.',
  targetSet: 'adjust.target.set',
  targetKeep: 'adjust.target.keep',
  targetNone: 'adjust.target.none',
  safetyOk: 'adjust.safety.ok',
  safetyStop: 'adjust.safety.stop',
  show: 'adjust.show',
  more: 'adjust.more',
  saveTarget: 'adjust.save_target',
  weekdaysDefault: 'adjust.weekdays.default',
  weekdaysChoose: 'adjust.weekdays.choose',
} as const;

/** Swift's `Int(String)`: an optional sign and decimal digits, nothing around them. */
function swiftInt(value: string): number | null {
  return /^[+-]?\d+$/.test(value) ? Number.parseInt(value, 10) : null;
}

/** A chip that answers a question rather than naming a step. */
export type AdjustAnswer =
  | { readonly kind: 'goal'; readonly goal: ProgramGoal }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'length'; readonly length: ProgramLength };

/** `adjust.goal.lose_weight`, `adjust.days.4`, `adjust.length.8`; null for anything else. */
export function parseAdjustAnswer(value: string): AdjustAnswer | null {
  if (value.startsWith(AdjustOptionValue.goalPrefix)) {
    const goal = oneOf(PROGRAM_GOALS, value.slice(AdjustOptionValue.goalPrefix.length));
    return goal ? { kind: 'goal', goal } : null;
  }
  if (value.startsWith(AdjustOptionValue.daysPrefix)) {
    const days = oneOf<number>(DAY_CHOICES, swiftInt(value.slice(AdjustOptionValue.daysPrefix.length)));
    return days !== null ? { kind: 'days', days } : null;
  }
  if (value.startsWith(AdjustOptionValue.lengthPrefix)) {
    const length = oneOf<number>(PROGRAM_LENGTHS, swiftInt(value.slice(AdjustOptionValue.lengthPrefix.length)));
    return length !== null ? { kind: 'length', length: length as ProgramLength } : null;
  }
  return null;
}
