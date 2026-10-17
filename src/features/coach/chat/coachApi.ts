/**
 * `POST /coach` for a free-text chat: the Android port of iOS
 * `CoachViewModel.invokeCoachFunction` with `CoachRequest` / `CoachResponse`
 * (Models/CoachPlan.swift).
 *
 *   Request:  { locale: 'en' | 'is', messages: [{ role, content }] }
 *   Response: { ok, data: { reply, plan?, freeMessages? } }
 *
 * `locale` decides the language of the reply and of the server's own privacy
 * notice on a conversation's first answer, whatever language the member
 * types in. A chat body never brings a plan back, so only `reply` and
 * `freeMessages` are read here (the day-plan flow sends its own `intake`).
 *
 * The API client sends the bearer token, unwraps the envelope and turns a
 * refusal into a typed error: `429 coach-daily-limit`, `429 coach-free-limit`
 * (with `freeMessages` and `upgrade`) and `503 coach-busy` arrive as problems.
 */
import { apiPost, decodeCoachFreeMessages, type CoachFreeMessages } from '../../../api';
import type { Lang } from '../../../i18n';

/** One chat turn as the model reads it (iOS `CoachAPIMessage`). */
export interface CoachApiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** `data` of the answer (iOS `CoachResponse`, chat half). */
export interface CoachChatReply {
  /** Always sent; an empty or missing one reads as "" (the store shows `coach.ai_unavailable`). */
  readonly reply: string;
  /** What is left of a free account's messages; absent for members and pass holders. */
  readonly freeMessages: CoachFreeMessages | null;
}

/** The `locale` the Coach is asked in: Icelandic, else English (iOS `apiLocale`). */
export function coachLocale(language: Lang | string): 'en' | 'is' {
  return language === 'is' ? 'is' : 'en';
}

/**
 * Reads the answer the way iOS `CoachResponse.init(from:)` does: a missing or
 * wrong-typed `reply` is "", and a count this build cannot read never costs
 * the answer it rides on (fail-soft).
 */
export function decodeCoachChatReply(data: unknown): CoachChatReply {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    reply: typeof body.reply === 'string' ? body.reply : '',
    freeMessages: decodeCoachFreeMessages(body.freeMessages) ?? null,
  };
}

/** Sends the conversation so far (already filtered and capped by `modelMessages`). */
export async function postCoachChat(language: Lang | string, messages: readonly CoachApiMessage[]): Promise<CoachChatReply> {
  return apiPost<CoachChatReply>(
    '/coach',
    { locale: coachLocale(language), messages },
    { decode: decodeCoachChatReply },
  );
}
