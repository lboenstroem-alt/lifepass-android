/**
 * The client against the vendored 0.34.0 contract: every success answer the
 * contract documents comes back unwrapped, every problem shape it documents
 * decodes into the error model, and what the client sends passes the
 * contract's request checks. Also holds the generated types to the contract.
 */
import {
  allOperations,
  contractVersion,
  requestBodySchema,
  sampleFromSchema,
  sampleSchema,
  validateSchema,
} from '@test/contract';
import { api, Reply } from '@test/server';

import type { ApiBody, ApiData, ApiPathParams, ApiQuery, ApiSchema } from '../contract';
import { decodeProblemDetails, ProblemError } from '../errors';
import { newIdempotencyKey } from '../idempotency';
import { createStubApiClient, expectSentToMatchContract, replyFromContract } from '../testing';

/** Compile-time equality: `expectType<A, B>(true)` only compiles when A and B are the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<A, B>(equal: Equal<A, B>): void {
  expect(equal).toBe(true);
}

const fill = (template: string) => template.replace(/\{[^}]+\}/g, 'x1');

it('is the 0.34.0 contract', () => {
  expect(contractVersion()).toBe('0.34.0');
});

describe('generated types', () => {
  it('reads data, bodies, queries and path parameters from the contract', () => {
    expectType<ApiData<'/profile', 'get'>, ApiSchema<'Profile'>>(true);
    expectType<ApiBody<'/profile/locale', 'post'>, { locale: 'en' | 'is' }>(true);
    expectType<ApiPathParams<'/venues/{venueId}/reviews', 'get'>['venueId'], string>(true);
    const query: ApiQuery<'/attractions', 'get'> = { locale: 'is' };
    expect(query.locale).toBe('is');
  });
});

describe('answers', () => {
  it('every documented GET answer comes back unwrapped, minimal and full', async () => {
    const { client } = createStubApiClient();
    const gets = allOperations().filter((op) => op.method === 'GET');
    expect(gets.length).toBeGreaterThan(30);
    let checked = 0;
    for (const op of gets) {
      const status = [200, 201].find((s) => op.operation.responses?.[String(s)]);
      if (!status) continue;
      for (const mode of ['minimal', 'full'] as const) {
        let reply;
        try {
          reply = replyFromContract('GET', fill(op.template), status, mode);
        } catch {
          continue; // a non-JSON answer (none today)
        }
        api.reset();
        api.on('GET', fill(op.template), reply);
        const data = await client.get(fill(op.template));
        expect([op.template, data]).toEqual([op.template, JSON.parse(reply.kind === 'http' ? reply.body! : 'null').data]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('problems', () => {
  it('every problem schema in the contract decodes into the error model', () => {
    for (const name of [
      'Problem',
      'ChargeConsentProblem',
      'CoachFreeLimitProblem',
      'HealthAccessProblem',
      'HealthReasonProblem',
    ] as const) {
      for (const mode of ['minimal', 'full'] as const) {
        const body = sampleSchema(name, mode) as Record<string, unknown>;
        expect(validateSchema(name, body).valid).toBe(true);
        const details = decodeProblemDetails(body, 409);
        expect([name, mode, details === null]).toEqual([name, mode, false]);
      }
    }
  });

  it('keeps what each extension carries', () => {
    const consent = decodeProblemDetails(sampleSchema('ChargeConsentProblem', 'full'), 402)!;
    const offer = sampleSchema('ChargeConsentOffer', 'full') as Record<string, unknown>;
    expect(consent.offer).toMatchObject({ kind: offer.kind, amountIsk: offer.amountIsk, lane: offer.lane, reason: offer.reason });
    expect(consent.offer?.party).toBeDefined();

    const coach = decodeProblemDetails(sampleSchema('CoachFreeLimitProblem', 'full'), 429)!;
    expect(coach.freeMessages).toBeDefined();
    expect(coach.upgrade).toBeDefined();

    const reason = decodeProblemDetails(sampleSchema('HealthReasonProblem', 'full'), 409)!;
    expect(typeof reason.reason).toBe('string');

    const access = decodeProblemDetails(sampleSchema('HealthAccessProblem', 'full'), 403)!;
    expect(typeof access.memberPricing).toBe('string');
  });

  it('a documented 402 arrives as a ProblemError with its offer', async () => {
    const body = {
      ...(sampleSchema('ChargeConsentProblem', 'full') as { offer: { amountIsk: number } }),
      type: 'https://lifepass.is/problems/charge_consent_required',
      status: 402,
    };
    api.on('POST', '/bookings', Reply.json(402, body, { 'content-type': 'application/problem+json' }));
    const { client } = createStubApiClient();
    const error = await client.post('/bookings', {}, { idempotencyKey: newIdempotencyKey() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).isProblem('charge_consent_required')).toBe(true);
    expect((error as ProblemError).offer?.amountIsk).toBe(body.offer.amountIsk);
  });
});

describe('requests', () => {
  it('a write sent through the client passes the contract, key included', async () => {
    const { client } = createStubApiClient();
    const sample = sampleFromSchema(requestBodySchema('POST', '/bookings')!, 'minimal');
    api.on('POST', '/bookings', replyFromContract('POST', '/bookings', 201));
    await client.post('/bookings', sample, { idempotencyKey: newIdempotencyKey() });
    expectSentToMatchContract('POST', '/bookings');
  });

  it('a body the contract refuses fails the check', async () => {
    const { client } = createStubApiClient();
    api.on('POST', '/profile/locale', Reply.ok({ locale: 'de' }));
    await client.post('/profile/locale', { locale: 'de' });
    expect(() => expectSentToMatchContract('POST', '/profile/locale')).toThrow();
  });
});
