/* eslint lifepass/no-literal-copy: "error" */
/**
 * Changing the workout plan by talking to the Coach (spec "appsUx"): the
 * Android port of iOS `extension CoachViewModel` "Plan edits"
 * (ViewModels/CoachViewModel+PlanEdit.swift). ../flows/planEdit.ts plugs it
 * into COACH-1's store as the `planEdit` flow.
 *
 * THE SHAPE OF A CHANGE
 * 1. Words reach it three ways: typed words the router reads as a plan
 *    change (`planEdit.start`), words typed while a suggestion is open or
 *    after "Change my plan" (`planEdit.open`), and words typed while Adjust
 *    my plan was open (handed on). They go to OP-58 with the plan's id,
 *    the app language for the card, and the day or exercise they were asked
 *    from.
 * 2. The answer is a PREVIEW (the card: what changes, which days, Apply and
 *    Cancel, two variants at most), a CLARIFYING question (chips that send
 *    their own words back), NO CHANGE (the reply and what could not be
 *    done), or NOT A PLAN EDIT: then the member's bubble goes and the words
 *    go on through the Coach from the programme offer, as if this never ran.
 * 3. NOTHING CHANGES UNTIL APPLY (OP-59). A change that makes the plan
 *    repeat as a cycle asks first. Apply waits while today's workout is open
 *    in the runner. After it, the card says "Changed" with Undo (OP-60)
 *    while the server says it can be undone; Cancel discards (OP-61, best
 *    effort).
 *
 * THE HEALTH LANE. Every bubble here is `isHealth`: never saved, never in
 * the history a chat sends to the model (src/features/coach/store/messages.ts
 * `isConversationTurn`), wiped with the health data. The words leave the
 * phone once, in the OP-58 body, and are never logged or tracked: the
 * analytics events carry fixed words only.
 *
 * ONE KEY PER REQUEST. Each send mints its Idempotency-Key; the consent tap
 * resends the SAME words with the SAME key (the server answers a replay for
 * free), Retry and Ask again mint a new one, and `idempotency_key_reused`
 * is retried once with a fresh key.
 */
import { isApiError, newIdempotencyKey, type ApiError } from '../../../api';
import { openHealthConsent, useHealthStore } from '../../../health';
import { countBand, track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import type { QuestionOption } from '../../../types/coach';
import { startAdjust } from '../adjust/flow';
import { appendProgramBubble, appendProgramUser, startProgram } from '../program';
import { coachHost } from '../store/host';
import { isOpenQuestion, type CoachMessage } from '../store/messages';

import {
  applyPlanEdit,
  cleanPlanEditText,
  discardPlanEdit,
  isPlanEditSendable,
  planEditApplyFailure,
  planEditBody,
  planEditErrorCode,
  planEditFailureCopyKey,
  planEditSendFailure,
  planEditUndoFailure,
  postPlanEdit,
} from './api';
import { planEditAvailability, type PlanEditAvailability } from './availability';
import { grantPlanEditConsent, livePlanEditConsentGrant, type PlanEditConsentGrant } from './consent';
import { planEditIntentMatches, planVocabularyFrom } from './intent';
import { presentDialog, presentToast, runnerOpenFor } from './platform';
import { announceUndone, forgetUndoKeys, isUndoable, refreshPlan, setUndoKeyMakerForTests, undoEdit } from './undo';
import type { PlanEditPreview, PlanEditResponse } from './types';

// ---------------------------------------------------------------------------
// Messages

/** The flow's own bubbles (its renderers, ../flows/planEdit.ts). */
export const PlanEditMessageKind = {
  /** The preview card. */
  preview: 'planEdit.preview',
  /** The one-tap consent. */
  consent: 'planEdit.consent',
  /** "Some of it couldn't be done": the server's lines, muted. */
  notice: 'planEdit.notice',
} as const;

/** The chips' wire values. */
export const PlanEditOptionValue = {
  prefix: 'planEdit.',
  choice: 'planEdit.choice.',
  retry: 'planEdit.retry.',
  askAgain: 'planEdit.askAgain.',
  suggestAdjust: 'planEdit.suggest.adjust',
  suggestNewPlan: 'planEdit.suggest.newPlan',
} as const;

/** Where a preview card stands. */
export type PlanEditCardStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'undoing'
  | 'undone'
  | 'cancelled'
  /** A newer suggestion replaced it (the server superseded it). */
  | 'superseded'
  /** The plan changed since: "Ask me again". */
  | 'stale';

export interface PlanEditCardPayload {
  readonly programId: string;
  /** The request the card answered (Ask again resends its words). */
  readonly requestId: string;
  readonly variants: readonly PlanEditPreview[];
  /** The variant the member is looking at: the recommended one first. */
  readonly selected: number;
  readonly status: PlanEditCardStatus;
  /** Once applied: the change as the server holds it. */
  readonly applied: { readonly editId: string; readonly undoUntil: Date | null; readonly undoable: boolean } | null;
  /** A line under the buttons (a failed Apply or Undo). */
  readonly errorKey: string | null;
}

export interface PlanEditConsentPayload {
  readonly requestId: string;
  readonly status: 'idle' | 'granting' | 'granted';
  readonly errorKey: string | null;
}

export interface PlanEditNoticePayload {
  /** "Some of it couldn't be done:" when the server sent it. */
  readonly note: string | null;
  readonly lines: readonly string[];
}

/** One send of words to OP-58, kept for the consent tap, Retry and Ask again. */
interface PlanEditRequest {
  readonly id: string;
  readonly programId: string;
  /** What the member typed or tapped, as their bubble shows it. */
  readonly text: string;
  readonly replacesEditId: string | null;
  readonly sessionId: string | null;
  readonly exerciseId: string | null;
  /** This request's key: the consent tap resends with it. */
  key: string;
  /** The member's bubble for these words, while it is on screen. */
  userMessageId: string | null;
}

/** The day or exercise a plan change was asked from. */
export interface PlanEditContext {
  readonly sessionId: string | null;
  readonly exerciseId: string | null;
}

const NO_CONTEXT: PlanEditContext = { sessionId: null, exerciseId: null };

// ---------------------------------------------------------------------------
// State

/** "Change my plan" (or Plan's "Change with Coach") was tapped: the next words go to OP-58 whatever they say. */
let awaiting: PlanEditContext | null = null;
/** The newest preview card still pending: words typed now refine it (`replacesEditId`). */
let openPreviewId: string | null = null;
/** The clarifying question on screen, and the request it asked about. */
let openClarify: { readonly messageId: string; readonly requestId: string } | null = null;
/** Every request this chat has sent, by id. */
const requests = new Map<string, PlanEditRequest>();
/** One key per edit and action: a second tap on Apply or Undo is the same request. */
const applyKeys = new Map<string, string>();
const consentKeys = new Map<string, string>();
let requestCounter = 0;
/**
 * Bumped by `resetPlanEdit` (a sign-out, a new chat, the health data wiped):
 * an answer still out then lands nowhere, the way the programme and Adjust
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
  const [id] = coachHost().append({ role: 'user', text, isHealth: true, flow: 'planEdit' });
  return id!;
}

function appendAssistant(text: string): void {
  coachHost().append({ role: 'assistant', text, isHealth: true, flow: 'planEdit' });
}

function appendQuestion(text: string, options: readonly QuestionOption[]): string {
  const [id] = coachHost().append({ role: 'assistant', text, options, isHealth: true, flow: 'planEdit' });
  return id!;
}

function updateCard(id: string, change: (payload: PlanEditCardPayload) => PlanEditCardPayload): void {
  coachHost().update(id, (message) => {
    const payload = cardPayload(message);
    return payload ? { ...message, payload: change(payload) } : message;
  });
}

function cardPayload(message: CoachMessage | undefined): PlanEditCardPayload | null {
  if (!message || message.kind !== PlanEditMessageKind.preview) return null;
  return (message.payload as PlanEditCardPayload | undefined) ?? null;
}

function findMessage(id: string): CoachMessage | undefined {
  return coachHost()
    .messages()
    .find((message) => message.id === id);
}

/** The cards still waiting for Apply or Cancel. */
function pendingCards(): CoachMessage[] {
  return coachHost()
    .messages()
    .filter((message) => cardPayload(message)?.status === 'pending');
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * The Coach's empty-state "Change my plan" chip (it replaces "Adjust my
 * plan" while the server changes plans by chat), and Plan's "Change with
 * Coach" (`context.sessionId`). The Coach asks what to change; the next
 * words go to OP-58.
 */
export async function startPlanEdit(userText: string, context: PlanEditContext = NO_CONTEXT): Promise<void> {
  const host = coachHost();
  if (host.isTyping()) return;
  const availability = planEditAvailability();
  if (availability.kind === 'unavailable') {
    // The feature went away under the chip: Adjust my plan, as before.
    await startAdjust(host.t('coach.chip.adjust_plan'));
    return;
  }
  appendUser(userText);
  if (availability.kind === 'paused') {
    appendAssistant(t('coach.planEdit.error.planPaused'));
    return;
  }
  track('plan_edit_sent', { entry: context.sessionId ? 'plan' : 'chip', mode: 'prompt' });
  appendAssistant(t('coach.planEdit.prompt'));
  awaiting = { ...context };
}

/**
 * A plan change parked by another tab. With words (the runner's "I don't
 * have the equipment for Lat pulldown"), they go in the input for the member
 * to send; without, the Coach asks what to change.
 */
export async function enterParkedPlanEdit(entry: {
  sessionId?: string | null;
  exerciseId?: string | null;
  prefill?: string | null;
}): Promise<void> {
  const context: PlanEditContext = { sessionId: entry.sessionId ?? null, exerciseId: entry.exerciseId ?? null };
  const prefill = entry.prefill?.trim() ?? '';
  if (prefill) {
    if (planEditAvailability().kind === 'unavailable') return;
    awaiting = context;
    coachHost().setInput(prefill);
    return;
  }
  await startPlanEdit(t('coach.planEdit.chip'), context);
}

// ---------------------------------------------------------------------------
// The pipeline's two steps

/** `planEdit.open`: a suggestion is open, or "Change my plan" was tapped. */
export function hasOpenPlanEdit(): boolean {
  if (planEditAvailability().kind === 'unavailable') return false;
  if (awaiting !== null) return true;
  if (openClarify !== null) {
    const question = findMessage(openClarify.messageId);
    if (question && isOpenQuestion(question)) return true;
  }
  return openPreviewId !== null && cardPayload(findMessage(openPreviewId))?.status === 'pending';
}

/** The words for an open suggestion: they refine it. */
export async function takeTypedPlanEdit(text: string): Promise<boolean | 'passed'> {
  const availability = planEditAvailability();
  if (availability.kind === 'unavailable') return false;
  let replacesEditId: string | null = null;
  let context: PlanEditContext = awaiting ?? NO_CONTEXT;
  const preview = openPreviewId ? findMessage(openPreviewId) : undefined;
  const card = cardPayload(preview);
  if (card?.status === 'pending') {
    replacesEditId = card.variants[card.selected]?.editId ?? null;
    const request = requests.get(card.requestId);
    if (request) context = { sessionId: request.sessionId, exerciseId: request.exerciseId };
  } else if (openClarify) {
    const request = requests.get(openClarify.requestId);
    if (request) {
      context = { sessionId: request.sessionId, exerciseId: request.exerciseId };
      replacesEditId = request.replacesEditId;
    }
    coachHost().markAnswered(openClarify.messageId);
  }
  return sendWords(text, availability, { replacesEditId, context });
}

/**
 * `planEdit.start`: words that ask to change the running plan, or any words
 * typed at Adjust my plan (`handedOn`).
 */
export async function startPlanEditFrom(
  text: string,
  options: { readonly handedOn: boolean; readonly abandonOpenQuestions: () => void },
): Promise<boolean | 'passed'> {
  const availability = planEditAvailability();
  if (availability.kind === 'unavailable') return false;
  if (!options.handedOn) {
    const day = availability.kind === 'available' ? availability.day : useHealthStore.getState().today;
    if (!planEditIntentMatches(text, planVocabularyFrom(day))) return false;
  }
  if (!isPlanEditSendable(text)) return false;
  options.abandonOpenQuestions();
  return sendWords(text, availability, { replacesEditId: null, context: NO_CONTEXT });
}

// ---------------------------------------------------------------------------
// Sending

async function sendWords(
  text: string,
  availability: PlanEditAvailability,
  options: { replacesEditId: string | null; context: PlanEditContext },
): Promise<boolean | 'passed'> {
  if (availability.kind === 'unavailable') return false;
  // Words the server would refuse for their length go on through the Coach.
  if (!isPlanEditSendable(text)) return false;
  awaiting = null;
  if (availability.kind === 'paused') {
    appendUser(text.trim());
    appendAssistant(t('coach.planEdit.error.planPaused'));
    return true;
  }
  const request: PlanEditRequest = {
    id: `r${(requestCounter += 1)}`,
    programId: availability.programId,
    text: text.trim(),
    replacesEditId: options.replacesEditId,
    sessionId: options.context.sessionId,
    exerciseId: options.context.exerciseId,
    key: makeKey(),
    userMessageId: null,
  };
  requests.set(request.id, request);
  request.userMessageId = appendUser(request.text);
  track('plan_edit_sent', { entry: options.replacesEditId ? 'refine' : 'typed', mode: 'send' });
  return send(request);
}

/**
 * OP-58 for one request, and its answer into the chat. `'passed'`: the
 * server says the words are not a plan change (or cannot take them), the
 * member's bubble is gone, and the caller sends the words on.
 */
async function send(request: PlanEditRequest): Promise<boolean | 'passed'> {
  const host = coachHost();
  const busy = host.busy();
  const opened = resets;
  const stillHere = () => busy.isCurrent() && opened === resets;
  let retriedKey = false;
  try {
    for (;;) {
      try {
        const body = planEditBody({
          message: request.text,
          language: host.language(),
          replacesEditId: request.replacesEditId,
          sessionId: request.sessionId,
          exerciseId: request.exerciseId,
        });
        const response = await postPlanEdit(request.programId, body, request.key);
        if (!stillHere()) return true;
        return answer(request, response);
      } catch (error) {
        if (!stillHere()) return true;
        if (!isApiError(error)) {
          track('plan_edit_error', { code: 'client' });
          appendAssistant(t('coach.planEdit.error.upstream'));
          return true;
        }
        if (error.isCancellation) return true;
        if (error.isProblem('idempotency_key_reused') && !retriedKey) {
          retriedKey = true;
          request.key = makeKey();
          continue;
        }
        return failed(request, error);
      }
    }
  } finally {
    busy.end();
  }
}

function removeUserBubble(request: PlanEditRequest): void {
  const id = request.userMessageId;
  if (id) coachHost().remove((message) => message.id === id);
  request.userMessageId = null;
}

function answer(request: PlanEditRequest, response: PlanEditResponse): boolean | 'passed' {
  if (response.kind === 'not_plan_edit') {
    track('plan_edit_preview', { kind: 'not_plan_edit', ops: 'none', variants: 'none' });
    removeUserBubble(request);
    requests.delete(request.id);
    return 'passed';
  }
  const items = response.variants.reduce((sum, variant) => sum + variant.changes.reduce((n, group) => n + group.items.length, 0), 0);
  track('plan_edit_preview', {
    kind: response.kind === 'unknown' ? 'no_change' : response.kind,
    ops: bandWord(items),
    variants: bandWord(response.variants.length),
  });

  const suggestion = suggestionOptions(response);
  switch (response.kind) {
    case 'preview': {
      if (response.reply) appendReply(response.reply, suggestion);
      // The server superseded every older pending preview of this plan.
      for (const card of pendingCards()) updateCard(card.id, (payload) => ({ ...payload, status: 'superseded' }));
      const recommended = response.variants.findIndex((variant) => variant.recommended);
      const payload: PlanEditCardPayload = {
        programId: request.programId,
        requestId: request.id,
        variants: response.variants,
        selected: recommended >= 0 ? recommended : 0,
        status: 'pending',
        applied: null,
        errorKey: null,
      };
      const [id] = coachHost().append({
        role: 'assistant',
        text: response.variants[payload.selected]?.summary ?? '',
        isHealth: true,
        flow: 'planEdit',
        kind: PlanEditMessageKind.preview,
        payload,
      });
      openPreviewId = id ?? null;
      openClarify = null;
      break;
    }
    case 'clarify': {
      const question = response.question;
      if (question) {
        if (response.reply && response.reply !== question.text) appendAssistant(response.reply);
        // The choices to tap, and the suggestion's chip after them. With
        // nothing to tap the member types the answer (the question stays open).
        const id = appendQuestion(question.text, [
          ...question.choices.map((choice, index) => ({ label: choice, value: `${PlanEditOptionValue.choice}${index}` })),
          ...suggestion,
        ]);
        openClarify = { messageId: id, requestId: request.id };
      } else {
        // A replay keeps no question text: the canned line, and the chat goes on.
        appendReply(response.reply ?? t('coach.planEdit.error.upstream'), suggestion);
      }
      break;
    }
    case 'no_change':
    case 'unknown': {
      const lines = response.notApplied.map((entry) => entry.text);
      if (response.reply || lines.length === 0) {
        appendReply(response.reply ?? t('coach.planEdit.error.upstream'), lines.length === 0 ? suggestion : []);
      }
      if (lines.length > 0) {
        coachHost().append({
          role: 'assistant',
          text: lines.join('\n'),
          isHealth: true,
          flow: 'planEdit',
          kind: PlanEditMessageKind.notice,
          payload: { note: null, lines } satisfies PlanEditNoticePayload,
        });
        if (suggestion.length > 0) appendQuestion(t('coach.planEdit.cardTitle'), suggestion);
      }
      break;
    }
  }
  return true;
}

/** The reply, as a question bubble when a suggestion's chip goes under it. */
function appendReply(reply: string, options: readonly QuestionOption[]): void {
  if (options.length > 0) appendQuestion(reply, options);
  else appendAssistant(reply);
}

/** "Adjust my plan" or "Start a new plan instead", when the server suggests one. */
function suggestionOptions(response: PlanEditResponse): QuestionOption[] {
  if (response.suggestion === 'adjust_plan') {
    return [{ label: t('coach.chip.adjust_plan'), value: PlanEditOptionValue.suggestAdjust }];
  }
  if (response.suggestion === 'new_plan') {
    return [{ label: t('program.adjust.opt.new_plan'), value: PlanEditOptionValue.suggestNewPlan }];
  }
  return [];
}

/** A failed OP-58, in the Coach's words. */
function failed(request: PlanEditRequest, error: ApiError): boolean | 'passed' {
  const failure = planEditSendFailure(error);
  if (failure !== 'consent' && failure !== 'passOn') track('plan_edit_error', { code: planEditErrorCode(error) });
  switch (failure) {
    case 'consent':
      track('plan_edit_error', { code: 'plan_edit_consent_required' });
      coachHost().append({
        role: 'assistant',
        text: t('healthconsent.ai.plan_edit'),
        isHealth: true,
        flow: 'planEdit',
        kind: PlanEditMessageKind.consent,
        payload: { requestId: request.id, status: 'idle', errorKey: null } satisfies PlanEditConsentPayload,
      });
      return true;
    case 'passOn':
      // The route is gone (the server dropped the feature after it was read),
      // or the words are not ones it takes: the Coach as before.
      if (!error.isProblem('invalid-plan-edit')) useAppStore.getState().dropServerFeature('plan_edit');
      removeUserBubble(request);
      requests.delete(request.id);
      return 'passed';
    case 'upstream':
      appendQuestion(t('coach.planEdit.error.upstream'), [
        { label: t('coach.planEdit.retry'), value: `${PlanEditOptionValue.retry}${request.id}` },
      ]);
      return true;
    case 'notLive':
    case 'planPaused':
      appendAssistant(t(planEditFailureCopyKey(failure)!));
      refreshPlan();
      return true;
    case 'offline':
      appendAssistant(error.messageIn(coachHost().language()) || t('coach.ai_unavailable'));
      return true;
    case 'refused':
      // The gate, consent, a pending deletion, a minor: the health store's
      // rules (a profile read, the wipe), and the server's own sentence.
      useHealthStore.getState().handle(error, { foreground: false });
      appendAssistant(error.messageIn(coachHost().language()) || t('coach.ai_unavailable'));
      return true;
    default:
      appendAssistant(t(planEditFailureCopyKey(failure) ?? 'coach.planEdit.error.upstream'));
      return true;
  }
}

/** A word for a count (analytics never carries a bare number). */
function bandWord(count: number): string {
  if (count < 1) return 'none';
  if (count === 1) return 'one';
  return countBand(count);
}

// ---------------------------------------------------------------------------
// Chips

/** Every chip on a plan-edit bubble. */
export async function selectPlanEditOption(messageId: string, value: string, label: string): Promise<void> {
  const host = coachHost();
  const message = findMessage(messageId);
  if (!message || message.answered || host.isTyping()) return;

  if (value.startsWith(PlanEditOptionValue.choice)) {
    if (!openClarify || openClarify.messageId !== messageId) return;
    host.markAnswered(messageId, label);
    const request = requests.get(openClarify.requestId);
    openClarify = null;
    const availability = planEditAvailability();
    const words = cleanPlanEditText(label);
    const result = await sendWords(words, availability, {
      replacesEditId: request?.replacesEditId ?? null,
      context: request ? { sessionId: request.sessionId, exerciseId: request.exerciseId } : NO_CONTEXT,
    });
    // A chip's words that turn out not to be a plan change go on through the Coach.
    if (result === 'passed') await host.resumeSend(words);
    return;
  }

  if (value.startsWith(PlanEditOptionValue.retry) || value.startsWith(PlanEditOptionValue.askAgain)) {
    const id = value.slice(value.startsWith(PlanEditOptionValue.retry) ? PlanEditOptionValue.retry.length : PlanEditOptionValue.askAgain.length);
    const previous = requests.get(id);
    host.markAnswered(messageId, label);
    if (!previous) return;
    const availability = planEditAvailability();
    if (availability.kind !== 'available') {
      appendAssistant(t(availability.kind === 'paused' ? 'coach.planEdit.error.planPaused' : 'coach.ai_unavailable'));
      return;
    }
    // The same words under a NEW key (a retry after a failure, or a stale
    // suggestion asked again), under the member's bubble already on screen.
    const request: PlanEditRequest = {
      ...previous,
      id: `r${(requestCounter += 1)}`,
      programId: availability.programId,
      replacesEditId: null,
      key: makeKey(),
      userMessageId: previous.userMessageId,
    };
    requests.set(request.id, request);
    if (!request.userMessageId || !findMessage(request.userMessageId)) request.userMessageId = appendUser(request.text);
    const result = await send(request);
    if (result === 'passed') await host.resumeSend(request.text);
    return;
  }

  if (value === PlanEditOptionValue.suggestAdjust) {
    host.markAnswered(messageId, label);
    await startAdjust(label);
    return;
  }

  if (value === PlanEditOptionValue.suggestNewPlan) {
    host.markAnswered(messageId, label);
    appendProgramUser(label);
    appendProgramBubble('program.make_new.replaces_running');
    await startProgram({ entry: 'intent', showUserBubble: false, skipExistingPlanGates: true });
  }
}

// ---------------------------------------------------------------------------
// The consent tap

export async function grantConsentFor(messageId: string): Promise<void> {
  const message = findMessage(messageId);
  if (!message || message.kind !== PlanEditMessageKind.consent) return;
  const payload = message.payload as PlanEditConsentPayload;
  if (payload.status !== 'idle') return;
  const request = requests.get(payload.requestId);
  if (!request) return;
  const host = coachHost();
  const setPayload = (next: Partial<PlanEditConsentPayload>) =>
    host.update(messageId, (current) => ({ ...current, payload: { ...(current.payload as PlanEditConsentPayload), ...next } }));
  setPayload({ status: 'granting', errorKey: null });
  const opened = resets;
  const key = consentKeys.get(messageId) ?? makeKey();
  consentKeys.set(messageId, key);
  const standing = useAppStore.getState().profile?.health?.consent ?? null;
  const outcome = await grantPlanEditConsent(standing, key, consentGrant);
  if (opened !== resets) return;
  switch (outcome.kind) {
    case 'granted': {
      track('health_consent_granted', {
        entry: 'plan_edit',
        source: outcome.consent.ageSource === 'attestation' ? 'attestation' : 'kennitala',
      });
      const app = useAppStore.getState();
      app.applyHealthConsentGranted(outcome.consent);
      void app.loadProfile();
      setPayload({ status: 'granted' });
      // The same words, the same key.
      const result = await send(request);
      if (result === 'passed') await host.resumeSend(request.text);
      return;
    }
    case 'needsFullSheet':
      setPayload({ status: 'idle' });
      openHealthConsent({
        entry: 'coach',
        onGranted: async () => {
          if (opened !== resets) return;
          setPayload({ status: 'granted' });
          const result = await send(request);
          if (result === 'passed') await host.resumeSend(request.text);
        },
      });
      return;
    case 'failed':
      setPayload({ status: 'idle', errorKey: outcome.errorKey });
      return;
    case 'refused':
      setPayload({ status: 'idle' });
      useHealthStore.getState().handle(outcome.error, { foreground: true });
      appendAssistant(outcome.error.messageIn(host.language()) || t('coach.ai_unavailable'));
  }
}

// ---------------------------------------------------------------------------
// The card's buttons

/** The variant segmented control. */
export function selectVariant(messageId: string, index: number): void {
  updateCard(messageId, (payload) =>
    payload.status === 'pending' && index >= 0 && index < payload.variants.length ? { ...payload, selected: index, errorKey: null } : payload,
  );
}

/** True while today's workout is open in the runner and this variant would change it. */
export function applyWaitsForRunner(variant: PlanEditPreview | undefined): boolean {
  if (!variant?.touchesToday || !variant.todaySessionId) return false;
  return runnerOpenFor(variant.todaySessionId);
}

/** Apply (OP-59). A change that makes the plan a cycle asks first. */
export async function applyCard(messageId: string, confirmed = false): Promise<void> {
  const card = cardPayload(findMessage(messageId));
  if (!card || card.status !== 'pending') return;
  const variant = card.variants[card.selected];
  if (!variant || applyWaitsForRunner(variant)) return;
  if (variant.becomesCustom && !confirmed) {
    confirmCustom(messageId, variant);
    return;
  }
  updateCard(messageId, (payload) => ({ ...payload, status: 'applying', errorKey: null }));
  const key = applyKeys.get(variant.editId) ?? makeKey();
  applyKeys.set(variant.editId, key);
  const opened = resets;
  try {
    const response = await applyPlanEdit(card.programId, variant.editId, { confirmCustom: variant.becomesCustom && confirmed }, key);
    if (opened !== resets) return;
    if (response.features) useAppStore.getState().noteServerFeatures(response.features);
    track('plan_edit_applied', { kind: variant.becomesCustom ? 'cycle' : 'change' });
    updateCard(messageId, (payload) => ({
      ...payload,
      status: 'applied',
      applied: { editId: response.edit.id, undoUntil: response.edit.undoUntil, undoable: response.edit.undoable },
    }));
    if (openPreviewId === messageId) openPreviewId = null;
    presentToast(t('coach.planEdit.updatedToast'));
    refreshPlan();
  } catch (error) {
    if (opened !== resets) return;
    if (!isApiError(error) || error.isCancellation) {
      updateCard(messageId, (payload) => ({ ...payload, status: 'pending', errorKey: isApiError(error) ? null : 'common.error_body' }));
      return;
    }
    track('plan_edit_error', { code: planEditErrorCode(error) });
    const failure = planEditApplyFailure(error);
    switch (failure) {
      case 'confirmRequired':
        updateCard(messageId, (payload) => ({ ...payload, status: 'pending' }));
        confirmCustom(messageId, variant);
        return;
      case 'alreadyApplied':
        updateCard(messageId, (payload) => ({
          ...payload,
          status: 'applied',
          applied: { editId: variant.editId, undoUntil: null, undoable: false },
        }));
        refreshPlan();
        return;
      case 'stale': {
        updateCard(messageId, (payload) => ({ ...payload, status: 'stale', errorKey: 'coach.planEdit.error.stale' }));
        if (openPreviewId === messageId) openPreviewId = null;
        appendQuestion(t('coach.planEdit.error.stale'), [
          { label: t('coach.planEdit.askAgain'), value: `${PlanEditOptionValue.askAgain}${card.requestId}` },
        ]);
        refreshPlan();
        return;
      }
      case 'offline':
        updateCard(messageId, (payload) => ({ ...payload, status: 'pending', errorKey: 'health.offline.action_hint' }));
        return;
      case 'refused':
        useHealthStore.getState().handle(error, { foreground: true });
        updateCard(messageId, (payload) => ({ ...payload, status: 'pending', errorKey: 'common.error_body' }));
        return;
      default:
        updateCard(messageId, (payload) => ({
          ...payload,
          status: failure === 'notLive' || failure === 'planPaused' ? 'stale' : 'pending',
          errorKey: planEditFailureCopyKey(failure) ?? 'common.error_body',
        }));
        if (failure === 'notLive' || failure === 'planPaused') refreshPlan();
    }
  }
}

function confirmCustom(messageId: string, variant: PlanEditPreview): void {
  presentDialog({
    title: t('coach.planEdit.confirmCustom.title'),
    message: variant.becomesCustomNote ?? t('coach.planEdit.confirmCustom.body'),
    buttons: [
      { label: t('coach.planEdit.cancel'), role: 'cancel', testID: 'planEdit.confirmCustom.cancel' },
      {
        label: t('coach.planEdit.confirmCustom.ok'),
        onPress: () => void applyCard(messageId, true),
        testID: 'planEdit.confirmCustom.ok',
      },
    ],
    testID: 'planEdit.confirmCustom',
  });
}

/** Cancel: the card says so at once; the discard is best effort (a preview lapses in 24 hours anyway). */
export function cancelCard(messageId: string): void {
  const card = cardPayload(findMessage(messageId));
  if (!card || card.status !== 'pending') return;
  updateCard(messageId, (payload) => ({ ...payload, status: 'cancelled', errorKey: null }));
  if (openPreviewId === messageId) openPreviewId = null;
  track('plan_edit_cancelled');
  for (const variant of card.variants) {
    discardPlanEdit(card.programId, variant.editId, makeKey()).catch(() => undefined);
  }
}

/** Undo (OP-60), on the collapsed card while the server says it can. */
export async function undoCard(messageId: string): Promise<void> {
  const card = cardPayload(findMessage(messageId));
  if (!card || card.status !== 'applied' || !card.applied || !isUndoable(card.applied)) return;
  const { editId } = card.applied;
  updateCard(messageId, (payload) => ({ ...payload, status: 'undoing', errorKey: null }));
  const opened = resets;
  try {
    const keptRows = await undoEdit(card.programId, editId);
    if (opened !== resets) return;
    updateCard(messageId, (payload) => ({ ...payload, status: 'undone' }));
    announceUndone(keptRows);
  } catch (error) {
    if (opened !== resets) return;
    const failure = isApiError(error) ? planEditUndoFailure(error) : 'other';
    if (failure === 'alreadyUndone') {
      updateCard(messageId, (payload) => ({ ...payload, status: 'undone' }));
      refreshPlan();
      return;
    }
    const closes = failure === 'undoWindow' || failure === 'undoChanged';
    updateCard(messageId, (payload) => ({
      ...payload,
      status: 'applied',
      applied: payload.applied && closes ? { ...payload.applied, undoable: false } : payload.applied,
      errorKey:
        failure === 'offline' ? 'health.offline.action_hint' : (planEditFailureCopyKey(failure) ?? 'common.error_body'),
    }));
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

/** Part of the store's `abandonOpenQuestions`: typed words no longer refine anything. Cards keep their buttons. */
export function abandonPlanEdit(): void {
  awaiting = null;
  openClarify = null;
  openPreviewId = null;
}

/** Forget everything (sign-out, a new chat, the health wipe): an answer still out lands nowhere. */
export function resetPlanEdit(): void {
  resets += 1;
  abandonPlanEdit();
  requests.clear();
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

/** Tests: the flow's state. */
export function planEditStateForTests(): { awaiting: PlanEditContext | null; openPreviewId: string | null; openClarify: string | null } {
  return { awaiting, openPreviewId, openClarify: openClarify?.messageId ?? null };
}
