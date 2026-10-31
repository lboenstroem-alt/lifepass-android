/**
 * The programme wizard's chat messages: which `kind` each of its own bubbles
 * has, what it carries, and the builders every programme turn goes through.
 *
 * EVERY TURN HERE IS `isHealth` (iOS: "Everything in here marks its messages
 * `isHealth`"), which is what keeps the answers out of the saved chats and
 * out of every later model call, and takes them off the screen when the
 * health data is wiped. A question the wizard asks carries `flow: 'program'`,
 * so a chip tapped on it comes back here whatever else is open (iOS
 * `isProgramQuestion`).
 */
import type { ProgramDetail } from '../../../health';
import type { QuestionOption } from '../../../types/coach';
import type { ProposalOutcome } from '../../plan/proposal/ProgramProposalCard';
import { coachHost } from '../store/host';
import type { CoachMessage } from '../store/messages';

import type { ProgramAnswers } from './model';
import type { ProgramMultiSelect } from './multiSelect';

/** The renderers' keys (../flows/program.ts maps each to its bubble). */
export const ProgramMessageKind = {
  multiSelect: 'program.multiSelect',
  summary: 'program.summary',
  proposal: 'program.proposal',
} as const;

/** The editable summary: a snapshot of the answers when it was drawn. */
export interface ProgramSummaryPayload {
  readonly answers: ProgramAnswers;
  /** Answered or abandoned: the rows stop answering and Build goes (iOS `questionAnswered`). */
  readonly closed: boolean;
}

/** A built (or revised) plan, and what became of it, so the card stays collapsed on a redraw. */
export interface ProgramProposalPayload {
  readonly detail: ProgramDetail;
  readonly outcome: ProposalOutcome | null;
  /**
   * A note under the card until the member switches or discards (iOS
   * `programProposalWarningKey`): a revision of a plan that carries changes
   * made in chat replaces them (`coach.planEdit.adjustWarning`, COACH-6).
   */
  readonly warningKey?: string | null;
}

/** What a renderer or the flow reads off a message: its kind and payload. */
type PayloadCarrier = { readonly kind?: string; readonly payload?: unknown } | undefined;

function payloadOf<T>(message: PayloadCarrier, kind: string): T | null {
  return message && message.kind === kind && message.payload != null ? (message.payload as T) : null;
}

export const multiSelectOf = (message: PayloadCarrier) => payloadOf<ProgramMultiSelect>(message, ProgramMessageKind.multiSelect);
export const summaryOf = (message: PayloadCarrier) => payloadOf<ProgramSummaryPayload>(message, ProgramMessageKind.summary);
export const proposalOf = (message: PayloadCarrier) => payloadOf<ProgramProposalPayload>(message, ProgramMessageKind.proposal);

/**
 * A bubble the wizard asked with: a chip question, a multi-select or a
 * summary (iOS `isProgramQuestion`). A proposal card is not one: it answers
 * through its own buttons.
 */
export function isProgramQuestion(message: CoachMessage): boolean {
  if (message.flow !== 'program') return false;
  return (
    message.options !== undefined ||
    message.kind === ProgramMessageKind.multiSelect ||
    message.kind === ProgramMessageKind.summary
  );
}

/**
 * Closed: a chip question by the store's `answered` (the question bubble
 * draws it), a multi-select or a summary by its own `closed` (iOS keeps
 * `closed` on the multi-select and `questionAnswered` on the summary).
 */
function isClosed(message: CoachMessage): boolean {
  if (message.flow === 'program') {
    const multi = multiSelectOf(message);
    if (multi) return multi.closed;
    const summary = summaryOf(message);
    if (summary) return summary.closed;
  }
  return !!message.answered;
}

/** A programme bubble that can still answer into the wizard. */
export function isOpenProgramQuestion(message: CoachMessage): boolean {
  return isProgramQuestion(message) && !isClosed(message);
}

// ---------------------------------------------------------------------------
// Builders (iOS `appendProgramBubble`, `appendProgramQuestion`, ...)

/** A plain Coach bubble in the health lane: `key` translated, or `text` as given (the plan's own intro). */
export function appendProgramBubble(key: string | null, text?: string): string {
  const host = coachHost();
  const [id] = host.append({ role: 'assistant', text: text ?? (key ? host.t(key) : ''), isHealth: true });
  return id!;
}

/** A question with chips; a tap comes back to the programme flow. */
export function appendProgramQuestion(text: string, options: readonly QuestionOption[]): string {
  const [id] = coachHost().append({ role: 'assistant', text, options, isHealth: true, flow: 'program' });
  return id!;
}

export function appendProgramMultiSelect(state: ProgramMultiSelect): string {
  const [id] = coachHost().append({
    role: 'assistant',
    text: state.text,
    isHealth: true,
    flow: 'program',
    kind: ProgramMessageKind.multiSelect,
    payload: state,
  });
  return id!;
}

export function appendProgramSummaryMessage(answers: ProgramAnswers): string {
  const host = coachHost();
  const payload: ProgramSummaryPayload = { answers, closed: false };
  const [id] = host.append({
    role: 'assistant',
    text: host.t('program.summary.title'),
    isHealth: true,
    flow: 'program',
    kind: ProgramMessageKind.summary,
    payload,
  });
  return id!;
}

/**
 * The plan card in the chat (PLAN-4's `ProgramProposalCard`, coach palette).
 * Adjust my plan (COACH-5) lands its revisions through this too: the card's
 * Start, Not now and Discard come back to `setProposalOutcome`.
 */
export function appendProposalMessage(detail: ProgramDetail, warningKey: string | null = null): string {
  const payload: ProgramProposalPayload = { detail, outcome: null, warningKey };
  const [id] = coachHost().append({
    role: 'assistant',
    text: '',
    isHealth: true,
    flow: 'program',
    kind: ProgramMessageKind.proposal,
    payload,
  });
  return id!;
}

/** The member's side of a programme turn: a chip's label, never anything typed. */
export function appendProgramUser(label: string): string {
  const [id] = coachHost().append({ role: 'user', text: label, isHealth: true });
  return id!;
}

/** Closes a chip question with the chip that answered it. */
export function markProgramAnswered(messageId: string, label: string): void {
  coachHost().markAnswered(messageId, label);
}

/** Replaces a programme bubble's payload (a multi-select's selection, a proposal's outcome). */
export function updatePayload<T>(messageId: string, change: (payload: T) => T): void {
  coachHost().update(messageId, (message) => ({ ...message, payload: change(message.payload as T) }));
}

/**
 * Closes every open programme question `predicate` matches, so it stops
 * answering: a chip question as answered, a multi-select or a summary as
 * closed.
 */
export function closeProgramQuestions(predicate: (message: CoachMessage) => boolean): void {
  const host = coachHost();
  for (const message of host.messages()) {
    if (!isOpenProgramQuestion(message) || !predicate(message)) continue;
    host.update(message.id, (current) => {
      if (multiSelectOf(current)) return { ...current, payload: { ...(current.payload as ProgramMultiSelect), closed: true } };
      if (summaryOf(current)) return { ...current, payload: { ...(current.payload as ProgramSummaryPayload), closed: true } };
      return { ...current, answered: true };
    });
  }
}
