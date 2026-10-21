/**
 * `POST /coach` for a free chat (iOS `CoachRequest` / `CoachResponse`): the
 * locale always goes with the messages (the first build sent none, so the
 * reply and the server's privacy notice came back in whatever language the
 * member typed in), and a count this build cannot read never costs the
 * answer it rides on (CoachFreeTierTests
 * testAnAnswerCarriesWhatIsLeftAndAMemberAnswerDoesNot).
 */
import { expectRequestBodyValid } from '@test/contract';
import { api, Reply } from '@test/server';

import { isApiError, isProblem } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { coachLocale, decodeCoachChatReply, postCoachChat } from '../coachApi';

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
    expect(decodeCoachChatReply({ reply: 'Hi.', freeMessages: [1, 2] })).toEqual({ reply: 'Hi.', freeMessages: null });
    expect(decodeCoachChatReply({ reply: 'Hi.', freeMessages: { limit: 'three' } })).toEqual({
      reply: 'Hi.',
      freeMessages: null,
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
    expect(reply).toEqual({ reply: 'Laugardalslaug is open until 22.', freeMessages: null });
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
