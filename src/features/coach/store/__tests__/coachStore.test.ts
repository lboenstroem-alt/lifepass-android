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
 * one's chat, and two Home prompts produce two sends. And the chat path of
 * CoachClassCardsTests: what the chat sends, what it shows, and how it
 * behaves against a server that has never heard of cards, including one
 * that refuses the new key outright.
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
import { claimCoachForMember } from '../../register';
import {
  COACH_SESSIONS_KEY,
  COACH_SESSIONS_OWNER_KEY,
  loadSavedSessions,
  writeSavedSessions,
} from '../../persistence/sessions';
import { INITIAL_FREE_TIER } from '../../freeTier/freeTier';
import { BAD_REQUEST, CARDS_EN, envelope, PLAIN_EN } from '../../chat/__tests__/classCardFixtures';
import {
  coachSendsClassCards,
  PARKED_SEND,
  pendingCoachSaves,
  resetCoachStoreForTests,
  selectIsAILocked,
  selectRecentChats,
  TYPED_SEND,
  useCoachStore,
} from '../coachStore';
import { coachHost } from '../host';
import { GREETING_ID, isReportableReply, type CoachMessage } from '../messages';
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
  readonly cards?: readonly string[];
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

/**
 * Holds every read of the saved chats until `release` (the claim's read of
 * the owner key goes through), so a test can land a read where it wants.
 */
function holdSessionReads() {
  // The storage mock's getItem is already a jest.fn: swap its body, then put it back.
  const getItem = jest.mocked(AsyncStorage.getItem);
  const original = getItem.getMockImplementation()!;
  const held: (() => void)[] = [];
  getItem.mockImplementation(async (key: string, ...rest) => {
    if (key === COACH_SESSIONS_KEY) await new Promise<void>((resolve) => held.push(resolve));
    return original(key, ...rest);
  });
  return {
    get waiting() {
      return held.length;
    },
    release() {
      for (const resolve of held.splice(0)) resolve();
    },
    restore() {
      this.release();
      getItem.mockImplementation(original);
    },
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

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
        // A free chat asks for class cards (API 0.36.0).
        cards: ['classes'],
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

  it('an active programme with no question open takes the words: they never reach another flow or the model', async () => {
    answer('should not be asked');
    fake('program').active = true;
    fake('program').takesTyped = false;
    fake('venueWizard').startsOn = () => true;
    fake('dayPlan').startsOn = () => true;
    await coach().send('my knee hurts');
    expect(fake('program').calls).toContain('takeTyped:my knee hurts');
    expect(fake('venueWizard').calls).toEqual([]);
    expect(fake('dayPlan').calls).toEqual([]);
    expect(api.sentAll('/coach')).toHaveLength(0);
    expect(texts()).not.toContain('my knee hurts');
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

describe('class cards (CoachClassCardsTests, the chat path)', () => {
  const ask = 'Are there any classes in Akureyri today?';
  const cardsReply = 'Here are classes in Akureyri today. Tap one to book.';
  const plainReply = 'Today in Akureyri:\n• 12:10-13:10 HOT FIT, Nordur Akureyri';
  const badRequest = () => Reply.json(400, JSON.parse(BAD_REQUEST), { 'content-type': 'application/problem+json' });
  const serve = (json: string) => api.on('POST', '/coach', Reply.json(200, envelope(json)));
  const last = () => coach().messages.at(-1)!;

  it('the chat asks for class cards and shows them under the reply (testTheChatAsksForClassCardsAndShowsThem)', async () => {
    serve(CARDS_EN);
    await coach().send(ask);
    expect(coachBodies()).toHaveLength(1);
    expect(Object.keys(coachBodies()[0]!).sort()).toEqual(['cards', 'locale', 'messages']);
    expect(coachBodies()[0]!.cards).toEqual(['classes']);
    expect(coachBodies()[0]!.messages.at(-1)!.content).toBe(ask);

    expect(last().role).toBe('assistant');
    // The short reply still shows.
    expect(last().text).toBe(cardsReply);
    expect(last().classCards?.map((session) => session.title)).toEqual(['HOT FIT', 'Spinning', 'Yoga Flow', 'Sauna ritual']);
    expect(last().classCardsHidden).toBeFalsy();
    // Up to six cards are taller than the screen: the chat lands on the reply's top.
    expect(last().anchorTop).toBe(true);
    expect(coachSendsClassCards()).toBe(true);
  });

  it("a follow-up carries the card turn's words (testAFollowUpCarriesTheCardTurnsWords)", async () => {
    serve(CARDS_EN);
    await coach().send(ask);
    await coach().send('Which one would you recommend?');
    expect(coachBodies().at(-1)!.messages.slice(-3).map((message) => message.content)).toEqual([
      ask,
      cardsReply,
      'Which one would you recommend?',
    ]);
  });

  it('an older server just answers in text (testAnOlderServerJustAnswersInText)', async () => {
    serve(PLAIN_EN);
    await coach().send(ask);
    expect(coachBodies()).toHaveLength(1);
    expect(last().text).toBe(plainReply);
    expect(last().classCards).toBeUndefined();
    expect(last().anchorTop).toBeUndefined();
  });

  it('a server that refuses the key gets the plain request once, then no more (testAServerThatRefusesTheKeyGetsThePlainRequestOnceThenNoMore)', async () => {
    api.on('POST', '/coach', (request) =>
      (request.body as CoachBody).cards !== undefined ? badRequest() : Reply.json(200, envelope(PLAIN_EN)),
    );
    await coach().send(ask);
    expect(coachBodies()).toHaveLength(2);
    expect(coachBodies()[0]!.cards).toEqual(['classes']);
    expect(Object.keys(coachBodies()[1]!).sort()).toEqual(['locale', 'messages']);
    expect(coachBodies()[1]!.messages).toEqual(coachBodies()[0]!.messages);
    expect(last().text).toBe(plainReply);
    expect(coachSendsClassCards()).toBe(false);

    await coach().send('And tomorrow?');
    // One request per turn from now on, New chat or not.
    expect(coachBodies()).toHaveLength(3);
    expect(coachBodies()[2]).not.toHaveProperty('cards');
    coach().resetChat();
    await coach().send('And Sunday?');
    expect(coachBodies()).toHaveLength(4);
    expect(coachBodies()[3]).not.toHaveProperty('cards');

    // The next account asks again (iOS builds a new view model).
    await runSignOutCleaners({ memberId: MEMBER_A });
    expect(coachSendsClassCards()).toBe(true);
  });

  it('a 400 the plain request also gets is shown, and the key stays (testA400ThePlainRequestAlsoGetsIsShownAndTheKeyStays)', async () => {
    api.on('POST', '/coach', badRequest());
    await coach().send(ask);
    // Retried once, never more.
    expect(coachBodies()).toHaveLength(2);
    expect(last().role).toBe('assistant');
    expect(last().text).toBe('The coach request payload is invalid.');
    expect(last().classCards).toBeUndefined();
    // The key was not the problem.
    expect(coachSendsClassCards()).toBe(true);
  });

  it.each([
    [429, 'coach-daily-limit'],
    [500, 'internal_error'],
    [503, 'coach-busy'],
  ])('a %s is never retried (testOtherRefusalsAreNeverRetried)', async (status, slug) => {
    api.on('POST', '/coach', Reply.problem(status, slug));
    await coach().send(ask);
    expect(coachBodies()).toHaveLength(1);
    expect(coachSendsClassCards()).toBe(true);
    expect(last().classCards).toBeUndefined();
  });

  it('cards with no words still get a line above them (testCardsWithNoWordsStillGetALineAboveThem)', async () => {
    serve(CARDS_EN.replace(cardsReply, ' '));
    await coach().send(ask);
    expect(last().text).toBe(en('coach.classes.intro'));
    expect(last().classCards).toHaveLength(4);
  });

  it('the list closes and comes back, keeping its cards (testTheListClosesAndComesBack)', async () => {
    serve(CARDS_EN);
    await coach().send(ask);
    const id = last().id;
    coach().setClassCardsHidden(true, id);
    expect(last().classCardsHidden).toBe(true);
    expect(last().classCards).toHaveLength(4);
    coach().setClassCardsHidden(false, id);
    expect(last().classCardsHidden).toBe(false);
    // A message without cards is left alone.
    const before = coach().messages;
    coach().setClassCardsHidden(true, GREETING_ID);
    expect(coach().messages).toBe(before);
  });

  it('a chat reopened from the drawer keeps its class cards (testAChatReopenedFromTheDrawerKeepsItsClassCards)', async () => {
    await claimCoachForMember(MEMBER_A, false);
    serve(CARDS_EN);
    await coach().send(ask);
    const shown = last().classCards;
    coach().resetChat();
    await pendingCoachSaves();

    // A later launch reads the saved chats from disk.
    resetCoachStoreForTests();
    await claimCoachForMember(MEMBER_A, false);
    await coach().loadSessions();
    const saved = coach().savedSessions[0]!;
    coach().restoreSession(saved.id);
    const restored = last();
    expect(restored.text).toBe(cardsReply);
    // Field for field, booking handles included.
    expect(restored.classCards).toEqual(shown);
    expect(restored.classCards?.map((session) => session.status)).toEqual(['open', 'full', 'opens_later', 'open']);
    expect(restored.classCards?.[3]?.booking?.slotEndsAt).toEqual(new Date('2026-10-13T20:00:00Z'));
    expect(coach().messages.find((message) => message.role === 'user')?.classCards).toBeUndefined();
    // Restoring asks nothing.
    expect(coachBodies()).toHaveLength(1);
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

describe('which bubbles are the model\'s own words ("Report this reply", Android COACH-7)', () => {
  const last = () => coach().messages.at(-1)!;
  const reportable = () => coach().messages.filter(isReportableReply).map((message) => message.text);

  it('marks the model\'s prose answer, never the greeting or the member\'s turn', async () => {
    answer('Laugardalslaug is open until 22.');
    await coach().send('where can I swim tonight?');
    expect(last().aiReply).toBe(true);
    expect(coach().messages.filter((message) => message.aiReply).map((message) => message.text)).toEqual([
      'Laugardalslaug is open until 22.',
    ]);
    expect(reportable()).toEqual(['Laugardalslaug is open until 22.']);
  });

  it('marks a class answer\'s reply', async () => {
    api.on('POST', '/coach', Reply.json(200, envelope(CARDS_EN)));
    await coach().send('Are there any classes in Akureyri today?');
    expect(last().classCards?.length).toBeGreaterThan(0);
    expect(last().aiReply).toBe(true);
  });

  it('never marks the app\'s own words: an empty answer\'s apology, a limit, a busy server, an error', async () => {
    answer('   ');
    await coach().send('hello');
    expect(last().text).toBe(en('coach.ai_unavailable'));
    expect(last().aiReply).toBeUndefined();

    api.on('POST', '/coach', Reply.problem(503, 'coach-busy'));
    await coach().send('hello again');
    expect(last().text).toBe(en('coach.busy'));
    expect(last().aiReply).toBeUndefined();

    api.on('POST', '/coach', Reply.problem(500, 'internal_error'));
    await coach().send('and again');
    expect(last().aiReply).toBeUndefined();

    api.on('POST', '/coach', Reply.problem(429, 'coach-daily-limit', { detail: "You have used all of today's coach messages." }));
    await coach().send('one more');
    expect(last().aiReply).toBeUndefined();
    expect(reportable()).toEqual([]);
  });

  it('marks a venue answer\'s own intro, not the app\'s fallback intro', async () => {
    const sky = venue(2, 'Sky Lagoon', 'sky-lagoon');
    api.on('GET', '/venues/by-slug/:slug', Reply.ok(venueToApi(sky)));
    answer('{"type":"venues","intro":"A calm evening.","venues":[{"id":"sky-lagoon","name":"Sky Lagoon"}]}');
    await coach().send('somewhere calm tonight?');
    expect(last().text).toBe('A calm evening.');
    expect(last().aiReply).toBe(true);

    answer('{"type":"venues","intro":"","venues":[{"id":"sky-lagoon","name":"Sky Lagoon"}]}');
    await coach().send('and another?');
    expect(last().text).toBe(en('coach.explore_fallback'));
    expect(last().aiReply).toBeUndefined();
  });

  it('marks a venue answer read as a list when it names a place, not the bare fallback', async () => {
    api.on('GET', '/venues/by-slug/:slug', Reply.problem(404, 'not_found'));
    api.on('GET', '/venues', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } }));
    answer('{"type":"venues","intro":"","venues":[{"id":"made-up","name":"Made Up Spa"}]}');
    await coach().send('somewhere calm?');
    expect(last().aiReply).toBe(true);

    answer('{"type":"venues","intro":"","venues":[]}');
    await coach().send('anything?');
    expect(last().text).toBe(en('coach.explore_fallback'));
    expect(last().aiReply).toBeUndefined();
  });

  it('a saved chat keeps the mark, so a reopened reply can still be reported', async () => {
    await claimCoachForMember(MEMBER_A, false);
    answer('Three pools.');
    await coach().send('pools?');
    const sessionId = coach().currentSessionId;
    coach().resetChat();
    await pendingCoachSaves();
    const stored = (await loadSavedSessions())[0]!;
    expect(stored.messages.map((message) => message.aiReply ?? false)).toEqual([false, false, true]);

    coach().restoreSession(sessionId ?? stored.id);
    expect(reportable()).toEqual(['Three pools.']);
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
    await claimCoachForMember(MEMBER_A, false);
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
    await claimCoachForMember(MEMBER_A, false);
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
    await claimCoachForMember(MEMBER_A, false);
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
    await AsyncStorage.setItem(COACH_SESSIONS_OWNER_KEY, MEMBER_A);
    await claimCoachForMember(MEMBER_A, false);
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
    await AsyncStorage.setItem(COACH_SESSIONS_OWNER_KEY, MEMBER_A);
    const reads = holdSessionReads();
    try {
      await claimCoachForMember(MEMBER_A, false);
      // The claim's read of the list is still on its way.
      expect(reads.waiting).toBe(1);
      seed([msg('1', 'user', 'new chat')]);
      coach().resetChat();
      reads.release();
      await pendingCoachSaves();
    } finally {
      reads.restore();
    }
    expect(coach().savedSessions.map((entry) => entry.title)).toEqual(['new chat', 'old chat']);
    expect((await loadSavedSessions()).map((entry) => entry.title)).toEqual(['new chat', 'old chat']);
  });

  it('nothing is read or written before the sign-in has claimed the chats', async () => {
    await writeSavedSessions([
      { id: 'theirs', title: 'not yours', date: '2026-09-01T10:00:00.000Z', messages: [{ id: '1', role: 'user', text: 'not yours' }] },
    ]);
    await coach().loadSessions();
    expect(coach().savedSessions).toEqual([]);
    expect(coach().sessionsLoaded).toBe(false);
    seed([msg('1', 'user', 'typed before any claim')]);
    coach().resetChat();
    await pendingCoachSaves();
    expect((await loadSavedSessions()).map((entry) => entry.title)).toEqual(['not yours']);
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

  it('two prompts waiting behind one reply go one after the other, even while the flows take their time', async () => {
    let count = 0;
    api.on('POST', '/coach', () => {
      count += 1;
      return Reply.delayed(count === 1 ? 100 : 0, Reply.ok({ reply: `reply ${count}` }));
    });
    // The flows look at every send for a while before passing (no isTyping yet).
    fake('venueWizard').startFrom = async (text: string) => {
      fake('venueWizard').calls.push(`startFrom:${text}`);
      await tick(250);
      return false;
    };
    const first = coach().send('first');
    await tick(10);
    useIntentStore.getState().parkCoachPrompt('prompt one');
    const one = coach().consumeParkedEntries();
    await tick(10);
    useIntentStore.getState().parkCoachPrompt('prompt two');
    const two = coach().consumeParkedEntries();
    await Promise.all([first, one, two]);
    const after = texts().slice(1);
    expect(after.slice(0, 2)).toEqual(['first', 'reply 1']);
    // Each prompt is followed by its own answer: never two in flight.
    expect([after[2], after[4]].sort()).toEqual(['prompt one', 'prompt two']);
    expect(after[3]).toBe('reply 2');
    expect(after[5]).toBe('reply 3');
    expect(api.sentAll('/coach')).toHaveLength(3);
  }, 15_000);

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

  it('the same member signing in again keeps the chat on screen and the recents', async () => {
    await claimCoachForMember(MEMBER_A, false);
    seed([msg('1', 'user', 'mine')]);
    coach().resetChat();
    await pendingCoachSaves();
    seed([msg('2', 'user', 'on screen')]);
    await claimCoachForMember(MEMBER_A.toUpperCase(), true);
    expect(texts()).toEqual(['on screen']);
    expect(coach().savedSessions.map((entry) => entry.title)).toEqual(['mine']);
  });

  it("a read that lands before the claim removed the last member's chats never reaches the drawer", async () => {
    await claimCoachForMember(MEMBER_A, false);
    seed([msg('1', 'user', "A's chat")]);
    coach().resetChat();
    await pendingCoachSaves();
    // A's list is being read again (it was forgotten on screen) when B signs in.
    useCoachStore.setState({ savedSessions: [], sessionsLoaded: false });
    const reads = holdSessionReads();
    try {
      const loadingForA = coach().loadSessions();
      expect(reads.waiting).toBe(1);
      // B, with the tabs still mounted: the screen asks for the recents at
      // once, as the first build's did on the user id.
      const claim = claimCoachForMember(MEMBER_B, false);
      const early = coach().loadSessions();
      reads.release();
      await Promise.all([loadingForA, early]);
      expect(coach().savedSessions).toEqual([]);
      await claim;
      reads.release();
      await coach().loadSessions();
    } finally {
      reads.restore();
    }
    expect(coach().savedSessions).toEqual([]);
    expect(coach().memberId).toBe(MEMBER_B);
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
  });

  it('a claim that fails deletes the chats rather than guess whose they are', async () => {
    await claimCoachForMember(MEMBER_A, false);
    seed([msg('1', 'user', "A's chat")]);
    coach().resetChat();
    await pendingCoachSaves();
    // The claim's read of the owner key fails (used once, then the mock reads again).
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    await claimCoachForMember(MEMBER_B, false);
    await coach().loadSessions();
    expect(coach().savedSessions).toEqual([]);
    expect(await AsyncStorage.getItem(COACH_SESSIONS_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY)).toBe(MEMBER_B);
  });

  it("a reply still in flight at sign-out brings the next member none of the last one's counts", async () => {
    api.on(
      'POST',
      '/coach',
      Reply.delayed(80, Reply.ok({ reply: 'late', freeMessages: { limit: 3, remaining: 0, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' } })),
    );
    await claimCoachForMember(MEMBER_A, false);
    const sending = coach().send('hello');
    await tick(10);
    await runSignOutCleaners({ memberId: MEMBER_A });
    await sending;
    expect(texts()).toEqual([en('coach.greeting')]);
    expect({
      limitReached: coach().limitReached,
      freeMessages: coach().freeMessages,
      freeLimitReached: coach().freeLimitReached,
      upgrade: coach().upgrade,
      freeCountHeardAt: coach().freeCountHeardAt,
    }).toEqual(INITIAL_FREE_TIER);
    expect(coach().isTyping).toBe(false);
  });

  it('a daily-limit refusal still in flight at sign-out locks nobody', async () => {
    api.on(
      'POST',
      '/coach',
      Reply.delayed(80, Reply.problem(429, 'coach-daily-limit', { detail: "You have used all of today's coach messages." })),
    );
    await claimCoachForMember(MEMBER_A, false);
    const sending = coach().send('hello');
    await tick(10);
    await runSignOutCleaners({ memberId: MEMBER_A });
    await sending;
    await claimCoachForMember(MEMBER_B, false);
    expect(coach().limitReached).toBe(false);
    expect(selectIsAILocked(coach())).toBe(false);
    expect(texts()).toEqual([en('coach.greeting')]);
  });

  it("a flow's counts after a sign-out are dropped too (the busy token's account)", async () => {
    const token = coachHost().busy();
    await runSignOutCleaners({ memberId: MEMBER_A });
    coachHost().recordFreeMessages({ limit: 3, remaining: 0 }, token);
    expect(coach().freeMessages).toBeNull();
    expect(token.isCurrent()).toBe(false);
    expect(token.sameAccount()).toBe(false);
  });

  it("a parked prompt waiting at sign-out is the last member's: it is never sent", async () => {
    answer('reply');
    useCoachStore.setState({ isTyping: true });
    useIntentStore.getState().parkCoachPrompt('from Home');
    const parked = coach().consumeParkedEntries();
    await tick(10);
    await runSignOutCleaners({ memberId: MEMBER_A });
    await parked;
    expect(texts()).toEqual([en('coach.greeting')]);
    expect(api.sentAll('/coach')).toHaveLength(0);
  });
});
