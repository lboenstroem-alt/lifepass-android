/* eslint lifepass/no-literal-copy: "error" */
/**
 * Changing the workout plan by talking to the Coach (OP-58 to OP-62): the
 * Android port of iOS `extension CoachViewModel` "Change my plan in chat"
 * (ViewModels/CoachViewModel+PlanEdit.swift). ../flows/planEdit.ts plugs it
 * into COACH-1's store as the `planEdit` flow.
 *
 * The member says what to change, in their own words. The words go to
 * `POST /health/programs/{id}/edits`, which answers with a PREVIEW (the
 * card: what changes and on which days, Apply and Cancel, two variants at
 * most), a QUESTION (its choices as chips, sent back WITH the request they
 * answer: the server keeps no conversation), NOTHING TO CHANGE (the reply
 * and why, each on its own line), or NOT A PLAN EDIT: then the member's
 * bubble is taken back and the same words go down the Coach's normal path
 * from the programme offer, which draws its own. Nothing changes until
 * Apply; Undo stays on the card, and in the plan's Changes list, for 7 days.
 *
 * THE THREAD. A plan change being talked about remembers its plan, what the
 * member asked from (a session, an exercise) and whether the next typed
 * words go to it (`takesWords`: a prompt, a question or a preview is open).
 * Any other flow taking over (`abandon`) stops it taking words; a card left
 * open keeps its buttons.
 *
 * THE PRIVACY LANE IS THE PLAN LANE. Every bubble here is `isHealth`: never
 * saved, never in the history a later chat sends to the model
 * (../store/messages.ts `isConversationTurn`), gone with the health data.
 * The words travel once, in the request body, and nowhere else: no analytics
 * value, no log, no disk.
 *
 * ONE KEY PER REQUEST. Each send mints its Idempotency-Key. The consent tap
 * and the offline Try again resend the SAME key (a request that reached the
 * server is answered again for free); a failed answer's Try again and Ask
 * again mint a new one; `idempotency_key_reused` is resent once, silently,
 * under a new one.
 */
import { isApiError, newIdempotencyKey, type ApiError } from '../../../api';
import { openHealthConsent, useHealthStore } from '../../../health';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import type { CoachPlanEditEntry } from '../../../stores/intentStore';
import type { QuestionOption } from '../../../types/coach';
import { beginAdjust } from '../adjust/flow';
import { appendProgramBubble, readProgramContext, startProgram } from '../program';
import { coachHost } from '../store/host';
import type { CoachMessage } from '../store/messages';

import {
  answerPlanEditQuestion,
  applyPlanEdit,
  capPlanEditText,
  discardPlanEdit,
  isPlanEditSendable,
  planEditBody,
  planEditErrorReason,
  planEditProblem,
  postPlanEdit,
  type PlanEditProblem,
} from './api';
import { planEditAvailability } from './availability';
import { grantPlanEditConsent, livePlanEditConsentGrant, type PlanEditConsentGrant } from './consent';
import { planEditIntentMatches, planVocabularyFrom } from './intent';
import { presentDialog, presentToast, runnerOpenFor } from './platform';
import type { PlanEditPreview, PlanEditResponse, PlanEditSuggestion } from './types';
import { forgetUndoKeys, isUndoable, refreshPlan, setUndoKeyMakerForTests, undoEdit } from './undo';

// ---------------------------------------------------------------------------
// Messages

/** The flow's own bubbles (its renderers, ../flows/planEdit.ts). */
export const PlanEditMessageKind = {
  /** The preview card. */
  preview: 'planEdit.preview',
  /** The one-tap consent. */
  consent: 'planEdit.consent',
} as const;

/** Chip values the plan change answers itself, namespaced so they never collide with another flow's. */
export const PlanEditOptionValue = {
  prefix: 'planEdit.',
  choice: 'planEdit.choice',
  /** Again under a NEW key (a failed answer: the call cost nothing, it is refunded). */
  retry: 'planEdit.retry',
  /** Again under the SAME key (offline, too many requests): if the first reached the server, its answer comes back free. */
  resend: 'planEdit.resend',
  askAgain: 'planEdit.askAgain',
  suggestAdjust: 'planEdit.suggest.adjust',
  suggestNewPlan: 'planEdit.suggest.newPlan',
  openPlan: 'planEdit.openPlan',
  openAccount: 'planEdit.openAccount',
  openPlans: 'planEdit.openPlans',
} as const;

/** Where a preview card stands (iOS `PlanEditCard.Status`). */
export type PlanEditCardStatus = 'pending' | 'applying' | 'applied' | 'undoing' | 'undone' | 'cancelled' | 'superseded' | 'stale';

export interface PlanEditCardPayload {
  readonly programId: string;
  /** The request that made it, for Ask again. */
  readonly requestId: string | null;
  readonly variants: readonly PlanEditPreview[];
  /** The variant on screen: the recommended one first. */
  readonly selected: number;
  readonly status: PlanEditCardStatus;
  /** The change as the server applied it. */
  readonly applied: {
    readonly editId: string;
    readonly undoUntil: Date | null;
    readonly undoable: boolean;
    readonly summary: string | null;
  } | null;
  /** A line for a refusal that leaves the card as it is. */
  readonly errorKey: string | null;
  /** Undo was refused for good: why. */
  readonly undoBlockedKey: string | null;
  /** Done or skipped days an Undo left as they were. */
  readonly keptRows: number;
}

export interface PlanEditConsentPayload {
  readonly requestId: string;
  readonly status: 'idle' | 'granting' | 'granted' | 'declined';
  readonly errorKey: string | null;
}

/** One request to OP-58, kept for the consent's resend, Retry and Ask again. */
interface PlanEditRequest {
  readonly id: string;
  readonly programId: string;
  /** The message as sent (a question's answer carries the request it answers). */
  readonly message: string;
  readonly replacesEditId: string | null;
  readonly sessionId: string | null;
  readonly exerciseId: string | null;
  key: string;
  /** The member's bubble for these words, taken back on `not_plan_edit`. */
  bubbleId: string | null;
  /** The words as the member typed them, for the Coach's normal path. */
  readonly typed: string;
}

/** The plan change being talked about (iOS `PlanEditThread`). */
interface PlanEditThread {
  readonly programId: string;
  readonly sessionId: string | null;
  readonly exerciseId: string | null;
  /** The next typed words go here (`planEdit.open`). */
  takesWords: boolean;
  /** The message a question asked about, sent again with its answer. */
  questionFor: string | null;
}

// ---------------------------------------------------------------------------
// State

let thread: PlanEditThread | null = null;
const requests = new Map<string, PlanEditRequest>();
/** The last request sent, for Try again; the one behind a stale card, for Ask again; the one the consent waits on. */
let lastRequestId: string | null = null;
let askAgainRequestId: string | null = null;
let pendingConsentRequestId: string | null = null;
const applyKeys = new Map<string, string>();
const consentKeys = new Map<string, string>();
let requestCounter = 0;
/**
 * Bumped by `resetPlanEdit` (a sign-out, a new chat, the health wipe): an
 * answer still out then lands nowhere, the way the programme and Adjust
 * flows guard theirs.
 */
let resets = 0;

let consentGrant: PlanEditConsentGrant = livePlanEditConsentGrant;
let makeKey: () => string = newIdempotencyKey;

function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  return coachHost().t(key, params);
}

// ---------------------------------------------------------------------------
// Bubbles

function appendUser(text: string): string {
  return coachHost().append({ role: 'user', text, isHealth: true, flow: 'planEdit' })[0]!;
}

function appendBubble(text: string): void {
  coachHost().append({ role: 'assistant', text, isHealth: true, flow: 'planEdit' });
}

function appendQuestion(text: string, options: readonly QuestionOption[]): void {
  coachHost().append({ role: 'assistant', text, options, isHealth: true, flow: 'planEdit' });
}

function findMessage(id: string): CoachMessage | undefined {
  return coachHost()
    .messages()
    .find((message) => message.id === id);
}

function cardOf(message: CoachMessage | undefined): PlanEditCardPayload | null {
  if (!message || message.kind !== PlanEditMessageKind.preview) return null;
  return (message.payload as PlanEditCardPayload | undefined) ?? null;
}

function setCard(id: string, change: (card: PlanEditCardPayload) => PlanEditCardPayload): void {
  coachHost().update(id, (message) => {
    const card = cardOf(message);
    return card ? { ...message, payload: change(card) } : message;
  });
}

function openPlanChip(): QuestionOption {
  return { label: t('program.chip.open_plan'), value: PlanEditOptionValue.openPlan };
}

/** The variant on screen. */
export function selectedVariant(card: PlanEditCardPayload): PlanEditPreview | null {
  return card.variants[card.selected] ?? card.variants[0] ?? null;
}

/** Undo is offered: applied, not refused for good, and the server's rule and window allow it. */
export function cardCanUndo(card: PlanEditCardPayload, now: Date = new Date()): boolean {
  return card.status === 'applied' && card.undoBlockedKey === null && card.applied !== null && isUndoable(card.applied, now);
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * The Coach's empty-state "Change my plan" chip (it replaces "Adjust my
 * plan" while the server changes plans by chat). The store has refused a tap
 * over a reply in flight and abandoned every open question first.
 */
export async function startPlanEditFromChip(userText: string): Promise<void> {
  if (coachHost().isTyping()) return;
  appendUser(userText);
  const availability = planEditAvailability();
  switch (availability.kind) {
    case 'unavailable':
      // The server stopped offering it since the chip was drawn: the
      // programme wizard's own gate answers, in its own words.
      await startProgram({ entry: 'chip', showUserBubble: false });
      return;
    case 'paused':
      appendQuestion(t('coach.planEdit.error.planPaused'), [openPlanChip()]);
      return;
    case 'available':
      thread = { programId: availability.programId, sessionId: null, exerciseId: null, takesWords: true, questionFor: null };
      appendBubble(t('coach.planEdit.ask'));
  }
}

/**
 * Plan's "Change with Coach" (the day, and its title for the question) or
 * the runner's "I don't have this" (the exercise, and the words put in the
 * input for the member to send; never sent for them). The store has waited
 * out a reply in flight and abandoned every open question first.
 */
export function beginPlanEdit(entry: CoachPlanEditEntry): void {
  const prefill = entry.prefill?.trim() ?? '';
  appendUser(t(prefill ? 'coach.planEdit.notHaveThis' : 'coach.planEdit.changeWithCoach'));
  const availability = planEditAvailability();
  switch (availability.kind) {
    case 'unavailable':
      appendBubble(t('coach.planEdit.error.paused'));
      return;
    case 'paused':
      appendQuestion(t('coach.planEdit.error.planPaused'), [openPlanChip()]);
      return;
    case 'available': {
      thread = {
        programId: availability.programId,
        sessionId: entry.sessionId ?? null,
        exerciseId: entry.exerciseId ?? null,
        takesWords: true,
        questionFor: null,
      };
      const title = entry.sessionTitle?.trim() ?? '';
      if (prefill) {
        coachHost().setInput(prefill);
        appendBubble(t('coach.planEdit.askPrefilled'));
      } else if (title) {
        appendBubble(t('coach.planEdit.askSession', { title }));
      } else {
        appendBubble(t('coach.planEdit.ask'));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The pipeline's two steps

function openThread(programId: string): PlanEditThread | null {
  return thread && thread.programId === programId && thread.takesWords ? thread : null;
}

/** `planEdit.open`: a prompt, a question or a preview of the live plan is open. */
export function hasOpenPlanEdit(): boolean {
  const availability = planEditAvailability();
  if (availability.kind === 'unavailable') return false;
  return openThread(availability.programId) !== null;
}

/**
 * `planEdit.open` and `planEdit.start` (iOS `routeToPlanEdit`): the words of
 * an open thread, words that ask for a change, or any words Adjust my plan
 * handed on. `'passed'`: the server says they are not a plan change (or
 * cannot take them), the member's bubble is gone, and the pipeline sends
 * them on from the programme offer.
 */
export async function routeToPlanEdit(text: string, options: { readonly handedOn: boolean }): Promise<boolean | 'passed'> {
  const availability = planEditAvailability();
  if (availability.kind === 'unavailable') return false;
  const asks = (): boolean => {
    if (options.handedOn || openThread(availability.programId) !== null) return true;
    const day = availability.kind === 'available' ? availability.day : useHealthStore.getState().today;
    return planEditIntentMatches(text, planVocabularyFrom(day));
  };
  if (!asks()) return false;
  if (availability.kind === 'paused') {
    coachHost().abandonOpenQuestions();
    appendUser(text.trim());
    appendQuestion(t('coach.planEdit.error.planPaused'), [openPlanChip()]);
    thread = null;
    return true;
  }
  return sendPlanEdit(text, null);
}

// ---------------------------------------------------------------------------
// Sending (OP-58)

/**
 * Words to the plan change. `bubbleId` names a bubble the caller already
 * drew (a chip's echo); otherwise the words get their own. False: the words
 * are not ones it takes (too short), and the caller sends them on.
 */
async function sendPlanEdit(text: string, bubbleId: string | null): Promise<boolean | 'passed'> {
  const trimmed = text.trim();
  const availability = planEditAvailability();
  if (availability.kind !== 'available') return false;
  const { programId } = availability;
  const open = openThread(programId);
  const message = open?.questionFor ? answerPlanEditQuestion(trimmed, open.questionFor) : capPlanEditText(trimmed);
  // Too short to be a change ("k"): the Coach's normal path takes it.
  if (!isPlanEditSendable(message)) return false;
  const bubble = bubbleId ?? appendUser(trimmed);
  const same = thread?.programId === programId ? thread : null;
  const request: PlanEditRequest = {
    id: `r${(requestCounter += 1)}`,
    programId,
    message,
    replacesEditId: open ? openCardVariantId(programId) : null,
    sessionId: same?.sessionId ?? null,
    exerciseId: same?.exerciseId ?? null,
    key: makeKey(),
    bubbleId: bubble,
    typed: trimmed,
  };
  requests.set(request.id, request);
  return perform(request);
}

/** The selected variant of the newest preview still open on this plan. */
function openCardVariantId(programId: string): string | null {
  const messages = coachHost().messages();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const card = cardOf(messages[index]);
    if (card && card.programId === programId && card.status === 'pending') return selectedVariant(card)?.editId ?? null;
  }
  return null;
}

/** One request, and what its answer means. */
async function perform(request: PlanEditRequest): Promise<boolean | 'passed'> {
  lastRequestId = request.id;
  pendingConsentRequestId = null;
  const host = coachHost();
  const busy = host.busy();
  const opened = resets;
  const stillHere = () => busy.isCurrent() && opened === resets;
  track('plan_edit_sent');
  let renewed = false;
  let response: PlanEditResponse | null = null;
  try {
    for (;;) {
      try {
        const body = planEditBody({
          message: request.message,
          language: host.language(),
          replacesEditId: request.replacesEditId,
          sessionId: request.sessionId,
          exerciseId: request.exerciseId,
        });
        response = await postPlanEdit(request.programId, body, request.key);
        break;
      } catch (error) {
        if (!stillHere()) return true;
        if (isApiError(error) && error.isCancellation) return true;
        const problem: PlanEditProblem = isApiError(error) ? planEditProblem(error) : { kind: 'other' };
        if (problem.kind === 'keyReused' && !renewed) {
          renewed = true;
          request.key = makeKey();
          continue;
        }
        busy.end();
        return handleFailure(problem, isApiError(error) ? error : null, request);
      }
    }
  } finally {
    busy.end();
  }
  // Out of the request's try: drawing the answer is never taken for a failed request.
  if (!stillHere()) return true;
  return handleResponse(response, request);
}

function handleResponse(response: PlanEditResponse, request: PlanEditRequest): boolean | 'passed' {
  switch (response.kind) {
    case 'not_plan_edit':
    case 'unknown':
      trackAnswer('not_plan_edit', 0, 0);
      return continueInChat(request);

    case 'preview': {
      if (response.variants.length === 0) return noChange(response, request);
      coachHost().abandonOpenQuestions();
      supersedeOpenCards(request.programId);
      if (response.reply) appendBubble(response.reply);
      const recommended = response.variants.findIndex((variant) => variant.recommended);
      const card: PlanEditCardPayload = {
        programId: request.programId,
        requestId: request.id,
        variants: response.variants,
        selected: recommended >= 0 ? recommended : 0,
        status: 'pending',
        applied: null,
        errorKey: null,
        undoBlockedKey: null,
        keptRows: 0,
      };
      coachHost().append({
        role: 'assistant',
        text: '',
        isHealth: true,
        flow: 'planEdit',
        kind: PlanEditMessageKind.preview,
        payload: card,
      });
      thread = {
        programId: request.programId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        takesWords: true,
        questionFor: null,
      };
      const items = response.variants[0]!.changes.reduce((sum, group) => sum + group.items.length, 0);
      trackAnswer('preview', items, response.variants.length);
      return true;
    }

    case 'clarify': {
      coachHost().abandonOpenQuestions();
      const question = response.question?.text?.trim() || response.reply || t('coach.planEdit.noChange');
      if (response.reply && response.reply !== question) appendBubble(response.reply);
      const seen = new Set<string>();
      const options: QuestionOption[] = [];
      for (const choice of response.question?.choices ?? []) {
        if (seen.has(choice)) continue;
        seen.add(choice);
        options.push({ label: choice, value: PlanEditOptionValue.choice });
      }
      for (const chip of suggestionChips(response.suggestion)) {
        if (seen.has(chip.label)) continue;
        seen.add(chip.label);
        options.push(chip);
      }
      if (options.length === 0) appendBubble(question);
      else appendQuestion(question, options);
      thread = {
        programId: request.programId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        takesWords: true,
        questionFor: request.message,
      };
      trackAnswer('clarify', 0, 0);
      return true;
    }

    case 'no_change':
      return noChange(response, request);
  }
}

/** Nothing to change: the reply, then each reason on a line of its own, never inside the reply. */
function noChange(response: PlanEditResponse, request: PlanEditRequest): true {
  coachHost().abandonOpenQuestions();
  const reasons = response.notApplied.map((entry) => entry.text.trim()).filter((line) => line.length > 0);
  const lines = [response.reply ?? t('coach.planEdit.noChange'), ...reasons];
  const chips = suggestionChips(response.suggestion);
  if (chips.length === 0) appendBubble(lines.join('\n'));
  else appendQuestion(lines.join('\n'), chips);
  thread = { programId: request.programId, sessionId: request.sessionId, exerciseId: request.exerciseId, takesWords: false, questionFor: null };
  trackAnswer('no_change', 0, 0);
  return true;
}

/**
 * The words were not about the plan: the member's bubble is taken back and
 * the same words go on from the programme offer, as if the plan change had
 * never been asked. No second bubble.
 */
function continueInChat(request: PlanEditRequest): 'passed' {
  const id = request.bubbleId;
  if (id) coachHost().remove((message) => message.id === id);
  request.bubbleId = null;
  if (thread) {
    thread.takesWords = false;
    thread.questionFor = null;
  }
  return 'passed';
}

/** A newer preview replaced the open ones on this plan: the server superseded them, and their buttons go. */
function supersedeOpenCards(programId: string): void {
  for (const message of coachHost().messages()) {
    const card = cardOf(message);
    if (card && card.programId === programId && card.status === 'pending') {
      setCard(message.id, (current) => ({ ...current, status: 'superseded' }));
    }
  }
}

/**
 * The bigger change the server suggested, when this plan can make it.
 * Adjust my plan on a plan that cannot be adjusted (a custom cycle, a
 * server without revisions) reads as a new plan.
 */
function suggestionChips(suggestion: PlanEditSuggestion | null): QuestionOption[] {
  if (suggestion !== 'adjust_plan' && suggestion !== 'new_plan') return [];
  const context = readProgramContext();
  if (suggestion === 'adjust_plan' && context.supportsPlanRevision && context.liveProgram?.custom !== true) {
    return [{ label: t('coach.chip.adjust_plan'), value: PlanEditOptionValue.suggestAdjust }];
  }
  return [{ label: t('program.chip.make_new'), value: PlanEditOptionValue.suggestNewPlan }];
}

function handleFailure(problem: PlanEditProblem, error: ApiError | null, request: PlanEditRequest): boolean | 'passed' {
  track('plan_edit_error', { reason: problem.kind === 'offline' ? 'offline' : planEditErrorReason(error) });
  switch (problem.kind) {
    case 'consentNeeded':
      pendingConsentRequestId = request.id;
      coachHost().append({
        role: 'assistant',
        text: t('coach.planEdit.consent.title'),
        isHealth: true,
        flow: 'planEdit',
        kind: PlanEditMessageKind.consent,
        payload: { requestId: request.id, status: 'idle', errorKey: null } satisfies PlanEditConsentPayload,
      });
      return true;
    case 'healthConsentGone': {
      // The health consent is gone (withdrawn on another device): the FULL
      // consent sheet, never the one-tap line, then the same words under the
      // same key.
      pendingConsentRequestId = request.id;
      const opened = resets;
      openHealthConsent({
        entry: 'coach',
        onGranted: async () => {
          if (opened !== resets || pendingConsentRequestId !== request.id) return;
          pendingConsentRequestId = null;
          const result = await perform(request);
          if (result === 'passed') await coachHost().resumeSend(request.typed);
        },
      });
      return true;
    }
    case 'featureOff':
      // The server stopped offering it since its features were read: the
      // feature hides, and the words go on through the Coach as before.
      useAppStore.getState().dropServerFeature('plan_edit');
      return continueInChat(request);
    case 'personalData':
      appendBubble(t('coach.planEdit.error.personalData'));
      return true;
    case 'limit':
      appendBubble(t('coach.planEdit.error.limit'));
      return true;
    case 'servicePaused':
      appendBubble(t('coach.planEdit.error.paused'));
      return true;
    case 'offline':
      appendQuestion(error?.messageIn(coachHost().language()) || t('coach.ai_unavailable'), [
        { label: t('coach.planEdit.retry'), value: PlanEditOptionValue.resend },
      ]);
      return true;
    case 'rateLimited':
      appendQuestion(t('health.err.rate_limited'), [{ label: t('coach.planEdit.retry'), value: PlanEditOptionValue.resend }]);
      return true;
    case 'notLive':
    case 'programGone':
      thread = null;
      appendBubble(t('coach.planEdit.error.notLive'));
      refreshPlan();
      return true;
    case 'planPaused':
      thread = null;
      appendQuestion(t('coach.planEdit.error.planPaused'), [openPlanChip()]);
      refreshPlan();
      return true;
    case 'pendingDeletion':
      appendQuestion(t('health.err.pending_deletion'), [{ label: t('health.err.open_account'), value: PlanEditOptionValue.openAccount }]);
      return true;
    case 'notMember':
      thread = null;
      appendQuestion(t('program.gate.not_member'), [{ label: t('plan.gate.cta_choose'), value: PlanEditOptionValue.openPlans }]);
      return true;
    case 'minor':
      thread = null;
      appendBubble(t('health.minor.body'));
      return true;
    default:
      appendQuestion(t('coach.planEdit.error.upstream'), [{ label: t('coach.planEdit.retry'), value: PlanEditOptionValue.retry }]);
      return true;
  }
}

/** Fixed words and bands only: never the member's words or a name. */
function trackAnswer(kind: string, items: number, variants: number): void {
  track('plan_edit_preview', { kind, items: band(items), count_band: band(variants) });
}

/** A count as a word (analytics never carries a bare number). */
function band(count: number): string {
  if (count < 1) return 'none';
  if (count === 1) return 'one';
  return count <= 5 ? '2-5' : '6+';
}

// ---------------------------------------------------------------------------
// Chips

/** Every chip on a plan-edit bubble: answered, echoed as the member's bubble, then acted on. */
export async function selectPlanEditOption(messageId: string, value: string, label: string): Promise<void> {
  const host = coachHost();
  const message = findMessage(messageId);
  if (!message || message.answered || host.isTyping()) return;
  host.markAnswered(messageId, label);
  const echo = appendUser(label);

  switch (value) {
    case PlanEditOptionValue.choice: {
      const result = await sendPlanEdit(label, echo);
      // A choice that is no plan change goes on through the Coach, without
      // a second bubble.
      if (result !== true) {
        host.remove((candidate) => candidate.id === echo);
        await host.resumeSend(label);
      }
      return;
    }
    case PlanEditOptionValue.retry:
    case PlanEditOptionValue.resend: {
      const request = lastRequestId ? requests.get(lastRequestId) : undefined;
      if (!request) return;
      if (value === PlanEditOptionValue.retry) request.key = makeKey();
      const result = await perform(request);
      if (result === 'passed') await host.resumeSend(request.typed);
      return;
    }
    case PlanEditOptionValue.askAgain: {
      const source = askAgainRequestId ? requests.get(askAgainRequestId) : undefined;
      askAgainRequestId = null;
      if (!source) return;
      const request: PlanEditRequest = {
        ...source,
        id: `r${(requestCounter += 1)}`,
        replacesEditId: null,
        key: makeKey(),
        bubbleId: echo,
      };
      requests.set(request.id, request);
      const result = await perform(request);
      if (result === 'passed') await host.resumeSend(request.typed);
      return;
    }
    case PlanEditOptionValue.suggestAdjust:
      thread = null;
      await beginAdjust(readProgramContext(), 'gate');
      return;
    case PlanEditOptionValue.suggestNewPlan:
      thread = null;
      appendProgramBubble('program.make_new.replaces_running');
      await startProgram({ entry: 'intent', showUserBubble: false, skipExistingPlanGates: true });
      return;
    case PlanEditOptionValue.openPlan:
      host.route({ kind: 'planTab' });
      return;
    case PlanEditOptionValue.openAccount:
      host.route({ kind: 'account' });
      return;
    case PlanEditOptionValue.openPlans:
      host.route({ kind: 'plans' });
  }
}

// ---------------------------------------------------------------------------
// The one-tap consent (409 plan_edit_consent_required)

function setConsent(messageId: string, change: Partial<PlanEditConsentPayload>): void {
  coachHost().update(messageId, (message) => ({ ...message, payload: { ...(message.payload as PlanEditConsentPayload), ...change } }));
}

/**
 * The consent to the v4 text, then the SAME words with the SAME key, so the
 * server answers them as the request it refused.
 */
export async function grantConsentFor(messageId: string): Promise<void> {
  const message = findMessage(messageId);
  if (!message || message.kind !== PlanEditMessageKind.consent) return;
  const payload = message.payload as PlanEditConsentPayload;
  if (payload.status !== 'idle' || pendingConsentRequestId !== payload.requestId) return;
  const request = requests.get(payload.requestId);
  if (!request) return;
  const host = coachHost();
  setConsent(messageId, { status: 'granting', errorKey: null });
  const opened = resets;
  const key = consentKeys.get(messageId) ?? makeKey();
  consentKeys.set(messageId, key);
  const standing = useAppStore.getState().profile?.health?.consent ?? null;
  const outcome = await grantPlanEditConsent(standing, key, consentGrant);
  if (opened !== resets) return;
  const resend = async () => {
    pendingConsentRequestId = null;
    setConsent(messageId, { status: 'granted' });
    const result = await perform(request);
    if (result === 'passed') await host.resumeSend(request.typed);
  };
  switch (outcome.kind) {
    case 'granted': {
      track('health_consent_granted', {
        entry: 'plan_edit',
        source: outcome.consent.ageSource === 'attestation' ? 'attestation' : 'kennitala',
      });
      const app = useAppStore.getState();
      app.applyHealthConsentGranted(outcome.consent);
      void app.loadProfile();
      await resend();
      return;
    }
    case 'needsFullSheet':
      // The account has to attest its age: only the full sheet has that row.
      setConsent(messageId, { status: 'idle' });
      openHealthConsent({
        entry: 'coach',
        onGranted: async () => {
          if (opened === resets) await resend();
        },
      });
      return;
    case 'failed':
      setConsent(messageId, { status: 'idle', errorKey: outcome.errorKey });
      return;
    case 'refused':
      setConsent(messageId, { status: 'declined' });
      pendingConsentRequestId = null;
      useHealthStore.getState().handle(outcome.error, { foreground: true });
      handleFailure(planEditProblem(outcome.error), outcome.error, request);
  }
}

/** "Not now": nothing was sent, nothing changes. */
export function declineConsentFor(messageId: string): void {
  const message = findMessage(messageId);
  if (!message || message.kind !== PlanEditMessageKind.consent) return;
  const payload = message.payload as PlanEditConsentPayload;
  if (payload.status !== 'idle') return;
  setConsent(messageId, { status: 'declined' });
  if (pendingConsentRequestId === payload.requestId) pendingConsentRequestId = null;
  if (thread) thread.takesWords = false;
  appendBubble(t('coach.planEdit.consent.declined'));
}

// ---------------------------------------------------------------------------
// The card

/** The variant switch (two variants only). */
export function selectVariant(messageId: string, index: number): void {
  setCard(messageId, (card) =>
    card.status === 'pending' && index >= 0 && index < card.variants.length ? { ...card, selected: index, errorKey: null } : card,
  );
}

/** Whether Apply waits for today's workout: the change touches today and the runner holds a workout in progress for it. */
export function applyWaitsForRunner(variant: PlanEditPreview | null | undefined): boolean {
  if (!variant?.touchesToday || !variant.todaySessionId) return false;
  return runnerOpenFor(variant.todaySessionId);
}

/** Apply (OP-59). A change that makes the plan repeat as a cycle asks first, then sends `confirmCustom`. */
export async function applyCard(messageId: string, confirmCustom = false): Promise<void> {
  const card = cardOf(findMessage(messageId));
  if (!card || card.status !== 'pending') return;
  const variant = selectedVariant(card);
  if (!variant) return;
  if (applyWaitsForRunner(variant)) {
    setCard(messageId, (current) => ({ ...current, errorKey: 'coach.planEdit.runnerOpen' }));
    return;
  }
  if (variant.becomesCustom && !confirmCustom) {
    askToConfirmCustom(messageId, variant);
    return;
  }
  const key = applyKeys.get(variant.editId) ?? makeKey();
  applyKeys.set(variant.editId, key);
  setCard(messageId, (current) => ({ ...current, status: 'applying', errorKey: null }));
  const opened = resets;
  try {
    const result = await applyPlanEdit(card.programId, variant.editId, { confirmCustom, language: coachHost().language() }, key);
    if (opened !== resets) return;
    setCard(messageId, (current) => ({
      ...current,
      status: 'applied',
      applied: {
        editId: result.edit.id,
        undoUntil: result.edit.undoUntil,
        undoable: result.edit.undoable,
        summary: result.edit.summary || null,
      },
    }));
    if (thread?.programId === card.programId) thread = null;
    presentToast(t('coach.planEdit.updatedToast'));
    const choice = card.variants.length < 2 ? 'single' : variant.recommended ? 'ours' : 'own';
    track('plan_edit_applied', { choice });
    if (result.features) useAppStore.getState().noteServerFeatures(result.features);
    refreshPlan();
  } catch (error) {
    if (opened !== resets) return;
    if (!isApiError(error)) {
      setCard(messageId, (current) => ({ ...current, status: 'pending', errorKey: 'common.error_body' }));
      return;
    }
    if (error.isCancellation) {
      setCard(messageId, (current) => ({ ...current, status: 'pending' }));
      return;
    }
    track('plan_edit_error', { reason: planEditErrorReason(error) });
    applyFailed(messageId, card, variant, planEditProblem(error));
  }
}

function applyFailed(messageId: string, card: PlanEditCardPayload, variant: PlanEditPreview, problem: PlanEditProblem): void {
  const pending = (errorKey: string) => setCard(messageId, (current) => ({ ...current, status: 'pending', errorKey }));
  switch (problem.kind) {
    case 'confirmRequired':
      setCard(messageId, (current) => ({ ...current, status: 'pending' }));
      askToConfirmCustom(messageId, variant);
      return;
    case 'stale':
    case 'featureOff':
      setCard(messageId, (current) => ({ ...current, status: 'stale' }));
      offerAskAgain(card);
      return;
    case 'notPending':
      if (problem.reason === 'applied') {
        // Applied already (another phone, a tap the network lost): the plan
        // says so, and the Changes list has its Undo.
        setCard(messageId, (current) => ({ ...current, status: 'applied' }));
        refreshPlan();
      } else {
        setCard(messageId, (current) => ({ ...current, status: 'stale' }));
        offerAskAgain(card);
      }
      return;
    case 'notLive':
    case 'programGone':
      setCard(messageId, (current) => ({ ...current, status: 'stale' }));
      if (thread?.programId === card.programId) thread = null;
      appendBubble(t('coach.planEdit.error.notLive'));
      refreshPlan();
      return;
    case 'planPaused':
      pending('coach.planEdit.error.planPaused');
      return;
    case 'offline':
      pending('health.offline.action_hint');
      return;
    case 'rateLimited':
      pending('health.err.rate_limited');
      return;
    case 'pendingDeletion':
      pending('health.err.pending_deletion');
      return;
    default:
      pending('common.error_body');
  }
}

function askToConfirmCustom(messageId: string, variant: PlanEditPreview): void {
  presentDialog({
    title: t('coach.planEdit.confirmCustom.title'),
    message: variant.becomesCustomNote ?? t('coach.planEdit.confirmCustom.body'),
    buttons: [
      { label: t('common.cancel'), role: 'cancel', testID: 'planEdit.confirmCustom.cancel' },
      { label: t('coach.planEdit.confirmCustom.ok'), onPress: () => void applyCard(messageId, true), testID: 'planEdit.confirmCustom.ok' },
    ],
    testID: 'planEdit.confirmCustom',
  });
}

/** "Your plan changed since I suggested this", and the chip that asks the same thing again (a new key: the old preview is gone). */
function offerAskAgain(card: PlanEditCardPayload): void {
  askAgainRequestId = card.requestId;
  if (thread?.programId === card.programId) thread.takesWords = false;
  if (card.requestId && requests.has(card.requestId)) {
    appendQuestion(t('coach.planEdit.error.stale'), [{ label: t('coach.planEdit.askAgain'), value: PlanEditOptionValue.askAgain }]);
  } else {
    appendBubble(t('coach.planEdit.error.stale'));
  }
}

/** Cancel: the card says so at once; the discard is best effort (a preview lapses within 24 hours either way). */
export function cancelCard(messageId: string): void {
  const card = cardOf(findMessage(messageId));
  if (!card || card.status !== 'pending') return;
  setCard(messageId, (current) => ({ ...current, status: 'cancelled', errorKey: null }));
  if (thread?.programId === card.programId) thread.takesWords = false;
  track('plan_edit_cancelled');
  const language = coachHost().language();
  for (const variant of card.variants) {
    discardPlanEdit(card.programId, variant.editId, language, makeKey()).catch(() => undefined);
  }
}

/** Undo (OP-60), from the collapsed card. */
export async function undoCard(messageId: string): Promise<void> {
  const card = cardOf(findMessage(messageId));
  if (!card || !cardCanUndo(card) || !card.applied) return;
  const { editId } = card.applied;
  setCard(messageId, (current) => ({ ...current, status: 'undoing', errorKey: null }));
  const opened = resets;
  try {
    const keptRows = await undoEdit(card.programId, editId, 'card');
    if (opened !== resets) return;
    setCard(messageId, (current) => ({ ...current, status: 'undone', keptRows }));
    presentToast(t('coach.planEdit.undoneToast'));
  } catch (error) {
    if (opened !== resets) return;
    const problem: PlanEditProblem = isApiError(error) ? planEditProblem(error) : { kind: 'other' };
    const applied = (change: { readonly undoBlockedKey?: string; readonly errorKey?: string }) =>
      setCard(messageId, (current) => ({
        ...current,
        status: 'applied',
        undoBlockedKey: change.undoBlockedKey ?? current.undoBlockedKey,
        errorKey: change.errorKey ?? null,
      }));
    switch (problem.kind) {
      case 'undoWindow':
        applied({ undoBlockedKey: 'coach.planEdit.error.undoWindow' });
        return;
      case 'undoChanged':
        applied({ undoBlockedKey: 'coach.planEdit.error.undoChanged' });
        return;
      case 'notPending':
        if (problem.reason === 'undone') {
          setCard(messageId, (current) => ({ ...current, status: 'undone' }));
          refreshPlan();
          return;
        }
        applied({ errorKey: 'common.error_body' });
        return;
      case 'offline':
        applied({ errorKey: 'health.offline.action_hint' });
        return;
      default:
        applied({ errorKey: 'common.error_body' });
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

/** Part of the store's `abandonOpenQuestions`: another flow takes the words; a card left open keeps its buttons. */
export function abandonPlanEdit(): void {
  if (thread) {
    thread.takesWords = false;
    thread.questionFor = null;
  }
}

/** Forget everything (sign-out, a new chat, a restored one, the health wipe): an answer still out lands nowhere. */
export function resetPlanEdit(): void {
  resets += 1;
  thread = null;
  requests.clear();
  lastRequestId = null;
  askAgainRequestId = null;
  pendingConsentRequestId = null;
  applyKeys.clear();
  consentKeys.clear();
  forgetUndoKeys();
}

/** Tests: the consent grant and the key minting. */
export function setPlanEditDepsForTests(deps: { grant?: PlanEditConsentGrant | null; makeKey?: (() => string) | null }): void {
  if (deps.grant !== undefined) consentGrant = deps.grant ?? livePlanEditConsentGrant;
  if (deps.makeKey !== undefined) {
    makeKey = deps.makeKey ?? newIdempotencyKey;
    setUndoKeyMakerForTests(deps.makeKey);
  }
}

/** Tests: the thread. */
export function planEditThreadForTests(): Readonly<PlanEditThread> | null {
  return thread ? { ...thread } : null;
}
