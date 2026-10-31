/**
 * Adjust my plan never lets a health answer out of the health lane (`SPEC`
 * 6.0, 8.4, owner decision 4: "health data must still NEVER reach the AI
 * model"). A port of iOS `CoachAdjustPrivacyTests`, case for case.
 *
 * Everything the flow adds is `isHealth`, so it is not saved with the chat,
 * not in the `messages` a later free chat sends to the model, and never
 * carries a weight. The flow is driven through the same `selectOption` the
 * chips call, as far as it goes without a network (the confirmation), which
 * is every bubble it draws. The target sheet is a stand-in that hands a value
 * back, as the real one does in pick mode.
 */
import { setCurrentLanguage } from '../../../../i18n';
import { resetIntentStoreForTests } from '../../../../stores/intentStore';
import { openTargetSheet, type TargetSheetMode } from '../../../body/sheets';
import { turnOffFoodForSafety } from '../../../feedback';
import { openChangeDays } from '../../../plan/days';
import { modelMessages } from '../../chat/modelMessages';
import { setProgramContextForTests } from '../../program/context';
import { resetProgram, weekdayList } from '../../program/wizard';
import { pendingCoachSaves, resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { GREETING_ID, type CoachMessage } from '../../store/messages';
import { adjustFlowForTests, recordAdjustTarget, resetAdjust } from '../flow';
import { AdjustOptionValue, isTargetOnly, revisionInput, targetSet } from '../model';
import { adjustingContext, coach, en, last, liveProgram, messages, openBubble, openLabels, tap } from './adjustHarness';

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

const openTargetSheetMock = openTargetSheet as jest.MockedFunction<typeof openTargetSheet>;
const openChangeDaysMock = openChangeDays as jest.MockedFunction<typeof openChangeDays>;

beforeEach(() => {
  setCurrentLanguage('en');
  resetCoachStoreForTests();
  resetIntentStoreForTests();
  resetProgram();
  resetAdjust();
  openTargetSheetMock.mockReset();
  openChangeDaysMock.mockReset();
  (turnOffFoodForSafety as jest.Mock).mockClear();
});

afterEach(async () => {
  setProgramContextForTests(null);
  resetAdjust();
  await pendingCoachSaves();
});

const REAL_CONVERSATION: CoachMessage[] = [
  { id: 'c1', role: 'user', text: 'where can I swim tonight?' },
  { id: 'c2', role: 'assistant', text: 'Laugardalslaug is open until 22.' },
];

/** A member with a plan running, a real conversation first, and the menu open. */
async function adjusting(goal = 'build_muscle'): Promise<void> {
  setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal }) }));
  // A real conversation first, so there is something to save and send.
  useCoachStore.setState({ messages: [...messages(), ...REAL_CONVERSATION] });
  await coach().startAdjust();
}

/** The goal branch with a target, the days branch and the length branch, each to its confirmation. */
async function driveEveryBranch(): Promise<void> {
  await tap(en('program.adjust.opt.goal'));
  await tap(en('program.goal.lose_weight'));
  // Into lose weight: the safety question, asked here and never sent.
  expect(last().text).toBe(en('program.adjust.q.safety'));
  await tap(en('program.adjust.safety.no'));
  expect(last().text).toBe(en('program.adjust.q.target'));
  // Keep is offered for a standing lose target that is not reached.
  expect(openLabels()).toEqual([en('program.adjust.target.set'), en('program.adjust.target.keep'), en('program.adjust.target.none')]);
  // The sheet (pick mode) hands a value back; nothing is sent.
  await tap(en('program.adjust.target.set'));
  expect(openTargetSheetMock).toHaveBeenCalledTimes(1);
  const mode = openTargetSheetMock.mock.calls[0]![0] as Extract<TargetSheetMode, { kind: 'pick' }>;
  expect(mode).toMatchObject({ kind: 'pick', goal: 'lose_weight' });
  mode.onPicked(71.3);
  expect(last().text.startsWith(en('program.adjust.confirm'))).toBe(true);

  await tap(en('program.adjust.change_more'));
  await tap(en('program.adjust.opt.days'));
  await tap(en('program.days_n', { count: '4' }));
  expect(last().text).toBe(en('program.adjust.q.weekdays'));
  await tap(en('program.days.default_chip', { days: weekdayList([1, 2, 4, 6]) }));

  await tap(en('program.adjust.change_more'));
  await tap(en('program.adjust.opt.length'));
  await tap(en('program.length.8'));
  const confirmation = last();
  expect(confirmation.text.startsWith(en('program.adjust.confirm'))).toBe(true);
  // A new target, in words.
  expect(confirmation.text).toContain(en('program.adjust.line.target'));
  expect(confirmation.options?.[0]?.value).toBe(AdjustOptionValue.show);
}

/** Every turn after the greeting and the real conversation. */
const adjustTurns = () => messages().filter((message) => ![GREETING_ID, 'c1', 'c2'].includes(message.id));

it('marks every turn the flow adds as health', async () => {
  await adjusting();
  await driveEveryBranch();
  const turns = adjustTurns();
  expect(turns.length).toBeGreaterThan(10);
  for (const turn of turns) expect({ text: turn.text, isHealth: turn.isHealth }).toEqual({ text: turn.text, isHealth: true });
});

it('saves none of it with the chat', async () => {
  await adjusting();
  await driveEveryBranch();
  const adjustTexts = new Set(adjustTurns().map((message) => message.text));
  coach().resetChat();
  const saved = coach().savedSessions[0];
  // The real conversation is kept.
  expect(saved?.messages.some((message) => message.text === 'where can I swim tonight?')).toBe(true);
  for (const message of saved?.messages ?? []) expect(adjustTexts.has(message.text)).toBe(false);
});

it('lets none of it reach the model', async () => {
  await adjusting();
  await driveEveryBranch();
  // The greeting and the real conversation, and not one adjust turn.
  expect(modelMessages(messages()).map((message) => message.content)).toEqual([
    en('coach.greeting'),
    'where can I swim tonight?',
    'Laugardalslaug is open until 22.',
  ]);
});

it('puts no weight in any bubble or chip', async () => {
  // The numbers live on the sheets. (A digit followed by "kg" is the shape of every weight.)
  await adjusting();
  await driveEveryBranch();
  const weight = /\d\s*(kg|kíló)/i;
  for (const turn of adjustTurns()) {
    for (const text of [turn.text, ...(turn.options ?? []).map((option) => option.label)]) {
      expect(text).not.toMatch(weight);
      // The picked target, the standing target and the current weight.
      expect(text).not.toContain('71');
      expect(text).not.toContain('68');
      expect(text).not.toContain('80');
    }
  }
});

it('keeps nothing typed during the flow', async () => {
  await adjusting();
  await coach().send('I weigh 96 kg and want to be 80 kg by June');
  const everything = messages().map((message) => message.text).join(' ');
  expect(everything).not.toContain('96 kg');
  expect(everything).not.toContain('by June');
  expect(messages().some((message) => message.text === en('program.typed_hint'))).toBe(true);
  // The flow is still open, its question asked again.
  expect(adjustFlowForTests()).not.toBeNull();
  expect(openBubble().text).toBe(en('program.adjust.title') + '\n' + en('program.adjust.now', { summary: 'Build muscle, 3 days a week' }));
});

it('ends the flow on the phone on a safety yes: nothing sent, nothing kept', async () => {
  await adjusting();
  await tap(en('program.adjust.opt.goal'));
  await tap(en('program.goal.gain_weight'));
  await tap(en('program.adjust.safety.yes'));
  expect(adjustFlowForTests()).toBeNull();
  expect(last().text).toBe(en('program.adjust.safety_stop'));
});

it('confirms a target-only change for the same goal with a target', async () => {
  // The plan is not rebuilt, and the confirmation says so.
  await adjusting('lose_weight');
  await tap(en('program.adjust.opt.goal'));
  await tap(en('program.goal.lose_weight'));
  // No safety question: the goal is not changing.
  expect(last().text).toBe(en('program.adjust.q.target'));
  recordAdjustTarget(targetSet(66));
  expect(last().text).toBe(en('program.adjust.confirm_target'));
  const flow = adjustFlowForTests();
  expect(flow && isTargetOnly(flow)).toBe(true);
  expect(flow && revisionInput(flow)).toBeNull();
});

it('keeps the other changes on "No target" for the same goal with nothing stored', async () => {
  // "No target" on the plan's own goal with no target stored changes nothing
  // about the target, and must not throw away what else was chosen.
  setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'lose_weight' }), standingTarget: null }));
  await coach().startAdjust();
  await tap(en('program.adjust.opt.length'));
  await tap(en('program.length.12'));
  await tap(en('program.adjust.change_more'));
  await tap(en('program.adjust.opt.goal'));
  await tap(en('program.goal.lose_weight'));
  // No keep without a stored target.
  expect(openLabels()).toEqual([en('program.adjust.target.set'), en('program.adjust.target.none')]);
  await tap(en('program.adjust.target.none'));

  expect(last().text.startsWith(en('program.adjust.confirm'))).toBe(true);
  const flow = adjustFlowForTests();
  expect(flow?.weeks).toBe(12);
  expect(flow?.target).toEqual({ kind: 'unchanged' });
  expect(flow && revisionInput(flow)).not.toHaveProperty('targetWeightKg');
});

it('says there is nothing to update for "No target" on the same goal with nothing else', async () => {
  setProgramContextForTests(adjustingContext({ liveProgram: liveProgram({ goal: 'gain_weight' }), standingTarget: null }));
  await coach().startAdjust();
  await tap(en('program.adjust.opt.goal'));
  await tap(en('program.goal.gain_weight'));
  await tap(en('program.adjust.target.none'));
  expect(messages().some((message) => message.text === en('program.adjust.nothing'))).toBe(true);
  // Back to the menu.
  expect(last().text.startsWith(en('program.adjust.title'))).toBe(true);
  expect(adjustFlowForTests()).not.toBeNull();
});

it('ends the flow on Never mind', async () => {
  await adjusting();
  await tap(en('program.adjust.opt.cancel'));
  expect(adjustFlowForTests()).toBeNull();
  expect(last().text).toBe(en('program.adjust.cancelled'));
});

it('takes the flow and every one of its turns on the local wipe', async () => {
  await adjusting();
  await driveEveryBranch();
  coach().dropHealthMessages();
  expect(adjustFlowForTests()).toBeNull();
  expect(messages().every((message) => !message.isHealth)).toBe(true);
});

it('falls back to the gate without revisions: no adjust flow, nothing sent', async () => {
  // Against a server without revisions the empty-state entry is the wizard's gate.
  setProgramContextForTests({ access: 'entitled', hasConsent: true, hasLiveProgram: true });
  await coach().startAdjust();
  expect(adjustFlowForTests()).toBeNull();
  expect(last().text).toBe(en('program.active_exists'));
});
