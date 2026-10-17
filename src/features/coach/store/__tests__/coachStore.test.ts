/**
 * The Coach store (the port of iOS `CoachViewModel`), with the four flows
 * replaced by recording fakes (./fakeFlows.ts) and the network by the stub
 * server.
 *
 * Ports CoachPersistenceTests (the non-programme cases: health turns never
 * saved, a chat of only health turns not saved, a health turn never titles,
 * the local wipe), the store half of CoachFreeTierTests, and the package's
 * acceptance cases: a chat past 20 turns still answers, "Book it" opens by
 * slug (the resolved venue rows), the next account never sees the last
 * one's chat, and two Home prompts produce two sends.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenue, venueToApi } from '../../../../api/venues';
import { runSignInHooks, runSignOutCleaners } from '../../../../app/signOut';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { runHealthWipeHooks } from '../../../../health/wipe';
import * as coachApi from '../../chat/coachApi';
// The register file wires the store to sign-in, sign-out and the health wipe.
import '../../register';
import { COACH_SESSIONS_KEY, loadSavedSessions, writeSavedSessions } from '../../persistence/sessions';
import {
  PARKED_SEND,
  pendingCoachSaves,
  resetCoachStoreForTests,
  selectIsAILocked,
  selectRecentChats,
  TYPED_SEND,
  useCoachStore,
} from '../coachStore';
import { coachHost } from '../host';
import { GREETING_ID, type CoachMessage } from '../messages';
import { clearFakeFlows, fake } from './fakeFlows';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('../../flows/venueWizard', () => ({ venueWizardFlow: require('./fakeFlows').fakeFlow('venueWizard') }));
jest.mock('../../flows/dayPlan', () => ({ dayPlanFlow: require('./fakeFlows').fakeFlow('dayPlan') }));
jest.mock('../../flows/program', () => ({ programFlow: require('./fakeFlows').fakeFlow('program') }));
jest.mock('../../flows/adjust', () => ({ adjustFlow: require('./fakeFlows').fakeFlow('adjust') }));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const coach = () => useCoachStore.getState();
const en = (key: string) => lookup(key, 'en');

const MEMBER_A = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const MEMBER_B = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

beforeEach(() => {
  resetCoachStoreForTests();
  resetIntentStoreForTests();
  clearFakeFlows();
});

afterEach(async () => {
  await pendingCoachSaves();
});

/** Answers `POST /coach` with `reply` and records each body. */
function answer(reply: string | ((request: StubRequest) => string), extra: Record<string, unknown> = {}) {
  api.on('POST', '/coach', (request) =>
    Reply.ok({ reply: typeof reply === 'string' ? reply : reply(request), ...extra }),
  );
}

interface CoachBody {
  readonly locale: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

function coachBodies(): CoachBody[] {
  return api.sentAll('/coach', 'POST').map((request) => request.body as CoachBody);
}

function texts(messages: readonly CoachMessage[] = coach().messages): string[] {
  return messages.map((message) => message.text);
}

function seed(messages: CoachMessage[]): void {
  useCoachStore.setState({ messages });
}

function msg(id: string, role: 'user' | 'assistant', text: string, extra: Partial<CoachMessage> = {}): CoachMessage {
  return { id, role, text, ...extra };
}

function venue(n: number, name: string, slug: string) {
  return decodeVenue({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, slug, name, inBundle: true });
}

// ---------------------------------------------------------------------------

describe('a fresh chat', () => {
  it('is the greeting alone, in the account language', () => {
    expect(coach().messages).toEqual([{ id: GREETING_ID, role: 'assistant', text: en('coach.greeting') }]);
    setCurrentLanguage('is');
    coach().updateLanguage();
    expect(texts()).toEqual([lookup('coach.greeting', 'is')]);
  });

  it('re-localises only an untouched greeting (iOS updateLanguage)', () => {
    seed([msg(GREETING_ID, 'assistant', en('coach.greeting')), msg('101', 'user', 'hi')]);
    setCurrentLanguage('is');
    coach().updateLanguage();
    expect(texts()[0]).toBe(en('coach.greeting'));
  });
});

// ---------------------------------------------------------------------------

describe('a typed message no flow takes', () => {
  it('goes to the model with the locale, and the answer lands in the chat', async () => {
    answer('Laugardalslaug is open until 22.');
    await coach().send('  where can I swim tonight?  ');

    expect(coachBodies()).toEqual([
      {
        locale: 'en',
        messages: [
          { role: 'assistant', content: en('coach.greeting') },
          { role: 'user', content: 'where can I swim tonight?' },
        ],
      },
    ]);
    expect(texts()).toEqual([en('coach.greeting'), 'where can I swim tonight?', 'Laugardalslaug is open until 22.']);
    expect(coach().isTyping).toBe(false);
    expect(coach().inputText).toBe('');
  });

  it('is asked in Icelandic for an Icelandic account', async () => {
    setCurrentLanguage('is');
    answer('Laugardalslaug er opin til 22.');
    await coach().send('hvar get ég synt?');
    expect(coachBodies()[0]!.locale).toBe('is');
  });

  it('went through every flow first, in iOS order, with the typed options', async () => {
    answer('ok');
    await coach().send('hello');
    expect(fake('program').calls).toEqual(['startFrom:hello']);
    expect(fake('dayPlan').calls).toEqual(['startFrom:hello']);
    expect(fake('venueWizard').calls).toEqual(['startFrom:hello']);
    expect(fake('venueWizard').startOptions).toEqual([TYPED_SEND]);
  });

  it('nothing blank is sent, and nothing while a reply is in flight', async () => {
    await coach().send('   ');
    useCoachStore.setState({ isTyping: true });
    await coach().send('hello');
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(texts()).toEqual([en('coach.greeting')]);
  });

  it('a chat past 20 turns still answers: only the last 20 go', async () => {
    const history: CoachMessage[] = [msg(GREETING_ID, 'assistant', en('coach.greeting'))];
    for (let index = 0; index < 30; index += 1) {
      history.push(msg(String(200 + index), index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`));
    }
    seed(history);
    answer('still here');
    await coach().send('one more');
    const sent = coachBodies()[0]!.messages;
    expect(sent).toHaveLength(20);
    expect(sent[19]).toEqual({ role: 'user', content: 'one more' });
    expect(texts().at(-1)).toBe('still here');
  });

  it('never sends a health turn, a question or a strip', async () => {
    seed([
      msg(GREETING_ID, 'assistant', en('coach.greeting')),
      msg('101', 'user', 'Get a 4-week plan', { isHealth: true }),
      msg('102', 'assistant', 'What is your goal?', { isHealth: true, flow: 'program', options: [{ label: 'x', value: 'x' }] }),
      msg('103', 'assistant', en('coach.nearby_prompt'), { showCategoryStrip: true }),
    ]);
    answer('ok');
    await coach().send('pools?');
    expect(coachBodies()[0]!.messages.map((message) => message.content)).toEqual([en('coach.greeting'), 'pools?']);
  });

  it('an empty answer says the Coach is unavailable', async () => {
    answer('   ');
    await coach().send('hello');
    expect(texts().at(-1)).toBe(en('coach.ai_unavailable'));
  });

  it('an error that is not the API client\'s says "Sorry" with it', async () => {
    const spy = jest.spyOn(coachApi, 'postCoachChat').mockRejectedValueOnce(new TypeError('boom'));
    try {
      await coach().send('hello');
    } finally {
      spy.mockRestore();
    }
    const last = texts().at(-1)!;
    expect(last.startsWith(en('coach.ai_error').split('{error}')[0]!)).toBe(true);
    expect(coach().isTyping).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the allowances', () => {
  const freeLimit = () =>
    Reply.problem(429, 'coach-free-limit', {
      detail: 'You have used your 3 free Coach messages. Want to keep going?',
      freeMessages: { limit: 3, remaining: 0, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' },
      upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
    });

  it("a 429 daily limit locks the AI path and says the server's words", async () => {
    api.on(
      'POST',
      '/coach',
      Reply.problem(429, 'coach-daily-limit', { detail: "You have used all of today's coach messages." }),
    );
    await coach().send('hello');
    expect(coach().limitReached).toBe(true);
    expect(coach().freeLimitReached).toBe(false);
    expect(selectIsAILocked(coach())).toBe(true);
    expect(texts().at(-1)).toBe("You have used all of today's coach messages.");

    // Locked: typed words that no flow takes are dropped, never sent.
    await coach().send('and again');
    expect(api.sentAll('/coach')).toHaveLength(1);
    expect(texts()).not.toContain('and again');
  });

  it("an Icelandic account hears the app's own sentence, not the server's English", async () => {
    setCurrentLanguage('is');
    api.on('POST', '/coach', Reply.problem(429, 'coach-daily-limit', { detail: 'English detail.' }));
    await coach().send('halló');
    expect(texts().at(-1)).toBe(lookup('error.rate_limited', 'is'));
  });

  it('a 429 free limit locks with the count and the way on', async () => {
    api.on('POST', '/coach', freeLimit());
    await coach().send('hello');
    expect(coach().freeLimitReached).toBe(true);
    expect(coach().limitReached).toBe(false);
    expect(coach().freeMessages?.remaining).toBe(0);
    expect(coach().upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/plans' });
  });

  it('a 503 coach-busy is a moment, never a lock', async () => {
    api.on('POST', '/coach', Reply.problem(503, 'coach-busy'));
    await coach().send('hello');
    expect(texts().at(-1)).toBe(en('coach.busy'));
    expect(selectIsAILocked(coach())).toBe(false);
  });

  it('an answer carries what is left, and the one that spends the last brings the prompt', async () => {
    answer('Try the pool.', { freeMessages: { limit: 3, remaining: 1, windowDays: 30, resetsAt: null } });
    await coach().send('first');
    expect(coach().freeMessages?.remaining).toBe(1);
    expect(coach().freeLimitReached).toBe(false);
    expect(coach().freeCountHeardAt).not.toBeNull();

    answer('Last one.', { freeMessages: { limit: 3, remaining: 0, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' } });
    await coach().send('second');
    expect(coach().freeLimitReached).toBe(true);
  });

  it('the flows still work while locked: a wizard never calls the model', async () => {
    useCoachStore.setState({ freeLimitReached: true });
    fake('venueWizard').startsOn = (text) => text.includes('gym');
    await coach().send('a gym near me');
    expect(fake('venueWizard').calls).toContain('startFrom:a gym near me');
    expect(texts()).toContain('venueWizard question');
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a new chat clears the daily lock and recomputes the free one (testANewChatStaysLockedWhileNothingIsLeft)', async () => {
    api.on('POST', '/coach', freeLimit());
    await coach().send('hello');
    coach().resetChat();
    expect(coach().freeLimitReached).toBe(true);

    coach().recordFreeMessages({ limit: 3, remaining: 1 });
    coach().resetChat();
    expect(coach().freeLimitReached).toBe(false);

    useCoachStore.setState({ limitReached: true });
    coach().resetChat();
    expect(coach().limitReached).toBe(false);
  });

  it('the profile block applies with the newer reading winning', () => {
    const now = Date.now();
    coach().applyProfileCoach(
      { tier: 'free', freeMessages: { limit: 3, remaining: 3 }, upgrade: null },
      new Date(now - 120_000),
    );
    expect(coach().freeMessages?.remaining).toBe(3);
    coach().recordFreeMessages({ limit: 3, remaining: 2 });
    coach().applyProfileCoach(
      { tier: 'free', freeMessages: { limit: 3, remaining: 3 }, upgrade: null },
      new Date(now - 120_000),
    );
    expect(coach().freeMessages?.remaining).toBe(2);
    coach().applyProfileCoach({ tier: 'member', freeMessages: null, upgrade: null }, new Date(Date.now() + 1_000));
    expect(coach().freeMessages).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('venue documents', () => {
  const sky = venue(2, 'Sky Lagoon', 'sky-lagoon');

  it('resolve to real venue rows ("Book it" opens by slug), under the intro', async () => {
    api.on('GET', '/venues/by-slug/:slug', ({ params }) =>
      params.slug === 'sky-lagoon' ? Reply.ok(venueToApi(sky)) : Reply.problem(404, 'not_found'),
    );
    answer('```json\n{"type":"venues","intro":"A calm evening.","venues":[{"id":"sky-lagoon","name":"Sky Lagoon","location":"Kópavogur"}]}\n```');
    await coach().send('somewhere calm tonight?');
    const last = coach().messages.at(-1)!;
    expect(last.text).toBe('A calm evening.');
    expect(last.venues?.map((row) => row.slug)).toEqual(['sky-lagoon']);
    expect(last.venues?.[0]?.id).toBe(sky.id);
  });

  it('with nothing resolved, a plain list and the nudge, never JSON', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.problem(404, 'not_found'));
    api.on('GET', '/venues', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } }));
    answer('{"type":"venues","intro":"","venues":[{"id":"made-up","name":"Made Up Spa","location":"Nowhere"}]}');
    await coach().send('somewhere calm?');
    expect(texts().at(-1)).toBe(`• Made Up Spa, Nowhere\n\n${en('coach.explore_nudge')}`);
    expect(coach().messages.at(-1)!.venues).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('the chat generation', () => {
  it('a reply still in flight when the chat is reset is dropped', async () => {
    api.on('POST', '/coach', Reply.delayed(80, Reply.ok({ reply: 'late answer' })));
    const sending = coach().send('hello');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(coach().isTyping).toBe(true);
    coach().resetChat();
    expect(coach().isTyping).toBe(false);
    await sending;
    expect(texts()).toEqual([en('coach.greeting')]);
    expect(coach().isTyping).toBe(false);
  });

  it('a flow\'s busy token outlives no reset', () => {
    const token = coachHost().busy();
    expect(coach().isTyping).toBe(true);
    expect(token.isCurrent()).toBe(true);
    coach().resetChat();
    expect(token.isCurrent()).toBe(false);
    useCoachStore.setState({ isTyping: true });
    token.end();
    // The new chat owns the dots now.
    expect(coach().isTyping).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('saved chats (CoachPersistenceTests)', () => {
  it('health turns are not saved (testHealthTurnsAreNotSaved)', async () => {
    seed([
      msg(GREETING_ID, 'assistant', en('coach.greeting')),
      msg('1', 'user', 'where can I swim?'),
      msg('2', 'assistant', 'Here are three pools.'),
      msg('3', 'user', 'Build muscle', { isHealth: true }),
      msg('4', 'assistant', 'Where is the injury?', { isHealth: true }),
    ]);
    coach().resetChat();
    await pendingCoachSaves();

    const saved = coach().savedSessions[0];
    expect(saved).toBeDefined();
    const savedTexts = saved!.messages.map((message) => message.text);
    expect(savedTexts).toContain('where can I swim?');
    expect(savedTexts).not.toContain('Build muscle');
    expect(savedTexts).not.toContain('Where is the injury?');
    // And on disk.
    expect(JSON.stringify(await loadSavedSessions())).not.toContain('Build muscle');
  });

  it('a chat of only health turns is not saved at all (testAChatOfOnlyHealthTurnsIsNotSavedAtAll)', async () => {
    seed([
      msg(GREETING_ID, 'assistant', en('coach.greeting')),
      msg('1', 'user', 'Get a 4-week plan', { isHealth: true }),
      msg('2', 'assistant', 'What is your main goal?', { isHealth: true }),
    ]);
    coach().resetChat();
    await pendingCoachSaves();
    expect(coach().savedSessions).toEqual([]);
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
  });

  it('a health turn never titles a saved session (testAHealthTurnNeverTitlesASavedSession)', () => {
    seed([msg('1', 'user', 'Lose weight', { isHealth: true }), msg('2', 'user', 'any pools nearby?')]);
    coach().resetChat();
    expect(coach().savedSessions[0]?.title).toBe('any pools nearby?');
    expect(selectRecentChats(coach())).toEqual([{ id: coach().savedSessions[0]!.id, title: 'any pools nearby?' }]);
  });

  it('saving the same chat again replaces its entry; three at most', async () => {
    seed([msg('1', 'user', 'first chat')]);
    coach().resetChat();
    for (const title of ['second chat', 'third chat', 'fourth chat']) {
      seed([msg('1', 'user', title)]);
      coach().resetChat();
    }
    await pendingCoachSaves();
    expect(coach().savedSessions.map((entry) => entry.title)).toEqual(['fourth chat', 'third chat', 'second chat']);
    expect((await loadSavedSessions()).map((entry) => entry.title)).toEqual([
      'fourth chat',
      'third chat',
      'second chat',
    ]);
  });

  it('a restore saves the chat on screen first, then rebuilds the text and moves the id counter past it', async () => {
    await writeSavedSessions([
      {
        id: 'saved-1',
        title: 'pools?',
        date: '2026-10-01T10:00:00.000Z',
        messages: [
          { id: GREETING_ID, role: 'assistant', text: en('coach.greeting') },
          { id: '500', role: 'user', text: 'pools?' },
          { id: '501', role: 'assistant', text: 'Three pools.' },
        ],
      },
    ]);
    await coach().loadSessions();
    seed([msg('101', 'user', 'the chat on screen')]);
    useCoachStore.setState({ limitReached: true });

    coach().restoreSession('saved-1');
    expect(texts()).toEqual([en('coach.greeting'), 'pools?', 'Three pools.']);
    expect(coach().currentSessionId).toBe('saved-1');
    expect(coach().limitReached).toBe(false);
    expect(coach().savedSessions.map((entry) => entry.title)).toEqual(['the chat on screen', 'pools?']);
    expect(fake('venueWizard').calls).toContain('reset');

    // A new message never repeats a restored id.
    answer('ok');
    await coach().send('and gyms?');
    const ids = coach().messages.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-2)).toBe('502');
  });

  it('restoring the chat already open does nothing (it would drop its newest turns)', () => {
    seed([msg('1', 'user', 'pools?')]);
    coach().resetChat();
    const id = coach().savedSessions[0]!.id;
    coach().restoreSession(id);
    seed([...coach().messages, msg('900', 'user', 'newest')]);
    coach().restoreSession(id);
    expect(texts()).toContain('newest');
  });

  it('a save made before the stored list was read stays on top of it', async () => {
    await writeSavedSessions([
      { id: 'old', title: 'old chat', date: '2026-09-01T10:00:00.000Z', messages: [{ id: '1', role: 'user', text: 'old chat' }] },
    ]);
    seed([msg('1', 'user', 'new chat')]);
    coach().resetChat();
    await pendingCoachSaves();
    expect(coach().savedSessions.map((entry) => entry.title)).toEqual(['new chat', 'old chat']);
    expect((await loadSavedSessions()).map((entry) => entry.title)).toEqual(['new chat', 'old chat']);
  });
});

// ---------------------------------------------------------------------------

describe('the health lane', () => {
  it('the local wipe removes every health turn and ends the health flows (testTheLocalWipeRemovesHealthMessages)', async () => {
    seed([msg('1', 'user', 'where can I swim?'), msg('2', 'user', 'An injury', { isHealth: true })]);
    await runHealthWipeHooks({ profileId: MEMBER_A, reason: 'withdrawn_elsewhere' });
    expect(coach().messages.filter((message) => message.isHealth)).toHaveLength(0);
    expect(texts()).toContain('where can I swim?');
    expect(fake('program').calls).toContain('healthWiped');
    expect(fake('adjust').calls).toContain('healthWiped');
  });

  it('the wipe leaves a greeting rather than an empty screen (testTheWipeLeavesAGreetingRatherThanAnEmptyScreen)', () => {
    seed([msg('1', 'user', 'Build muscle', { isHealth: true })]);
    coach().dropHealthMessages();
    expect(coach().messages).toHaveLength(1);
    expect(coach().messages[0]!.isHealth).toBeFalsy();
    expect(coach().messages[0]!.id).toBe(GREETING_ID);
  });
});

// ---------------------------------------------------------------------------

describe('taps that start a flow', () => {
  it('a category tile starts the venue wizard under its own localised label, and never calls the model', () => {
    setCurrentLanguage('is');
    coach().startSearch('gyms', 'coach.cat.gyms');
    expect(fake('venueWizard').entries).toEqual([
      { kind: 'category', category: 'gym', userText: lookup('coach.cat.gyms', 'is') },
    ]);
    expect(texts()).toContain(lookup('coach.cat.gyms', 'is'));
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('wellness opens the spa wizard and the lagoon chip the lagoon one; an unknown tile does nothing', () => {
    coach().startSearch('wellness', 'coach.cat.wellness');
    coach().startSearch('lagoon', 'coach.chip.lagoon');
    coach().startSearch('bowling', 'coach.cat.gyms');
    expect(fake('venueWizard').entries.map((entry) => (entry.kind === 'category' ? entry.category : null))).toEqual([
      'spa',
      'lagoon',
    ]);
  });

  it('a tap abandons every open question first, so an old chip cannot answer the new flow', async () => {
    coach().startSearch('pools', 'coach.cat.pools');
    const first = coach().messages.find((message) => message.options)!;
    expect(first.answered).toBeFalsy();
    coach().startSearch('gyms', 'coach.cat.gyms');
    expect(coach().messages.find((message) => message.id === first.id)!.answered).toBe(true);
    for (const id of ['venueWizard', 'dayPlan', 'program', 'adjust'] as const) {
      expect(fake(id).calls).toContain('abandon');
    }
    // The stale chip goes nowhere.
    await coach().selectOption(first.id, 'one', 'One');
    expect(fake('venueWizard').calls).not.toContain(`selectOption:${first.id}:one`);
  });

  it('nothing starts while a reply is in flight', async () => {
    useCoachStore.setState({ isTyping: true });
    coach().startSearch('gyms', 'coach.cat.gyms');
    coach().showCategoryPicker('coach.chip.nearby');
    await coach().startPlan('coach.chip.plan_day');
    await coach().startProgram();
    await coach().startAdjust();
    expect(texts()).toEqual([en('coach.greeting')]);
    for (const id of ['venueWizard', 'dayPlan', 'program', 'adjust'] as const) {
      expect(fake(id).entries).toEqual([]);
    }
  });

  it('"What\'s nearby?" shows the category strip under the member\'s localised bubble', () => {
    coach().showCategoryPicker('coach.chip.nearby');
    const [user, prompt] = coach().messages.slice(-2);
    expect(user).toMatchObject({ role: 'user', text: en('coach.chip.nearby') });
    expect(prompt).toMatchObject({ role: 'assistant', text: en('coach.nearby_prompt'), showCategoryStrip: true });
  });

  it('the full-width chips enter the day plan, the programme and Adjust my plan with their labels', async () => {
    await coach().startPlan('coach.chip.plan_day');
    await coach().startProgram();
    await coach().startAdjust();
    expect(fake('dayPlan').entries).toEqual([{ kind: 'chip', userText: en('coach.chip.plan_day') }]);
    expect(fake('program').entries).toEqual([{ kind: 'chip', userText: en('coach.chip.program') }]);
    expect(fake('adjust').entries).toEqual([{ kind: 'chip', userText: en('coach.chip.adjust_plan') }]);
  });

  it("a chip goes back to the flow that asked, and typed words answer that flow's open question", async () => {
    coach().startSearch('pools', 'coach.cat.pools');
    const question = coach().messages.find((message) => message.options)!;
    await coach().selectOption(question.id, 'two', 'Two');
    expect(fake('venueWizard').calls).toContain(`selectOption:${question.id}:two`);
    expect(coach().messages.find((message) => message.id === question.id)).toMatchObject({
      answered: true,
      selectedAnswer: 'Two',
    });
    // An answered bubble takes no second tap.
    await coach().selectOption(question.id, 'one', 'One');
    expect(fake('venueWizard').calls.filter((call) => call.startsWith('selectOption'))).toHaveLength(1);

    coach().startSearch('gyms', 'coach.cat.gyms');
    await coach().send('the west side');
    expect(fake('venueWizard').calls).toContain('takeTyped:the west side');
    expect(api.sentAll('/coach')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('entries parked by other tabs', () => {
  it('two Home prompts produce two sends', async () => {
    answer((request) => `answer to ${(request.body as { messages: { content: string }[] }).messages.at(-1)!.content}`);
    useIntentStore.getState().parkCoachPrompt('Suggest gym classes I should try this week.');
    await coach().consumeParkedEntries();
    useIntentStore.getState().parkCoachPrompt('Plan a perfect spa evening for me.');
    await coach().consumeParkedEntries();
    expect(coachBodies().map((body) => body.messages.at(-1)!.content)).toEqual([
      'Suggest gym classes I should try this week.',
      'Plan a perfect spa evening for me.',
    ]);
    expect(useIntentStore.getState().pendingCoachPrompt).toBeNull();
    // Consumed once: another appearance sends nothing more.
    await coach().consumeParkedEntries();
    expect(api.sentAll('/coach')).toHaveLength(2);
  });

  it('a parked prompt skips plan and schedule detection: it keeps its historic route', async () => {
    fake('venueWizard').startsOn = (text, options) => !options.detectScheduleQuestion && text.includes('gym');
    fake('dayPlan').startsOn = () => true;
    fake('program').startsOn = () => true;
    useIntentStore.getState().parkCoachPrompt('Suggest gym classes I should try this week.');
    await coach().consumeParkedEntries();
    expect(fake('program').calls).not.toContain('startFrom:Suggest gym classes I should try this week.');
    expect(fake('dayPlan').calls).not.toContain('startFrom:Suggest gym classes I should try this week.');
    expect(fake('venueWizard').startOptions).toEqual([PARKED_SEND]);
    expect(texts()).toContain('venueWizard question');
  });

  it('a parked prompt while a question is open starts fresh rather than answering it', async () => {
    coach().startSearch('pools', 'coach.cat.pools');
    const question = coach().messages.find((message) => message.options)!;
    answer('fresh answer');
    useIntentStore.getState().parkCoachPrompt('what is open late?');
    await coach().consumeParkedEntries();
    expect(fake('venueWizard').calls).not.toContain('takeTyped:what is open late?');
    expect(coach().messages.find((message) => message.id === question.id)!.answered).toBe(true);
    expect(texts().slice(-2)).toEqual(['what is open late?', 'fresh answer']);
  });

  it('a parked prompt waits for a reply in flight instead of being dropped', async () => {
    let count = 0;
    api.on('POST', '/coach', () => {
      count += 1;
      return Reply.delayed(count === 1 ? 250 : 0, Reply.ok({ reply: `reply ${count}` }));
    });
    const first = coach().send('first');
    await new Promise((resolve) => setTimeout(resolve, 20));
    useIntentStore.getState().parkCoachPrompt('from Home');
    await coach().consumeParkedEntries();
    await first;
    expect(texts().slice(1)).toEqual(['first', 'reply 1', 'from Home', 'reply 2']);
  });

  it('a reply that never ends holds a parked prompt at most 10 seconds', async () => {
    jest.useFakeTimers();
    try {
      useCoachStore.setState({ isTyping: true });
      const parked = coach().sendParkedPrompt('from Home');
      await jest.advanceTimersByTimeAsync(10_400);
      await parked;
    } finally {
      jest.useRealTimers();
    }
    expect(texts()).not.toContain('from Home');
    expect(api.sentAll('/coach')).toHaveLength(0);
  });

  it('a parked programme entry starts the programme wizard, and a feedback Adjust starts Adjust my plan', async () => {
    useIntentStore.getState().parkCoachProgram({ kind: 'planTab' });
    await coach().consumeParkedEntries();
    expect(fake('program').entries).toEqual([{ kind: 'parked', entry: { kind: 'planTab' } }]);

    useIntentStore.getState().parkCoachProgram({ kind: 'adjust' });
    await coach().consumeParkedEntries();
    expect(fake('adjust').entries).toEqual([{ kind: 'parked', entry: { kind: 'adjust' } }]);
    expect(useIntentStore.getState().pendingCoachProgram).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('whose chat it is', () => {
  it('sign-out resets the chat, the counts, the locks and every flow, and forgets the saved chats', async () => {
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    seed([msg('1', 'user', 'Pools near Laugardalur?')]);
    coach().resetChat();
    await pendingCoachSaves();
    seed([msg('2', 'user', 'still on screen')]);
    useCoachStore.setState({ limitReached: true, freeMessages: { limit: 3, remaining: 1 } });

    await runSignOutCleaners({ memberId: MEMBER_A });

    expect(texts()).toEqual([en('coach.greeting')]);
    expect(coach().savedSessions).toEqual([]);
    expect(coach().limitReached).toBe(false);
    expect(coach().freeMessages).toBeNull();
    expect(coach().memberId).toBeNull();
    expect(fake('program').calls).toContain('reset');
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
  });

  it("the next account never sees the last one's chat, on screen or in the drawer", async () => {
    await runSignInHooks({ userId: MEMBER_A, restoredSession: false });
    seed([msg('1', 'user', 'Pools near Laugardalur?')]);
    coach().resetChat();
    await pendingCoachSaves();
    seed([msg('2', 'user', 'typed by A')]);

    // B signs in without A signing out (A's session expired).
    await runSignInHooks({ userId: MEMBER_B, restoredSession: false });
    expect(texts()).toEqual([en('coach.greeting')]);
    expect(coach().savedSessions).toEqual([]);
    await coach().loadSessions();
    expect(coach().savedSessions).toEqual([]);
    expect(coach().memberId).toBe(MEMBER_B);
  });

  it('the same member signing in again keeps the chat on screen', async () => {
    coach().signedIn(MEMBER_A);
    seed([msg('1', 'user', 'mine')]);
    coach().signedIn(MEMBER_A.toUpperCase());
    expect(texts()).toEqual(['mine']);
  });
});
