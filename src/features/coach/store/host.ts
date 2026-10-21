/**
 * What a Coach flow (COACH-2 to COACH-5) may do to the chat: the store's
 * side of the flow contract (../flows/types.ts). iOS keeps every flow inside
 * `CoachViewModel`, so each one reaches `messages`, `isTyping` and
 * `chatGeneration` directly; here the flows are separate modules and reach
 * them through this host, which the store installs when it is created.
 *
 *   import { coachHost } from '../store/host';
 *
 *   const host = coachHost();
 *   host.append({ role: 'user', text: label }, { role: 'assistant', text: q.text, options: q.options, flow: 'venueWizard' });
 *
 *   const busy = host.busy();          // the typing dots, this chat's generation
 *   try {
 *     const venues = await fetchVenues(...);
 *     if (!busy.isCurrent()) return;   // New chat, a restore or a sign-out meanwhile: drop it
 *     host.append({ role: 'assistant', text: intro, venues });
 *   } finally {
 *     busy.end();
 *   }
 *
 * A flow that calls `/coach` hands the same token to the counts:
 * `host.recordFreeMessages(reply.freeMessages, busy)` (before its
 * `isCurrent` check, so a New chat mid-reply still counts the message) and
 * `host.applyCoachLimit(error, busy)`.
 *
 * Read the host inside a call, never at module load: the store installs it
 * when its module loads, which may be after the flow's.
 */
import type { ApiError, CoachFreeMessages } from '../../../api';
import type { Lang, Params } from '../../../i18n';
import type { CoachApiMessage } from '../chat/coachApi';
import type { CoachLimitKind } from '../freeTier/freeTier';
import type { CoachMessage, CoachMessageDraft } from './messages';

/**
 * A place the Coach sends the member (iOS `ProgramRoute`'s screen and tab
 * routes; the sheets a flow opens go through their own slots, e.g.
 * `openBodySheet`, `openChangeDays`). Performed once, by the screen.
 */
export type CoachRoute =
  /** The memberships screen (iOS `.plansSheet`). */
  | { readonly kind: 'plans' }
  /** Account (iOS `.accountSheet`). */
  | { readonly kind: 'account' }
  /** The Plan tab (iOS `.openPlan`). */
  | { readonly kind: 'planTab' }
  /** Plan, then its past plans (iOS `.openPastPlans`). */
  | { readonly kind: 'pastPlans' }
  /** Plan, then the saved proposal (iOS `.reviewSavedProposal`). */
  | { readonly kind: 'savedProposal' }
  /** A venue's page by slug (a plan step's venue before its full row is in). */
  | { readonly kind: 'venue'; readonly slug: string }
  /** A public sight's card (a plan step's sight). */
  | { readonly kind: 'sight'; readonly slug: string };

/** Async work in the chat: the typing dots are on until `end`, and `isCurrent` says the chat is still the one it started in. */
export interface CoachBusyToken {
  /** The chat generation the work started in. */
  readonly generation: number;
  /** False once the chat was reset or restored, or the member signed out: drop the result instead of appending it to another chat. */
  isCurrent(): boolean;
  /**
   * False once the member it started for signed out (or another account
   * signed in). A New chat keeps it true: an answer from `/coach` still
   * spent this member's allowance, so its counts are kept; after a sign-out
   * they belong to nobody on screen. Pass the token to
   * `recordFreeMessages` / `applyCoachLimit` and they check it.
   */
  sameAccount(): boolean;
  /** The work is done: the typing dots go, unless the chat changed meanwhile (then the new chat owns them). */
  end(): void;
}

export interface CoachHost {
  /** The Coach's language (the account language). */
  language(): Lang;
  /** Translate in the Coach's language (iOS `CoachViewModel.t`). */
  t(key: string, params?: Params): string;

  /** The chat as it is now. */
  messages(): readonly CoachMessage[];
  /** Appends in order, minting ids (iOS `nextId()`); returns the ids. */
  append(...drafts: CoachMessageDraft[]): string[];
  /** Replaces one message by id with `change(message)`. */
  update(id: string, change: (message: CoachMessage) => CoachMessage): void;
  /** Removes every message `predicate` matches. */
  remove(predicate: (message: CoachMessage) => boolean): void;
  /** Closes a question bubble with the chip that answered it. */
  markAnswered(id: string, selectedAnswer?: string): void;

  /** A reply or other work is in flight (iOS `isTyping`). */
  isTyping(): boolean;
  /** Starts async work (sets the typing dots). Always `end()` it. */
  busy(): CoachBusyToken;

  /** Either allowance is spent: nothing may call the model (the wizards still work). */
  isAILocked(): boolean;
  /** The free lock, and the daily lock (each flow words its own fallback). */
  freeLimitReached(): boolean;
  limitReached(): boolean;
  /**
   * A Coach 429 from any call to `/coach` (iOS `applyCoachLimit`). Pass the
   * busy token the call ran under: a refusal that lands after the member
   * signed out locks nobody (the next account never inherits it).
   */
  applyCoachLimit(error: ApiError, token?: CoachBusyToken): CoachLimitKind | null;
  /** `freeMessages` from any answer to `/coach` (iOS `recordFreeMessages`); the token as above. */
  recordFreeMessages(counts: CoachFreeMessages | null | undefined, token?: CoachBusyToken): void;

  /** iOS `abandonOpenQuestions`: every flow's open question dropped and every unanswered bubble closed. */
  abandonOpenQuestions(): void;
  /** The history a chat call sends (filtered and capped; see ../chat/modelMessages.ts). */
  modelMessages(): CoachApiMessage[];
  /** Asks the screen to go somewhere (performed once). */
  route(route: CoachRoute): void;
}

let installed: CoachHost | null = null;

/** The store installs itself here (once, when its module loads). */
export function installCoachHost(host: CoachHost): void {
  installed = host;
}

/** The host. Loads the store first if nothing has yet (a flow's own test, say). */
export function coachHost(): CoachHost {
  if (!installed) {
    // The store installs itself as it loads. Required lazily: the store
    // imports the flows, and a flow imports this file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./coachStore');
  }
  if (!installed) throw new Error('coachHost: the Coach store did not install its host');
  return installed;
}
