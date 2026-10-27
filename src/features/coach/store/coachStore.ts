/* eslint lifepass/no-literal-copy: "error" */
/**
 * The Coach's state and behaviour: the Android port of iOS `CoachViewModel`
 * (ViewModels/CoachViewModel.swift), minus the four flows (the venue wizard,
 * the day plan, the programme wizard, Adjust my plan), which plug in through
 * ../flows (COACH-2 to COACH-5) and reach the chat through ./host.ts.
 *
 * ONE STORE FOR THE APP SESSION. iOS creates the view model once in
 * `MainTabView`, so the conversation survives tab switches; a zustand store
 * does the same here, and screens and other tabs (Home's parked prompt) reach
 * it without a React tree. Sign-out resets it (./register.ts): the next
 * member on the phone never sees the last one's chat, counts or locks.
 *
 * THE STORE OUTLIVES THE ACCOUNT, the iOS view model does not (it goes with
 * the tabs). Two things make up for that:
 * - an ACCOUNT EPOCH, bumped at every sign-out and member switch: a reply,
 *   a refusal or a parked entry still in flight then lands nowhere, and its
 *   counts and locks are not the next member's;
 * - THE CLAIM GATE: the saved chats are read and written only once the
 *   sign-in hook has claimed them for the member on screen (`claimedFor`,
 *   iOS `claimSavedSessions` before the view model is built). Nothing a
 *   screen does can read the file before another member's chats are gone.
 *
 * What lives here:
 * - the messages, the input, the typing dots and the CHAT GENERATION: New
 *   chat and a restore bump it, and every reply in flight checks it before
 *   appending, so a late answer never lands in the next conversation;
 * - the send pipeline: the flows first (../flows/types.ts, in iOS order), and
 *   only words no flow took reach the model, and only while no allowance is
 *   spent;
 * - the chat call (`POST /coach`), its venue documents, its class cards
 *   (API 0.36.0: a class question answered with the classes, each with
 *   Book), its errors (429 is an allowance spent, 503 `coach-busy` a
 *   moment's wait);
 * - the free tier (../freeTier), the saved chats (../persistence), the
 *   health lane (`dropHealthMessages`) and the parked entries from other tabs.
 */
import { create } from 'zustand';

import { errorMessage, isApiError, type ApiError, type CoachFreeMessages } from '../../../api';
import type { ProfileCoachBlock } from '../../../api/profile';
import type { CoachPlanClass } from '../../classes/sheet';
import { currentLanguage, translate, type Lang, type Params } from '../../../i18n';
import { useIntentStore, type CoachProgramEntry } from '../../../stores/intentStore';
import { postCoachChat, type CoachApiMessage } from '../chat/coachApi';
import { modelMessages as buildModelMessages } from '../chat/modelMessages';
import { parseVenuePayload, resolveVenueCards, venuesReplyAsText } from '../chat/venueReply';
import { adjustFlow } from '../flows/adjust';
import { dayPlanFlow } from '../flows/dayPlan';
import { planEditFlow } from '../flows/planEdit';
import { offersPlanEdit } from '../planEdit/availability';
import { programFlow } from '../flows/program';
import {
  PASSED_RESUMES_AT,
  runSendPipeline,
  SEND_PIPELINE,
  type CoachFlow,
  type CoachFlowEntry,
  type CoachFlowId,
  type CoachSendOptions,
  type CoachSendStep,
  type CoachWizardCategory,
} from '../flows/types';
import { venueWizardFlow } from '../flows/venueWizard';
import {
  applyCoachLimit as applyLimit,
  applyProfileCoach as applyProfile,
  forNewChat,
  INITIAL_FREE_TIER,
  isAILocked,
  isCoachBusy,
  recordFreeMessages as recordCounts,
  type CoachLimitKind,
  type FreeTierState,
} from '../freeTier/freeTier';
import {
  buildSession,
  loadSavedSessions,
  messagesFromSession,
  onSessionsForgotten,
  upsertSession,
  writeSavedSessions,
  type ChatSession,
  type RecentChat,
} from '../persistence/sessions';
import { installCoachHost, type CoachBusyToken, type CoachHost, type CoachRoute } from './host';
import {
  greetingMessage,
  GREETING_ID,
  isOpenQuestion,
  type CoachMessage,
  type CoachMessageDraft,
} from './messages';

// ---------------------------------------------------------------------------
// The flows

/** The flows the pipeline runs, by id (COACH-2 to COACH-5, and COACH-6's plan change). */
export const COACH_FLOWS: Readonly<Record<CoachFlowId, CoachFlow>> = {
  program: programFlow,
  adjust: adjustFlow,
  planEdit: planEditFlow,
  venueWizard: venueWizardFlow,
  dayPlan: dayPlanFlow,
};

/** Words the member typed: every flow may take them, and a schedule question goes to the chat. */
export const TYPED_SEND: CoachSendOptions = { detectPlanRequest: true, detectScheduleQuestion: true };

/**
 * A prompt the app parked (Home's cards and chips, Plan's "plan my day"):
 * the app's own wording for a card that has always run the venue wizard or
 * the chat, so a stray "plan" or "classes" in it must not move it.
 */
export const PARKED_SEND: CoachSendOptions = { detectPlanRequest: false, detectScheduleQuestion: false };

/**
 * A category tile or chip id to the venue wizard's category (iOS
 * `CoachViewModel.wizardCategory`). Wellness opens the spa wizard.
 */
export const WIZARD_CATEGORY: Readonly<Record<string, CoachWizardCategory>> = {
  pools: 'swimming',
  gyms: 'gym',
  wellness: 'spa',
  spa: 'spa',
  yoga: 'yoga',
  golf: 'golf',
  lagoon: 'lagoon',
};

/** How long a parked entry waits for a reply in flight (iOS: 10 s, polled every 0.2 s). */
export const PARKED_WAIT_MS = 10_000;
export const PARKED_POLL_MS = 200;

// ---------------------------------------------------------------------------
// State

export interface CoachState extends FreeTierState {
  readonly messages: readonly CoachMessage[];
  readonly inputText: string;
  /** A reply (or a flow's work) is in flight: the typing dots, and the send arrow waits. */
  readonly isTyping: boolean;
  /** Bumped by New chat and a restore; work in flight drops its result when it changed. */
  readonly generation: number;
  /** The saved chats, newest first (the drawer's RECENTS). */
  readonly savedSessions: readonly ChatSession[];
  readonly sessionsLoaded: boolean;
  /** The saved session the chat on screen is (set by a save or a restore), so saving again upserts it. */
  readonly currentSessionId: string | null;
  /** Somewhere a flow asked the screen to go; the screen performs it once and clears it. */
  readonly pendingRoute: CoachRoute | null;
  /** The member this chat belongs to (lower case), or null before a sign-in. */
  readonly memberId: string | null;
  /**
   * The member whose saved chats the sign-in hook has claimed (lower case).
   * The saved chats are read and written only while it is `memberId`.
   */
  readonly claimedFor: string | null;
}

export interface CoachActions {
  setInputText(text: string): void;
  /** Re-localises the stock greeting while it is the only message (iOS `updateLanguage`). */
  updateLanguage(): void;

  /** Typed words (or a parked prompt with its options). See the file comment. */
  send(text: string, options?: CoachSendOptions): Promise<void>;
  /** A prompt parked by another tab (iOS `sendParkedPrompt`). */
  sendParkedPrompt(text: string): Promise<void>;
  /** A parked programme or Adjust entry (iOS `startProgram(parked:)`). */
  startParkedProgram(entry: CoachProgramEntry): Promise<void>;
  /** Takes whatever another tab parked for the Coach and runs it (every Coach appearance). */
  consumeParkedEntries(): Promise<void>;

  /** A category tile, the strip or the lagoon chip (iOS `startSearch`): the venue wizard, never the model. */
  startSearch(categoryKey: string, labelKey: string): void;
  /** "What's nearby?", "After work", "Something new" (iOS `showCategoryPicker`). */
  showCategoryPicker(chipLabelKey: string): void;
  /** "Plan my day" (iOS `startPlan(labelKey:)`). */
  startPlan(labelKey: string): Promise<void>;
  /** "Get a 4-week plan" (iOS `startProgram(entry: .chip)`). */
  startProgram(): Promise<void>;
  /** "Adjust my plan" (iOS `startAdjust`). */
  startAdjust(): Promise<void>;
  /** "Change my plan": the Coach asks what to change (iOS `startPlanEdit`). */
  startPlanEdit(): Promise<void>;
  /**
   * Words a plan-edit chip sent that are not a plan change: through the
   * pipeline from the programme offer, then the model (see `CoachHost.resumeSend`).
   */
  resumeSend(text: string): Promise<void>;
  /** A chip on a question bubble: back to the flow that asked it. */
  selectOption(messageId: string, value: string, label: string): Promise<void>;
  /** Close or reopen a reply's class list (iOS `setClassCardsHidden`); the cards stay. */
  setClassCardsHidden(hidden: boolean, messageId: string): void;
  /** iOS `abandonOpenQuestions`. */
  abandonOpenQuestions(): void;

  /** New chat (iOS `resetChat`): the chat on screen is saved first. */
  resetChat(): void;
  /** A drawer recent (iOS `restoreSession`); a no-op for the chat already open. */
  restoreSession(sessionId: string): void;
  /** Reads the saved chats (once; again after a sign-in or a forget). */
  loadSessions(): Promise<void>;

  /** The profile's coach block, with when its read was sent (iOS `applyProfileCoach`). */
  applyProfileCoach(block: ProfileCoachBlock | null | undefined, readAt: Date | null | undefined): void;
  /** `token`: the busy token the call ran under; counts that land after a sign-out are dropped. */
  recordFreeMessages(counts: CoachFreeMessages | null | undefined, token?: CoachBusyToken): void;
  applyCoachLimit(error: ApiError, token?: CoachBusyToken): CoachLimitKind | null;

  /** The health data was wiped (iOS `dropHealthMessages`): every health turn leaves the chat. */
  dropHealthMessages(): void;
  /** The saved chats were forgotten (sign-out): the recents go from the screen too. */
  sessionsForgotten(): void;
  /**
   * A member is becoming the signed-in one (called synchronously as the
   * sign-in starts, before the claim): a chat, counts and locks that were
   * someone else's are dropped, and the saved chats stay closed until
   * `sessionsClaimed`.
   */
  signedIn(memberId: string): void;
  /**
   * The saved chats on disk are now this member's (the claim ran): anything
   * read before it is thrown away and the list is read again.
   */
  sessionsClaimed(memberId: string): void;
  /** Everything goes (sign-out). */
  resetForSignOut(): void;

  /** Asks the screen to go somewhere. */
  route(route: CoachRoute): void;
  /** The screen takes the pending route (cleared). */
  takeRoute(): CoachRoute | null;
  /** Starts async work: the typing dots on, this chat's generation captured. */
  busy(): CoachBusyToken;
}

export type CoachStore = CoachState & CoachActions;

// ---------------------------------------------------------------------------
// Module state

/** iOS starts its message ids at 100 ("101" is the first). */
const FIRST_ID = 100;
let idCounter = FIRST_ID;

function nextId(): string {
  idCounter += 1;
  return String(idCounter);
}

/** Advance the counter past restored ids, so a new message never repeats one. */
function advanceIdCounterPast(messages: readonly { readonly id: string }[]): void {
  for (const message of messages) {
    const value = Number.parseInt(message.id, 10);
    if (Number.isFinite(value) && String(value) === message.id && value > idCounter) idCounter = value;
  }
}

/**
 * Bumped whenever the saved chats are forgotten. A save or a read that
 * started before a sign-out must never write one member's chat back after
 * it, so each captures this and stands down when it moved.
 */
let storageEpoch = 0;
/**
 * Bumped at every sign-out and member switch. Work for the Coach captures it
 * when it starts (a reply, a parked entry, a flow's busy token) and stands
 * down when it moved: the iOS view model dies with the tabs at sign-out, so
 * its late replies write to nothing; this store lives on.
 */
let accountEpoch = 0;
/**
 * A `send` is running (set synchronously after its guard, before its first
 * await). iOS `send` runs on the main actor and `callAI` sets `isTyping`
 * before it suspends; here the flows' steps are awaited first, and a second
 * parked prompt, a chip or a tile must not slip into that gap. Cleared by
 * its own send, or by a new chat / sign-out (whose chat no longer waits).
 */
let activeSend: object | null = null;
/**
 * Whether the chat asks for class cards (iOS `sendsClassCards`). Turned off
 * for the rest of the app session once a server has refused the `cards` key
 * with a 400 that the plain request then got past; back on for the next
 * account (iOS builds a new view model at sign-in).
 */
let sendsClassCards = true;
/** Saves run one after another, in the order they were made. */
let saveChain: Promise<void> = Promise.resolve();
let sessionsLoading: Promise<void> | null = null;

function language(): Lang {
  return currentLanguage();
}

function tr(key: string, params?: Params): string {
  return translate(key, language(), params);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freshChat(): CoachMessage[] {
  return [greetingMessage(tr('coach.greeting'))];
}

const initialState = (): CoachState => ({
  ...INITIAL_FREE_TIER,
  messages: freshChat(),
  inputText: '',
  isTyping: false,
  generation: 0,
  savedSessions: [],
  sessionsLoaded: false,
  currentSessionId: null,
  pendingRoute: null,
  memberId: null,
  claimedFor: null,
});

function freeTierOf(state: CoachState): FreeTierState {
  return {
    limitReached: state.limitReached,
    freeMessages: state.freeMessages,
    freeLimitReached: state.freeLimitReached,
    upgrade: state.upgrade,
    freeCountHeardAt: state.freeCountHeardAt,
  };
}

/** Closes every question bubble still open (part of `abandonOpenQuestions`). */
function closeOpenQuestions(messages: readonly CoachMessage[]): readonly CoachMessage[] {
  if (!messages.some(isOpenQuestion)) return messages;
  return messages.map((message) => (isOpenQuestion(message) ? { ...message, answered: true } : message));
}

// ---------------------------------------------------------------------------
// The store

export const useCoachStore = create<CoachStore>()((set, get) => {
  const append = (...drafts: CoachMessageDraft[]): string[] => {
    const created = drafts.map((draft) => ({ ...draft, id: draft.id ?? nextId() }) as CoachMessage);
    set({ messages: [...get().messages, ...created] });
    return created.map((message) => message.id);
  };

  /** Something is in flight: a reply or a flow's work (`isTyping`), or a send still in its flow steps. */
  const isBusy = (): boolean => get().isTyping || activeSend !== null;

  /** The saved chats were claimed for the member on screen (the gate for every read and write). */
  const isClaimed = (): boolean => {
    const { memberId, claimedFor } = get();
    return memberId !== null && claimedFor === memberId;
  };

  const busy = (): CoachBusyToken => {
    const generation = get().generation;
    const account = accountEpoch;
    set({ isTyping: true });
    let ended = false;
    const sameAccount = () => accountEpoch === account;
    return {
      generation,
      isCurrent: () => sameAccount() && get().generation === generation,
      sameAccount,
      end: () => {
        if (ended) return;
        ended = true;
        if (get().generation === generation) set({ isTyping: false });
      },
    };
  };

  const abandonOpenQuestions = () => {
    for (const flow of Object.values(COACH_FLOWS)) {
      try {
        flow.abandon();
      } catch {
        // One flow's failure must not leave another's question answerable.
      }
    }
    set({ messages: closeOpenQuestions(get().messages) });
  };

  const ensureSessionsLoaded = (): Promise<void> => {
    if (get().sessionsLoaded) return Promise.resolve();
    // Never before the claim: the file may still hold another member's chats.
    if (!isClaimed()) return Promise.resolve();
    if (sessionsLoading) return sessionsLoading;
    const epoch = storageEpoch;
    const loading: Promise<void> = loadSavedSessions()
      .then((sessions) => {
        if (epoch !== storageEpoch || !isClaimed()) return;
        // A save made before the read finished is already on screen: it
        // stays on top of what was stored.
        const inMemory = get().savedSessions;
        let merged = sessions;
        for (const session of [...inMemory].reverse()) merged = upsertSession(merged, session);
        set({ savedSessions: merged, sessionsLoaded: true });
      })
      .finally(() => {
        if (sessionsLoading === loading) sessionsLoading = null;
      });
    sessionsLoading = loading;
    return loading;
  };

  /**
   * iOS `persistCurrentSession`: the chat on screen saved as text (see
   * ../persistence/sessions.ts), upserted by the current session id. The
   * list on screen changes at once; the write follows in order.
   */
  const persistCurrentSession = () => {
    const state = get();
    const session = buildSession(state.messages, state.currentSessionId);
    if (!session) return;
    set({
      currentSessionId: session.id,
      savedSessions: upsertSession(state.savedSessions, session),
    });
    const epoch = storageEpoch;
    saveChain = saveChain
      .then(async () => {
        await ensureSessionsLoaded();
        // A sign-out or a sign-in meanwhile, or no claim yet: nothing is
        // written (a claim judges the file by its owner key).
        if (epoch !== storageEpoch || !isClaimed()) return;
        // After the read, the session is upserted again over what was stored.
        const next = upsertSession(get().savedSessions, session);
        set({ savedSessions: next });
        await writeSavedSessions(next);
      })
      .catch(() => undefined);
  };

  /** The chat after New chat or a restore: generation bumped, flows and the daily lock cleared. */
  const startOver = (messages: CoachMessage[], currentSessionId: string | null) => {
    for (const flow of Object.values(COACH_FLOWS)) {
      try {
        flow.reset();
      } catch {
        // A flow that fails to reset must not keep the old chat on screen.
      }
    }
    // The send that was running belongs to the old chat (its reply is
    // dropped by the generation): the new chat may send at once.
    activeSend = null;
    const state = get();
    set({
      ...forNewChat(freeTierOf(state)),
      generation: state.generation + 1,
      currentSessionId,
      messages,
      inputText: '',
      isTyping: false,
    });
  };

  /**
   * Appends the model's answer: a venue document as cards (or a text list),
   * else the text with its class cards. Class cards ride on a prose reply
   * only: the server never sends them with a venues document, and if one
   * ever did the venues would win (iOS `appendAssistantReply`).
   */
  const appendAssistantReply = async (text: string, classes: readonly CoachPlanClass[], token: CoachBusyToken) => {
    const payload = parseVenuePayload(text);
    if (!payload) {
      // A reply with up to six class cards can be taller than the screen:
      // the chat lands on its top, so the reply and the earliest class show first.
      append(classes.length > 0 ? { role: 'assistant', text, classCards: classes, anchorTop: true } : { role: 'assistant', text });
      return;
    }
    const cards = await resolveVenueCards(payload);
    if (!token.isCurrent()) return;
    if (cards.length > 0) {
      const intro = payload.intro?.trim();
      append({ role: 'assistant', text: intro ? intro : tr('coach.explore_fallback'), venues: cards });
    } else {
      append({ role: 'assistant', text: venuesReplyAsText(payload, (key) => tr(key)) });
    }
  };

  /** iOS `callAI`: the conversation so far to the model, and its answer or refusal into the chat. */
  const callAI = async () => {
    const token = busy();
    try {
      const reply = await postCoachChat(language(), buildModelMessages(get().messages), { cards: sendsClassCards });
      // The server refused the new key and answered the plain request: stop
      // asking for this account's session.
      if (reply.cardsRefused && token.sameAccount()) sendsClassCards = false;
      // Counted even when a New chat came meanwhile (the allowance was
      // spent), but never into the next account's counts.
      get().recordFreeMessages(reply.freeMessages, token);
      if (!token.isCurrent()) return;
      // A reply that came with class cards but no words still needs a line
      // above the list, not the "unavailable" apology.
      const fallback = reply.classes.length > 0 ? tr('coach.classes.intro') : tr('coach.ai_unavailable');
      await appendAssistantReply(reply.reply.trim() ? reply.reply : fallback, reply.classes, token);
    } catch (error) {
      if (isApiError(error)) {
        // 429: an allowance is spent (a member's 10 today, or a free
        // account's 3 in 30 days): the input locks, and the bubble says the
        // server's words (English) or the app's own sentence (Icelandic).
        // 503 coach-busy: a moment's wait, never a lock, in the member's
        // own language.
        get().applyCoachLimit(error, token);
        if (!token.isCurrent()) return;
        append({
          role: 'assistant',
          text: isCoachBusy(error) ? tr('coach.busy') : error.messageIn(language()) || tr('coach.ai_unavailable'),
        });
      } else {
        if (!token.isCurrent()) return;
        append({ role: 'assistant', text: tr('coach.ai_error', { error: errorMessage(error) }) });
      }
    } finally {
      token.end();
    }
  };

  /**
   * Waits out a reply in flight, at most 10 s (iOS's bounded wait); true when
   * the chat is free AND still the account's that parked the entry.
   */
  const waitForIdle = async (): Promise<boolean> => {
    const account = accountEpoch;
    const deadline = Date.now() + PARKED_WAIT_MS;
    while (isBusy() && Date.now() < deadline && account === accountEpoch) {
      await sleep(PARKED_POLL_MS);
    }
    return !isBusy() && account === accountEpoch;
  };

  /**
   * The send pipeline from `from`, then the model (iOS `send`). `clearsInput`:
   * typed words empty the input; words a chip sent leave it alone.
   */
  const sendFrom = async (text: string, options: CoachSendOptions, from: CoachSendStep, clearsInput: boolean) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy()) return;
    const mine = {};
    activeSend = mine;
    const account = accountEpoch;
    const generation = get().generation;
    try {
      if (clearsInput) set({ inputText: '' });

      const took = await runSendPipeline(COACH_FLOWS, trimmed, options, { abandonOpenQuestions }, from);
      if (took !== null) return;
      // Signed out, or a new chat, while the flows looked at the words:
      // they belong to a chat that is gone.
      if (account !== accountEpoch || generation !== get().generation) return;

      // The daily cap and the free allowance only lock the AI path; the
      // flows above never call the model on typed words, so they still work.
      // While the plan can be changed in chat the input stays open (the lock
      // does not cover that), so words meant for the chat are answered with
      // the lock rather than dropped (iOS `send`).
      if (isAILocked(get())) {
        if (offersPlanEdit()) {
          const state = get();
          append(
            { role: 'user', text: trimmed },
            { role: 'assistant', text: tr(state.freeLimitReached ? 'coach.input.free_limit' : 'coach.input.limit_reached') },
          );
        }
        return;
      }

      append({ role: 'user', text: trimmed });
      await callAI();
    } finally {
      if (activeSend === mine) activeSend = null;
    }
  };

  /** A tap that starts a flow: never over a reply in flight, and every open question abandoned first. */
  const enterFlow = async (flowId: CoachFlowId, entry: CoachFlowEntry) => {
    if (isBusy()) return;
    abandonOpenQuestions();
    await COACH_FLOWS[flowId].enter?.(entry);
  };

  return {
    ...initialState(),

    setInputText(text) {
      set({ inputText: text });
    },

    updateLanguage() {
      const { messages } = get();
      if (messages.length === 1 && messages[0]!.id === GREETING_ID) {
        set({ messages: freshChat() });
      }
    },

    send(text, options = TYPED_SEND) {
      return sendFrom(text, options, SEND_PIPELINE[0]!, true);
    },

    resumeSend(text) {
      return sendFrom(text, TYPED_SEND, PASSED_RESUMES_AT, false);
    },

    async sendParkedPrompt(text) {
      // send() drops words while a reply is in flight, so a parked prompt
      // waits for it (bounded, so a hung request cannot hold it forever).
      // A sign-out meanwhile drops it: it was the last member's.
      if (!(await waitForIdle())) return;
      // An open question must never take the app's prompt as its answer.
      abandonOpenQuestions();
      await get().send(text, PARKED_SEND);
    },

    async startParkedProgram(entry) {
      if (!(await waitForIdle())) return;
      // A feedback line's Adjust goes to Adjust my plan; Plan, Home and the
      // end of a block go to the programme wizard.
      await enterFlow(entry.kind === 'adjust' ? 'adjust' : 'program', { kind: 'parked', entry });
    },

    async consumeParkedEntries() {
      const intents = useIntentStore.getState();
      const prompt = intents.takeCoachPrompt();
      const program = intents.takeCoachProgram();
      const planEdit = intents.takeCoachPlanEdit();
      if (prompt) await get().sendParkedPrompt(prompt);
      if (program) await get().startParkedProgram(program);
      if (planEdit) {
        if (!(await waitForIdle())) return;
        await enterFlow('planEdit', { kind: 'planEdit', entry: planEdit });
      }
    },

    startSearch(categoryKey, labelKey) {
      if (isBusy()) return;
      const category = WIZARD_CATEGORY[categoryKey];
      if (!category) return;
      void enterFlow('venueWizard', { kind: 'category', category, userText: tr(labelKey) });
    },

    showCategoryPicker(chipLabelKey) {
      if (isBusy()) return;
      abandonOpenQuestions();
      append(
        { role: 'user', text: tr(chipLabelKey) },
        { role: 'assistant', text: tr('coach.nearby_prompt'), showCategoryStrip: true },
      );
    },

    startPlan(labelKey) {
      return enterFlow('dayPlan', { kind: 'chip', userText: tr(labelKey) });
    },

    startProgram() {
      return enterFlow('program', { kind: 'chip', userText: tr('coach.chip.program') });
    },

    startAdjust() {
      return enterFlow('adjust', { kind: 'chip', userText: tr('coach.chip.adjust_plan') });
    },

    startPlanEdit() {
      return enterFlow('planEdit', { kind: 'chip', userText: tr('coach.planEdit.chip') });
    },

    async selectOption(messageId, value, label) {
      const message = get().messages.find((candidate) => candidate.id === messageId);
      if (!message || !message.flow || message.answered) return;
      await COACH_FLOWS[message.flow].selectOption?.(messageId, value, label);
    },

    setClassCardsHidden(hidden, messageId) {
      const { messages } = get();
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0 || !messages[index]!.classCards) return;
      const next = [...messages];
      next[index] = { ...messages[index]!, classCardsHidden: hidden };
      set({ messages: next });
    },

    abandonOpenQuestions,

    resetChat() {
      persistCurrentSession();
      // The new chat is a brand-new session; a proposal already saved stays
      // saved (this clears the wizards, not the member's plan).
      startOver(freshChat(), null);
    },

    restoreSession(sessionId) {
      // Re-opening the chat already open would restore an older snapshot and
      // drop its newest turns.
      if (sessionId === get().currentSessionId) return;
      const session = get().savedSessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;
      // The chat on screen is saved first, so opening a recent never loses it.
      persistCurrentSession();
      const messages = messagesFromSession(session);
      advanceIdCounterPast(messages);
      startOver(messages, session.id);
    },

    loadSessions() {
      return ensureSessionsLoaded();
    },

    applyProfileCoach(block, readAt) {
      set(applyProfile(freeTierOf(get()), block, readAt));
    },

    recordFreeMessages(counts, token) {
      if (!counts || (token && !token.sameAccount())) return;
      set(recordCounts(freeTierOf(get()), counts));
    },

    applyCoachLimit(error, token) {
      if (token && !token.sameAccount()) return null;
      const result = applyLimit(freeTierOf(get()), error);
      if (result.kind) set(result.state);
      return result.kind;
    },

    dropHealthMessages() {
      for (const flow of Object.values(COACH_FLOWS)) {
        try {
          flow.healthWiped?.();
        } catch {
          // The turns below still go.
        }
      }
      const kept = get().messages.filter((message) => !message.isHealth);
      set({ messages: kept.length > 0 ? kept : freshChat() });
    },

    sessionsForgotten() {
      storageEpoch += 1;
      sessionsLoading = null;
      set({ savedSessions: [], sessionsLoaded: false, currentSessionId: null });
    },

    signedIn(memberId) {
      const id = memberId.toLowerCase();
      const { memberId: previous, claimedFor } = get();
      // The same member, already claimed (a refreshed sign-in): their chats
      // stay as they are, and the claim that follows keeps the file.
      if (previous === id && claimedFor === id) return;
      if (previous !== null && previous !== id) {
        // Someone else's chat, counts and locks never carry over.
        get().resetForSignOut();
      }
      // Closed until the claim: a read or a save started before it is dropped.
      storageEpoch += 1;
      sessionsLoading = null;
      set({
        memberId: id,
        claimedFor: null,
        savedSessions: [],
        sessionsLoaded: false,
        ...(previous === id ? {} : { currentSessionId: null }),
      });
    },

    sessionsClaimed(memberId) {
      const id = memberId.toLowerCase();
      // A later sign-in took over while this claim ran: its own claim decides.
      if (get().memberId !== id || get().claimedFor === id) return;
      // Whatever was read or kept before the claim is dropped, even for the
      // same member id: only what the claim left on disk is shown.
      storageEpoch += 1;
      sessionsLoading = null;
      set({ claimedFor: id, savedSessions: [], sessionsLoaded: false });
      void ensureSessionsLoaded();
    },

    resetForSignOut() {
      storageEpoch += 1;
      accountEpoch += 1;
      activeSend = null;
      sendsClassCards = true;
      sessionsLoading = null;
      for (const flow of Object.values(COACH_FLOWS)) {
        try {
          flow.reset();
        } catch {
          // Keep wiping.
        }
      }
      const generation = get().generation + 1;
      set({ ...initialState(), generation });
    },

    route(route) {
      set({ pendingRoute: route });
    },

    takeRoute() {
      const route = get().pendingRoute;
      if (route) set({ pendingRoute: null });
      return route;
    },

    busy,
  };
});

// ---------------------------------------------------------------------------
// Derived values (for `useCoachStore(selector)` and `getState()`)

export const selectIsAILocked = (s: CoachState): boolean => isAILocked(s);
export const selectRecentChats = (s: Pick<CoachState, 'savedSessions'>): RecentChat[] =>
  s.savedSessions.map((session) => ({ id: session.id, title: session.title }));

/** What the store hands the flows (./host.ts). */
const host: CoachHost = {
  language,
  t: tr,
  messages: () => useCoachStore.getState().messages,
  append: (...drafts) => {
    const created = drafts.map((draft) => ({ ...draft, id: draft.id ?? nextId() }) as CoachMessage);
    useCoachStore.setState({ messages: [...useCoachStore.getState().messages, ...created] });
    return created.map((message) => message.id);
  },
  update: (id, change) => {
    const { messages } = useCoachStore.getState();
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) return;
    const next = [...messages];
    next[index] = change(messages[index]!);
    useCoachStore.setState({ messages: next });
  },
  remove: (predicate) => {
    const { messages } = useCoachStore.getState();
    const kept = messages.filter((message) => !predicate(message));
    if (kept.length !== messages.length) useCoachStore.setState({ messages: kept });
  },
  markAnswered: (id, selectedAnswer) =>
    host.update(id, (message) => ({ ...message, answered: true, selectedAnswer: selectedAnswer ?? message.selectedAnswer })),
  isTyping: () => useCoachStore.getState().isTyping,
  busy: () => useCoachStore.getState().busy(),
  isAILocked: () => isAILocked(useCoachStore.getState()),
  freeLimitReached: () => useCoachStore.getState().freeLimitReached,
  limitReached: () => useCoachStore.getState().limitReached,
  applyCoachLimit: (error, token) => useCoachStore.getState().applyCoachLimit(error, token),
  recordFreeMessages: (counts, token) => useCoachStore.getState().recordFreeMessages(counts, token),
  abandonOpenQuestions: () => useCoachStore.getState().abandonOpenQuestions(),
  setInput: (text) => useCoachStore.getState().setInputText(text),
  resumeSend: (text) => useCoachStore.getState().resumeSend(text),
  modelMessages: (): CoachApiMessage[] => buildModelMessages(useCoachStore.getState().messages),
  route: (route) => useCoachStore.getState().route(route),
};

installCoachHost(host);

// A Coach screen still holding the saved chats drops them when they are
// forgotten (iOS `.coachSessionsForgotten`).
onSessionsForgotten(() => useCoachStore.getState().sessionsForgotten());

/** Back to a fresh app session (tests). */
export function resetCoachStoreForTests(): void {
  idCounter = FIRST_ID;
  storageEpoch += 1;
  accountEpoch += 1;
  activeSend = null;
  sendsClassCards = true;
  sessionsLoading = null;
  saveChain = Promise.resolve();
  useCoachStore.setState({ ...initialState() });
}

/** Whether the chat still asks for class cards this session (iOS `sendsClassCards`). */
export function coachSendsClassCards(): boolean {
  return sendsClassCards;
}

/** Lets a test wait for the saves in flight. */
export function pendingCoachSaves(): Promise<void> {
  return saveChain;
}
