/**
 * `POST /coach` for a free chat (iOS `CoachRequest` / `CoachResponse`): the
 * locale always goes with the messages (the first build sent none, so the
 * reply and the server's privacy notice came back in whatever language the
 * member typed in), and a count this build cannot read never costs the
 * answer it rides on (CoachFreeTierTests
 * testAnAnswerCarriesWhatIsLeftAndAMemberAnswerDoesNot). And the class
 * cards' request half (CoachClassCardsTests): `cards` is asked for, and a
 * server that refuses the key with a 400 gets the plain request once.
 */
import { expectRequestBodyValid } from '@test/contract';
import { api, Reply } from '@test/server';

import { isApiError, isProblem } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { CHAT_CARDS, coachLocale, decodeCoachChatReply, postCoachChat } from '../coachApi';
import { BAD_REQUEST, CARDS_EN, envelope, PLAIN_EN } from './classCardFixtures';

stubApiClientPerTest();

describe('the answer', () => {
  it('carries what is left for a free account, and nothing for a member', () => {
    const free = decodeCoachChatReply({
      reply: 'Try the pool.',
      freeMessages: { limit: 3, remaining: 2, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' },
    });
    expect(free.reply).toBe('Try the pool.');
    expect(free.freeMessages).toEqual({
      limit: 3,
      remaining: 2,
      windowDays: 30,
      resetsAt: new Date('2099-10-10T00:00:00Z'),
    });

    expect(decodeCoachChatReply({ reply: 'Try the pool.' }).freeMessages).toBeNull();
  });

  it('a garbled count leaves the reply readable (fail-soft)', () => {
    expect(decodeCoachChatReply({ reply: 'Hi.', freeMessages: [1, 2] })).toEqual({ reply: 'Hi.', freeMessages: null, classes: [] });
    expect(decodeCoachChatReply({ reply: 'Hi.', freeMessages: { limit: 'three' } })).toEqual({
      reply: 'Hi.',
      freeMessages: null,
      classes: [],
    });
  });

  it('a missing or wrong-typed reply reads as empty (the store says the Coach is unavailable)', () => {
    expect(decodeCoachChatReply({}).reply).toBe('');
    expect(decodeCoachChatReply({ reply: 7 }).reply).toBe('');
    expect(decodeCoachChatReply(null).reply).toBe('');
  });
});

describe('the request', () => {
  it('Icelandic is "is", anything else "en"', () => {
    expect(coachLocale('is')).toBe('is');
    expect(coachLocale('en')).toBe('en');
    expect(coachLocale('de')).toBe('en');
  });

  it('sends the locale with the messages, and matches the contract', async () => {
    api.on('POST', '/coach', Reply.ok({ reply: 'Laugardalslaug is open until 22.' }));
    const reply = await postCoachChat('is', [
      { role: 'assistant', content: 'Hæ!' },
      { role: 'user', content: 'Hvar get ég synt í kvöld?' },
    ]);
    expect(reply).toEqual({ reply: 'Laugardalslaug is open until 22.', freeMessages: null, classes: [], cardsRefused: false });
    // The body against the contract. The operation also lists an
    // Idempotency-Key, which only its programme build reads
    // (docs/12_COACH.md); a free chat sends none, as iOS sends none.
    const sent = api.sent('/coach', 'POST');
    expectRequestBodyValid('POST', '/coach', sent.body);
    expect(sent.headers['idempotency-key']).toBeUndefined();
    expect(sent.body).toEqual({
      locale: 'is',
      messages: [
        { role: 'assistant', content: 'Hæ!' },
        { role: 'user', content: 'Hvar get ég synt í kvöld?' },
      ],
    });
    expect(sent.headers.authorization).toBe('Bearer test-token');
  });

  it('a free-limit refusal arrives as a problem with its count and the way on', async () => {
    api.on(
      'POST',
      '/coach',
      Reply.problem(429, 'coach-free-limit', {
        title: 'coach_free_limit',
        detail: 'You have used your 3 free Coach messages. Want to keep going?',
        freeMessages: { limit: 3, remaining: 0, windowDays: 30, resetsAt: '2099-10-10T00:00:00Z' },
        upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
      }),
    );
    const error: unknown = await postCoachChat('en', [{ role: 'user', content: 'hi' }]).catch((caught: unknown) => caught);
    expect(isProblem(error, 'coach-free-limit')).toBe(true);
    if (!isApiError(error)) throw new Error('expected an API error');
    expect(error.status).toBe(429);
    expect(error.freeMessages?.remaining).toBe(0);
    expect(error.upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/plans' });
  });
});

describe('class cards (API 0.36.0)', () => {
  const ask = [{ role: 'user' as const, content: 'Are there any classes in Akureyri today?' }];
  const bodies = () => api.sentAll('/coach', 'POST').map((request) => request.body as Record<string, unknown>);

  it('asks for them, within the contract, and reads them (testTheChatAsksForClassCardsAndShowsThem)', async () => {
    api.on('POST', '/coach', Reply.json(200, envelope(CARDS_EN)));
    const reply = await postCoachChat('en', ask, { cards: true });
    expect(bodies()).toHaveLength(1);
    const body = bodies()[0]!;
    expect(Object.keys(body).sort()).toEqual(['cards', 'locale', 'messages']);
    expect(body.cards).toEqual(['classes']);
    expect(CHAT_CARDS).toEqual(['classes']);
    expectRequestBodyValid('POST', '/coach', body);
    expect(reply.classes.map((session) => session.title)).toEqual(['HOT FIT', 'Spinning', 'Yoga Flow', 'Sauna ritual']);
    expect(reply.cardsRefused).toBe(false);
  });

  it('an older server just answers in text: nothing is retried (testAnOlderServerJustAnswersInText)', async () => {
    api.on('POST', '/coach', Reply.json(200, envelope(PLAIN_EN)));
    const reply = await postCoachChat('en', ask, { cards: true });
    expect(bodies()).toHaveLength(1);
    expect(reply.reply).toBe('Today in Akureyri:\n• 12:10-13:10 HOT FIT, Nordur Akureyri');
    expect(reply.classes).toEqual([]);
    expect(reply.cardsRefused).toBe(false);
  });

  it('a server that refuses the key gets the plain request once (testAServerThatRefusesTheKeyGetsThePlainRequestOnce)', async () => {
    api.on('POST', '/coach', (request) =>
      (request.body as Record<string, unknown>).cards !== undefined
        ? Reply.json(400, JSON.parse(BAD_REQUEST), { 'content-type': 'application/problem+json' })
        : Reply.json(200, envelope(PLAIN_EN)),
    );
    const reply = await postCoachChat('en', ask, { cards: true });
    const [first, retry] = bodies();
    expect(bodies()).toHaveLength(2);
    expect(first!.cards).toEqual(['classes']);
    // The retry is exactly what a build without cards sends.
    expect(Object.keys(retry!).sort()).toEqual(['locale', 'messages']);
    expect(retry!.messages).toEqual(first!.messages);
    expect(reply.reply).toBe('Today in Akureyri:\n• 12:10-13:10 HOT FIT, Nordur Akureyri');
    expect(reply.cardsRefused).toBe(true);
  });

  it("a 400 the plain request also gets is the real error (testA400ThePlainRequestAlsoGetsIsShownAndTheKeyStays)", async () => {
    api.on('POST', '/coach', Reply.json(400, JSON.parse(BAD_REQUEST), { 'content-type': 'application/problem+json' }));
    const error: unknown = await postCoachChat('en', ask, { cards: true }).catch((caught: unknown) => caught);
    expect(bodies()).toHaveLength(2);
    if (!isApiError(error)) throw new Error('expected an API error');
    expect(error.status).toBe(400);
    expect(error.messageIn('en')).toBe('The coach request payload is invalid.');
  });

  it.each([
    [429, 'coach-daily-limit'],
    [500, 'internal_error'],
    [503, 'coach-busy'],
  ])('a %s is not about the new key: never retried (testOtherRefusalsAreNeverRetried)', async (status, slug) => {
    api.on('POST', '/coach', Reply.problem(status, slug));
    const error: unknown = await postCoachChat('en', ask, { cards: true }).catch((caught: unknown) => caught);
    expect(isProblem(error, slug)).toBe(true);
    expect(bodies()).toHaveLength(1);
  });

  it('a session that stopped asking sends the plain body only', async () => {
    api.on('POST', '/coach', Reply.json(200, envelope(PLAIN_EN)));
    await postCoachChat('en', ask, { cards: false });
    expect(bodies()[0]).not.toHaveProperty('cards');
  });
});
