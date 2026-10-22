/**
 * The programme wizard through COACH-1's store, with the network stubbed.
 *
 * Ports iOS `CoachMakeNewPlanTests` (the loop fix; a double tap never repeats
 * a bubble or starts two wizards; "make new" with nothing to replace says
 * nothing about replacing), the programme cases of `CoachPersistenceTests`
 * (a gate answers instead of the first question; no consent gets the tap the
 * copy promises; a minor is told once and offered nothing; typed words are
 * dropped; every turn is health), and the build's key and error rules of
 * `ProgramAnswersTests` as the member meets them.
 *
 * The day plan and Adjust my plan are recording fakes: this file tests what
 * the wizard hands them, not what they do.
 */
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { openBodySheet, type BodyDetails, type BodySheetMode } from '../../../body/sheets';
import { turnOffFoodForSafety } from '../../../feedback';
import { openChangeDays, type ChangeDaysMode } from '../../../plan/days';
import { programFlow } from '../../flows/program';
import { clearFakeFlows, fake } from '../../store/__tests__/fakeFlows';
import { pendingCoachSaves, resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { GREETING_ID, type CoachMessage } from '../../store/messages';
import { installProgramAdjustHandoff } from '../adjustHandoff';
import { setProgramContextForTests, type ProgramContext } from '../context';
import { isOpenProgramQuestion, multiSelectOf, proposalOf, summaryOf } from '../messages';
import { ProgramOptionValue } from '../model';
import {
  confirmMultiSelect,
  editProgramRow,
  programFlowForTests,
  resetProgram,
  setProposalOutcome,
  startProgramOver,
  submitProgram,
  toggleProgramOption,
} from '../wizard';

/* eslint-disable @typescript-eslint/no-require-imports */
// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../../flows/venueWizard', () => ({ venueWizardFlow: jest.requireActual('../../flows/types').inactiveFlow('venueWizard') }));
jest.mock('../../flows/dayPlan', () => ({ dayPlanFlow: require('../../store/__tests__/fakeFlows').fakeFlow('dayPlan') }));
jest.mock('../../flows/adjust', () => ({ adjustFlow: require('../../store/__tests__/fakeFlows').fakeFlow('adjust') }));
jest.mock('../../../body/sheets', () => ({ ...jest.requireActual('../../../body/sheets'), openBodySheet: jest.fn() }));
jest.mock('../../../plan/days', () => ({ ...jest.requireActual('../../../plan/days'), openChangeDays: jest.fn() }));
jest.mock('../../../feedback', () => ({
  ...jest.requireActual('../../../feedback'),
  turnOffFoodForSafety: jest.fn(async () => undefined),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const en = (key: string, params: Record<string, string> = {}) => {
  let text = lookup(key, 'en');
  for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, value);
  return text;
};
const coach = () => useCoachStore.getState();
const messages = () => coach().messages;
const assistantTexts = () => messages().filter((m) => m.role === 'assistant').map((m) => m.text);
const last = () => messages()[messages().length - 1]!;

const openBodySheetMock = openBodySheet as jest.MockedFunction<typeof openBodySheet>;
const openChangeDaysMock = openChangeDays as jest.MockedFunction<typeof openChangeDays>;
const turnOffFoodMock = turnOffFoodForSafety as jest.MockedFunction<typeof turnOffFoodForSafety>;

const ENTITLED: Partial<ProgramContext> = { access: 'entitled', hasConsent: true };

let events: { event: string; params: AnalyticsParams }[] = [];

beforeEach(() => {
  setCurrentLanguage('en');
  resetCoachStoreForTests();
  resetIntentStoreForTests();
  resetProgram();
  clearFakeFlows();
  installProgramAdjustHandoff(null);
  setProgramContextForTests(ENTITLED);
  openBodySheetMock.mockReset();
  openChangeDaysMock.mockReset();
  turnOffFoodMock.mockClear();
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setProgramContextForTests(null);
  resetProgram();
  await pendingCoachSaves();
});

// ---------------------------------------------------------------------------
// Helpers

/** The last programme bubble that can still answer. */
function openQuestion(): CoachMessage {
  const open = [...messages()].reverse().find(isOpenProgramQuestion);
  if (!open) throw new Error(`no open programme bubble (last: ${last().text})`);
  return open;
}

/** Taps the chip labelled `label` on the last open programme bubble, the way a member does. */
async function tap(label: string): Promise<void> {
  const bubble = openQuestion();
  const option = bubble.options?.find((candidate) => candidate.label === label);
  if (!option) throw new Error(`no chip "${label}" on "${bubble.text}" (${bubble.options?.map((o) => o.label).join(' | ')})`);
  await coach().selectOption(bubble.id, option.value, option.label);
}

/** Picks `values` on the open multi-select and presses Continue. */
function pick(...values: string[]): void {
  const bubble = openQuestion();
  for (const value of values) toggleProgramOption(bubble.id, value);
  confirmMultiSelect(bubble.id);
}

/** From the chip to the summary: Build muscle, Full body, 3 days, some experience, nothing, no body, default days. */
async function answerEverything(options: { safety?: string[] } = {}): Promise<void> {
  await coach().startProgram();
  await tap(en('program.goal.build_muscle'));
  await tap(en('program.focus.full'));
  await tap(en('program.days_n', { count: '3' }));
  await tap(en('program.exp.some'));
  pick(...(options.safety ?? ['nothing']));
  await tap(en('program.body.skip'));
  await tap(en('program.days.default_chip', { days: 'Mon, Wed, Fri' }));
}

function summaryMessages(): CoachMessage[] {
  return messages().filter((message) => summaryOf(message) !== null);
}

const PROGRAM_ID = '2b1a7f0e-9d8c-4b5a-8e7f-6a5b4c3d2e10';
const PREVIOUS_ID = '6f9c1f9e-3c51-4a76-9c5b-1d0f1a6b9e20';

function programJson(overrides: Record<string, unknown> = {}) {
  return {
    id: PROGRAM_ID,
    status: 'proposed',
    summaryTitle: 'Build muscle, 3 days a week',
    goal: 'build_muscle',
    focus: 'full',
    daysPerWeek: 3,
    weeks: 4,
    experience: 'some',
    trainingDays: [1, 3, 5],
    intro: '  A steady month of strength work.  ',
    weekPlans: [
      { weekNo: 1, days: [{ id: 'session-1', weekday: 1, kind: 'strength', title: 'Full body A', minutes: 40 }] },
    ],
    ...overrides,
  };
}

function built(status = 201): StubReply {
  return Reply.ok({ reply: 'Here is your plan.', program: programJson(), replayed: status === 200 }, status);
}

/** Answers every `POST /coach` with `replies` in turn (the last one repeats). */
function serveBuild(...replies: StubReply[]): StubRequest[] {
  const sent: StubRequest[] = [];
  api.on('POST', '/coach', (request) => {
    sent.push(request);
    return replies[Math.min(sent.length - 1, replies.length - 1)]!;
  });
  return sent;
}

interface SentProgram {
  readonly locale: string;
  readonly program: Record<string, unknown> & { readonly previousProgramId?: string };
}

const bodyOf = (request: StubRequest) => request.body as SentProgram;

// ---------------------------------------------------------------------------

describe('the gates come before the first question (CoachPersistenceTests)', () => {
  it('marks every turn of the wizard as health', async () => {
    await coach().startProgram();
    const turns = messages().filter((message) => message.id !== GREETING_ID);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((message) => message.isHealth)).toBe(true);
    expect(last().text).toBe(en('program.q.goal'));
    expect(events).toContainEqual({ event: 'program_wizard_started', params: { entry: 'chip' } });
    expect(events).toContainEqual({ event: 'program_wizard_step', params: { step: 1 } });
  });

  it('answers a member without a membership instead of asking the first question', async () => {
    setProgramContextForTests({ access: 'not_member', hasConsent: false });
    await coach().startProgram();
    expect(programFlowForTests()).toBeNull();
    expect(last().text).toBe(en('program.gate.not_member'));
    expect(last().options?.map((option) => option.label)).toEqual([en('plan.gate.cta_choose'), en('coach.chip.plan_day')]);
    expect(assistantTexts()).not.toContain(en('program.q.goal'));
  });

  it('treats an unknown access as no membership', async () => {
    setProgramContextForTests({ access: 'unknown', hasConsent: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.gate.not_member'));
  });

  it('gives a member without consent the tap the copy promises, and the tap runs the gate again', async () => {
    setProgramContextForTests({ access: 'entitled', hasConsent: false });
    await coach().startProgram();
    expect(programFlowForTests()).toBeNull();
    const bubble = [...messages()].reverse().find((message) => message.role === 'assistant');
    expect(bubble?.text).toBe(en('program.consent_skipped'));
    expect(bubble?.options?.map((option) => option.label)).toEqual([en('coach.chip.program')]);

    setProgramContextForTests(ENTITLED);
    await tap(en('coach.chip.program'));
    expect(last().text).toBe(en('program.q.goal'));
    // The chip already said it: no second "Get a 4-week plan" bubble.
    expect(messages().filter((message) => message.role === 'user' && message.text === en('coach.chip.program'))).toHaveLength(1);
  });

  it('tells a minor once and offers nothing', async () => {
    setProgramContextForTests({ access: 'minor', hasConsent: false });
    await coach().startProgram();
    expect(programFlowForTests()).toBeNull();
    const bubble = [...messages()].reverse().find((message) => message.role === 'assistant');
    expect(bubble?.text).toBe(en('health.minor.body'));
    expect(bubble?.options).toBeUndefined();
  });

  it('sends a member whose payment failed to Account', async () => {
    setProgramContextForTests({ access: 'past_due', hasConsent: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.gate.past_due'));
    await tap(en('health.past_due.cta'));
    expect(coach().takeRoute()).toEqual({ kind: 'account' });
  });

  it('offers a pass holder the memberships and the day plan', async () => {
    setProgramContextForTests({ access: 'pass_only', hasConsent: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.gate.pass'));
    await tap(en('plan.gate.cta_choose'));
    expect(coach().takeRoute()).toEqual({ kind: 'plans' });
  });

  it('starts the day plan from a gate', async () => {
    setProgramContextForTests({ access: 'pass_only', hasConsent: true });
    await coach().startProgram();
    await tap(en('coach.chip.plan_day'));
    expect(fake('dayPlan').entries).toEqual([{ kind: 'chip', userText: en('coach.chip.plan_day') }]);
  });

  it('asks a company member to activate the company plan', async () => {
    setProgramContextForTests({ access: 'company_inactive', hasConsent: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.gate.company'));
    await tap(en('plan.gate.cta_company'));
    expect(coach().takeRoute()).toEqual({ kind: 'account' });
  });

  it('opens the saved proposal on Plan, and Plan itself from a running plan', async () => {
    setProgramContextForTests({ ...ENTITLED, hasSavedProposal: true });
    await coach().startProgram();
    await tap(en('program.chip.review_saved'));
    expect(coach().takeRoute()).toEqual({ kind: 'savedProposal' });

    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true });
    await coach().startProgram();
    await tap(en('program.chip.open_plan'));
    expect(coach().takeRoute()).toEqual({ kind: 'planTab' });
  });
});

describe('Make a new plan (CoachMakeNewPlanTests, the loop fix)', () => {
  it('starts the wizard from a live plan on a server without revisions', async () => {
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.active_exists'));
    await tap(en('program.chip.make_new'));
    const assistant = assistantTexts();
    expect(assistant[assistant.length - 1]).toBe(en('program.q.goal'));
    expect(assistant).toContain(en('program.make_new.replaces_running'));
    expect(assistant.filter((text) => text === en('program.active_exists'))).toHaveLength(1);
    expect(programFlowForTests()).not.toBeNull();
  });

  it('starts the wizard from a saved proposal', async () => {
    setProgramContextForTests({ ...ENTITLED, hasSavedProposal: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.proposal_exists'));
    await tap(en('program.chip.make_new'));
    const assistant = assistantTexts();
    expect(assistant[assistant.length - 1]).toBe(en('program.q.goal'));
    expect(assistant).toContain(en('program.make_new.replaces_saved'));
    expect(assistant.filter((text) => text === en('program.proposal_exists'))).toHaveLength(1);
  });

  it('reaches the wizard with both a plan and a proposal', async () => {
    setProgramContextForTests({ ...ENTITLED, hasSavedProposal: true, hasLiveProgram: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.proposal_exists'));
    await tap(en('program.chip.make_new'));
    expect(last().text).toBe(en('program.q.goal'));
  });

  it('offers Adjust my plan on a server that revises, and hands it over', async () => {
    const begin = jest.fn();
    installProgramAdjustHandoff({ begin });
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    const gate = last();
    expect(gate.text).toBe(en('program.active_exists_adjust'));
    expect(gate.options?.map((option) => option.label)).toEqual([
      en('coach.chip.adjust_plan'),
      en('program.chip.start_new'),
      en('program.chip.open_plan'),
    ]);
    await tap(en('coach.chip.adjust_plan'));
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]![1]).toBe('gate');
    expect(last()).toMatchObject({ role: 'user', text: en('coach.chip.adjust_plan'), isHealth: true });
  });

  it('offers the gate without Adjust while Adjust my plan is not in the build', async () => {
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    expect(last().text).toBe(en('program.active_exists'));
  });

  it('opens Adjust my plan from Make a new plan when a plan runs on a server that revises', async () => {
    const begin = jest.fn();
    installProgramAdjustHandoff({ begin });
    setProgramContextForTests({ ...ENTITLED, hasSavedProposal: true, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    await tap(en('program.chip.make_new'));
    expect(begin).toHaveBeenCalledTimes(1);
    expect(assistantTexts()).not.toContain(en('program.q.goal'));
  });

  it('reaches the wizard from Start a new plan on the adjust gate', async () => {
    installProgramAdjustHandoff({ begin: jest.fn() });
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    await tap(en('program.chip.start_new'));
    expect(last().text).toBe(en('program.q.goal'));
    expect(assistantTexts()).toContain(en('program.make_new.replaces_running'));
  });

  it('never repeats a bubble when Make a new plan is tapped twice', async () => {
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true });
    await coach().startProgram();
    const gate = last();
    const option = gate.options!.find((candidate) => candidate.value === ProgramOptionValue.gateMakeNew)!;
    await coach().selectOption(gate.id, option.value, option.label);
    const afterFirst = messages().length;
    await coach().selectOption(gate.id, option.value, option.label);
    expect(messages()).toHaveLength(afterFirst);
    const assistant = assistantTexts();
    for (let index = 1; index < assistant.length; index += 1) expect(assistant[index]).not.toBe(assistant[index - 1]);
  });

  it('opens one menu when Adjust is tapped twice on the gate', async () => {
    const begin = jest.fn();
    installProgramAdjustHandoff({ begin });
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    const gate = last();
    const option = gate.options!.find((candidate) => candidate.value === ProgramOptionValue.adjustOpen)!;
    await coach().selectOption(gate.id, option.value, option.label);
    const afterFirst = messages().length;
    await coach().selectOption(gate.id, option.value, option.label);
    expect(messages()).toHaveLength(afterFirst);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('starts one wizard when Start a new plan is tapped twice', async () => {
    installProgramAdjustHandoff({ begin: jest.fn() });
    setProgramContextForTests({ ...ENTITLED, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startProgram();
    const gate = last();
    const option = gate.options!.find((candidate) => candidate.value === ProgramOptionValue.adjustNewPlan)!;
    await coach().selectOption(gate.id, option.value, option.label);
    const afterFirst = messages().length;
    await coach().selectOption(gate.id, option.value, option.label);
    expect(messages()).toHaveLength(afterFirst);
    expect(messages().filter((message) => message.text === en('program.make_new.replaces_running'))).toHaveLength(1);
    expect(messages().filter((message) => message.text === en('program.q.goal'))).toHaveLength(1);
  });

  it('says nothing about replacing when there is nothing to replace', async () => {
    useCoachStore.setState({
      messages: [
        ...messages(),
        {
          id: 'gate',
          role: 'assistant',
          text: en('program.err.deleted'),
          options: [{ label: en('program.chip.make_new'), value: ProgramOptionValue.gateMakeNew }],
          isHealth: true,
          flow: 'program',
        },
      ],
    });
    await coach().selectOption('gate', ProgramOptionValue.gateMakeNew, en('program.chip.make_new'));
    expect(last().text).toBe(en('program.q.goal'));
    expect(assistantTexts()).not.toContain(en('program.make_new.replaces_saved'));
    expect(assistantTexts()).not.toContain(en('program.make_new.replaces_running'));
  });
});

describe('typed words', () => {
  it('keeps nothing the member wrote during the wizard (CoachPersistenceTests)', async () => {
    await coach().startProgram();
    expect(programFlowForTests()).not.toBeNull();
    await coach().send('I am 96 kg and want to lose 10 kg before June');
    const everything = messages().map((message) => message.text).join(' ');
    expect(everything).not.toContain('96 kg');
    expect(everything).not.toContain('before June');
    expect(assistantTexts()).toContain(en('program.typed_hint'));
    // The question again, under the hint; the first one no longer answers.
    expect(last().text).toBe(en('program.q.goal'));
    expect(messages().filter((message) => message.text === en('program.q.goal') && isOpenProgramQuestion(message))).toHaveLength(1);
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('gives the hint once per wizard', async () => {
    await coach().startProgram();
    await coach().send('my knee');
    await coach().send('my back');
    expect(messages().filter((message) => message.text === en('program.typed_hint'))).toHaveLength(1);
  });

  it('shows the summary again when words are typed under it', async () => {
    await answerEverything();
    await coach().send('make it harder');
    expect(summaryMessages()).toHaveLength(2);
    expect(summaryOf(summaryMessages()[0])?.closed).toBe(true);
    expect(summaryOf(summaryMessages()[1])?.closed).toBe(false);
  });

  it('offers the wizard for a typed request for weeks, and starts nothing until a chip is tapped', async () => {
    await coach().send('Can you make me a training plan?');
    const offer = last();
    expect(offer.text).toBe(en('program.intent.offer'));
    expect(offer.options?.map((option) => option.label)).toEqual([en('coach.chip.program'), en('coach.chip.plan_day')]);
    expect(messages().find((message) => message.role === 'user')).toMatchObject({
      text: 'Can you make me a training plan?',
      isHealth: true,
    });
    expect(programFlowForTests()).toBeNull();
    expect(api.sentAll('/coach')).toHaveLength(0);

    await tap(en('coach.chip.program'));
    expect(last().text).toBe(en('program.q.goal'));
    expect(events).toContainEqual({ event: 'program_wizard_started', params: { entry: 'intent' } });
  });

  it('starts the day plan from the offer', async () => {
    await coach().send('I want a workout plan');
    await tap(en('coach.chip.plan_day'));
    expect(fake('dayPlan').entries).toHaveLength(1);
  });

  it('never offers the wizard for a prompt the app parked', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Sure.' }));
    await coach().sendParkedPrompt('Build me a training plan');
    expect(assistantTexts()).not.toContain(en('program.intent.offer'));
  });

  it('never saves a chat that was only the wizard', async () => {
    await answerEverything();
    coach().resetChat();
    await pendingCoachSaves();
    expect(coach().savedSessions).toEqual([]);
  });
});

describe('the questions', () => {
  it('walks to the summary, the member saying only chip labels', async () => {
    await answerEverything();
    const said = messages().filter((message) => message.role === 'user').map((message) => message.text);
    expect(said).toEqual([
      en('coach.chip.program'),
      en('program.goal.build_muscle'),
      en('program.focus.full'),
      en('program.days_n', { count: '3' }),
      en('program.exp.some'),
      en('program.safety.nothing'),
      en('program.body.skip'),
      en('program.days.default_chip', { days: 'Mon, Wed, Fri' }),
    ]);
    const summary = summaryOf(last());
    expect(summary?.answers).toMatchObject({
      goal: 'build_muscle',
      focus: 'full',
      daysPerWeek: 3,
      experience: 'some',
      trainingDays: [1, 3, 5],
      weeks: 4,
      body: null,
    });
    expect(last().text).toBe(en('program.summary.title'));
    expect(last().isHealth).toBe(true);
  });

  it('answers where silently with the places the membership covers', async () => {
    setProgramContextForTests({ ...ENTITLED, kinds: ['pool', 'outdoors'] });
    await answerEverything();
    expect(summaryOf(last())?.answers.kinds).toEqual(['pool', 'outdoors']);
  });

  it('asks where an injury is, at most three, and says so for three seconds on a fourth', async () => {
    jest.useFakeTimers();
    try {
      await coach().startProgram();
      await tap(en('program.goal.build_muscle'));
      await tap(en('program.focus.full'));
      await tap(en('program.days_n', { count: '3' }));
      await tap(en('program.exp.some'));
      pick('injury', 'condition');
      expect(last()).toMatchObject({ role: 'assistant', text: en('program.q.injury_where') });
      const parts = openQuestion();
      for (const part of ['knee', 'back', 'shoulder', 'neck']) toggleProgramOption(parts.id, part);
      let state = multiSelectOf(messages().find((message) => message.id === parts.id));
      expect(state?.selection).toEqual(['knee', 'back', 'shoulder']);
      expect(state?.showsMaxHint).toBe(true);
      jest.advanceTimersByTime(3_000);
      state = multiSelectOf(messages().find((message) => message.id === parts.id));
      expect(state?.showsMaxHint).toBe(false);
      confirmMultiSelect(parts.id);
      const said = messages().filter((message) => message.role === 'user').map((message) => message.text);
      expect(said).toContain(`${en('program.safety.injury')}, ${en('program.safety.condition')}`);
      expect(said[said.length - 1]).toBe(`${en('program.part.shoulder')}, ${en('program.part.back')}, ${en('program.part.knee')}`);
      expect(last().text).toBe(en('program.q.body'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for a pick before Continue answers', async () => {
    await coach().startProgram();
    await tap(en('program.goal.build_muscle'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    const safety = openQuestion();
    confirmMultiSelect(safety.id);
    expect(last().id).toBe(safety.id);
    expect(multiSelectOf(safety)?.noteKey).toBe('program.q.safety_note');
  });

  it('opens the body sheet with what the profile knows, and never puts a number in a bubble', async () => {
    setProgramContextForTests({
      ...ENTITLED,
      latestWeightKg: 84.2,
      latestHeightCm: 181,
      isKennitalaVerified: true,
      supportsTargetWeight: true,
    });
    await coach().startProgram();
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('nothing');
    await tap(en('program.body.add'));
    expect(openBodySheetMock).toHaveBeenCalledTimes(1);
    const mode = openBodySheetMock.mock.calls[0]![0] as Extract<BodySheetMode, { kind: 'intake' }>;
    expect(mode.kind).toBe('intake');
    expect(mode.prefill).toMatchObject({ weightKg: 84.2, heightCm: 181, kennitalaVerified: true, goal: 'lose_weight', details: null });

    const details: BodyDetails = {
      weightKg: 84.2,
      heightCm: 181,
      ageBand: null,
      sex: 'male',
      activity: 'moderate',
      targetWeightKg: 78,
      targetWeightTouched: true,
    };
    mode.onResult({ kind: 'used', details });
    expect(last().text).toBe(en('program.q.training_days'));
    const said = messages().filter((message) => message.role === 'user').map((message) => message.text);
    expect(said[said.length - 1]).toBe(en('program.body.added_target'));
    expect(messages().map((message) => message.text).join(' ')).not.toMatch(/84|181|78/);
  });

  it('asks the body question again when the sheet is closed, and takes Skip from the sheet', async () => {
    await coach().startProgram();
    await tap(en('program.goal.build_muscle'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('nothing');
    await tap(en('program.body.add'));
    (openBodySheetMock.mock.calls[0]![0] as Extract<BodySheetMode, { kind: 'intake' }>).onResult({ kind: 'cancelled' });
    expect(last().text).toBe(en('program.q.body'));
    await tap(en('program.body.add'));
    (openBodySheetMock.mock.calls[1]![0] as Extract<BodySheetMode, { kind: 'intake' }>).onResult({ kind: 'skipped' });
    const said = messages().filter((message) => message.role === 'user').map((message) => message.text);
    expect(said[said.length - 1]).toBe(en('program.body.skip'));
    expect(last().text).toBe(en('program.q.training_days'));
  });

  it('drops a sheet answer that lands after the wizard ended', async () => {
    await coach().startProgram();
    await tap(en('program.goal.build_muscle'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('nothing');
    await tap(en('program.body.add'));
    const mode = openBodySheetMock.mock.calls[0]![0] as Extract<BodySheetMode, { kind: 'intake' }>;
    coach().resetChat();
    await coach().startProgram();
    const before = messages().length;
    mode.onResult({ kind: 'skipped' });
    expect(messages()).toHaveLength(before);
  });

  it('picks other days on the day picker, and asks again when it is closed', async () => {
    await coach().startProgram();
    await tap(en('program.goal.build_muscle'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('nothing');
    await tap(en('program.body.skip'));
    await tap(en('program.days.choose'));
    const first = openChangeDaysMock.mock.calls[0]![0] as Extract<ChangeDaysMode, { kind: 'select' }>;
    expect(first).toMatchObject({ kind: 'select', daysPerWeek: 3, selected: [1, 3, 5] });
    first.onCancel?.();
    expect(last().text).toBe(en('program.q.training_days'));

    await tap(en('program.days.choose'));
    const second = openChangeDaysMock.mock.calls[1]![0] as Extract<ChangeDaysMode, { kind: 'select' }>;
    second.onPicked([6, 2, 4]);
    const said = messages().filter((message) => message.role === 'user').map((message) => message.text);
    expect(said[said.length - 1]).toBe('Tue, Thu, Sat');
    expect(summaryOf(last())?.answers.trainingDays).toEqual([2, 4, 6]);
  });
});

describe('the local refusals', () => {
  it('ends the wizard on a pregnancy, keeps and sends nothing, and offers no chip', async () => {
    serveBuild(built());
    await coach().startProgram();
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('pregnant', 'condition');
    expect(programFlowForTests()).toBeNull();
    const bubble = last();
    expect(bubble.text).toBe(en('program.refused.pregnant'));
    expect(bubble.options).toBeUndefined();
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(events.filter((entry) => entry.event === 'program_refused_local')).toEqual([
      { event: 'program_refused_local', params: {} },
    ]);
    // The member's bubble never names the answer.
    expect(messages().filter((message) => message.role === 'user').map((message) => message.text)).not.toContain(
      en('program.safety.pregnant'),
    );
    expect(turnOffFoodMock).not.toHaveBeenCalled();
  });

  it('offers the day plan after an eating-disorder answer, and turns food out of the monthly feedback', async () => {
    setProgramContextForTests({ ...ENTITLED, turnsOffFeedbackFoodOnRefusal: true });
    await coach().startProgram();
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.focus.full'));
    await tap(en('program.days_n', { count: '3' }));
    await tap(en('program.exp.some'));
    pick('injury', 'eating');
    expect(programFlowForTests()).toBeNull();
    const refusal = messages().find((message) => message.text === en('program.refused.eating'));
    expect(refusal?.options?.map((option) => option.label)).toEqual([en('coach.chip.plan_day')]);
    expect(last()).toMatchObject({ text: en('program.refused.feedback_food_off'), isHealth: true });
    expect(turnOffFoodMock).toHaveBeenCalledTimes(1);
    await tap(en('coach.chip.plan_day'));
    expect(fake('dayPlan').entries).toHaveLength(1);
  });
});

describe('the summary', () => {
  it('re-asks a row and comes back to a fresh summary', async () => {
    await answerEverything();
    const first = last();
    editProgramRow('goal');
    expect(summaryOf(messages().find((message) => message.id === first.id))?.closed).toBe(true);
    expect(last().text).toBe(en('program.q.goal'));
    await tap(en('program.goal.get_fitter'));
    expect(summaryOf(last())?.answers.goal).toBe('get_fitter');
    expect(summaryMessages()).toHaveLength(2);
    expect(events).toContainEqual({ event: 'program_summary_row_edited', params: { field: 'goal' } });
  });

  it('asks the weekdays again after a new number of days', async () => {
    await answerEverything();
    editProgramRow('days');
    await tap(en('program.days_n', { count: '4' }));
    expect(last().text).toBe(en('program.q.training_days'));
    await tap(en('program.days.default_chip', { days: 'Mon, Tue, Thu, Sat' }));
    expect(summaryOf(last())?.answers).toMatchObject({ daysPerWeek: 4, trainingDays: [1, 2, 4, 6] });
  });

  it('changes the places and the length from their rows', async () => {
    await answerEverything();
    editProgramRow('kinds');
    const where = openQuestion();
    expect(multiSelectOf(where)?.selection).toEqual(['gym', 'classes', 'pool', 'outdoors']);
    toggleProgramOption(where.id, 'gym');
    toggleProgramOption(where.id, 'classes');
    confirmMultiSelect(where.id);
    expect(summaryOf(last())?.answers.kinds).toEqual(['pool', 'outdoors']);
    editProgramRow('length');
    await tap(en('program.length.8'));
    expect(summaryOf(last())?.answers.weeks).toBe(8);
  });

  it('starts over through the gates', async () => {
    await answerEverything();
    startProgramOver();
    await Promise.resolve();
    expect(last().text).toBe(en('program.q.goal'));
    expect(summaryOf(summaryMessages()[0])?.closed).toBe(true);
  });
});

describe('the build (OP-10)', () => {
  it('posts the answers and nothing else, and lands the plan as a card', async () => {
    const sent = serveBuild(built());
    await answerEverything();
    await submitProgram();
    expect(sent).toHaveLength(1);
    const request = expectSentToMatchContract('POST', '/coach');
    expect(Object.keys(request.body as object).sort()).toEqual(['locale', 'program']);
    expect(bodyOf(request)).toEqual({
      locale: 'en',
      program: {
        goal: 'build_muscle',
        focus: 'full',
        daysPerWeek: 3,
        weeks: 4,
        kinds: ['gym', 'classes', 'pool', 'outdoors'],
        experience: 'some',
        safety: { conditionOrMedication: false, injuries: [] },
        trainingDays: [1, 3, 5],
      },
    });
    expect(request.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(request.headers['cache-control']).toBe('no-store');

    expect(assistantTexts()).toContain(en('program.building'));
    expect(assistantTexts()).toContain('A steady month of strength work.');
    const card = last();
    expect(proposalOf(card)?.detail.program.id).toBe(PROGRAM_ID);
    expect(card.isHealth).toBe(true);
    expect(summaryOf(summaryMessages()[0])?.closed).toBe(true);
    expect(coach().isTyping).toBe(false);
    expect(programFlowForTests()?.idempotencyKey).toBeNull();
    expect(events).toContainEqual({ event: 'program_created', params: { outcome: 'proposed' } });
  });

  it('sends the build in Icelandic for an Icelandic member', async () => {
    setCurrentLanguage('is');
    const sent = serveBuild(built());
    await coach().startProgram();
    await coach().selectOption(openQuestion().id, 'build_muscle', 'x');
    await coach().selectOption(openQuestion().id, 'full', 'x');
    await coach().selectOption(openQuestion().id, '3', 'x');
    await coach().selectOption(openQuestion().id, 'some', 'x');
    pick('nothing');
    await coach().selectOption(openQuestion().id, ProgramOptionValue.bodySkip, 'x');
    await coach().selectOption(openQuestion().id, ProgramOptionValue.daysDefault, 'x');
    await submitProgram();
    expect(bodyOf(sent[0]!).locale).toBe('is');
  });

  it('retries with the same key, and mints a new one once an answer changed', async () => {
    const sent = serveBuild(Reply.problem(503, 'coach-busy'), Reply.problem(503, 'coach-busy'), built());
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('coach.busy'));
    await tap(en('program.chip.try_again'));
    expect(sent[1]!.headers['idempotency-key']).toBe(sent[0]!.headers['idempotency-key']);

    editProgramRow('goal');
    await tap(en('program.goal.get_fitter'));
    await submitProgram();
    expect(sent[2]!.headers['idempotency-key']).not.toBe(sent[0]!.headers['idempotency-key']);
    expect(proposalOf(last())).not.toBeNull();
  });

  it('makes no call at the free lock or a known daily cap', async () => {
    serveBuild(built());
    await answerEverything();
    useCoachStore.setState({ freeLimitReached: true });
    await submitProgram();
    expect(last().text).toBe(en('coach.free.limit.body'));
    expect(last().options?.[0]?.value).toBe(ProgramOptionValue.gatePlans);

    useCoachStore.setState({ freeLimitReached: false, limitReached: true });
    await submitProgram();
    expect(last().text).toBe(en('program.err.daily_cap'));
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('locks the Coach on a 429 daily limit and keeps the answers', async () => {
    serveBuild(Reply.problem(429, 'coach-daily-limit'));
    await answerEverything();
    await submitProgram();
    expect(coach().limitReached).toBe(true);
    expect(last().text).toBe(en('program.err.daily_cap'));
    expect(programFlowForTests()).not.toBeNull();
  });

  it('offers "get fitter instead" when a weight-loss plan is refused, back to the summary', async () => {
    serveBuild(Reply.problem(422, 'program_refused', { reason: 'bmi_low_lose_weight' }));
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('program.refused.bmi_low'));
    await tap(en('program.chip.get_fitter_instead'));
    expect(summaryOf(last())?.answers.goal).toBe('get_fitter');
    expect(events).toContainEqual({ event: 'program_created', params: { outcome: 'refused' } });
  });

  it('ends the wizard on bmi_high', async () => {
    serveBuild(Reply.problem(422, 'program_refused', { reason: 'bmi_high' }));
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('program.refused.bmi_high'));
    expect(last().options?.map((option) => option.label)).toEqual([en('coach.chip.plan_day')]);
    expect(programFlowForTests()).toBeNull();
  });

  it('opens the body sheet again on a refused target, keeping everything else', async () => {
    serveBuild(Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_low' }));
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('program.refused.target_bmi_low'));
    expect(events).toContainEqual({ event: 'target_weight_saved', params: { outcome: 'refused', surface: 'coach' } });
    await tap(en('program.chip.change_target'));
    expect(openBodySheetMock).toHaveBeenCalledTimes(1);
    expect((openBodySheetMock.mock.calls[0]![0] as Extract<BodySheetMode, { kind: 'intake' }>).prefill.goal).toBe('build_muscle');
  });

  it('says the target was refused when a 400 names it', async () => {
    serveBuild(Reply.problem(400, 'invalid_coach_request', { errors: [{ field: 'program.targetWeightKg', message: 'too low' }] }));
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('target.err.server'));
    expect(last().options?.[0]?.value).toBe(ProgramOptionValue.changeTarget);
  });

  it('shows the summary again under any other 400', async () => {
    serveBuild(Reply.problem(400, 'invalid_coach_request', { errors: [{ field: 'program.focus' }] }));
    await answerEverything();
    await submitProgram();
    const texts = assistantTexts();
    expect(texts[texts.length - 2]).toBe(en('program.err.network'));
    expect(summaryOf(last())?.closed).toBe(false);
  });

  it('keeps the answers when the network fails', async () => {
    serveBuild(Reply.fail());
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('program.err.network'));
    expect(last().options?.map((option) => option.label)).toEqual([en('program.chip.try_again')]);
    expect(programFlowForTests()).not.toBeNull();
  });

  it('points at the past plans at the plan limit, and offers a new plan for a deleted one', async () => {
    serveBuild(Reply.problem(429, 'coach-program-limit'), Reply.problem(410, 'health_program_deleted'));
    await answerEverything();
    await submitProgram();
    expect(last().text).toBe(en('program.err.limit'));
    await tap(en('program.chip.open_plan'));
    expect(coach().takeRoute()).toEqual({ kind: 'pastPlans' });
    editProgramRow('goal');
    await tap(en('program.goal.build_muscle'));
    await submitProgram();
    expect(last().text).toBe(en('program.err.deleted'));
    expect(programFlowForTests()?.idempotencyKey).toBeNull();
  });

  it('resends once, silently and with a new key, when the key was already used', async () => {
    const sent = serveBuild(Reply.problem(409, 'idempotency_key_reused'), built());
    await answerEverything();
    await submitProgram();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers['idempotency-key']).not.toBe(sent[0]!.headers['idempotency-key']);
    expect(proposalOf(last())).not.toBeNull();
    expect(assistantTexts()).not.toContain(en('program.err.network'));
  });

  it('resends a next block without the block that is gone', async () => {
    api.on('GET', `/health/programs/${PREVIOUS_ID}`, Reply.ok({ program: programJson({ id: PREVIOUS_ID, status: 'completed' }) }));
    const sent = serveBuild(Reply.problem(404, 'health_program_not_found'), built());
    useIntentStore.getState().parkCoachProgram({ kind: 'nextBlock', programId: PREVIOUS_ID });
    await coach().consumeParkedEntries();
    expect(assistantTexts()).toContain(en('program.next.title'));
    // Goal, focus, days and experience came from the last block: safety is asked first.
    expect(last().text).toBe(en('program.q.safety'));
    pick('nothing');
    await tap(en('program.body.skip'));
    expect(summaryOf(last())?.answers).toMatchObject({ goal: 'build_muscle', trainingDays: [1, 3, 5] });
    await submitProgram();
    expect(bodyOf(sent[0]!).program.previousProgramId).toBe(PREVIOUS_ID);
    expect(bodyOf(sent[1]!).program.previousProgramId).toBeUndefined();
    expect(proposalOf(last())).not.toBeNull();
    expect(events).toContainEqual({ event: 'program_wizard_started', params: { entry: 'next_block' } });
  });

  it('asks everything for a next block that cannot be read', async () => {
    api.on('GET', `/health/programs/${PREVIOUS_ID}`, Reply.problem(404, 'health_program_not_found'));
    useIntentStore.getState().parkCoachProgram({ kind: 'nextBlock', programId: PREVIOUS_ID });
    await coach().consumeParkedEntries();
    expect(last().text).toBe(en('program.q.goal'));
  });

  it('drops a build that answers after a new chat', async () => {
    let release: () => void = () => undefined;
    api.on('POST', '/coach', () => new Promise<StubReply>((resolve) => (release = () => resolve(built()))));
    await answerEverything();
    const pending = submitProgram();
    await new Promise((resolve) => setTimeout(resolve, 0));
    coach().resetChat();
    release();
    await pending;
    expect(messages().some((message) => proposalOf(message) !== null)).toBe(false);
  });
});

describe('the proposal card and the wipe', () => {
  it('keeps the outcome on the message; Not now keeps the wizard, Start ends it', async () => {
    serveBuild(built());
    await answerEverything();
    await submitProgram();
    const card = last();
    setProposalOutcome(card.id, 'saved');
    expect(proposalOf(messages().find((message) => message.id === card.id))?.outcome).toBe('saved');
    expect(programFlowForTests()).not.toBeNull();
    setProposalOutcome(card.id, 'started');
    expect(proposalOf(messages().find((message) => message.id === card.id))?.outcome).toBe('started');
    expect(programFlowForTests()).toBeNull();
  });

  it('takes every wizard turn off the screen and ends the wizard when the health data is wiped', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Pools nearby.' }));
    await coach().send('hello there');
    await answerEverything();
    coach().dropHealthMessages();
    expect(programFlowForTests()).toBeNull();
    expect(messages().some((message) => message.isHealth)).toBe(false);
    expect(messages().map((message) => message.text)).toContain('hello there');
  });

  it('ends on a new chat and on the store abandoning open questions', async () => {
    await coach().startProgram();
    coach().abandonOpenQuestions();
    expect(programFlowForTests()).toBeNull();
    expect(programFlow.isActive()).toBe(false);
  });
});
