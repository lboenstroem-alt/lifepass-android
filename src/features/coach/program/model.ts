/**
 * The programme wizard's answers, its questions, the two refusals settled on
 * the phone and the key rule of its one call: the Android port of iOS
 * Models/CoachProgramWizard.swift (`ios-ux.md` 5).
 *
 * THE PRIVACY SHAPE OF THIS FILE IS THE POINT.
 *
 * Every answer here is a PRESET. Nothing the member types reaches it, nothing
 * free text is stored on it, and the two answers that would be the most
 * sensitive of all (pregnancy or breastfeeding, a history of disordered
 * eating) are evaluated by `localRefusal` and then dropped: they are never
 * put in a request body, never written to a session, never counted by
 * analytics. The request carries chip values, a band and, when the member
 * chose to give them, a weight and a height, which the SERVER turns into
 * bands before any model call (`api-contract.md` 2.3 OP-10).
 *
 * So there is no `note`, no free-text field and no `description` anywhere
 * below, and there must not be one added.
 *
 * Everything here is immutable: a recorder returns new answers (or null for
 * a value that does not belong), where iOS mutates a struct in place and
 * returns false. `changeFlow` is the one place a change can clear the build's
 * Idempotency-Key.
 */
import { newIdempotencyKey } from '../../../api';
import { roundTargetKg } from '../../../api/targetWeight';
import type { BodyDetails } from '../../body/sheets';

// ---------------------------------------------------------------------------
// The chip values (contract.ts PROGRAM_* enums), in iOS's order

export const PROGRAM_GOALS = ['lose_weight', 'gain_weight', 'build_muscle', 'get_fitter'] as const;
export type ProgramGoal = (typeof PROGRAM_GOALS)[number];

export const PROGRAM_FOCUSES = ['full', 'upper', 'lower', 'core', 'legs'] as const;
export type ProgramFocus = (typeof PROGRAM_FOCUSES)[number];

export const PROGRAM_KINDS = ['gym', 'classes', 'pool', 'outdoors'] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];

export const PROGRAM_EXPERIENCES = ['new', 'some', 'regular'] as const;
export type ProgramExperience = (typeof PROGRAM_EXPERIENCES)[number];

export const PROGRAM_BODY_PARTS = ['shoulder', 'back', 'knee', 'hip', 'wrist', 'ankle', 'neck'] as const;
export type ProgramBodyPart = (typeof PROGRAM_BODY_PARTS)[number];

/**
 * 4, 8 or 12 weeks. Defaulted to 4 and shown as an editable summary row
 * rather than asked (R16): the question cost a tap and almost every answer
 * was 4.
 */
export const PROGRAM_LENGTHS = [4, 8, 12] as const;
export type ProgramLength = (typeof PROGRAM_LENGTHS)[number];

export const goalLabelKey = (goal: ProgramGoal): string => `program.goal.${goal}`;
export const focusLabelKey = (focus: ProgramFocus): string => `program.focus.${focus}`;
export const kindLabelKey = (kind: ProgramKind): string => `program.where.${kind}`;
export const experienceLabelKey = (experience: ProgramExperience): string => `program.exp.${experience}`;
export const bodyPartLabelKey = (part: ProgramBodyPart): string => `program.part.${part}`;
export const lengthLabelKey = (length: ProgramLength): string => `program.length.${length}`;

/** Swift's `Int(String)`: an optional sign and decimal digits, nothing around them. */
function swiftInt(value: string): number | null {
  return /^[+-]?\d+$/.test(value) ? Number.parseInt(value, 10) : null;
}

/** `raw` when it is one of `values`, else null (iOS `Enum(rawValue:)`). */
export function oneOf<T extends string | number>(values: readonly T[], raw: unknown): T | null {
  return (values as readonly unknown[]).includes(raw) ? (raw as T) : null;
}

// ---------------------------------------------------------------------------
// Safety (question 5), and the two refusals that never leave the phone

/** The options of question 5, in the order they are shown (iOS `ProgramSafety.Option.allCases`). */
export const SAFETY_OPTIONS = ['nothing', 'pregnant', 'injury', 'condition', 'eating'] as const;
export type SafetyOption = (typeof SAFETY_OPTIONS)[number];

export const safetyLabelKey = (option: SafetyOption): string => `program.safety.${option}`;

/** The multi-select of question 5. `nothing` is exclusive both ways. */
export interface ProgramSafety {
  readonly nothing: boolean;
  readonly pregnantOrBreastfeeding: boolean;
  readonly injury: boolean;
  readonly conditionOrMedication: boolean;
  readonly eatingDisorderHistory: boolean;
}

export const EMPTY_SAFETY: ProgramSafety = {
  nothing: false,
  pregnantOrBreastfeeding: false,
  injury: false,
  conditionOrMedication: false,
  eatingDisorderHistory: false,
};

/** The options a safety answer holds, in `SAFETY_OPTIONS` order. */
export function safetySelected(safety: ProgramSafety): SafetyOption[] {
  const picked: SafetyOption[] = [];
  if (safety.nothing) picked.push('nothing');
  if (safety.pregnantOrBreastfeeding) picked.push('pregnant');
  if (safety.injury) picked.push('injury');
  if (safety.conditionOrMedication) picked.push('condition');
  if (safety.eatingDisorderHistory) picked.push('eating');
  return picked;
}

/**
 * A selection with the exclusivity rule of `ios-ux.md` 5.4: "Nothing" alone
 * is Nothing; any other pick clears it; an empty pick reads as Nothing.
 */
export function safetyFrom(options: ReadonlySet<SafetyOption>): ProgramSafety {
  if (options.has('nothing') && options.size === 1) return { ...EMPTY_SAFETY, nothing: true };
  const safety: ProgramSafety = {
    nothing: false,
    pregnantOrBreastfeeding: options.has('pregnant'),
    injury: options.has('injury'),
    conditionOrMedication: options.has('condition'),
    eatingDisorderHistory: options.has('eating'),
  };
  return safetySelected(safety).length === 0 ? { ...safety, nothing: true } : safety;
}

/**
 * A refusal decided HERE, on the phone, before anything is sent.
 *
 * The contract has fields for both of these and answers 422 to a `true`, but
 * sending them would mean a pregnancy and an eating-disorder history
 * travelled to a server and sat in a log line. `ios-ux.md` 5.4 checks
 * pregnancy first and then eating: with both ticked the pregnancy copy is the
 * one that answers, because it is the one with a date on it.
 */
export type LocalRefusal = 'pregnant' | 'eating';

export function localRefusal(safety: ProgramSafety): LocalRefusal | null {
  if (safety.pregnantOrBreastfeeding) return 'pregnant';
  if (safety.eatingDisorderHistory) return 'eating';
  return null;
}

export const localRefusalCopyKey = (refusal: LocalRefusal): string =>
  refusal === 'pregnant' ? 'program.refused.pregnant' : 'program.refused.eating';

/** The most injured parts question 5b accepts. A fourth tap says so and selects nothing. */
export const MAX_INJURIES = 3;

// ---------------------------------------------------------------------------
// The body and its target

/**
 * Which way a target goes for a programme goal (iOS
 * `TargetWeightRules.Direction(programGoal:)`): lose or gain weight take one,
 * every other goal (and no goal) none. The same rule as BODY-2's
 * `TargetWeightRules.directionForProgramGoal` (a test holds them together),
 * kept here so the wizard's answers load without the body sheet's screens.
 */
export function targetDirection(goal: string | null | undefined): 'lose' | 'gain' | null {
  if (goal === 'lose_weight') return 'lose';
  if (goal === 'gain_weight') return 'gain';
  return null;
}

/**
 * A target the wizard may mention in its bubble: "with a target weight",
 * never the number (iOS `BodyDetails.givesTarget`).
 */
export function givesTarget(details: Pick<BodyDetails, 'targetWeightTouched' | 'targetWeightKg'>): boolean {
  return details.targetWeightTouched && details.targetWeightKg !== null;
}

// ---------------------------------------------------------------------------
// The questions

/**
 * The eight questions in the order they are asked, plus the two answers that
 * are defaulted at question 1 and only ever reached by editing the summary
 * (`ios-ux.md` 5.4).
 */
export type ProgramQuestion =
  | 'goal'
  | 'focus'
  | 'days'
  | 'experience'
  | 'safety'
  | 'injuryWhere'
  | 'body'
  | 'trainingDays'
  /** Summary rows only. */
  | 'kinds'
  | 'length';

/** The step number for `program_wizard_step`. The two summary-only rows are not steps. */
export function questionStepNumber(question: ProgramQuestion): number | null {
  switch (question) {
    case 'goal':
      return 1;
    case 'focus':
      return 2;
    case 'days':
      return 3;
    case 'experience':
      return 4;
    case 'safety':
    case 'injuryWhere':
      return 5;
    case 'body':
      return 6;
    case 'trainingDays':
      return 7;
    case 'kinds':
    case 'length':
      return null;
  }
}

/**
 * The `field` value of `program_summary_row_edited`. A field NAME is not an
 * answer, so it is inside the analytics allow-list.
 */
export function questionAnalyticsField(question: ProgramQuestion): string {
  switch (question) {
    case 'safety':
    case 'injuryWhere':
      return 'safety';
    case 'trainingDays':
      return 'training_days';
    case 'kinds':
      return 'where';
    default:
      return question;
  }
}

// ---------------------------------------------------------------------------
// The answers

/**
 * What the wizard has been told, and what it still has to ask.
 *
 * `nextQuestion` is DERIVED, never stored, exactly as the day plan derives its
 * own: a prefilled next block (5.7) then simply skips every question it
 * already has an answer for, and an edited summary row re-asks one question
 * without any state saying "we are in edit mode".
 */
export interface ProgramAnswers {
  readonly goal: ProgramGoal | null;
  readonly focus: ProgramFocus | null;
  readonly daysPerWeek: number | null;
  readonly experience: ProgramExperience | null;

  readonly safety: ProgramSafety;
  readonly safetyAnswered: boolean;
  readonly injuries: readonly ProgramBodyPart[];
  readonly injuriesAnswered: boolean;

  /** Held in memory for the length of the wizard and sent once, with the build. */
  readonly body: BodyDetails | null;
  readonly bodyAnswered: boolean;

  /** ISO weekdays, 1 = Monday. */
  readonly trainingDays: readonly number[];
  readonly trainingDaysAnswered: boolean;

  /** Defaults set at question 1 and shown as editable summary rows (R16). */
  readonly weeks: ProgramLength;
  /**
   * Empty until the flow starts: the wizard fills it with what the membership
   * covers, unless a next block already carried an answer in.
   */
  readonly kinds: readonly ProgramKind[];
}

export const EMPTY_ANSWERS: ProgramAnswers = {
  goal: null,
  focus: null,
  daysPerWeek: null,
  experience: null,
  safety: EMPTY_SAFETY,
  safetyAnswered: false,
  injuries: [],
  injuriesAnswered: false,
  body: null,
  bodyAnswered: false,
  trainingDays: [],
  trainingDaysAnswered: false,
  weeks: 4,
  kinds: [],
};

/** The day-count chips of question 3. */
export const DAY_CHOICES = [2, 3, 4, 5] as const;

/**
 * `DEFAULT_TRAINING_DAYS` of `contract.ts`, mirrored so the chip can show the
 * days before the server ever sees the answers.
 */
export function defaultTrainingDays(daysPerWeek: number): number[] {
  switch (daysPerWeek) {
    case 2:
      return [1, 4];
    case 3:
      return [1, 3, 5];
    case 4:
      return [1, 2, 4, 6];
    case 5:
      return [1, 2, 3, 4, 5];
    default:
      return [1, 3, 5];
  }
}

export function nextQuestion(answers: ProgramAnswers): ProgramQuestion | null {
  if (answers.goal === null) return 'goal';
  if (answers.focus === null) return 'focus';
  if (answers.daysPerWeek === null) return 'days';
  if (answers.experience === null) return 'experience';
  if (!answers.safetyAnswered) return 'safety';
  if (answers.safety.injury && !answers.injuriesAnswered) return 'injuryWhere';
  if (!answers.bodyAnswered) return 'body';
  if (!answers.trainingDaysAnswered) return 'trainingDays';
  return null;
}

/** True once every question has an answer, so the summary can be built. */
export function isComplete(answers: ProgramAnswers): boolean {
  return nextQuestion(answers) === null;
}

/**
 * Records a chip value against a single-choice question. Null for a value
 * that does not belong to it, which leaves the answers untouched (the same
 * contract the day plan's `record` keeps).
 */
export function recordAnswer(answers: ProgramAnswers, value: string, question: ProgramQuestion): ProgramAnswers | null {
  switch (question) {
    case 'goal': {
      const parsed = oneOf(PROGRAM_GOALS, value);
      if (parsed === null) return null;
      // A target belongs to the direction it was given for. A goal that takes
      // none (or points the other way) drops it, so the build never carries a
      // target the server would refuse, and the summary stops saying "with a
      // target weight".
      let body = answers.body;
      if (body && targetDirection(parsed) !== targetDirection(answers.goal)) {
        body = { ...body, targetWeightKg: null, targetWeightTouched: false };
      }
      return { ...answers, goal: parsed, body };
    }
    case 'focus': {
      const parsed = oneOf(PROGRAM_FOCUSES, value);
      return parsed === null ? null : { ...answers, focus: parsed };
    }
    case 'days': {
      const parsed = oneOf<number>(DAY_CHOICES, swiftInt(value));
      if (parsed === null) return null;
      // A different number of days invalidates a day picking made for the
      // old one: the server refuses trainingDays whose count is not
      // daysPerWeek, so the wizard must not carry it forward.
      if (answers.daysPerWeek !== parsed) {
        return { ...answers, daysPerWeek: parsed, trainingDays: [], trainingDaysAnswered: false };
      }
      return { ...answers, daysPerWeek: parsed };
    }
    case 'experience': {
      const parsed = oneOf(PROGRAM_EXPERIENCES, value);
      return parsed === null ? null : { ...answers, experience: parsed };
    }
    case 'length': {
      const parsed = oneOf<number>(PROGRAM_LENGTHS, swiftInt(value));
      if (parsed === null) return null;
      return { ...answers, weeks: parsed as ProgramLength };
    }
    case 'safety':
    case 'injuryWhere':
    case 'body':
    case 'trainingDays':
    case 'kinds':
      // Multi-select and sheet answers have their own recorders below: they
      // carry more than one value, and two of them are never sent.
      return null;
  }
}

/**
 * Question 5. A local refusal comes back INSTEAD of answers, so the caller
 * ends the wizard without storing the answer that caused it.
 */
export function recordSafety(
  answers: ProgramAnswers,
  options: ReadonlySet<SafetyOption>,
): { readonly answers: ProgramAnswers; readonly refusal: null } | { readonly answers: null; readonly refusal: LocalRefusal } {
  const picked = safetyFrom(options);
  const refusal = localRefusal(picked);
  if (refusal) return { answers: null, refusal };
  const next: ProgramAnswers = { ...answers, safety: picked, safetyAnswered: true };
  if (!picked.injury) return { answers: { ...next, injuries: [], injuriesAnswered: false }, refusal: null };
  return { answers: next, refusal: null };
}

/** Question 5b, at most three parts, kept in `PROGRAM_BODY_PARTS` order. */
export function recordInjuries(answers: ProgramAnswers, parts: readonly ProgramBodyPart[]): ProgramAnswers | null {
  if (parts.length > MAX_INJURIES) return null;
  return { ...answers, injuries: PROGRAM_BODY_PARTS.filter((part) => parts.includes(part)), injuriesAnswered: true };
}

/** Question 6. Null is Skip, which is an answer. */
export function recordBody(answers: ProgramAnswers, details: BodyDetails | null): ProgramAnswers {
  return { ...answers, body: details, bodyAnswered: true };
}

/** Question 7: exactly `daysPerWeek` distinct weekdays, 1 to 7, kept sorted. */
export function recordTrainingDays(answers: ProgramAnswers, days: readonly number[]): ProgramAnswers | null {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (answers.daysPerWeek === null || unique.length !== answers.daysPerWeek) return null;
  if (!unique.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) return null;
  return { ...answers, trainingDays: unique, trainingDaysAnswered: true };
}

/** The summary's "where" row, kept in `PROGRAM_KINDS` order. */
export function recordKinds(answers: ProgramAnswers, picked: readonly ProgramKind[]): ProgramAnswers | null {
  if (picked.length === 0) return null;
  return { ...answers, kinds: PROGRAM_KINDS.filter((kind) => picked.includes(kind)) };
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameBody(a: BodyDetails | null, b: BodyDetails | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.weightKg === b.weightKg &&
    a.heightCm === b.heightCm &&
    a.ageBand === b.ageBand &&
    a.sex === b.sex &&
    a.activity === b.activity &&
    a.targetWeightKg === b.targetWeightKg &&
    a.targetWeightTouched === b.targetWeightTouched
  );
}

/** Value equality (iOS `ProgramAnswers: Equatable`), which decides whether a change clears the key. */
export function answersEqual(a: ProgramAnswers, b: ProgramAnswers): boolean {
  return (
    a.goal === b.goal &&
    a.focus === b.focus &&
    a.daysPerWeek === b.daysPerWeek &&
    a.experience === b.experience &&
    sameList(safetySelected(a.safety), safetySelected(b.safety)) &&
    a.safetyAnswered === b.safetyAnswered &&
    sameList(a.injuries, b.injuries) &&
    a.injuriesAnswered === b.injuriesAnswered &&
    sameBody(a.body, b.body) &&
    a.bodyAnswered === b.bodyAnswered &&
    sameList(a.trainingDays, b.trainingDays) &&
    a.trainingDaysAnswered === b.trainingDaysAnswered &&
    a.weeks === b.weeks &&
    sameList(a.kinds, b.kinds)
  );
}

// ---------------------------------------------------------------------------
// OP-10's body

/** `POST /coach`'s `program` (`CoachProgramBody`). */
export interface ProgramBuildBody {
  readonly goal: ProgramGoal;
  readonly focus: ProgramFocus;
  readonly daysPerWeek: number;
  readonly weeks: ProgramLength;
  readonly kinds: readonly ProgramKind[];
  readonly experience: ProgramExperience;
  /**
   * `pregnantOrBreastfeeding` and `eatingDisorderHistory` are deliberately
   * absent: those two answers are refused on the phone (`localRefusal`) and
   * never travel.
   */
  readonly safety: { readonly conditionOrMedication: boolean; readonly injuries: readonly ProgramBodyPart[] };
  /** Left out when the member skipped question 6. `ageBand` and `sex` are left out when not given. */
  readonly body?: {
    readonly weightKg: number;
    readonly heightCm: number;
    readonly ageBand?: string;
    readonly sex?: string;
    readonly activity: string;
  };
  readonly trainingDays: readonly number[];
  /** The next block's predecessor; left out otherwise. */
  readonly previousProgramId?: string;
  /**
   * Tri-state (`SPEC` 2.5): ABSENT leaves the standing target alone at
   * adoption, `null` clears it, a number sets it. JSON keeps the difference
   * because an `undefined` member is left out of the text, a null is not.
   */
  readonly targetWeightKg?: number | null;
}

/**
 * The OP-10 body. Null while an answer is missing.
 *
 * Note what is NOT here: the pregnancy and eating-disorder answers. They were
 * refused on the phone (`recordSafety`) and never recorded, so there is
 * nothing to leave out.
 *
 * `includeTarget` is the server's `target_weight` flag: against a server that
 * does not advertise it, `targetWeightKg` is never put on the body, whatever
 * the sheet returned (the schema is strict and would 400).
 */
export function requestBody(
  answers: ProgramAnswers,
  previousProgramId: string | null,
  includeTarget = true,
): ProgramBuildBody | null {
  const { goal, focus, daysPerWeek, experience, body } = answers;
  if (goal === null || focus === null || daysPerWeek === null || experience === null || !isComplete(answers)) {
    return null;
  }
  const days = answers.trainingDays.length === 0 ? defaultTrainingDays(daysPerWeek) : [...answers.trainingDays];
  const result: {
    -readonly [K in keyof ProgramBuildBody]: ProgramBuildBody[K];
  } = {
    goal,
    focus,
    daysPerWeek,
    weeks: answers.weeks,
    kinds: answers.kinds.length === 0 ? [...PROGRAM_KINDS] : [...answers.kinds],
    experience,
    safety: { conditionOrMedication: answers.safety.conditionOrMedication, injuries: [...answers.injuries] },
    trainingDays: days,
  };
  if (body) {
    result.body = {
      weightKg: body.weightKg,
      heightCm: body.heightCm,
      ...(body.ageBand !== null ? { ageBand: body.ageBand } : {}),
      ...(body.sex !== null ? { sex: body.sex } : {}),
      activity: body.activity,
    };
  }
  if (previousProgramId !== null) result.previousProgramId = previousProgramId;
  // Only a TOUCHED target travels, and only with a goal that takes one.
  if (includeTarget && body && body.targetWeightTouched && targetDirection(goal) !== null) {
    result.targetWeightKg = body.targetWeightKg === null ? null : roundTargetKg(body.targetWeightKg);
  }
  return result;
}

// ---------------------------------------------------------------------------
// The flow

/** How the member got here, for `program_wizard_started` (iOS `ProgramFlow.Entry` raw values). */
export type ProgramEntry = 'chip' | 'intent' | 'plan_tab' | 'next_block';

/**
 * The wizard as the flow holds it: the answers, the key the build will use,
 * and which question an edited summary row re-opened.
 */
export interface ProgramFlowState {
  readonly answers: ProgramAnswers;
  readonly entry: ProgramEntry;
  /** The next block's predecessor, sent once and dropped on a 404. */
  readonly previousProgramId: string | null;
  /**
   * Minted at the first Build and kept while the answers do not change, so
   * "Try again" is a RETRY of the same request rather than a second plan.
   */
  readonly idempotencyKey: string | null;
  /** The summary row a tap re-opened, so answering it returns to the summary. */
  readonly editingQuestion: ProgramQuestion | null;
  /** The typed-text hint is shown once per flow, not once per keystroke. */
  readonly typedHintShown: boolean;
}

export function newFlow(
  entry: ProgramEntry,
  answers: ProgramAnswers = EMPTY_ANSWERS,
  previousProgramId: string | null = null,
): ProgramFlowState {
  return { answers, entry, previousProgramId, idempotencyKey: null, editingQuestion: null, typedHintShown: false };
}

/**
 * Applies a change to the answers and, when it CHANGED them, drops the stored
 * key so the next Build mints a new one (R16, C9). Null when the change was
 * refused (the flow is then untouched).
 *
 * This is the whole reason the flow owns the key: an edited answer that
 * reused the key would be answered by the server as a replay of the previous
 * plan, and the member would watch their edit produce the plan they just
 * edited.
 */
export function changeFlow(
  flow: ProgramFlowState,
  mutate: (answers: ProgramAnswers) => ProgramAnswers | null,
): ProgramFlowState | null {
  const next = mutate(flow.answers);
  if (next === null) return null;
  if (answersEqual(next, flow.answers)) return { ...flow, answers: next };
  return { ...flow, answers: next, idempotencyKey: null };
}

/** The key this build will send, minting one when there is none. */
export function keyForBuild(flow: ProgramFlowState): { readonly flow: ProgramFlowState; readonly key: string } {
  if (flow.idempotencyKey !== null) return { flow, key: flow.idempotencyKey };
  const key = newIdempotencyKey();
  return { flow: { ...flow, idempotencyKey: key }, key };
}

// ---------------------------------------------------------------------------
// Chip values that are routing instructions rather than answers

/** Namespaced so they can never collide with a wire value (iOS `ProgramOptionValue`). */
export const ProgramOptionValue = {
  intentProgram: 'program.intent.program',
  intentDay: 'program.intent.day',
  gatePlans: 'gate.plans',
  gateAccount: 'gate.account',
  gatePlanTab: 'gate.plan_tab',
  gateMakeNew: 'gate.make_new',
  gateReviewSaved: 'gate.review_saved',
  bodyAdd: 'program.body.add',
  bodySkip: 'program.body.skip',
  daysDefault: 'program.days.default',
  daysChoose: 'program.days.choose',
  tryAgain: 'program.try_again',
  openPastPlans: 'program.open_past_plans',
  getFitterInstead: 'program.get_fitter_instead',
  planDay: 'program.plan_day',
  /** A build refused because of the target: the body sheet again. */
  changeTarget: 'program.change_target',
  /**
   * Adjust my plan (`SPEC` 6.7). Every value starts `adjust.`; the two below
   * sit on the wizard's own gate bubble, every other belongs to COACH-5.
   */
  adjustPrefix: 'adjust.',
  adjustOpen: 'adjust.open',
  adjustNewPlan: 'adjust.new_plan',
} as const;
