/**
 * `POST /coach` for a free-text chat: the Android port of iOS
 * `CoachViewModel.invokeCoachFunction` with `CoachRequest` / `CoachResponse`
 * (Models/CoachPlan.swift).
 *
 *   Request:  { locale: 'en' | 'is', messages: [{ role, content }], cards: ['classes'] }
 *   Response: { ok, data: { reply, classes?, plan?, freeMessages? } }
 *
 * `locale` decides the language of the reply and of the server's own privacy
 * notice on a conversation's first answer, whatever language the member
 * types in. A chat body never brings a plan back, so only `reply`, `classes`
 * and `freeMessages` are read here (the day-plan flow sends its own `intake`,
 * and never `cards`).
 *
 * CLASS CARDS (API 0.36.0). `cards: ['classes']` asks for `classes` on a
 * timetable answer and a short reply that points at them. `locale` and
 * `cards` are extra keys an older server ignores (its body schema strips
 * unknown keys). Should a server refuse `cards` with a 400 anyway, the same
 * turn is sent once more without it: if that answers, the key was the
 * problem and the caller stops asking (`cardsRefused`); if it fails too, its
 * error is the real one. A 400 is decided before the allowance is counted, so
 * the retry never costs a second message. Nothing else is ever retried.
 *
 * The API client sends the bearer token, unwraps the envelope and turns a
 * refusal into a typed error: `429 coach-daily-limit`, `429 coach-free-limit`
 * (with `freeMessages` and `upgrade`) and `503 coach-busy` arrive as problems.
 */
import { apiPost, decodeCoachFreeMessages, isApiError, type CoachFreeMessages } from '../../../api';
import type { Lang } from '../../../i18n';
import type { CoachPlanClass } from '../../classes/sheet';
import { decodeClassCards } from '../dayPlan/decode';

/** One chat turn as the model reads it (iOS `CoachAPIMessage`). */
export interface CoachApiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** What the chat asks for: class cards (iOS `CoachRequest.chatCards`). */
export const CHAT_CARDS: readonly string[] = ['classes'];

/** `data` of the answer (iOS `CoachResponse`, chat half). */
export interface CoachChatReply {
  /** Always sent; an empty or missing one reads as "" (the store shows `coach.ai_unavailable`). */
  readonly reply: string;
  /** What is left of a free account's messages; absent for members and pass holders. */
  readonly freeMessages: CoachFreeMessages | null;
  /** The classes a timetable answer is about (six at most); empty from an older server or a plain request. */
  readonly classes: readonly CoachPlanClass[];
}

/** The answer, and whether the server refused the `cards` key (the plain retry answered). */
export interface CoachChatResult extends CoachChatReply {
  readonly cardsRefused: boolean;
}

/** The `locale` the Coach is asked in: Icelandic, else English (iOS `apiLocale`). */
export function coachLocale(language: Lang | string): 'en' | 'is' {
  return language === 'is' ? 'is' : 'en';
}

/**
 * Reads the answer the way iOS `CoachResponse.init(from:)` does: a missing or
 * wrong-typed `reply` is "", and a count or a class card this build cannot
 * read never costs the answer it rides on (fail-soft).
 */
export function decodeCoachChatReply(data: unknown): CoachChatReply {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    reply: typeof body.reply === 'string' ? body.reply : '',
    freeMessages: decodeCoachFreeMessages(body.freeMessages) ?? null,
    classes: decodeClassCards(body.classes),
  };
}

export interface PostCoachChatOptions {
  /** Ask for class cards (`cards: ['classes']`). Off once a server has refused the key this session. */
  readonly cards?: boolean;
}

function post(language: Lang | string, messages: readonly CoachApiMessage[], cards: boolean): Promise<CoachChatReply> {
  const body = cards
    ? { locale: coachLocale(language), messages, cards: CHAT_CARDS }
    : { locale: coachLocale(language), messages };
  return apiPost<CoachChatReply>('/coach', body, { decode: decodeCoachChatReply });
}

/** Sends the conversation so far (already filtered and capped by `modelMessages`). */
export async function postCoachChat(
  language: Lang | string,
  messages: readonly CoachApiMessage[],
  options: PostCoachChatOptions = {},
): Promise<CoachChatResult> {
  if (!options.cards) return { ...(await post(language, messages, false)), cardsRefused: false };
  try {
    return { ...(await post(language, messages, true)), cardsRefused: false };
  } catch (error) {
    if (!isApiError(error) || error.status !== 400) throw error;
  }
  // Once, without the new key: exactly what a build without cards sends.
  return { ...(await post(language, messages, false)), cardsRefused: true };
}
