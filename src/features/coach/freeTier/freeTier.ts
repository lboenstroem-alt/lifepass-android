/**
 * The Coach's allowances (server PR #239), as iOS `CoachViewModel` keeps
 * them (ViewModels/CoachViewModel.swift, "The free tier"):
 *
 * - An account with neither a membership nor an active visitor pass
 *   (`past_due` included) gets 3 Coach messages in any rolling 30 days, then
 *   a membership prompt. Nothing ever tells such an account "back tomorrow":
 *   tomorrow brings it nothing, and the honest answer is when the next free
 *   message frees up, or a membership.
 * - Members and pass holders get 10 a UTC day (`429 coach-daily-limit`).
 * - `503 coach-busy` is a burst guard that clears within a minute and spends
 *   nothing: never a lock.
 *
 * The count arrives three ways: the profile's `coach` block (before the first
 * message), `freeMessages` on each answer to a free account, and the `429
 * coach-free-limit` refusal. THE NEWER READING WINS: the Coach tab hands the
 * store the profile it has on every visit, often the one read at launch, and
 * applied blindly that read put "3 free messages left" back after an answer
 * had said 2. So a profile block is taken only when its read was SENT after
 * the last count this session heard from the Coach route itself.
 *
 * Pure functions over `FreeTierState`, so the rules are tested without the
 * store and the store applies them in one place.
 */
import type { ApiError, CoachFreeMessages, CoachUpgrade } from '../../../api';
import type { ProfileCoachBlock } from '../../../api/profile';

/** Which allowance a Coach 429 says is spent (iOS `CoachLimitKind`). */
export type CoachLimitKind = 'daily' | 'free';

export interface FreeTierState {
  /** A member's or pass holder's daily cap is spent (until a new chat or tomorrow). */
  readonly limitReached: boolean;
  /** What is left of a free account's messages; null for a member or pass holder, or before anything said. */
  readonly freeMessages: CoachFreeMessages | null;
  /** The free messages are used up: the AI path is locked until one frees up or a membership. */
  readonly freeLimitReached: boolean;
  /** Where Get a membership goes when the app has no screen for it. */
  readonly upgrade: CoachUpgrade | null;
  /** When this session last heard the count from the Coach route (`Date.now()`), or null. */
  readonly freeCountHeardAt: number | null;
}

export const INITIAL_FREE_TIER: FreeTierState = {
  limitReached: false,
  freeMessages: null,
  freeLimitReached: false,
  upgrade: null,
  freeCountHeardAt: null,
};

/** Nothing left, and the next one has not freed up yet (iOS `CoachFreeMessages.isExhausted`). */
export function isExhausted(counts: CoachFreeMessages, now: number = Date.now()): boolean {
  if (counts.remaining > 0) return false;
  if (!counts.resetsAt) return true;
  return counts.resetsAt.getTime() > now;
}

/** Either allowance spent: everything that would call the model checks this; the wizards never do. */
export function isAILocked(state: Pick<FreeTierState, 'limitReached' | 'freeLimitReached'>): boolean {
  return state.limitReached || state.freeLimitReached;
}

/**
 * The profile's `coach` block (iOS `applyProfileCoach`). A null block (the
 * server's own read failed), a missing tier or an unknown one changes
 * nothing. Taken only when nothing has been heard from the Coach route this
 * session, or when its read was sent after that (`readAt`, the app store's
 * `profileReadAt`); a block with no read time never overrides an answer. A
 * member or pass tier clears the lock and the counts, whatever an earlier
 * answer said (a membership bought from the prompt).
 */
export function applyProfileCoach(
  state: FreeTierState,
  block: ProfileCoachBlock | null | undefined,
  readAt: Date | null | undefined,
  now: number = Date.now(),
): FreeTierState {
  if (!block) return state;
  const tier = block.tier;
  if (!tier || tier === 'unknown') return state;
  if (state.freeCountHeardAt !== null) {
    if (!readAt || readAt.getTime() <= state.freeCountHeardAt) return state;
  }
  if (tier === 'free') {
    let next = state;
    if (block.freeMessages) {
      next = { ...next, freeMessages: block.freeMessages, freeLimitReached: isExhausted(block.freeMessages, now) };
    }
    if (block.upgrade) next = { ...next, upgrade: block.upgrade };
    return next;
  }
  return { ...state, freeMessages: null, freeLimitReached: false, upgrade: null };
}

/**
 * An answer to a free account carries what is left (iOS
 * `recordFreeMessages`). The lock follows it at once: the answer that
 * spends the last free message is followed by the membership prompt, not by
 * a refusal at the next send.
 */
export function recordFreeMessages(
  state: FreeTierState,
  counts: CoachFreeMessages | null | undefined,
  now: number = Date.now(),
): FreeTierState {
  if (!counts) return state;
  return { ...state, freeCountHeardAt: now, freeMessages: counts, freeLimitReached: isExhausted(counts, now) };
}

/**
 * Every Coach 429 goes through here (iOS `applyCoachLimit`), so no call site
 * can mistake one allowance for the other. A 429 on this route means one
 * thing, the account's own allowance is spent. Returns the kind, or null for
 * anything that is not a 429 (then the state is unchanged).
 */
export function applyCoachLimit(
  state: FreeTierState,
  error: ApiError,
  now: number = Date.now(),
): { readonly state: FreeTierState; readonly kind: CoachLimitKind | null } {
  if (error.status !== 429) return { state, kind: null };
  if (error.isProblem('coach-free-limit')) {
    const counts: CoachFreeMessages = error.freeMessages ?? {
      limit: state.freeMessages?.limit ?? 3,
      remaining: 0,
      windowDays: 30,
      resetsAt: state.freeMessages?.resetsAt,
    };
    return {
      kind: 'free',
      state: {
        ...state,
        freeCountHeardAt: now,
        freeLimitReached: true,
        freeMessages: counts,
        upgrade: error.upgrade ?? state.upgrade,
      },
    };
  }
  return { kind: 'daily', state: { ...state, limitReached: true } };
}

/** A burst refusal from the Coach's network guard (iOS `isCoachBusy`): a moment's wait, never a lock. */
export function isCoachBusy(error: ApiError): boolean {
  return error.status === 503 && error.isProblem('coach-busy');
}

/**
 * A new chat or a restored one (iOS `resetChat` / `restoreSession`): the
 * daily lock clears, and the free lock is RECOMPUTED from what is left,
 * never simply cleared. The allowance belongs to the account, not the chat.
 */
export function forNewChat(state: FreeTierState, now: number = Date.now()): FreeTierState {
  return {
    ...state,
    limitReached: false,
    freeLimitReached: state.freeMessages ? isExhausted(state.freeMessages, now) : false,
  };
}

/** The input's placeholder key: never "back tomorrow" to a free account (iOS `inputPromptKey`). */
export function inputPromptKey(state: Pick<FreeTierState, 'limitReached' | 'freeLimitReached'>): string {
  if (state.freeLimitReached) return 'coach.input.free_limit';
  if (state.limitReached) return 'coach.input.limit_reached';
  return 'coach.input.placeholder';
}
