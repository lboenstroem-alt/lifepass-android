/**
 * The wire shapes of "change my plan in chat" (OP-58 to OP-62, API 0.41.0):
 * the Android port of iOS `PlanEditModels`. Nothing here is the member's
 * words: what comes back is server text in the app language (every label,
 * summary, item and note) and the model's short reply in the message's
 * language, all drawn as given.
 *
 * FAIL SOFT, as every health model (src/health/models.ts): a variant, a
 * group or an item this build cannot read costs only itself, never the
 * answer, and an unknown kind, scope, item type, status or reason reads as
 * `'unknown'` instead of throwing. Only what the app cannot act without is
 * required: the answer's kind, a variant's edit id, an edit's id.
 */
import {
  boolean,
  enumOf,
  instant,
  integer,
  object,
  req,
  soft,
  string,
  type Json,
  type Reader,
} from '../../../health/decode';
import { decodeProgramSummary, decodeSessionBrief, type ProgramSummary, type SessionBrief } from '../../../health/models';

// ---------------------------------------------------------------------------
// Enums

/** What OP-58 answered: a change to check, a question, nothing to change, or "this is not about the plan". */
export type PlanEditKind = 'preview' | 'clarify' | 'no_change' | 'not_plan_edit' | 'unknown';
export const PLAN_EDIT_KINDS: readonly PlanEditKind[] = ['preview', 'clarify', 'no_change', 'not_plan_edit'];

/** Where a group of changes applies: one day, every day of one workout, the plan, some weekdays, the cycle. */
export type PlanEditScope = 'day' | 'pattern' | 'plan' | 'weekdays' | 'cycle' | 'unknown';
export const PLAN_EDIT_SCOPES: readonly PlanEditScope[] = ['day', 'pattern', 'plan', 'weekdays', 'cycle'];

export type PlanEditItemType =
  | 'swap'
  | 'dose'
  | 'add'
  | 'remove'
  | 'reorder'
  | 'title'
  | 'minutes'
  | 'intensity'
  | 'replace'
  | 'rest'
  | 'swap_days'
  | 'cycle'
  | 'training_days'
  | 'exclude'
  | 'include'
  | 'unknown';
export const PLAN_EDIT_ITEM_TYPES: readonly PlanEditItemType[] = [
  'swap',
  'dose',
  'add',
  'remove',
  'reorder',
  'title',
  'minutes',
  'intensity',
  'replace',
  'rest',
  'swap_days',
  'cycle',
  'training_days',
  'exclude',
  'include',
];

/** The items a card draws on one line: what they become, never "before → after". */
export const SINGLE_LINE_ITEM_TYPES: ReadonlySet<PlanEditItemType> = new Set(['rest', 'title', 'cycle', 'training_days']);

/** Why part of a request was not done (each a server sentence in `text`). */
export type PlanEditDropReason =
  | 'unknown_ref'
  | 'not_editable'
  | 'not_suitable'
  | 'no_alternative'
  | 'unit_mismatch'
  | 'over_limit'
  | 'own_note_unsupported'
  | 'too_many'
  | 'conflicts'
  | 'not_supported'
  | 'unsafe'
  | 'text_not_shared'
  | 'unknown';
export const PLAN_EDIT_DROP_REASONS: readonly PlanEditDropReason[] = [
  'unknown_ref',
  'not_editable',
  'not_suitable',
  'no_alternative',
  'unit_mismatch',
  'over_limit',
  'own_note_unsupported',
  'too_many',
  'conflicts',
  'not_supported',
  'unsafe',
  'text_not_shared',
];

/** What a suggestion that is no edit points at: Adjust my plan, or a new plan. */
export type PlanEditSuggestion = 'adjust_plan' | 'new_plan' | 'unknown';
export const PLAN_EDIT_SUGGESTIONS: readonly PlanEditSuggestion[] = ['adjust_plan', 'new_plan'];

/** An applied edit's state in the history (OP-62) and after apply and undo. */
export type PlanEditStatus = 'previewed' | 'applied' | 'undone' | 'discarded' | 'superseded' | 'unknown';
export const PLAN_EDIT_STATUSES: readonly PlanEditStatus[] = ['previewed', 'applied', 'undone', 'discarded', 'superseded'];

// ---------------------------------------------------------------------------
// Shapes

export interface PlanEditChangeItem {
  readonly type: PlanEditItemType;
  readonly before: string | null;
  readonly after: string | null;
  /** The member's own exercise: tagged "Your exercise". */
  readonly own: boolean;
}

export interface PlanEditChangeGroup {
  readonly scope: PlanEditScope;
  /** Server text: "Push, every time", "Thursday 29 October". */
  readonly label: string;
  /** `YYYY-MM-DD`, kept as strings (no time shifting). */
  readonly dates: readonly string[];
  readonly sessionIds: readonly string[];
  readonly items: readonly PlanEditChangeItem[];
}

export interface PlanEditExclusion {
  readonly kind: 'equipment' | 'exercise' | 'unknown';
  readonly id: string;
  readonly label: string;
}

export interface PlanEditNotApplied {
  readonly reason: PlanEditDropReason;
  readonly text: string;
}

/** One way to make the change (at most two: our exercise, or the member's own). */
export interface PlanEditPreview {
  readonly editId: string;
  /** "Our exercise: Dumbbell bench press" / "Your own: Zottman curls", or null with one variant. */
  readonly label: string | null;
  readonly recommended: boolean;
  readonly expiresAt: Date | null;
  readonly summary: string;
  /** Applying makes the plan repeat as a cycle: Apply asks first and sends `confirmCustom`. */
  readonly becomesCustom: boolean;
  readonly becomesCustomNote: string | null;
  readonly touchesToday: boolean;
  /** Today's session, when the change touches it: Apply waits while its workout is open. */
  readonly todaySessionId: string | null;
  readonly changes: readonly PlanEditChangeGroup[];
  readonly exclusions: { readonly added: readonly PlanEditExclusion[]; readonly removed: readonly PlanEditExclusion[] };
  readonly notApplied: readonly PlanEditNotApplied[];
  /** "Some of it couldn't be done:", a line of its own, never inside the reply. */
  readonly notAppliedNote: string | null;
}

/** OP-58's answer. */
export interface PlanEditResponse {
  readonly kind: PlanEditKind;
  /** The model's short reply in the member's language (null for `not_plan_edit`). */
  readonly reply: string | null;
  /** Clarify only: the question and up to four answers to tap. */
  readonly question: { readonly text: string; readonly choices: readonly string[] } | null;
  readonly variants: readonly PlanEditPreview[];
  readonly suggestion: PlanEditSuggestion | null;
  readonly notApplied: readonly PlanEditNotApplied[];
  readonly editsLeftToday: number | null;
  readonly replayed: boolean;
}

/** An applied (or undone) edit, as the history and the apply and undo answers show it. */
export interface PlanEditView {
  readonly id: string;
  readonly programId: string | null;
  readonly status: PlanEditStatus;
  readonly appliedAt: Date | null;
  readonly undoneAt: Date | null;
  readonly undoUntil: Date | null;
  /** The server's rule: applied, within the window, no later overlapping edit, nothing changed since. */
  readonly undoable: boolean;
  readonly summary: string;
  readonly changes: readonly PlanEditChangeGroup[];
}

/** OP-59. */
export interface PlanEditApplyResponse {
  readonly edit: PlanEditView;
  readonly program: ProgramSummary | null;
  readonly changed: readonly SessionBrief[];
  readonly features: readonly string[] | null;
  readonly replayed: boolean;
}

/** OP-60. */
export interface PlanEditUndoResponse {
  readonly edit: PlanEditView;
  readonly program: ProgramSummary | null;
  readonly changed: readonly SessionBrief[];
  /** Days done or skipped since the change: kept as history, not undone. */
  readonly keptRows: number;
  readonly replayed: boolean;
}

/** OP-61. */
export interface PlanEditDiscardResponse {
  readonly edit: { readonly id: string; readonly status: PlanEditStatus } | null;
}

// ---------------------------------------------------------------------------
// Readers

const kind = enumOf(PLAN_EDIT_KINDS);
const scope = enumOf(PLAN_EDIT_SCOPES);
const itemType = enumOf(PLAN_EDIT_ITEM_TYPES);
const dropReason = enumOf(PLAN_EDIT_DROP_REASONS);
const suggestion = enumOf(PLAN_EDIT_SUGGESTIONS);
const status = enumOf(PLAN_EDIT_STATUSES);
const exclusionKind = enumOf<'equipment' | 'exercise'>(['equipment', 'exercise']);

/** The members of a list that read; the rest are dropped (one bad row costs only itself). */
function softList<T>(read: Reader<T>): Reader<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    value.forEach((item, index) => {
      try {
        out.push(read(item, `${path}[${index}]`));
      } catch {
        // dropped
      }
    });
    return out;
  };
}

function list<T>(json: Json, key: string, path: string, read: Reader<T>): T[] {
  return softList(read)(json[key], `${path}.${key}`);
}

function text(json: Json, key: string, path: string): string | null {
  const value = soft(json, key, path, string);
  return value !== null && value.trim() !== '' ? value : null;
}

export const decodeChangeItem: Reader<PlanEditChangeItem> = (value, path) => {
  const json = object(value, path);
  const before = text(json, 'before', path);
  const after = text(json, 'after', path);
  // An item that says nothing is no item.
  if (before === null && after === null) throw new Error(`${path}: empty item`);
  return { type: soft(json, 'type', path, itemType) ?? 'unknown', before, after, own: soft(json, 'own', path, boolean) ?? false };
};

export const decodeChangeGroup: Reader<PlanEditChangeGroup> = (value, path) => {
  const json = object(value, path);
  return {
    scope: soft(json, 'scope', path, scope) ?? 'unknown',
    label: text(json, 'label', path) ?? '',
    dates: list(json, 'dates', path, string),
    sessionIds: list(json, 'sessionIds', path, string),
    items: list(json, 'items', path, decodeChangeItem),
  };
};

const decodeExclusion: Reader<PlanEditExclusion> = (value, path) => {
  const json = object(value, path);
  return {
    kind: soft(json, 'kind', path, exclusionKind) ?? 'unknown',
    id: req(json, 'id', path, string),
    label: text(json, 'label', path) ?? req(json, 'id', path, string),
  };
};

const decodeNotApplied: Reader<PlanEditNotApplied> = (value, path) => {
  const json = object(value, path);
  const sentence = text(json, 'text', path);
  if (sentence === null) throw new Error(`${path}: no text`);
  return { reason: soft(json, 'reason', path, dropReason) ?? 'unknown', text: sentence };
};

export const decodePreview: Reader<PlanEditPreview> = (value, path) => {
  const json = object(value, path);
  const exclusions = soft(json, 'exclusions', path, object) ?? {};
  const exclusionsPath = `${path}.exclusions`;
  return {
    editId: req(json, 'editId', path, string),
    label: text(json, 'label', path),
    recommended: soft(json, 'recommended', path, boolean) ?? false,
    expiresAt: soft(json, 'expiresAt', path, instant),
    summary: text(json, 'summary', path) ?? '',
    becomesCustom: soft(json, 'becomesCustom', path, boolean) ?? false,
    becomesCustomNote: text(json, 'becomesCustomNote', path),
    touchesToday: soft(json, 'touchesToday', path, boolean) ?? false,
    todaySessionId: soft(json, 'todaySessionId', path, string),
    changes: list(json, 'changes', path, decodeChangeGroup),
    exclusions: {
      added: list(exclusions, 'added', exclusionsPath, decodeExclusion),
      removed: list(exclusions, 'removed', exclusionsPath, decodeExclusion),
    },
    notApplied: list(json, 'notApplied', path, decodeNotApplied),
    notAppliedNote: text(json, 'notAppliedNote', path),
  };
};

const decodeQuestion: Reader<{ text: string; choices: string[] }> = (value, path) => {
  const json = object(value, path);
  const question = text(json, 'text', path);
  if (question === null) throw new Error(`${path}: no question`);
  const choices = list(json, 'choices', path, string)
    .map((choice) => choice.trim())
    .filter((choice) => choice !== '')
    .slice(0, 4);
  return { text: question, choices };
};

/** OP-58's `data`. */
export function decodePlanEditResponse(data: unknown): PlanEditResponse {
  const path = 'planEdit';
  const json = object(data, path);
  const answer = req(json, 'kind', path, kind);
  const variants = answer === 'preview' ? list(json, 'variants', path, decodePreview).slice(0, 2) : [];
  return {
    // A preview whose every variant failed to read is nothing to check.
    kind: answer === 'preview' && variants.length === 0 ? 'no_change' : answer,
    reply: text(json, 'reply', path),
    question: answer === 'clarify' ? soft(json, 'question', path, decodeQuestion) : null,
    variants,
    suggestion: soft(json, 'suggestion', path, suggestion),
    notApplied: list(json, 'notApplied', path, decodeNotApplied),
    editsLeftToday: soft(json, 'editsLeftToday', path, integer),
    replayed: soft(json, 'replayed', path, boolean) ?? false,
  };
}

export const decodePlanEditView: Reader<PlanEditView> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    programId: soft(json, 'programId', path, string),
    status: soft(json, 'status', path, status) ?? 'unknown',
    appliedAt: soft(json, 'appliedAt', path, instant),
    undoneAt: soft(json, 'undoneAt', path, instant),
    undoUntil: soft(json, 'undoUntil', path, instant),
    undoable: soft(json, 'undoable', path, boolean) ?? false,
    summary: text(json, 'summary', path) ?? '',
    changes: list(json, 'changes', path, decodeChangeGroup),
  };
};

function features(json: Json): readonly string[] | null {
  const value = json.features;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

export function decodeApplyResponse(data: unknown): PlanEditApplyResponse {
  const path = 'planEditApply';
  const json = object(data, path);
  return {
    edit: req(json, 'edit', path, decodePlanEditView),
    program: soft(json, 'program', path, decodeProgramSummary),
    changed: list(json, 'changed', path, decodeSessionBrief),
    features: features(json),
    replayed: soft(json, 'replayed', path, boolean) ?? false,
  };
}

export function decodeUndoResponse(data: unknown): PlanEditUndoResponse {
  const path = 'planEditUndo';
  const json = object(data, path);
  return {
    edit: req(json, 'edit', path, decodePlanEditView),
    program: soft(json, 'program', path, decodeProgramSummary),
    changed: list(json, 'changed', path, decodeSessionBrief),
    keptRows: soft(json, 'keptRows', path, integer) ?? 0,
    replayed: soft(json, 'replayed', path, boolean) ?? false,
  };
}

export function decodeDiscardResponse(data: unknown): PlanEditDiscardResponse {
  const path = 'planEditDiscard';
  const json = object(data, path);
  const edit = soft(json, 'edit', path, (raw, p) => {
    const e = object(raw, p);
    return { id: req(e, 'id', p, string), status: soft(e, 'status', p, status) ?? 'unknown' };
  });
  return { edit };
}

export function decodeHistory(data: unknown): readonly PlanEditView[] {
  const path = 'planEditHistory';
  const json = object(data, path);
  return list(json, 'edits', path, decodePlanEditView);
}
