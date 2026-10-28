/* eslint lifepass/no-literal-copy: "error" */
/**
 * The day-plan wizard: "Plan my day" to ONE `POST /coach` intake call, with
 * a model-less fallback (iOS `CoachViewModel`'s "Plan wizard (v2 intake ->
 * one /coach call)": `startPlan`, `startPlanFlow`, `askPlanQuestion`,
 * `selectPlanOption`, `submitPlan`, `runPlan`, `runVenueFallback`,
 * `refinePlan`, `hydratePlanVenues`). ../flows/dayPlan.ts wraps it as the
 * `CoachFlow` COACH-1's store runs; ../planCards draws the plan.
 *
 * HOW IT STARTS
 * - The empty state's "Plan my day" chip (`enter`), the programme gate's
 *   "Plan my day" chip (`startDayPlanFromChip`, COACH-4), and "Plan
 *   something else" under a plan (`restartDayPlan`): a fresh wizard, goal
 *   first, under the chip's own label.
 * - Typed words that clearly ask for a day ("plan my day", "a hike", "hvað á
 *   ég að gera í dag"; ../routing/intents.ts `planIntentAnswers`): the
 *   wizard starts with what the words already answer.
 *
 * WHAT IT ASKS. Goal, area, when, time of day (not for "now"), duration,
 * intensity (a workout or the outdoors), class type (a class or a workout).
 * The next question is derived from the answers (./model.ts). Each tap
 * closes the bubble and posts its label as the member's bubble. Only the
 * LAST open question answers, as in the venue wizard.
 *
 * WHAT IT DOES WITH TYPING (owner ruling P1). Only the class-type question
 * takes typed words, as its answer (cut to 40 UTF-16 units). Anywhere else
 * the words are DROPPED: not kept, not sent, not saved. `coach.plan.typed_hint`
 * says so once per wizard, and the question is asked again under it so the
 * chips stay at the bottom of the chat.
 *
 * THE CALL. Nothing calls the model until the last answer. Then: at either
 * Coach lock, the free venue list straight away (in words that fit the
 * allowance that is spent); otherwise ONE `POST /coach { locale, intake }`
 * under the typing dots ("Near me" first waits up to 4 s for a fix, and
 * without one plans for the Capital Region and says so). A plan is drawn as
 * plan cards; no plan and no reply is `coach.plan.empty`; a reply without a
 * plan is the chat's reply (text, or a venue document as cards). A 429
 * shows the server's sentence, a 503 `coach.busy`, anything else
 * `coach.plan.error_fallback`, each followed by the free venue list for what
 * was asked (the member never loses their answers to an error).
 *
 * REFINEMENTS. A chip under a plan posts its label, then `POST /coach {
 * locale, refine: { planId, change } }` with NO intake (./api.ts says why).
 * At a lock the input's locked sentence answers; an error says the API's
 * sentence or `coach.plan.refine_error`. Never a fallback list.
 *
 * "REPORT THIS REPLY" (Android only, COACH-7). A plan's intro in the model's
 * words (the plan's own intro, else the reply) marks the message `aiReply`,
 * so the card offers the report, and what is sent is the model's words as
 * the card draws them: the intro, then each step's note (`planReportWords`).
 * The app's fallback intro is never marked.
 *
 * Every answer checks the chat it started in (the busy token): a New chat, a
 * restore or a sign-out meanwhile drops it. Nothing here is stored on the
 * phone, so a sign-out has nothing to wipe beyond `resetDayPlan`.
 */
import { isApiError } from '../../../api';
import { fetchVenueBySlug } from '../../../api/venues';
import type { SharedRouteNavigation } from '../../../navigation/sharedSheet';
import type { Venue } from '../../../types/venue';
import type * as ClassSheet from '../../classes/sheet';
import { parseVenuePayload, resolveVenueCards, venuesReplyAsText, venuesReplyHasModelWords } from '../chat/venueReply';
import { runVenueQuery } from '../flows/venueWizard';
import { isCoachBusy } from '../freeTier/freeTier';
import { planIntentAnswers } from '../routing/intents';
import { coachHost, type CoachBusyToken } from '../store/host';
import { lastOpenQuestion, modelWords, type CoachMessage } from '../store/messages';
import { postCoachPlan, type CoachPlanRequest } from './api';
import { planChangeForChip, planVenueSlugs, type CoachPlan } from './decode';
import { resolvePlanLocation, warmPlanLocation } from './location';
import {
  answersFromIntent,
  EMPTY_PLAN_ANSWERS,
  fallbackVenueCategory,
  fallbackWizardAnswers,
  NEAR_CHOICE,
  nextPlanQuestion,
  planIntake,
  recordPlanAnswer,
  refineChipLabel,
  type PlanAnswers,
  type PlanQuestion,
} from './model';
import { planQuestionDef } from './questions';

/** The message kind a plan is drawn by (../planCards/PlanMessage.tsx). */
export const PLAN_MESSAGE_KIND = 'dayPlan.plan';

/** A plan message's payload: the plan, and the full venue rows that load after it (iOS `plan`, `planVenues`). */
export interface PlanMessagePayload {
  readonly plan: CoachPlan;
  /** Full venue rows by slug, filled in shortly after the plan lands. A slug missing here draws from the plan's own fields. */
  readonly venues: Readonly<Record<string, Venue>>;
}

/** The payload of a plan message, or null for any other message. */
export function planPayloadOf(message: Pick<CoachMessage, 'kind' | 'payload'> | undefined | null): PlanMessagePayload | null {
  if (!message || message.kind !== PLAN_MESSAGE_KIND) return null;
  const payload = message.payload as Partial<PlanMessagePayload> | undefined;
  if (!payload || typeof payload !== 'object' || !payload.plan) return null;
  return { plan: payload.plan, venues: payload.venues ?? {} };
}

/**
 * What "Report this reply" sends for a plan: the model's own words as the
 * card draws them, the intro and then each step's note, a blank line apart.
 * A plan message with no plan left (a saved chat keeps only the intro) is
 * its text. Only asked of a message marked `aiReply`, whose intro is the
 * model's.
 */
export function planReportWords(message: Pick<CoachMessage, 'kind' | 'payload' | 'text'>): string {
  const notes = planPayloadOf(message)?.plan.steps.map((step) => step.note) ?? [];
  return [message.text, ...notes]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n');
}

// MARK: - State

/** The wizard in progress (iOS `planFlow`), or null. */
interface WizardState {
  readonly answers: PlanAnswers;
  /** The bubble asking the question on screen: the only one that may answer. */
  readonly questionId: string;
}

let wizard: WizardState | null = null;
/** The typed-words hint is said once per wizard, not once per message (iOS `planTypedHintShown`). */
let typedHintShown = false;

/** The wizard is in progress (a question open, or about to be asked). */
export function isDayPlanActive(): boolean {
  return wizard !== null;
}

/** True while `messageId` is the wizard's question AND the last open question in the chat. */
function isCurrentQuestion(messageId: string): boolean {
  if (!wizard || wizard.questionId !== messageId) return false;
  return lastOpenQuestion(coachHost().messages())?.id === messageId;
}

/** The wizard has its question open. */
export function dayPlanHasOpenQuestion(): boolean {
  return wizard !== null && isCurrentQuestion(wizard.questionId);
}

/** Drops the wizard (iOS `abandonOpenQuestions`, `resetChat`, a restore): its bubble is closed by the store. */
export function resetDayPlan(): void {
  wizard = null;
  typedHintShown = false;
}

/** The wizard's answers and open question, for tests. */
export function dayPlanStateForTests(): { readonly answers: PlanAnswers; readonly question: PlanQuestion | null } | null {
  return wizard ? { answers: wizard.answers, question: nextPlanQuestion(wizard.answers) } : null;
}

// MARK: - Asking

/** Appends the bubble for `question` and makes it the open one (iOS `askPlanQuestion`). */
function ask(answers: PlanAnswers, question: PlanQuestion): void {
  const host = coachHost();
  const def = planQuestionDef(question, (key) => host.t(key));
  const [questionId] = host.append({ role: 'assistant', text: def.text, options: def.options, flow: 'dayPlan' });
  wizard = { answers, questionId: questionId! };
}

/**
 * The member's bubble, then the first question not already answered (iOS
 * `startPlanFlow`). One wizard at a time: every entry abandoned the open
 * questions before this.
 */
function start(userText: string, answers: PlanAnswers): void {
  coachHost().append({ role: 'user', text: userText });
  typedHintShown = false;
  wizard = null;
  const question = nextPlanQuestion(answers);
  if (question !== null) ask(answers, question);
}

/** A tap that starts a fresh wizard under `userText` (the store abandoned every open question first). */
export function enterDayPlan(userText: string): void {
  start(userText, EMPTY_PLAN_ANSWERS);
}

/**
 * A fresh wizard from a chip a flow draws itself (iOS `startPlan(labelKey:)`):
 * never over a reply in flight, and every open question abandoned first.
 * "Plan something else" under a plan (`coach.plan.new`) and the programme
 * gate's "Plan my day" (`coach.chip.plan_day`, COACH-4) start here.
 *
 * Nothing happens while a fresh wizard already has its first question open:
 * a quick second tap (nothing sets typing on this path) would otherwise leave
 * two of the member's bubbles and a dead goal question between them.
 */
export function startDayPlanFromChip(labelKey: string): void {
  const host = coachHost();
  if (host.isTyping()) return;
  if (wizard !== null && wizard.answers === EMPTY_PLAN_ANSWERS && isCurrentQuestion(wizard.questionId)) return;
  host.abandonOpenQuestions();
  start(host.t(labelKey), EMPTY_PLAN_ANSWERS);
}

/** "Plan something else" under a plan (iOS `restartPlan`). */
export function restartDayPlan(): void {
  startDayPlanFromChip('coach.plan.new');
}

/**
 * Typed words that ask for a day start the wizard with what they already
 * answer (the pipeline's `dayPlan.start`, iOS `send`'s
 * `CoachPlanIntent.answers`). Every open question is abandoned FIRST, so
 * this wizard's own question stays open. False for words that keep their
 * old path (a venue search, a question for the chat).
 */
export function startDayPlanFromWords(text: string, abandonOpenQuestions: () => void): boolean {
  const intent = planIntentAnswers(text);
  if (!intent) return false;
  abandonOpenQuestions();
  start(text, answersFromIntent(intent));
  return true;
}

// MARK: - Answering

/**
 * A chip (or the "Other" field, or words typed into the class-type
 * question) answered the open question (iOS `selectPlanOption`). A value
 * that does not belong to the question, or a tap on any bubble but the last
 * open one, changes nothing.
 */
export async function answerDayPlan(messageId: string, value: string, label: string): Promise<void> {
  const current = wizard;
  if (!current) return;
  const question = nextPlanQuestion(current.answers);
  if (question === null || !isCurrentQuestion(messageId)) return;
  const answers = recordPlanAnswer(current.answers, value, question);
  if (!answers) return;

  const host = coachHost();
  host.markAnswered(messageId, label);
  host.append({ role: 'user', text: label });

  // A fix is warmed the moment "Near me" is picked (not before, so a member
  // who picks a region is never asked); the questions left give it time.
  if (question === 'area' && value === NEAR_CHOICE) warmPlanLocation();

  const next = nextPlanQuestion(answers);
  if (next !== null) {
    ask(answers, next);
    return;
  }
  wizard = null;
  await submitPlan(answers);
}

/**
 * Words typed while the wizard has its question open (the pipeline's
 * `dayPlan.open`). The class-type question takes them as its answer; any
 * other question drops them (see the file comment). Always true: the words
 * end here either way.
 */
export async function takeTypedForDayPlan(text: string): Promise<boolean> {
  const current = wizard;
  if (!current || !isCurrentQuestion(current.questionId)) return false;
  const question = nextPlanQuestion(current.answers);
  if (question === null) return false;
  if (question === 'classType') {
    await answerDayPlan(current.questionId, text, text);
    return true;
  }
  const host = coachHost();
  if (!typedHintShown) {
    typedHintShown = true;
    host.append({ role: 'assistant', text: host.t('coach.plan.typed_hint') });
  }
  host.markAnswered(current.questionId);
  ask(current.answers, question);
  return true;
}

// MARK: - The call

/**
 * The last answer is in (iOS `submitPlan`). At either lock the call would
 * only come back 429, so it is skipped for the free venue list.
 */
async function submitPlan(answers: PlanAnswers): Promise<void> {
  const host = coachHost();
  if (host.isAILocked()) {
    await runVenueFallback(answers, host.freeLimitReached() ? 'coach.plan.free_limit_fallback' : 'coach.plan.limit_fallback');
    return;
  }
  const busy = host.busy();
  try {
    let current = answers;
    let location: { latitude: number; longitude: number } | null = null;
    if (current.areaChoice === NEAR_CHOICE) {
      const fix = await resolvePlanLocation();
      if (!busy.isCurrent()) return;
      if (fix) {
        location = fix;
      } else {
        // No fix: plan for the capital rather than sending Reykjavík's centre
        // dressed up as the member's position, and say so.
        current = { ...current, areaChoice: 'capital' };
        host.append({ role: 'assistant', text: host.t('coach.plan.no_location') });
      }
    }
    const intake = planIntake(current, location);
    if (!intake) return;
    await runPlan({ intake }, current, busy);
  } finally {
    busy.end();
  }
}

/**
 * ONE `/coach` call for a plan or a refinement (iOS `runPlan`), under `busy`
 * (the caller ends it). `fallbackAnswers` is set for a first plan: if the
 * call fails for any reason, the member still gets the free venue list.
 */
async function runPlan(request: CoachPlanRequest, fallbackAnswers: PlanAnswers | null, busy: CoachBusyToken): Promise<void> {
  const host = coachHost();
  try {
    const response = await postCoachPlan(host.language(), request);
    // Counted even when a New chat came meanwhile (the allowance was spent).
    host.recordFreeMessages(response.freeMessages, busy);
    if (!busy.isCurrent()) return;

    const reply = response.reply.trim();
    if (response.plan) {
      const plan = response.plan;
      const intro = plan.intro !== '' ? plan.intro : reply;
      const payload: PlanMessagePayload = { plan, venues: {} };
      const [messageId] = host.append({
        role: 'assistant',
        text: intro !== '' ? intro : host.t('coach.plan.intro_fallback'),
        flow: 'dayPlan',
        kind: PLAN_MESSAGE_KIND,
        payload,
        // Taller than the screen: the chat lands on its top, and the member reads down.
        anchorTop: true,
        // The model's intro offers "Report this reply"; the app's fallback does not.
        ...modelWords(intro !== ''),
      });
      void hydratePlanVenues(messageId!, plan, busy);
    } else if (reply === '') {
      host.append({ role: 'assistant', text: host.t('coach.plan.empty') });
    } else {
      // A server with no plan for this intake answers in words (or, from an
      // older prompt, a venues document).
      await appendReply(reply, busy);
    }
  } catch (error) {
    if (isApiError(error) && error.status === 429) {
      // The server's own sentence says which allowance and when it comes back.
      host.applyCoachLimit(error, busy);
      if (!busy.isCurrent()) return;
      host.append({ role: 'assistant', text: error.messageIn(host.language()) || host.t('coach.ai_unavailable') });
      if (fallbackAnswers) await runVenueFallback(fallbackAnswers, null);
      return;
    }
    if (isApiError(error) && isCoachBusy(error)) {
      // Busy for a minute, not spent: said, and the input stays open.
      if (!busy.isCurrent()) return;
      if (fallbackAnswers) await runVenueFallback(fallbackAnswers, 'coach.busy');
      else host.append({ role: 'assistant', text: host.t('coach.busy') });
      return;
    }
    if (!busy.isCurrent()) return;
    if (fallbackAnswers) {
      // A server that predates plans answers 400; a timeout or a 5xx lands
      // here too. None of them should cost the member their answers.
      await runVenueFallback(fallbackAnswers, 'coach.plan.error_fallback');
    } else {
      const sentence = isApiError(error) ? error.messageIn(host.language()) : '';
      host.append({ role: 'assistant', text: sentence || host.t('coach.plan.refine_error') });
    }
  }
}

/**
 * A reply without a plan, as the chat shows one (iOS `appendAssistantReply`).
 * The model's own words are marked `aiReply`, so they offer "Report this
 * reply" (src/features/coach/report); the app's fallback intro is not.
 */
async function appendReply(text: string, busy: CoachBusyToken): Promise<void> {
  const host = coachHost();
  const payload = parseVenuePayload(text);
  if (!payload) {
    host.append({ role: 'assistant', text, ...modelWords(true) });
    return;
  }
  const cards = await resolveVenueCards(payload);
  if (!busy.isCurrent()) return;
  if (cards.length > 0) {
    const intro = payload.intro?.trim();
    host.append({ role: 'assistant', text: intro ? intro : host.t('coach.explore_fallback'), venues: cards, ...modelWords(!!intro) });
  } else {
    host.append({
      role: 'assistant',
      text: venuesReplyAsText(payload, (key) => host.t(key)),
      ...modelWords(venuesReplyHasModelWords(payload)),
    });
  }
}

/**
 * The free, model-less answer (iOS `runVenueFallback`): an optional notice,
 * then the venue wizard's list for what was asked, honouring the area where
 * the venue wizard can (../flows/venueWizard.ts `runVenueQuery`).
 */
async function runVenueFallback(answers: PlanAnswers, noticeKey: string | null): Promise<void> {
  const host = coachHost();
  if (noticeKey) host.append({ role: 'assistant', text: host.t(noticeKey) });
  await runVenueQuery(fallbackVenueCategory(answers), fallbackWizardAnswers(answers));
}

/**
 * The full venue rows for a plan's venue steps (iOS `hydratePlanVenues`),
 * after the plan is on screen so the cards never wait on it. A slug that
 * fails to load keeps the card drawn from the plan's own fields; a chat that
 * changed meanwhile is left alone.
 */
async function hydratePlanVenues(messageId: string, plan: CoachPlan, busy: CoachBusyToken): Promise<void> {
  const slugs = planVenueSlugs(plan);
  if (slugs.length === 0) return;
  const found: Record<string, Venue> = {};
  for (const slug of slugs) {
    try {
      found[slug] = await fetchVenueBySlug(slug);
    } catch {
      // This card keeps the plan's own fields.
    }
  }
  if (Object.keys(found).length === 0 || !busy.isCurrent()) return;
  coachHost().update(messageId, (message) => {
    const payload = planPayloadOf(message);
    if (!payload) return message;
    const next: PlanMessagePayload = { plan: payload.plan, venues: { ...payload.venues, ...found } };
    return { ...message, payload: next };
  });
}

// MARK: - Under a plan

/**
 * A refinement chip under a plan (iOS `refinePlan`): the change, and the plan
 * it refines. The plan id is the whole state (the answers, what earlier taps
 * changed, what "something else" has shown), so the change lands on the plan
 * the member is LOOKING AT.
 */
export async function refineDayPlan(messageId: string, chip: string): Promise<void> {
  const host = coachHost();
  if (host.isTyping()) return;
  const payload = planPayloadOf(host.messages().find((message) => message.id === messageId));
  if (!payload) return;
  host.abandonOpenQuestions();
  host.append({ role: 'user', text: refineChipLabel(chip, (key) => host.t(key)) });
  if (host.isAILocked()) {
    host.append({ role: 'assistant', text: host.t(host.freeLimitReached() ? 'coach.input.free_limit' : 'coach.input.limit_reached') });
    return;
  }
  const busy = host.busy();
  try {
    await runPlan({ refine: { planId: payload.plan.id, change: planChangeForChip(payload.plan, chip) } }, null, busy);
  } finally {
    busy.end();
  }
}

/** A venue step's card: the venue's page, by slug (whether or not its full row has loaded). */
export function openPlanVenue(slug: string): void {
  coachHost().route({ kind: 'venue', slug });
}

/** A sight step's card: the sight's card ("See the place"). */
export function openPlanSight(slug: string): void {
  coachHost().route({ kind: 'sight', slug });
}

/**
 * Where a class step's Book opens the venue page when the feed has no such
 * class: through the Coach screen, which performs it once (`host.route`).
 */
const venueThroughCoach = {
  navigate: (name: string, params?: { readonly slug?: string }) => {
    if (name === 'VenueDetail' && params?.slug) openPlanVenue(params.slug);
  },
} as unknown as SharedRouteNavigation;

/**
 * A class step's Book (iOS CoachView's `bookClass`): the class sheet on
 * that exact session (the plan's own handle, else the same class found in
 * the feed), or, when nothing matches, the venue's page, whose timetable
 * books it (CLASS-2's `bookCoachClass`). A chat class card's Book is the
 * same call (src/screens/coach/ClassCardsMessage.tsx).
 */
export async function bookPlanClass(session: ClassSheet.CoachPlanClass): Promise<void> {
  try {
    // Required on the tap, not at import: the class sheet draws with the UI
    // kit, and this file loads with the Coach's store wherever that loads
    // (../planCards/index.ts says why).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bookCoachClass } = require('../../classes/sheet') as typeof ClassSheet;
    await bookCoachClass(session, { navigation: venueThroughCoach });
  } catch {
    // The lookup reports its own failures as "not found"; nothing else to say.
  }
}
