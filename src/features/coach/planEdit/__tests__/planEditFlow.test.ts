/**
 * Changing the plan in chat through COACH-1's store, with the network
 * stubbed: what typed words reach OP-58 and with what, every kind of answer
 * as the member meets it, the fallback to the chat for words that are no
 * plan change (one bubble, not a health one), refining an open suggestion,
 * the clarifying chips, the one-tap consent resending the SAME key, the
 * error table, Apply (and its cycle dialog, and its wait for an open
 * workout), Cancel, Undo, the entry points, and the health lane: no bubble
 * of this flow ever reaches `/coach`.
 */
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeHealthDay, useHealthStore } from '../../../../health';
import { lookup, setCurrentLanguage, translate } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { pendingCoachSaves, resetCoachStoreForTests, useCoachStore } from '../../store/coachStore';
import { isOpenQuestion, type CoachMessage } from '../../store/messages';
import { setProgramContextForTests } from '../../program/context';
import { setPlanEditAvailabilityForTests } from '../availability';
import {
  applyCard,
  cancelCard,
  declineConsentFor,
  grantConsentFor,
  PlanEditMessageKind,
  planEditThreadForTests,
  resetPlanEdit,
  selectVariant,
  setPlanEditDepsForTests,
  undoCard,
  type PlanEditCardPayload,
  type PlanEditConsentPayload,
} from '../flow';
import { presentDialog, presentToast, runnerOpenFor } from '../platform';

import {
  applyJson,
  applyPath,
  discardPath,
  EDIT_A,
  EDIT_B,
  EDITS_PATH,
  previewJson,
  PROGRAM_ID,
  responseJson,
  TODAY_SESSION,
  undoJson,
  undoPath,
} from './planEditFixtures';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../flows/venueWizard', () => ({ venueWizardFlow: jest.requireActual('../../flows/types').inactiveFlow('venueWizard') }));
jest.mock('../../flows/dayPlan', () => ({ dayPlanFlow: require('../../flows/types').inactiveFlow('dayPlan') }));
jest.mock('../platform', () => ({ presentDialog: jest.fn(), presentToast: jest.fn(), runnerOpenFor: jest.fn(() => false) }));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const presentDialogMock = presentDialog as jest.MockedFunction<typeof presentDialog>;
const presentToastMock = presentToast as jest.MockedFunction<typeof presentToast>;
const runnerOpenForMock = runnerOpenFor as jest.MockedFunction<typeof runnerOpenFor>;

const coach = () => useCoachStore.getState();
const messages = () => coach().messages;
const en = (key: string) => lookup(key, 'en');
const cards = () => messages().filter((m) => m.kind === PlanEditMessageKind.preview);
const card = (message: CoachMessage | undefined = cards()[cards().length - 1]) => message?.payload as PlanEditCardPayload;
const openBubble = () => [...messages()].reverse().find(isOpenQuestion)!;
const sentEdits = () => api.sentAll(EDITS_PATH).filter((r) => r.method === 'POST');

/** The cached Today read: a plan with a bench press and a lat pulldown today. */
const DAY = decodeHealthDay({
  date: '2026-10-23',
  program: { id: PROGRAM_ID, status: 'active' },
  day: {
    date: '2026-10-23',
    session: {
      id: TODAY_SESSION,
      title: 'Push (Brust & Trizeps)',
      status: 'planned',
      blocks: [
        { blockNo: 1, exerciseId: 'barbell-bench-press', name: 'Barbell bench press' },
        { blockNo: 2, exerciseId: 'lat-pulldown', name: 'Lat pulldown' },
      ],
    },
  },
});

let keys = 0;
let events: { event: string; params: AnalyticsParams }[] = [];
const grant = jest.fn(async (version: string, _ageAttested: boolean, _key: string) => ({
  consent: null,
  deleted: null,
  optedIn: true,
  version,
  consentedAt: new Date('2026-10-23T10:00:00Z'),
  ageSource: 'kennitala',
}));
const load = jest.fn(async () => undefined);
const realLoad = useHealthStore.getState().load;

beforeEach(() => {
  setCurrentLanguage('en');
  resetCoachStoreForTests();
  resetIntentStoreForTests();
  resetPlanEdit();
  keys = 0;
  setPlanEditDepsForTests({ makeKey: () => `key-${(keys += 1)}`, grant });
  grant.mockClear();
  setPlanEditAvailabilityForTests({ kind: 'available', programId: PROGRAM_ID, program: DAY.program, day: DAY });
  setProgramContextForTests({ access: 'entitled', hasConsent: true, hasLiveProgram: true, supportsPlanRevision: true, liveProgram: DAY.program });
  useAppStore.setState({ serverFeatures: ['plan_edit', 'plan_revision'] });
  useHealthStore.setState({ load });
  load.mockClear();
  presentDialogMock.mockReset();
  presentToastMock.mockReset();
  runnerOpenForMock.mockReset();
  runnerOpenForMock.mockReturnValue(false);
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setPlanEditAvailabilityForTests(null);
  setProgramContextForTests(null);
  setPlanEditDepsForTests({ makeKey: null, grant: null });
  useHealthStore.setState({ load: realLoad });
  resetPlanEdit();
  await pendingCoachSaves();
});

function answerEdits(...replies: StubReply[]): void {
  let index = 0;
  api.on('POST', EDITS_PATH, () => replies[Math.min(index++, replies.length - 1)]!);
}

describe('typed words that ask to change the plan', () => {
  it('go to OP-58 with the plan, a key and the app language, and come back as a card to check', async () => {
    answerEdits(Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');

    expect(sentEdits()).toHaveLength(1);
    const sent = sentEdits()[0]!;
    expect(sent.body).toEqual({ message: 'swap bench press for push-ups', locale: 'en' });
    expect(sent.headers['idempotency-key']).toBe('key-1');

    const [user, reply, preview] = messages().slice(-3);
    expect(user).toMatchObject({ role: 'user', text: 'swap bench press for push-ups', isHealth: true, flow: 'planEdit' });
    expect(reply).toMatchObject({ role: 'assistant', text: 'Done: push-ups on your Push days.', isHealth: true });
    expect(preview).toMatchObject({ kind: PlanEditMessageKind.preview, isHealth: true, flow: 'planEdit' });
    expect(card(preview)).toMatchObject({ status: 'pending', selected: 0, programId: PROGRAM_ID });
    expect(api.sentAll('/coach')).toHaveLength(0);

    expect(events.map((e) => e.event)).toEqual(['plan_edit_sent', 'plan_edit_preview']);
    expect(events[1]!.params).toEqual({ kind: 'preview', items: '2-5', count_band: 'one' });
  });

  it('that are no plan change go on to the chat: one member bubble, not a health one, and no plan-edit bubble in its history', async () => {
    answerEdits(Reply.ok(responseJson()), Reply.ok({ kind: 'not_plan_edit', reply: null, variants: [], notApplied: [], replayed: false }));
    api.on('POST', '/coach', Reply.ok({ reply: 'Try some music with a steady beat.' }));
    await coach().send('swap bench press for push-ups');
    await coach().send('change my workout playlist to something faster');

    expect(sentEdits()).toHaveLength(2);
    const coachCalls = api.sentAll('/coach');
    expect(coachCalls).toHaveLength(1);
    const history = (coachCalls[0]!.body as { messages: { role: string; content: string }[] }).messages;
    // The greeting and the words; nothing of the plan change before them.
    expect(history.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(history[1]).toEqual({ role: 'user', content: 'change my workout playlist to something faster' });
    expect(JSON.stringify(history)).not.toMatch(/bench press|push-ups on your Push days/);

    const bubbles = messages().filter((m) => m.role === 'user' && m.text === 'change my workout playlist to something faster');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.isHealth).toBeFalsy();
    expect(messages()[messages().length - 1]).toMatchObject({ role: 'assistant', text: 'Try some music with a steady beat.' });
  });

  it('refine an open suggestion: the variant on screen is replaced, and the older card says so', async () => {
    answerEdits(
      Reply.ok(responseJson({ variants: [previewJson({ editId: EDIT_A, recommended: false }), previewJson({ editId: EDIT_B, recommended: true, label: 'Your own: Zottman curls' })] })),
      Reply.ok(responseJson({ variants: [previewJson({ editId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f' })] })),
    );
    await coach().send('swap bench press for push-ups');
    const first = cards()[0]!;
    // The recommended variant is preselected; the member picks the other one.
    expect(card(first).selected).toBe(1);
    selectVariant(first.id, 0);

    await coach().send('no, make it 4 sets');
    expect(sentEdits()[1]!.body).toEqual({ message: 'no, make it 4 sets', locale: 'en', replacesEditId: EDIT_A });
    expect(card(cards()[0]).status).toBe('superseded');
    expect(card().status).toBe('pending');
  });

  it('are not sent when the server does not change plans by chat: the chat has them, as before', async () => {
    setPlanEditAvailabilityForTests({ kind: 'unavailable' });
    api.on('POST', '/coach', Reply.ok({ reply: 'Okay.' }));
    await coach().send('swap bench press for push-ups');
    expect(sentEdits()).toHaveLength(0);
    expect(api.sentAll('/coach')).toHaveLength(1);
  });

  it('on a paused plan say how to change it, and send nothing', async () => {
    setPlanEditAvailabilityForTests({ kind: 'paused', programId: PROGRAM_ID });
    await coach().send('swap this exercise for push-ups');
    expect(sentEdits()).toHaveLength(0);
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(messages()[messages().length - 1]!.text).toBe(en('coach.planEdit.error.planPaused'));
  });

  it('that are a question are the chat\'s', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Three to four.' }));
    await coach().send('how many sets should I do?');
    expect(sentEdits()).toHaveLength(0);
    expect(api.sentAll('/coach')).toHaveLength(1);
  });
});

describe('a clarifying question', () => {
  it("shows its choices, and a tap sends the choice's words with the request they answer", async () => {
    answerEdits(
      Reply.ok(responseJson({ kind: 'clarify', reply: null, variants: [], question: { text: 'Which press?', choices: ['Bench press', 'Shoulder press'] } })),
      Reply.ok(responseJson()),
    );
    await coach().send('swap the press for something else');
    const question = openBubble();
    expect(question.text).toBe('Which press?');
    expect(question.options?.map((o) => o.label)).toEqual(['Bench press', 'Shoulder press']);

    await coach().selectOption(question.id, question.options![0]!.value, 'Bench press');
    // The server keeps no conversation: the answer travels with its request.
    expect(sentEdits()[1]!.body).toEqual({ message: 'swap the press for something else Bench press', locale: 'en' });
    expect(messages().filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['swap the press for something else', 'Bench press']);
    expect(card().status).toBe('pending');
  });

  it('typed words answer it too', async () => {
    answerEdits(
      Reply.ok(responseJson({ kind: 'clarify', reply: 'Got it.', variants: [], question: { text: 'Which day?', choices: [] } })),
      Reply.ok(responseJson()),
    );
    await coach().send('swap the press for something else');
    expect(planEditThreadForTests()?.questionFor).toBe('swap the press for something else');
    await coach().send('the Thursday one');
    expect(sentEdits()).toHaveLength(2);
    expect(sentEdits()[1]!.body).toEqual({ message: 'swap the press for something else the Thursday one', locale: 'en' });
  });

  it('a suggestion offers Adjust my plan or a new plan as a chip', async () => {
    answerEdits(
      Reply.ok(
        responseJson({
          kind: 'clarify',
          reply: null,
          variants: [],
          question: { text: 'Do you want a plan for losing weight?', choices: [] },
          suggestion: 'new_plan',
        }),
      ),
    );
    await coach().send('change my plan so I lose weight');
    expect(openBubble().options?.map((o) => o.label)).toEqual([en('program.chip.make_new')]);
  });

  it('Adjust my plan is offered only on a plan that can be adjusted (never a custom one)', async () => {
    const answer = (suggestion: string) =>
      Reply.ok(responseJson({ kind: 'clarify', reply: null, variants: [], question: { text: 'Change the goal?', choices: [] }, suggestion }));
    answerEdits(answer('adjust_plan'));
    await coach().send('change my plan to 3 days a week');
    expect(openBubble().options?.map((o) => o.label)).toEqual([en('coach.chip.adjust_plan')]);
    setProgramContextForTests({ access: 'entitled', hasConsent: true, hasLiveProgram: true, supportsPlanRevision: true, liveProgram: { ...DAY.program!, custom: true } });
    answerEdits(answer('adjust_plan'));
    await coach().send('change my plan to 3 days a week');
    expect(openBubble().options?.map((o) => o.label)).toEqual([en('program.chip.make_new')]);
  });
});

describe('nothing to change', () => {
  it('says the reply, then what could not be done on a line of its own', async () => {
    answerEdits(
      Reply.ok(
        responseJson({
          kind: 'no_change',
          reply: "I couldn't do that.",
          variants: [],
          notApplied: [{ reason: 'not_supported', text: 'A class day has no exercises to swap.' }],
        }),
      ),
    );
    await coach().send('swap the exercises in my yoga workout');
    expect(messages()[messages().length - 1]!.text).toBe("I couldn't do that.\nA class day has no exercises to swap.");
    // Nothing is open: the next words are not taken as a refinement.
    expect(planEditThreadForTests()?.takesWords).toBe(false);
  });
});

describe('the refusals', () => {
  it.each([
    [422, 'plan_edit_personal_data', 'coach.planEdit.error.personalData'],
    [429, 'plan_edit_limit', 'coach.planEdit.error.limit'],
    [503, 'plan_edit_paused', 'coach.planEdit.error.paused'],
  ] as const)('%i %s says %s and keeps the member\'s words on screen', async (status, slug, key) => {
    answerEdits(Reply.problem(status, slug, { reason: 'daily' }));
    await coach().send('swap bench press for push-ups');
    expect(messages()[messages().length - 1]!.text).toBe(en(key));
    expect(messages()[messages().length - 2]).toMatchObject({ role: 'user', text: 'swap bench press for push-ups', isHealth: true });
    expect(events.find((e) => e.event === 'plan_edit_error')?.params).toEqual({ reason: slug });
  });

  it('a failed answer offers Try again, which sends the same words under a new key', async () => {
    answerEdits(Reply.problem(502, 'coach_upstream_error'), Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    const retry = openBubble();
    expect(retry.text).toBe(en('coach.planEdit.error.upstream'));
    await coach().selectOption(retry.id, retry.options![0]!.value, en('coach.planEdit.retry'));
    expect(sentEdits().map((r) => r.headers['idempotency-key'])).toEqual(['key-1', 'key-2']);
    expect(sentEdits()[1]!.body).toEqual({ message: 'swap bench press for push-ups', locale: 'en' });
    expect(messages().filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['swap bench press for push-ups', en('coach.planEdit.retry')]);
    expect(card().status).toBe('pending');
  });

  it('no connection offers Try again under the SAME key (a request that arrived is answered again for free)', async () => {
    answerEdits(Reply.fail(), Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    const retry = openBubble();
    await coach().selectOption(retry.id, retry.options![0]!.value, en('coach.planEdit.retry'));
    expect(sentEdits().map((r) => r.headers['idempotency-key'])).toEqual(['key-1', 'key-1']);
    expect(card().status).toBe('pending');
  });

  it('an answer this build does not know is taken as no plan change: the chat has the words', async () => {
    answerEdits(Reply.ok({ kind: 'teleport', reply: 'Beam me up.' }));
    api.on('POST', '/coach', Reply.ok({ reply: 'Okay.' }));
    await coach().send('swap bench press for push-ups');
    expect(api.sentAll('/coach')).toHaveLength(1);
    expect(messages().some((m) => m.text === 'Beam me up.')).toBe(false);
  });

  it('a membership gate, a pending deletion or a minor answer in their own words, with the way on', async () => {
    answerEdits(Reply.problem(403, 'no_active_plan_or_pass'));
    await coach().send('swap bench press for push-ups');
    expect(openBubble().text).toBe(en('program.gate.not_member'));
    expect(openBubble().options?.map((o) => o.label)).toEqual([en('plan.gate.cta_choose')]);
  });

  it('a key the server already used is resent once with a fresh one', async () => {
    answerEdits(Reply.problem(422, 'idempotency_key_reused'), Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    expect(sentEdits().map((r) => r.headers['idempotency-key'])).toEqual(['key-1', 'key-2']);
    expect(cards()).toHaveLength(1);
  });

  it('the route gone (the feature turned off) drops the feature and the words go to the chat', async () => {
    answerEdits(Reply.raw(404, 'Not found'));
    api.on('POST', '/coach', Reply.ok({ reply: 'Okay.' }));
    await coach().send('swap bench press for push-ups');
    expect(useAppStore.getState().serverFeatures).not.toContain('plan_edit');
    expect(api.sentAll('/coach')).toHaveLength(1);
    expect(messages().filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('a plan that ended says so and reads Plan again', async () => {
    answerEdits(Reply.problem(409, 'program_action_not_allowed', { reason: 'not_live' }));
    await coach().send('swap bench press for push-ups');
    expect(messages()[messages().length - 1]!.text).toBe(en('coach.planEdit.error.notLive'));
    expect(load).toHaveBeenCalledWith({ force: true });
  });
});

describe('the one-tap consent', () => {
  it('grants the plan-change text (v4), then sends the SAME words with the SAME key', async () => {
    answerEdits(Reply.problem(409, 'plan_edit_consent_required'), Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    const consent = messages()[messages().length - 1]!;
    expect(consent.kind).toBe(PlanEditMessageKind.consent);
    expect((consent.payload as PlanEditConsentPayload).status).toBe('idle');

    await grantConsentFor(consent.id);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant.mock.calls[0]![0]).toBe('2026-09-v4');
    expect(grant.mock.calls[0]![1]).toBe(false);
    expect(sentEdits().map((r) => r.headers['idempotency-key'])).toEqual(['key-1', 'key-1']);
    expect(sentEdits()[1]!.body).toEqual(sentEdits()[0]!.body);
    expect((messages().find((m) => m.id === consent.id)!.payload as PlanEditConsentPayload).status).toBe('granted');
    expect(card().status).toBe('pending');
    expect(messages().filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('"Not now" sends nothing and says the plan stays as it is', async () => {
    answerEdits(Reply.problem(409, 'plan_edit_consent_required'));
    await coach().send('swap bench press for push-ups');
    const consent = messages()[messages().length - 1]!;
    declineConsentFor(consent.id);
    expect(grant).not.toHaveBeenCalled();
    expect(sentEdits()).toHaveLength(1);
    expect(messages()[messages().length - 1]!.text).toBe(en('coach.planEdit.consent.declined'));
    await grantConsentFor(consent.id);
    expect(grant).not.toHaveBeenCalled();
  });
});

describe('Apply, Cancel, Undo', () => {
  async function preview(variant: Record<string, unknown> = {}): Promise<CoachMessage> {
    answerEdits(Reply.ok(responseJson({ variants: [previewJson(variant)] })));
    await coach().send('swap bench press for push-ups');
    return cards()[cards().length - 1]!;
  }

  it('Apply sends OP-59, says the plan is updated, reads Plan again and offers Undo', async () => {
    const message = await preview();
    api.on('POST', applyPath(EDIT_A), Reply.ok(applyJson()));
    await applyCard(message.id);
    const sent = api.sent(applyPath(EDIT_A));
    expect(sent.body).toEqual({});
    expect(sent.headers['idempotency-key']).toBe('key-2');
    expect(card()).toMatchObject({ status: 'applied', applied: { editId: EDIT_A, undoable: true } });
    expect(presentToastMock).toHaveBeenCalledWith(en('coach.planEdit.updatedToast'));
    expect(load).toHaveBeenCalledWith({ force: true });
    expect(events.find((e) => e.event === 'plan_edit_applied')?.params).toEqual({ choice: 'single' });
    // An applied change ends the thread: typed words no longer refine it.
    expect(planEditThreadForTests()).toBeNull();
  });

  it('a change that makes the plan a cycle asks first, then applies with confirmCustom', async () => {
    const message = await preview({ becomesCustom: true, becomesCustomNote: 'Your plan will repeat every 4 days.' });
    api.on('POST', applyPath(EDIT_A), Reply.ok(applyJson()));
    await applyCard(message.id);
    expect(api.sentAll(applyPath(EDIT_A))).toHaveLength(0);
    expect(presentDialogMock).toHaveBeenCalledTimes(1);
    const dialog = presentDialogMock.mock.calls[0]![0];
    expect(dialog.title).toBe(en('coach.planEdit.confirmCustom.title'));
    expect(dialog.message).toBe('Your plan will repeat every 4 days.');
    const ok = dialog.buttons.find((button) => button.label === en('coach.planEdit.confirmCustom.ok'))!;
    ok.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.sent(applyPath(EDIT_A)).body).toEqual({ confirmCustom: true });
  });

  it('Apply waits while today\'s workout is open in the runner', async () => {
    const message = await preview({ touchesToday: true, todaySessionId: TODAY_SESSION });
    runnerOpenForMock.mockReturnValue(true);
    await applyCard(message.id);
    expect(api.sentAll(applyPath(EDIT_A))).toHaveLength(0);
    expect(runnerOpenForMock).toHaveBeenCalledWith(TODAY_SESSION);
    expect(card()).toMatchObject({ status: 'pending', errorKey: 'coach.planEdit.runnerOpen' });
  });

  it('a stale suggestion says so and offers Ask again, which sends the words again under a new key', async () => {
    const message = await preview();
    api.on('POST', applyPath(EDIT_A), Reply.problem(409, 'plan_edit_stale'));
    await applyCard(message.id);
    expect(card(messages().find((m) => m.id === message.id)).status).toBe('stale');
    const ask = openBubble();
    expect(ask.text).toBe(en('coach.planEdit.error.stale'));
    expect(ask.options?.map((o) => o.label)).toEqual([en('coach.planEdit.askAgain')]);
    answerEdits(Reply.ok(responseJson()));
    await coach().selectOption(ask.id, ask.options![0]!.value, en('coach.planEdit.askAgain'));
    expect(sentEdits()).toHaveLength(2);
    expect(sentEdits()[1]!.headers['idempotency-key']).not.toBe(sentEdits()[0]!.headers['idempotency-key']);
  });

  it('Cancel says so at once and discards every variant, best effort', async () => {
    answerEdits(Reply.ok(responseJson({ variants: [previewJson(), previewJson({ editId: EDIT_B, recommended: false })] })));
    await coach().send('swap bench press for push-ups');
    api.on('POST', discardPath(EDIT_A), Reply.problem(500, 'internal_error'));
    api.on('POST', discardPath(EDIT_B), Reply.ok({ edit: { id: EDIT_B, status: 'discarded' } }));
    cancelCard(cards()[0]!.id);
    expect(card().status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.sentAll(discardPath(EDIT_A))).toHaveLength(1);
    expect(api.sentAll(discardPath(EDIT_B))).toHaveLength(1);
    expect(events.some((e) => e.event === 'plan_edit_cancelled')).toBe(true);
  });

  it('Undo takes the change back and says when finished days stay as they are', async () => {
    const message = await preview();
    api.on('POST', applyPath(EDIT_A), Reply.ok(applyJson()));
    await applyCard(message.id);
    api.on('POST', undoPath(EDIT_A), Reply.ok(undoJson({ keptRows: 2 })));
    await undoCard(message.id);
    expect(api.sent(undoPath(EDIT_A)).headers['idempotency-key']).toBe('key-3');
    expect(card()).toMatchObject({ status: 'undone', keptRows: 2 });
    expect(presentToastMock).toHaveBeenLastCalledWith(en('coach.planEdit.undoneToast'));
    expect(events.find((e) => e.event === 'plan_edit_undone')?.params).toEqual({ entry: 'card' });
  });

  it('an Undo the server refuses says why and offers it no more', async () => {
    const message = await preview();
    api.on('POST', applyPath(EDIT_A), Reply.ok(applyJson()));
    await applyCard(message.id);
    api.on('POST', undoPath(EDIT_A), Reply.problem(409, 'plan_edit_undo_unavailable', { reason: 'later_edit' }));
    await undoCard(message.id);
    expect(card()).toMatchObject({ status: 'applied', undoBlockedKey: 'coach.planEdit.error.undoChanged' });
  });
});

describe('the entry points', () => {
  it('"Change my plan" asks what to change, and the next words go to OP-58 whatever they say', async () => {
    answerEdits(Reply.ok(responseJson()));
    await coach().startPlanEdit();
    expect(messages().slice(-2).map((m) => [m.role, m.text, m.isHealth])).toEqual([
      ['user', en('coach.planEdit.chip'), true],
      ['assistant', en('coach.planEdit.ask'), true],
    ]);
    await coach().send('the Thursday one is too long');
    expect(sentEdits()).toHaveLength(1);
  });

  it('"I don\'t have this" from the runner fills the input; Send goes with the day and the exercise', async () => {
    answerEdits(Reply.ok(responseJson()));
    useIntentStore.getState().parkCoachPlanEdit({
      sessionId: TODAY_SESSION,
      exerciseId: 'lat-pulldown',
      prefill: "I don't have the equipment for Lat pulldown",
    });
    await coach().consumeParkedEntries();
    expect(coach().inputText).toBe("I don't have the equipment for Lat pulldown");
    expect(messages().slice(-2).map((m) => [m.role, m.text])).toEqual([
      ['user', en('coach.planEdit.notHaveThis')],
      ['assistant', en('coach.planEdit.askPrefilled')],
    ]);
    expect(sentEdits()).toHaveLength(0);
    await coach().send(coach().inputText);
    expect(sentEdits()[0]!.body).toEqual({
      message: "I don't have the equipment for Lat pulldown",
      locale: 'en',
      context: { sessionId: TODAY_SESSION, exerciseId: 'lat-pulldown' },
    });
  });

  it('"Change with Coach" from Plan asks what to change about that day', async () => {
    answerEdits(Reply.ok(responseJson()));
    useIntentStore.getState().parkCoachPlanEdit({ sessionId: TODAY_SESSION, sessionTitle: 'Push' });
    await coach().consumeParkedEntries();
    expect(messages().slice(-2).map((m) => m.text)).toEqual([
      en('coach.planEdit.changeWithCoach'),
      translate('coach.planEdit.askSession', 'en', { title: 'Push' }),
    ]);
    await coach().send('make it shorter');
    expect(sentEdits()[0]!.body).toEqual({ message: 'make it shorter', locale: 'en', context: { sessionId: TODAY_SESSION } });
  });
});

describe('the health lane', () => {
  it('a wipe takes every plan-change bubble away', async () => {
    answerEdits(Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    expect(messages().some((m) => m.flow === 'planEdit')).toBe(true);
    coach().dropHealthMessages();
    expect(messages().some((m) => m.flow === 'planEdit')).toBe(false);
    expect(planEditThreadForTests()).toBeNull();
  });

  it('an answer that lands after a new chat lands nowhere', async () => {
    let release: (reply: StubReply) => void = () => undefined;
    api.on('POST', EDITS_PATH, () => new Promise<StubReply>((resolve) => (release = resolve)));
    const sending = coach().send('swap bench press for push-ups');
    await new Promise((resolve) => setTimeout(resolve, 0));
    coach().resetChat();
    release(Reply.ok(responseJson()));
    await sending;
    expect(cards()).toHaveLength(0);
  });

  it('analytics never carry the words', async () => {
    answerEdits(Reply.ok(responseJson()));
    await coach().send('swap bench press for push-ups');
    for (const { params } of events) {
      for (const value of Object.values(params)) expect(String(value)).not.toMatch(/bench|push/i);
    }
  });

  it('while the chat is locked, words for the chat are answered with the lock, and the plan can still be changed', async () => {
    useCoachStore.setState({ limitReached: true });
    answerEdits(Reply.ok(responseJson()));
    await coach().send('tell me a joke');
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(messages().slice(-2).map((m) => [m.role, m.text])).toEqual([
      ['user', 'tell me a joke'],
      ['assistant', en('coach.input.limit_reached')],
    ]);
    await coach().send('swap bench press for push-ups');
    expect(cards()).toHaveLength(1);
  });
});
