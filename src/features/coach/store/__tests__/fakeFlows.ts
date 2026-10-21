/**
 * Stand-ins for the four Coach flows (COACH-2 to COACH-5), so the store's
 * side of the contract (../../flows/types.ts) is tested on its own: what the
 * store hands a flow, in which order, and what it does with the answer.
 *
 * Each fake records every call. Its venue-wizard-like behaviour is the least
 * a real flow does through the host: `enter` appends the member's bubble and
 * one open question; a chip or typed words answer it. Tests switch on what
 * they need (`startsOn`, `takesTyped`).
 *
 *   jest.mock('../../flows/venueWizard', () => ({
 *     venueWizardFlow: require('./fakeFlows').fakeFlow('venueWizard'),
 *   }));
 */
import type {
  CoachFlow,
  CoachFlowEntry,
  CoachFlowId,
  CoachSendOptions,
  CoachStartContext,
} from '../../flows/types';
import { coachHost } from '../host';

export interface FakeFlow extends CoachFlow {
  /** Every call, in order: `enter`, `takeTyped:<text>`, `startFrom:<text>`, `abandon`, `reset`, ... */
  readonly calls: string[];
  readonly entries: CoachFlowEntry[];
  readonly startOptions: CoachSendOptions[];
  /** Words that start this flow (typed or parked). */
  startsOn: ((text: string, options: CoachSendOptions) => boolean) | null;
  /** Whether an open question takes typed words. */
  takesTyped: boolean;
  /** The id of this flow's open question bubble, if any. */
  openQuestionId: string | null;
  /** In progress with no question open (a programme summary or sheet up). */
  active: boolean;
  /** Back to fresh (between tests). */
  clear(): void;
}

const flows = new Map<CoachFlowId, FakeFlow>();

function askQuestion(flow: FakeFlow, userText: string, isHealth: boolean): void {
  const host = coachHost();
  const [, questionId] = host.append(
    { role: 'user', text: userText, isHealth },
    {
      role: 'assistant',
      text: `${flow.id} question`,
      flow: flow.id,
      isHealth,
      options: [
        { label: 'One', value: 'one' },
        { label: 'Two', value: 'two' },
      ],
    },
  );
  flow.openQuestionId = questionId ?? null;
}

export function fakeFlow(id: CoachFlowId): FakeFlow {
  const isHealth = id === 'program' || id === 'adjust';
  const flow: FakeFlow = {
    id,
    calls: [],
    entries: [],
    startOptions: [],
    startsOn: null,
    takesTyped: true,
    openQuestionId: null,
    active: false,
    renderers: {},
    clear() {
      flow.calls.length = 0;
      flow.entries.length = 0;
      flow.startOptions.length = 0;
      flow.startsOn = null;
      flow.takesTyped = true;
      flow.openQuestionId = null;
      flow.active = false;
    },
    isActive: () => flow.active || flow.openQuestionId !== null,
    hasOpenQuestion: () => flow.openQuestionId !== null,
    takeTyped(text: string) {
      flow.calls.push(`takeTyped:${text}`);
      if (!flow.takesTyped || !flow.openQuestionId) return false;
      const host = coachHost();
      host.markAnswered(flow.openQuestionId, text);
      host.append({ role: 'user', text, isHealth });
      flow.openQuestionId = null;
      return true;
    },
    startFrom(text: string, options: CoachSendOptions, context: CoachStartContext) {
      flow.calls.push(`startFrom:${text}`);
      flow.startOptions.push(options);
      if (!flow.startsOn || !flow.startsOn(text, options)) return false;
      context.abandonOpenQuestions();
      askQuestion(flow, text, isHealth);
      return true;
    },
    abandon() {
      flow.calls.push('abandon');
      flow.openQuestionId = null;
      flow.active = false;
    },
    reset() {
      flow.calls.push('reset');
      flow.openQuestionId = null;
      flow.active = false;
    },
    enter(entry: CoachFlowEntry) {
      flow.calls.push('enter');
      flow.entries.push(entry);
      askQuestion(flow, entry.kind === 'parked' ? `parked ${entry.entry.kind}` : entry.userText, isHealth);
    },
    selectOption(messageId: string, value: string, label: string) {
      flow.calls.push(`selectOption:${messageId}:${value}`);
      if (messageId !== flow.openQuestionId) return;
      const host = coachHost();
      host.markAnswered(messageId, label);
      host.append({ role: 'user', text: label, isHealth });
      flow.openQuestionId = null;
    },
    healthWiped() {
      flow.calls.push('healthWiped');
      if (isHealth) {
        flow.openQuestionId = null;
        flow.active = false;
      }
    },
  };
  flows.set(id, flow);
  return flow;
}

/** The fake a mocked flow module installed. */
export function fake(id: CoachFlowId): FakeFlow {
  const flow = flows.get(id);
  if (!flow) throw new Error(`no fake flow for ${id}: mock its module first`);
  return flow;
}

export function clearFakeFlows(): void {
  for (const flow of flows.values()) flow.clear();
}
