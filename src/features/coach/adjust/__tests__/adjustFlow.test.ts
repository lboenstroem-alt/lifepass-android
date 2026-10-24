/**
 * Adjust my plan through COACH-1's store, with the network stubbed: the
 * entries, each branch to what it sends, the three calls (revise, the target
 * on its own, the day sheet's own save), the key kept for a retry, the error
 * table as the member meets it, and a call that answers after a wipe or a
 * new chat landing nowhere.
 *
 * The sheets are stand-ins whose callbacks the tests call, as the real ones
 * do once they have closed. The programme wizard is real: its gates answer
 * when the flow cannot, and its proposal card is where a revision lands.
 */
import { api, Reply, type StubReply } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { openTargetSheet, type TargetSheetMode } from '../../../body/sheets';
import { turnOffFoodForSafety } from '../../../feedback';
import { openChangeDays, type ChangeDaysMode } from '../../../plan/days';
import { adjustFlow } from '../../flows/adjust';
import { setPlanEditAvailabilityForTests } from '../../planEdit/availability';
import { resetPlanEdit } from '../../planEdit/flow';
import { setProgramContextForTests } from '../../program/context';
import { proposalOf } from '../../program/messages';
import { programFlowForTests, resetProgram, weekdayList } from '../../program/wizard';
import { pendingCoachSaves, resetCoachStoreForTests } from '../../store/coachStore';
import { adjustFlowForTests, resetAdjust } from '../flow';
import {
  adjustingContext,
  assistantTexts,
  coach,
  en,
  last,
  liveProgram,
  messages,
  openBubble,
  openLabels,
  PROGRAM_ID,
  programJson,
  standingTarget,
  tap,
  until,
} from './adjustHarness';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../../flows/venueWizard', () => ({ venueWizardFlow: jest.requireActual('../../flows/types').inactiveFlow('venueWizard') }));
jest.mock('../../flows/dayPlan', () => ({ dayPlanFlow: require('../../flows/types').inactiveFlow('dayPlan') }));
jest.mock('../../../body/sheets', () => ({ ...jest.requireActual('../../../body/sheets'), openTargetSheet: jest.fn(), openBodySheet: jest.fn() }));
jest.mock('../../../plan/days', () => ({ ...jest.requireActual('../../../plan/days'), openChangeDays: jest.fn() }));
jest.mock('../../../feedback', () => ({
  ...jest.requireActual('../../../feedback'),
  turnOffFoodForSafety: jest.fn(async () => undefined),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const openTargetSheetMock = openTargetSheet as jest.MockedFunction<typeof openTargetSheet>;
const openChangeDaysMock = openChangeDays as jest.MockedFunction<typeof openChangeDays>;

const REVISE = `/health/programs/${PROGRAM_ID}/revise`;
const REVISION_ID = '7d4e2c1a-5b6f-4e3d-8c2b-1a0f9e8d7c60';

let events: { event: string; params: AnalyticsParams }[] = [];

beforeEach(() => {
  setCurrentLanguage('en');
  resetCoachStoreForTests();
  resetIntentStoreForTests();
  resetProgram();
  resetAdjust();
  openTargetSheetMock.mockReset();
  openChangeDaysMock.mockReset();
  (turnOffFoodForSafety as jest.Mock).mockClear();
  setProgramContextForTests(adjustingContext());
  useAppStore.setState({ serverFeatures: ['plan_revision', 'target_weight'] });
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setProgramContextForTests(null);
  resetAdjust();
  resetProgram();
  await pendingCoachSaves();
});

// ---------------------------------------------------------------------------
// Helpers

function revisionJson(overrides: Record<string, unknown> = {}) {
  return {
    ...programJson({
      id: REVISION_ID,
      status: 'proposed',
      weeks: 8,
      summaryTitle: 'Build muscle, 3 days a week, 8 weeks',
      intro: '  The same plan, run over eight weeks.  ',
      revisionOf: PROGRAM_ID,
      weekPlans: [{ weekNo: 1, days: [{ id: 'session-1', weekday: 1, kind: 'strength', title: 'Full body A', minutes: 40 }] }],
    }),
    ...overrides,
  };
}

const revised = (status = 201): StubReply => Reply.ok({ program: revisionJson(), replayed: status === 200 }, status);

/** Answers every revise with `replies` in turn (the last one repeats). */
function serveRevise(...replies: StubReply[]): void {
  let count = 0;
  api.on('POST', REVISE, () => replies[Math.min(count++, replies.length - 1)]!);
}

const reviseRequests = () => api.sentAll(REVISE);

/** From the chip to the confirmation of a plan that runs 8 weeks. */
async function confirmEightWeeks(): Promise<void> {
  await coach().startAdjust();
  await tap(en('program.adjust.opt.length'));
  await tap(en('program.length.8'));
}

function targetSheet(index = 0): Extract<TargetSheetMode, { kind: 'pick' }> {
  return openTargetSheetMock.mock.calls[index]![0] as Extract<TargetSheetMode, { kind: 'pick' }>;
}

function daysSheet<K extends ChangeDaysMode['kind']>(kind: K, index = 0): Extract<ChangeDaysMode, { kind: K }> {
  const mode = openChangeDaysMock.mock.calls[index]![0];
  if (mode.kind !== kind) throw new Error(`the day sheet opened in ${mode.kind} mode`);
  return mode as Extract<ChangeDaysMode, { kind: K }>;
}

const MENU_TEXT = () => `${en('program.adjust.title')}\n${en('program.adjust.now', { summary: 'Build muscle, 3 days a week' })}`;

// ---------------------------------------------------------------------------

describe('the entries', () => {
  it('opens the menu on the running plan from the empty-state chip', async () => {
    await coach().startAdjust();
    expect(messages().filter((message) => message.role === 'user').map((message) => message.text)).toEqual([en('coach.chip.adjust_plan')]);
    expect(last().text).toBe(MENU_TEXT());
    expect(last().flow).toBe('adjust');
    expect(openLabels()).toEqual([
      en('program.adjust.opt.goal'),
      en('program.adjust.opt.days'),
      en('program.adjust.opt.weekdays'),
      en('program.adjust.opt.length'),
      en('program.adjust.opt.new_plan'),
      en('program.adjust.opt.cancel'),
    ]);
    expect(events).toContainEqual({ event: 'program_adjust_started', params: { entry: 'chip' } });
    // The Today read had the plan: nothing was read.
    expect(api.requests).toHaveLength(0);
  });

  it('says "Goal" alone on a server without targets', async () => {
    setProgramContextForTests(adjustingContext({ supportsTargetWeight: false }));
    await coach().startAdjust();
    expect(openLabels()[0]).toBe(en('program.adjust.opt.goal_only'));
  });

  it('leaves "Now:" out when the plan has no summary', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ summaryTitle: '   ' }) }));
    await coach().startAdjust();
    expect(last().text).toBe(en('program.adjust.title'));
  });

  it('reads the plan itself while the Today read has not answered', async () => {
    api.on('GET', `/health/programs/${PROGRAM_ID}`, Reply.ok({ program: programJson() }));
    setProgramContextForTests(adjustingContext({ liveProgram: null }));
    await coach().startAdjust();
    expect(api.sent(`/health/programs/${PROGRAM_ID}`, 'GET').query.locale).toBe('en');
    expect(last().text).toBe(MENU_TEXT());
    expect(coach().isTyping).toBe(false);
  });

  it('says the plan changed when it cannot be read, or has ended', async () => {
    api.on('GET', `/health/programs/${PROGRAM_ID}`, Reply.problem(404, 'health_program_not_found'));
    setProgramContextForTests(adjustingContext({ liveProgram: null }));
    await coach().startAdjust();
    expect(last().text).toBe(en('program.adjust.err.changed'));
    expect(openLabels()).toEqual([en('program.chip.open_plan')]);
    expect(adjustFlowForTests()).toBeNull();

    api.on('GET', `/health/programs/${PROGRAM_ID}`, Reply.ok({ program: programJson({ status: 'completed' }) }));
    await coach().startAdjust();
    expect(last().text).toBe(en('program.adjust.err.changed'));
    expect(adjustFlowForTests()).toBeNull();
  });

  it('sends Open Plan on the problem bubble to the Plan tab', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: null, liveProgramId: null }));
    await coach().startAdjust();
    expect(last().text).toBe(en('program.adjust.err.changed'));
    await tap(en('program.chip.open_plan'));
    expect(coach().pendingRoute).toEqual({ kind: 'planTab' });
  });

  it('is offered on the wizard\'s running-plan gate, and opens from it', async () => {
    await coach().startProgram();
    expect(last().text).toBe(en('program.active_exists_adjust'));
    await tap(en('coach.chip.adjust_plan'));
    expect(last().text).toBe(MENU_TEXT());
    expect(events).toContainEqual({ event: 'program_adjust_started', params: { entry: 'gate' } });
    expect(programFlowForTests()).toBeNull();
  });

  it('opens from "Make a new plan" while a plan runs on a server that revises', async () => {
    setProgramContextForTests(adjustingContext({ hasSavedProposal: true }));
    await coach().startProgram();
    expect(last().text).toBe(en('program.proposal_exists'));
    await tap(en('program.chip.make_new'));
    expect(last().text).toBe(MENU_TEXT());
    expect(adjustFlowForTests()).not.toBeNull();
  });

  it('opens from a monthly feedback line, saying only the chip\'s words', async () => {
    useIntentStore.getState().parkCoachProgram({ kind: 'adjust' });
    await coach().consumeParkedEntries();
    expect(messages().filter((message) => message.role === 'user').map((message) => message.text)).toEqual([en('coach.chip.adjust_plan')]);
    expect(last().text).toBe(MENU_TEXT());
  });

  it('answers with the wizard\'s gates when it cannot adjust', async () => {
    setProgramContextForTests({ access: 'not_member' });
    await coach().startAdjust();
    expect(last().text).toBe(en('program.gate.not_member'));
    setProgramContextForTests({ access: 'entitled', hasConsent: false, hasLiveProgram: true, supportsPlanRevision: true });
    await coach().startAdjust();
    expect(last().text).toBe(en('program.consent_skipped'));
    expect(adjustFlowForTests()).toBeNull();
  });

  it('never starts from typed words', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Sure.' }));
    await coach().send('adjust my plan');
    expect(adjustFlowForTests()).toBeNull();
    expect(adjustFlow.isActive()).toBe(false);
  });

  it('starts the wizard from "Start a new plan instead", saying what happens to the running plan', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.new_plan'));
    expect(adjustFlowForTests()).toBeNull();
    expect(assistantTexts()).toContain(en('program.make_new.replaces_running'));
    // The gates are not run again: the first question.
    expect(last().text).toBe(en('program.q.goal'));
    expect(programFlowForTests()).not.toBeNull();
  });
});

describe('the goal', () => {
  it('goes straight to the confirmation for a goal that takes no target', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    expect(last().text).toBe(en('program.adjust.q.goal'));
    await tap(en('program.goal.get_fitter'));
    expect(last().text).toBe(
      [
        en('program.adjust.confirm'),
        en('program.adjust.line.goal', { new: en('program.goal.get_fitter'), old: en('program.goal.lose_weight') }),
        en('program.adjust.confirm_note'),
      ].join('\n'),
    );
  });

  it('asks the safety question going from lose to gain, and asks the target without one', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }), supportsTargetWeight: false }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal_only'));
    await tap(en('program.goal.gain_weight'));
    expect(last().text).toBe(en('program.adjust.q.safety'));
    await tap(en('program.adjust.safety.no'));
    // No target on a server that takes none: the confirmation.
    expect(last().text.startsWith(en('program.adjust.confirm'))).toBe(true);
  });

  it('says the goal is already the plan\'s when only its target could change, and none can', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.build_muscle'));
    expect(assistantTexts()).toContain(en('program.adjust.same_goal'));
    expect(last().text).toBe(MENU_TEXT());
  });

  it('offers no keep for a target the other way, or one already reached', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'get_fitter' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.gain_weight'));
    await tap(en('program.adjust.safety.no'));
    expect(openLabels()).toEqual([en('program.adjust.target.set'), en('program.adjust.target.none')]);

    setProgramContextForTests(
      adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }), standingTarget: standingTarget({ reachedAt: '2026-10-01T08:00:00Z' }) }),
    );
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    expect(openLabels()).toEqual([en('program.adjust.target.set'), en('program.adjust.target.none')]);
  });

  it('asks the target again when the sheet closes without a choice, and takes a removal from it', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.target.set'));
    expect(targetSheet()).toMatchObject({ kind: 'pick', goal: 'lose_weight', existing: standingTarget() });
    targetSheet().onCancel?.();
    expect(last().text).toBe(en('program.adjust.q.target'));
    await tap(en('program.adjust.target.set'));
    targetSheet(1).onRemove?.();
    expect(last().text).toBe(en('program.adjust.confirm_target_remove'));
  });

  it('ends on a safety yes, turning food out of the monthly feedback', async () => {
    setProgramContextForTests(adjustingContext({ turnsOffFeedbackFoodOnRefusal: true }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.safety.yes'));
    expect(turnOffFoodForSafety).toHaveBeenCalledTimes(1);
    expect(assistantTexts()).toContain(en('program.adjust.safety_stop'));
    expect(last().text).toBe(en('program.refused.feedback_food_off'));
    // Nothing about the answer is counted beyond the bare event.
    expect(events).toContainEqual({ event: 'program_refused_local', params: {} });
    expect(adjustFlowForTests()).toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});

describe('days and length', () => {
  it('offers the other counts, then the weekdays for the new one', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.days'));
    expect(openLabels()).toEqual(['2', '4', '5'].map((count) => en('program.days_n', { count })));
    await tap(en('program.days_n', { count: '2' }));
    expect(openLabels()).toEqual([en('program.days.default_chip', { days: weekdayList([1, 4]) }), en('program.days.choose')]);
    await tap(en('program.days.choose'));
    const picker = daysSheet('select');
    expect(picker).toMatchObject({ daysPerWeek: 2, selected: [1, 4] });

    // A picking that does not fit asks again; one that does is said and confirmed.
    picker.onPicked([2, 5, 6]);
    expect(last().text).toBe(en('program.adjust.q.weekdays'));
    await tap(en('program.days.choose'));
    daysSheet('select', 1).onPicked([5, 2]);
    expect(messages().filter((message) => message.role === 'user').at(-1)?.text).toBe(weekdayList([2, 5]));
    expect(last().text).toBe(
      [
        en('program.adjust.confirm'),
        en('program.adjust.line.days', { new: '2', old: '3' }),
        en('program.adjust.line.weekdays', { days: weekdayList([2, 5]) }),
        en('program.adjust.confirm_note'),
      ].join('\n'),
    );
  });

  it('asks the weekdays again when the picker is closed', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.days'));
    await tap(en('program.days_n', { count: '4' }));
    await tap(en('program.days.choose'));
    daysSheet('select').onCancel?.();
    expect(last().text).toBe(en('program.adjust.q.weekdays'));
  });

  it('picks the new count\'s days from "Training days" once a new count is chosen', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.days'));
    await tap(en('program.days_n', { count: '4' }));
    await tap(en('program.days.default_chip', { days: weekdayList([1, 2, 4, 6]) }));
    await tap(en('program.adjust.change_more'));
    await tap(en('program.adjust.opt.weekdays'));
    expect(daysSheet('select')).toMatchObject({ daysPerWeek: 4, selected: [1, 2, 4, 6] });
  });

  it('offers the other lengths', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.length'));
    expect(openLabels()).toEqual([en('program.length.8'), en('program.length.12')]);
  });

  it('says the plan saved but not started is replaced', async () => {
    setProgramContextForTests(adjustingContext({ hasSavedProposal: true }));
    await confirmEightWeeks();
    expect(last().text.split('\n').at(-1)).toBe(en('program.adjust.replaces_saved'));
  });
});

describe('training days on the same count (OP-14, saved by the sheet)', () => {
  it('saves through the day sheet and says so; with nothing else, the flow ends', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.weekdays'));
    const sheet = daysSheet('program');
    expect(sheet).toMatchObject({ programId: PROGRAM_ID, daysPerWeek: 3, selected: [1, 3, 5] });
    sheet.onSaved?.({ program: null, days: [2, 4, 6] });
    expect(last().text).toBe(en('program.adjust.days_saved', { days: weekdayList([2, 4, 6]) }));
    expect(last().isHealth).toBe(true);
    expect(events).toContainEqual({ event: 'program_adjust_submitted', params: { change: 'weekdays' } });
    expect(adjustFlowForTests()).toBeNull();
  });

  it('confirms what else was chosen after the days are saved', async () => {
    await confirmEightWeeks();
    await tap(en('program.adjust.change_more'));
    await tap(en('program.adjust.opt.weekdays'));
    daysSheet('program').onSaved?.({ program: null, days: [6, 2, 4] });
    expect(adjustFlowForTests()?.current.trainingDays).toEqual([2, 4, 6]);
    expect(last().text.startsWith(en('program.adjust.confirm'))).toBe(true);
  });

  it('goes back to the menu when the sheet is closed, and ends when the plan changed elsewhere', async () => {
    await coach().startAdjust();
    await tap(en('program.adjust.opt.weekdays'));
    daysSheet('program').onCancel?.();
    expect(last().text).toBe(MENU_TEXT());
    await tap(en('program.adjust.opt.weekdays'));
    daysSheet('program', 1).onChanged?.();
    expect(adjustFlowForTests()).toBeNull();
    expect(last().text).toBe(en('program.adjust.err.changed'));
    expect(openLabels()).toEqual([en('program.chip.open_plan')]);
  });
});

describe('Show me the updated plan', () => {
  it('sends only what changed and lands the revision as the proposal card', async () => {
    serveRevise(revised());
    await confirmEightWeeks();
    expect(last().text).toBe(
      [en('program.adjust.confirm'), en('program.adjust.line.length', { new: '8', old: '4' }), en('program.adjust.confirm_note')].join('\n'),
    );
    await tap(en('program.adjust.show'));

    const request = expectSentToMatchContract('POST', REVISE);
    expect(request.body).toEqual({ weeks: 8 });
    expect(request.query.locale).toBe('en');
    expect(request.headers['idempotency-key']).toBeTruthy();

    expect(assistantTexts()).toContain(en('program.adjust.building'));
    expect(assistantTexts()).toContain('The same plan, run over eight weeks.');
    const card = last();
    expect(proposalOf(card)?.detail.program.revisionOf).toBe(PROGRAM_ID);
    expect(card.isHealth).toBe(true);
    expect(adjustFlowForTests()).toBeNull();
    expect(events).toContainEqual({ event: 'program_adjust_submitted', params: { change: 'length' } });
    expect(coach().isTyping).toBe(false);
  });

  it('sends a goal with its target, and the days with their weekdays', async () => {
    serveRevise(revised());
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.safety.no'));
    await tap(en('program.adjust.target.set'));
    targetSheet().onPicked(72.46);
    await tap(en('program.adjust.change_more'));
    await tap(en('program.adjust.opt.days'));
    await tap(en('program.days_n', { count: '4' }));
    await tap(en('program.days.default_chip', { days: weekdayList([1, 2, 4, 6]) }));
    await tap(en('program.adjust.show'));
    expect(expectSentToMatchContract('POST', REVISE).rawBody).toBe(
      '{"goal":"lose_weight","daysPerWeek":4,"trainingDays":[1,2,4,6],"targetWeightKg":72.5}',
    );
    const kinds = events.filter((entry) => entry.event === 'program_adjust_submitted').map((entry) => entry.params.change);
    expect(kinds).toEqual(['goal', 'days', 'target']);
  });

  it('resends the same revision under the same key on Try again', async () => {
    serveRevise(Reply.problem(500, 'internal_error'), revised());
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.err.network'));
    expect(adjustFlowForTests()).not.toBeNull();
    await tap(en('program.chip.try_again'));
    const [first, second] = reviseRequests();
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
    expect(proposalOf(last())).not.toBeNull();
  });

  it('mints a new key after an edit', async () => {
    serveRevise(Reply.problem(422, 'program_refused', { reason: 'bmi_high' }));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.refused.bmi_high'));
    await tap(en('program.adjust.change_more'));
    await tap(en('program.adjust.opt.length'));
    await tap(en('program.length.12'));
    await tap(en('program.adjust.show'));
    const [first, second] = reviseRequests();
    expect(second?.body).toEqual({ weeks: 12 });
    expect(second?.headers['idempotency-key']).not.toBe(first?.headers['idempotency-key']);
  });

  it('resends a spent key once, silently, under a new key', async () => {
    serveRevise(Reply.problem(409, 'idempotency-key-reused'), revised());
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    const [first, second] = reviseRequests();
    expect(second?.headers['idempotency-key']).not.toBe(first?.headers['idempotency-key']);
    expect(second?.body).toEqual(first?.body);
    expect(proposalOf(last())).not.toBeNull();
    expect(assistantTexts()).not.toContain(en('program.err.network'));
  });

  it('resends only once', async () => {
    serveRevise(Reply.problem(409, 'health_program_deleted'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(reviseRequests()).toHaveLength(2);
    expect(last().text).toBe(en('program.err.network'));
  });

  it('says the revision cap and ends', async () => {
    serveRevise(Reply.problem(429, 'coach-plan-revision-limit'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.adjust.err.limit'));
    expect(last().flow).toBe('program');
    expect(openLabels()).toEqual([en('program.chip.open_plan')]);
    expect(adjustFlowForTests()).toBeNull();
    // The cap is the revision's own, never the Coach's daily lock.
    expect(coach().limitReached).toBe(false);
  });

  it('keeps the flow open on a refused target, offering another change', async () => {
    serveRevise(Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_low' }));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.refused.target_bmi_low'));
    expect(openLabels()).toEqual([en('program.adjust.change_more'), en('program.adjust.opt.cancel')]);
    expect(adjustFlowForTests()).not.toBeNull();
    expect(events).toContainEqual({ event: 'target_weight_saved', params: { outcome: 'refused', surface: 'coach' } });
    await tap(en('program.adjust.change_more'));
    expect(last().text).toBe(MENU_TEXT());
  });

  it('says there is nothing to update when the server finds no difference', async () => {
    serveRevise(Reply.problem(400, 'invalid-program-revision', { errors: [{ field: 'weeks', message: 'unchanged' }] }));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(assistantTexts()).toContain(en('program.adjust.nothing'));
    expect(last().text).toBe(MENU_TEXT());
  });

  it('says the plan changed when it was ended elsewhere', async () => {
    serveRevise(Reply.problem(409, 'program_action_not_allowed'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.adjust.err.changed'));
    expect(adjustFlowForTests()).toBeNull();
  });

  it('hides what a stale feature list gated when the route is missing', async () => {
    serveRevise(Reply.raw(404, '<html>Not found</html>'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(useAppStore.getState().serverFeatures).toEqual([]);
    expect(adjustFlowForTests()).toBeNull();
    expect(last().text).toBe(en('program.err.network'));
  });

  it('gives the common answers: consent, the rate limit', async () => {
    serveRevise(Reply.problem(403, 'health_consent_required'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.consent_skipped'));
    expect(adjustFlowForTests()).toBeNull();
    // Its chip runs the wizard's gate again.
    await tap(en('coach.chip.program'));
    expect(last().text).toBe(en('program.active_exists_adjust'));

    serveRevise(Reply.problem(429, 'rate-limited'));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(assistantTexts()).toContain(en('health.err.rate_limited'));
    expect(last().text).toBe(MENU_TEXT());
    expect(adjustFlowForTests()).not.toBeNull();
  });

  it('offers Try again when the network fails', async () => {
    serveRevise(Reply.fail());
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(last().text).toBe(en('program.err.network'));
    expect(openLabels()).toEqual([en('program.chip.try_again')]);
  });

  it('does not send against a server that stopped advertising revisions', async () => {
    await confirmEightWeeks();
    setProgramContextForTests(adjustingContext({ supportsPlanRevision: false }));
    await tap(en('program.adjust.show'));
    expect(reviseRequests()).toHaveLength(0);
    expect(last().text).toBe(en('program.err.network'));
    expect(adjustFlowForTests()).toBeNull();
  });
});

describe('a target on its own (PUT /health/target-weight)', () => {
  async function confirmTarget(): Promise<void> {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.target.set'));
    targetSheet().onPicked(66.04);
  }

  const targetSaved = (features: string[] = ['plan_revision', 'target_weight', 'feedback']) =>
    Reply.ok({ targetWeight: { targetWeightKg: 66, direction: 'lose', appliesTo: 'program' }, goal: null, features });

  it('asks before saving, saves the target alone, and says so without the number', async () => {
    api.on('PUT', '/health/target-weight', targetSaved());
    await confirmTarget();
    expect(last().text).toBe(en('program.adjust.confirm_target'));
    expect(openLabels()).toEqual([en('program.adjust.save_target'), en('common.cancel')]);
    await tap(en('program.adjust.save_target'));

    const request = expectSentToMatchContract('PUT', '/health/target-weight');
    expect(request.body).toEqual({ targetWeightKg: 66 });
    expect(request.headers['idempotency-key']).toBeTruthy();
    expect(reviseRequests()).toHaveLength(0);
    expect(last().text).toBe(en('program.adjust.target_saved'));
    expect(adjustFlowForTests()).toBeNull();
    expect(useAppStore.getState().serverFeatures).toEqual(['feedback', 'plan_revision', 'target_weight']);
    expect(events).toContainEqual({ event: 'program_adjust_submitted', params: { change: 'target' } });
    expect(events).toContainEqual({ event: 'target_weight_saved', params: { outcome: 'set', surface: 'coach' } });
  });

  it('removes the standing target with a null', async () => {
    api.on('PUT', '/health/target-weight', Reply.ok({ targetWeight: null, goal: null, features: ['plan_revision', 'target_weight'] }));
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.target.none'));
    expect(last().text).toBe(en('program.adjust.confirm_target_remove'));
    await tap(en('program.adjust.save_target'));
    expect(api.sent('/health/target-weight', 'PUT').rawBody).toBe('{"targetWeightKg":null}');
    expect(last().text).toBe(en('program.adjust.target_removed'));
    expect(events).toContainEqual({ event: 'target_weight_saved', params: { outcome: 'cleared', surface: 'coach' } });
  });

  it('keeps the plan as it is on Cancel', async () => {
    await confirmTarget();
    await tap(en('common.cancel'));
    expect(last().text).toBe(en('program.adjust.cancelled'));
    expect(api.requests).toHaveLength(0);
  });

  it('saves the same target again under the same key on Try again', async () => {
    let count = 0;
    api.on('PUT', '/health/target-weight', () => (count++ === 0 ? Reply.problem(503, 'service_unavailable') : targetSaved()));
    await confirmTarget();
    await tap(en('program.adjust.save_target'));
    expect(last().text).toBe(en('program.err.network'));
    await tap(en('program.chip.try_again'));
    const [first, second] = api.sentAll('/health/target-weight');
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
    expect(last().text).toBe(en('program.adjust.target_saved'));
  });

  it('says a refused or unusable target, keeping the flow open', async () => {
    api.on('PUT', '/health/target-weight', Reply.problem(422, 'program_refused', { reason: 'target_weight_bmi_low' }));
    await confirmTarget();
    await tap(en('program.adjust.save_target'));
    expect(last().text).toBe(en('program.refused.target_bmi_low'));
    expect(events).toContainEqual({ event: 'target_weight_saved', params: { outcome: 'refused', surface: 'coach' } });
    expect(adjustFlowForTests()).not.toBeNull();

    api.on('PUT', '/health/target-weight', Reply.problem(400, 'invalid_target_weight'));
    await tap(en('program.adjust.change_more'));
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.target.set'));
    targetSheet(1).onPicked(70);
    await tap(en('program.adjust.save_target'));
    expect(last().text).toBe(en('target.err.server'));
  });

  it('hides the target feature when its route is missing', async () => {
    api.on('PUT', '/health/target-weight', Reply.raw(404, '<html>Not found</html>'));
    await confirmTarget();
    await tap(en('program.adjust.save_target'));
    expect(useAppStore.getState().serverFeatures).toEqual([]);
    expect(adjustFlowForTests()).toBeNull();
  });
});

describe('typed words', () => {
  it('shows the hint once, then asks the open question again each time', async () => {
    await coach().startAdjust();
    await coach().send('make it easier');
    await coach().send('please');
    expect(messages().filter((message) => message.text === en('program.typed_hint'))).toHaveLength(1);
    const menus = messages().filter((message) => message.text === MENU_TEXT());
    expect(menus).toHaveLength(3);
    // Only the newest can answer.
    expect(menus.filter((message) => !message.answered)).toHaveLength(1);
    expect(openBubble().id).toBe(menus[2]!.id);
    expect(messages().some((message) => message.text === 'make it easier' || message.text === 'please')).toBe(false);
    expect(api.requests).toHaveLength(0);
  });
});

describe('a call that answers too late', () => {
  /** Holds every revise until `release` is called with its reply. */
  function holdRevise(): { readonly arrived: () => boolean; release(reply: StubReply): void } {
    let resolveReply: ((reply: StubReply) => void) | null = null;
    api.on('POST', REVISE, () => new Promise<StubReply>((resolve) => (resolveReply = resolve)));
    return { arrived: () => resolveReply !== null, release: (reply) => resolveReply?.(reply) };
  }

  it('lands no card after the health data was wiped', async () => {
    const hold = holdRevise();
    await confirmEightWeeks();
    const pending = tap(en('program.adjust.show'));
    await until(hold.arrived);
    coach().dropHealthMessages();
    hold.release(revised());
    await pending;
    expect(messages().some((message) => message.isHealth)).toBe(false);
    expect(events.map((entry) => entry.event)).not.toContain('program_adjust_submitted');
  });

  it('lands no error, and resends nothing, after a new chat', async () => {
    const hold = holdRevise();
    await confirmEightWeeks();
    const pending = tap(en('program.adjust.show'));
    await until(hold.arrived);
    coach().resetChat();
    hold.release(Reply.problem(409, 'idempotency-key-reused'));
    await pending;
    expect(reviseRequests()).toHaveLength(1);
    expect(messages().some((message) => message.isHealth)).toBe(false);
  });

  it('lands no menu from a plan read after the health data was wiped', async () => {
    let resolveRead: ((reply: StubReply) => void) | null = null;
    api.on('GET', `/health/programs/${PROGRAM_ID}`, () => new Promise<StubReply>((resolve) => (resolveRead = resolve)));
    setProgramContextForTests(adjustingContext({ liveProgram: null }));
    const pending = coach().startAdjust();
    await until(() => resolveRead !== null);
    coach().dropHealthMessages();
    resolveRead!(Reply.ok({ program: programJson() }));
    await pending;
    expect(adjustFlowForTests()).toBeNull();
    expect(messages().some((message) => message.isHealth)).toBe(false);
  });

  it('takes nothing from a sheet that closes after the flow ended', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }) }));
    await coach().startAdjust();
    await tap(en('program.adjust.opt.goal'));
    await tap(en('program.goal.lose_weight'));
    await tap(en('program.adjust.target.set'));
    coach().dropHealthMessages();
    // A new flow before the old sheet answers: its pick must not land here.
    await coach().startAdjust();
    const before = messages().length;
    targetSheet().onPicked(60);
    expect(messages()).toHaveLength(before);
    expect(adjustFlowForTests()?.target).toEqual({ kind: 'unchanged' });
  });
});

describe('the flow contract', () => {
  it('ends when the store abandons open questions, and on sign-out', async () => {
    await coach().startAdjust();
    expect(adjustFlow.isActive()).toBe(true);
    expect(adjustFlow.hasOpenQuestion()).toBe(true);
    coach().abandonOpenQuestions();
    expect(adjustFlow.isActive()).toBe(false);

    await coach().startAdjust();
    coach().resetForSignOut();
    expect(adjustFlowForTests()).toBeNull();
  });

  it('answers each chip once', async () => {
    await coach().startAdjust();
    const menu = openBubble();
    const length = menu.options!.find((option) => option.label === en('program.adjust.opt.length'))!;
    await coach().selectOption(menu.id, length.value, length.label);
    await coach().selectOption(menu.id, length.value, length.label);
    expect(messages().filter((message) => message.text === en('program.adjust.q.length'))).toHaveLength(1);
  });

  it('lets no chip on an abandoned bubble change a later flow', async () => {
    await coach().startAdjust();
    const old = openBubble();
    await tap(en('program.adjust.opt.cancel'));
    await coach().startAdjust();
    await adjustFlow.selectOption?.(old.id, 'adjust.length', en('program.adjust.opt.length'));
    expect(last().text).toBe(MENU_TEXT());
  });
});

// ---------------------------------------------------------------------------
// COACH-6: changing the plan in chat

describe('with changes made in chat (COACH-6)', () => {
  afterEach(() => {
    setPlanEditAvailabilityForTests(null);
    resetPlanEdit();
  });

  it('says under the revision that it replaces them, apart from the equipment the member does not have', async () => {
    serveRevise(Reply.ok({ program: revisionJson(), replayed: false, chatEdits: 2 }, 201));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(proposalOf(last())).toMatchObject({ warningKey: 'coach.planEdit.adjustWarning', outcome: null });
  });

  it('says nothing of it when the plan carries none, or the server is older', async () => {
    serveRevise(Reply.ok({ program: revisionJson(), replayed: false, chatEdits: 0 }, 201));
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(proposalOf(last())?.warningKey).toBeNull();
    serveRevise(revised());
    await confirmEightWeeks();
    await tap(en('program.adjust.show'));
    expect(proposalOf(last())?.warningKey).toBeNull();
  });

  it('a custom plan is never adjusted: the wizard\'s own gate answers (it refuses a revision)', async () => {
    setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ custom: true, cycleDays: 4 }) }));
    await coach().startAdjust();
    expect(adjustFlowForTests()).toBeNull();
    expect(last().text).toBe(en('program.active_exists'));
    expect(reviseRequests()).toHaveLength(0);
  });

  it('words typed while it is open close it and go to the plan change, whatever they say', async () => {
    setPlanEditAvailabilityForTests({ kind: 'available', programId: PROGRAM_ID, program: liveProgram(), day: null });
    api.on('POST', `/health/programs/${PROGRAM_ID}/edits`, Reply.ok({ kind: 'clarify', reply: null, question: { text: 'Which day?', choices: [] }, variants: [], notApplied: [], replayed: false }));
    await coach().startAdjust();
    expect(adjustFlowForTests()).not.toBeNull();
    await coach().send('the Thursday one is too long');
    expect(adjustFlowForTests()).toBeNull();
    expect(api.sentAll(`/health/programs/${PROGRAM_ID}/edits`)).toHaveLength(1);
    expect(api.sent(`/health/programs/${PROGRAM_ID}/edits`).body).toEqual({ message: 'the Thursday one is too long', locale: 'en' });
    expect(assistantTexts()).not.toContain(en('program.typed_hint'));
  });
});
