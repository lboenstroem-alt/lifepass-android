/* eslint lifepass/no-literal-copy: "error" */
/**
 * One turn of the Coach chat: the Android form of iOS `CoachChatMessage`
 * (ViewModels/CoachViewModel.swift), with the flow-specific fields iOS keeps
 * on the message (plan, programme summary, proposal...) folded into a
 * flow-owned `kind` and `payload` that the flow's own renderer draws.
 *
 * THE PRIVACY SWITCH is `isHealth`. A turn marked with it is never written to
 * the saved chats, never put in the `messages` a free chat sends to the
 * model, and is removed outright when the health data on the phone is wiped:
 * a goal, an injured knee or a body detail must never come back to the model
 * three chats later inside "here is the conversation so far".
 */
import type { CoachFlowId } from '../flows/types';
import type { QuestionOption } from '../../../types/coach';
import type { Venue } from '../../../types/venue';

export type CoachRole = 'user' | 'assistant';

export interface CoachMessage {
  readonly id: string;
  readonly role: CoachRole;
  /** What the bubble says. For a card-bearing reply, its intro (what a saved chat keeps). */
  readonly text: string;

  /** The health lane (see the file comment). */
  readonly isHealth?: boolean;
  /** The flow that added it: a chip on its question goes back to that flow, and its `kind` to that flow's renderer. */
  readonly flow?: CoachFlowId;

  // A question bubble (the wizards' chips).
  /** Present (non-empty) on a question bubble. */
  readonly options?: readonly QuestionOption[];
  /** The question was answered or abandoned: its chips are closed. */
  readonly answered?: boolean;
  /** The label of the chip that answered it. */
  readonly selectedAnswer?: string;

  /** Venue cards under the intro (full venue rows: price pill, heart, Book it by slug). */
  readonly venues?: readonly Venue[];
  /** The category strip under the text ("What would you like to find nearby?"). */
  readonly showCategoryStrip?: boolean;

  /** A flow's own bubble: drawn by `flows[flow].renderers[kind]`. */
  readonly kind?: string;
  readonly payload?: unknown;
  /**
   * The chat lands on this message's TOP when it arrives, not its bottom: a
   * day plan is taller than the screen, and the member reads down through it
   * (iOS `last.plan == nil ? .bottom : .top`). Only the day plan sets it;
   * every other bubble, a proposal or summary card included, scrolls to the
   * end, where its chips and buttons are.
   */
  readonly anchorTop?: boolean;
}

/** A flow's own bubble (a `kind` its flow draws). */
export type CoachFlowBubble = CoachMessage & { readonly kind: string; readonly flow: CoachFlowId };

export function isFlowBubble(message: CoachMessage): message is CoachFlowBubble {
  return typeof message.kind === 'string' && message.kind.length > 0 && message.flow !== undefined;
}

/**
 * A message as a flow or the store hands it in: the id is minted on append
 * (iOS `nextId()`), unless the caller fixed one.
 */
export type CoachMessageDraft = Omit<CoachMessage, 'id'> & { readonly id?: string };

/** The stock greeting's id (iOS `m0`). Only an untouched greeting is re-localised. */
export const GREETING_ID = 'm0';

/** The greeting in `text` (already translated `coach.greeting`). */
export function greetingMessage(text: string): CoachMessage {
  return { id: GREETING_ID, role: 'assistant', text };
}

/** A question bubble whose chips can still answer (iOS `questionOptions != nil && !questionAnswered`). */
export function isOpenQuestion(message: CoachMessage): boolean {
  return message.options !== undefined && !message.answered;
}

/** A question bubble, answered or not (iOS `questionOptions != nil`). */
export function isQuestion(message: CoachMessage): boolean {
  return message.options !== undefined;
}

/**
 * The turns that may leave the phone or be saved: no question bubbles, no
 * category strips, no health turns. iOS applies exactly this filter in both
 * `modelMessages()` and `persistCurrentSession()`. A venue-card reply stays,
 * as its intro text (the AI's own words; dropping them made the model lose
 * its earlier recommendations on a follow-up).
 */
export function isConversationTurn(message: CoachMessage): boolean {
  return !isQuestion(message) && !message.showCategoryStrip && !message.isHealth;
}

/** True once the member has said anything (iOS `hasStartedChat`): the empty state gives way to the list. */
export function hasStartedChat(messages: readonly CoachMessage[]): boolean {
  return messages.some((message) => message.role === 'user');
}

/** The last question bubble that can still answer (iOS `messages.last(where: questionOptions != nil && !questionAnswered)`). */
export function lastOpenQuestion(messages: readonly CoachMessage[]): CoachMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isOpenQuestion(messages[index]!)) return messages[index]!;
  }
  return null;
}
