/**
 * The contract harness itself: lookups, request checks (the iOS
 * ContractFixtureTests key-set and header assertions, now driven by the
 * contract), response checks, and the sample builder for every operation.
 */
import { api, Reply, TEST_API_BASE } from '@test/server';

import {
  allOperations,
  contractPath,
  contractVersion,
  declaresIdempotencyKey,
  expectRequestValid,
  findOperation,
  requestBodyKeys,
  responseSchema,
  sampleResponse,
  sampleSchema,
  validateRequest,
  validateRequestBody,
  validateResponseData,
  validateSchema,
  withoutKey,
  withValue,
} from '..';

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';
const ACTIVITY = '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34';

describe('the vendored contract', () => {
  it('is LifePass Mobile API 0.46.0, without prose', () => {
    expect(contractVersion()).toBe('0.46.0');
    const operations = allOperations();
    expect(operations.length).toBeGreaterThan(100);
    // Stripped by scripts/vendor-openapi.mjs: the repo is public.
    for (const op of operations) {
      expect(op.operation).not.toHaveProperty('description');
      expect(op.operation).not.toHaveProperty('summary');
    }
  });
});

describe('finding an operation', () => {
  it('normalises full URLs, the /api/v1 prefix and query strings', () => {
    expect(contractPath(`${TEST_API_BASE}/venues/map?x=1`)).toBe('/venues/map');
    expect(contractPath('/api/v1/profile/')).toBe('/profile');
  });

  it('prefers a literal segment over a template one', () => {
    expect(findOperation('GET', '/venues/map')?.template).toBe('/venues/map');
    expect(findOperation('GET', `/venues/by-slug/sky-lagoon`)?.template).toBe('/venues/by-slug/{slug}');
    const reviews = findOperation('GET', `/venues/${VENUE}/reviews`);
    expect(reviews?.template).toBe('/venues/{venueId}/reviews');
    expect(reviews?.pathParams).toEqual({ venueId: VENUE });
  });

  it('knows what is not in the contract', () => {
    expect(findOperation('GET', '/credits/wallet')).toBeNull();
    expect(findOperation('PUT', '/profile')).toBeNull();
  });
});

describe('request bodies (iOS ContractFixtureTests, by contract)', () => {
  it('lists the walk-in body keys', () => {
    expect(requestBodyKeys('POST', '/check-ins/walk-in')).toEqual({
      properties: ['acceptCharge', 'acceptedChargeAmountIsk', 'activityId', 'bookingAction', 'guestAgeBands', 'venueId'],
      required: ['venueId'],
    });
  });

  it('accepts the bodies iOS sends', () => {
    expect(
      validateRequestBody('POST', '/check-ins/walk-in', {
        venueId: VENUE,
        activityId: ACTIVITY,
        acceptCharge: true,
        acceptedChargeAmountIsk: 1500,
        bookingAction: 'walk_in',
        guestAgeBands: ['child'],
      }).valid,
    ).toBe(true);
    expect(validateRequestBody('POST', '/check-ins/walk-in', { venueId: VENUE }).valid).toBe(true);
    expect(validateRequestBody('POST', '/bookings', { activityId: ACTIVITY, eventId: 4411 }).valid).toBe(true);
  });

  it('rejects an extra key, a wrong type, a bad enum and a missing required key', () => {
    const extra = validateRequestBody('POST', '/check-ins/walk-in', { venueId: VENUE, credits: 1 });
    expect(extra.valid).toBe(false);
    expect(extra.errors.join('\n')).toMatch(/additionalProperties|must NOT have additional properties/);
    expect(validateRequestBody('POST', '/check-ins/walk-in', { venueId: 'not-a-uuid' }).valid).toBe(false);
    expect(validateRequestBody('POST', '/check-ins/walk-in', { venueId: VENUE, bookingAction: 'attend_later' }).valid).toBe(false);
    expect(validateRequestBody('POST', '/check-ins/walk-in', {}).valid).toBe(false);
    expect(validateRequestBody('POST', '/check-ins/walk-in', undefined).errors).toEqual([
      'body: required by the contract, none sent',
    ]);
  });

  it('refuses a body on a call that takes none', () => {
    expect(validateRequestBody('GET', '/profile', { a: 1 }).valid).toBe(false);
    expect(validateRequestBody('GET', '/profile', undefined).valid).toBe(true);
  });
});

describe('whole requests', () => {
  it('checks a recorded request: body, Idempotency-Key, path and query', async () => {
    api.on('POST', '/check-ins/walk-in', Reply.ok({ checkInId: '9d7c1b2a-0000-4000-8000-000000000001' }));
    await fetch(`${TEST_API_BASE}/check-ins/walk-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'walkin-key-1' },
      body: JSON.stringify({ venueId: VENUE, guestAgeBands: ['child', 'child'] }),
    });
    expect(() => expectRequestValid(api.sent('/check-ins/walk-in'))).not.toThrow();
  });

  it('requires the Idempotency-Key on writes that declare it, in the server format', () => {
    expect(declaresIdempotencyKey('POST', '/check-ins/walk-in')).toBe(true);
    expect(declaresIdempotencyKey('GET', '/profile')).toBe(false);
    const base = { method: 'POST', path: '/check-ins/walk-in', body: { venueId: VENUE } };
    expect(validateRequest({ ...base, headers: {} }).errors).toContain(
      'header Idempotency-Key: required on this write, none sent',
    );
    expect(validateRequest({ ...base, headers: { 'Idempotency-Key': 'short' } }).valid).toBe(false);
    expect(validateRequest({ ...base, headers: { 'Idempotency-Key': 'has spaces in it' } }).valid).toBe(false);
    expect(validateRequest({ ...base, headers: { 'idempotency-key': '9f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10' } }).valid).toBe(true);
  });

  it('checks query parameters (coerced from strings) and flags undocumented ones', () => {
    expect(validateRequest({ method: 'GET', path: '/venues', query: { limit: '20' } }).valid).toBe(true);
    expect(validateRequest({ method: 'GET', path: '/venues', query: { limit: '500' } }).valid).toBe(false);
    expect(validateRequest({ method: 'GET', path: '/venues', query: { sort: 'random' } }).errors).toEqual([
      'query sort: not a parameter of GET /venues',
    ]);
  });

  it('checks path parameters', () => {
    expect(validateRequest({ method: 'GET', path: `/venues/${VENUE}/reviews` }).valid).toBe(true);
    expect(validateRequest({ method: 'GET', path: '/venues/not-a-uuid/reviews' }).valid).toBe(false);
  });

  it('throws a readable error', () => {
    expect(() => expectRequestValid({ method: 'POST', path: '/bookings', body: { credits: 2 }, headers: {} })).toThrow(
      /POST \/bookings breaks the API contract/,
    );
  });
});

describe('responses', () => {
  it('validates the inside of the envelope and problem bodies', () => {
    expect(validateResponseData('POST', '/profile/locale', 200, { locale: 'is' }).valid).toBe(true);
    expect(validateResponseData('POST', '/profile/locale', 200, { locale: 'de' }).valid).toBe(false);
    expect(responseSchema('GET', '/profile', 401)).not.toBeNull();
    expect(
      validateResponseData('GET', '/profile', 401, {
        type: 'https://lifepass.is/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Sign in again.',
      }).valid,
    ).toBe(true);
  });

  it('accepts null where the contract allows it (3.0 `nullable` rewritten for 2020-12)', () => {
    const offer = sampleSchema('Profile', 'full') as Record<string, unknown>;
    expect(validateSchema('Profile', offer).valid).toBe(true);
  });

  it('validates named schemas', () => {
    expect(validateSchema('NoSuchSchema', {}).errors).toEqual(['no schema named NoSuchSchema in the contract']);
  });
});

describe('samples', () => {
  const jsonOperations = allOperations().flatMap((op) =>
    Object.entries(op.operation.responses ?? {})
      .filter(([status]) => /^2\d\d$/.test(status))
      .filter(([status]) => {
        const content = op.operation.responses?.[status]?.content ?? {};
        return 'application/json' in content && responseSchema(op.method, op.template, Number(status)) !== null;
      })
      .map(([status]) => [op.method, op.template, Number(status)] as const),
  );

  it('covers every success response with a JSON body', () => {
    expect(jsonOperations.length).toBeGreaterThan(80);
  });

  it.each(jsonOperations)('%s %s %d: minimal and full samples satisfy the contract', (method, template, status) => {
    for (const mode of ['minimal', 'full'] as const) {
      const sample = sampleResponse(method, template, status, mode);
      const result = validateResponseData(method, template, status, sample);
      if (!result.valid) throw new Error(`${mode} sample invalid:\n${result.errors.slice(0, 8).join('\n')}`);
    }
  });

  it('makes malformed variants without touching the original', () => {
    const venue = sampleResponse('GET', '/venues/by-slug/laugar', 200, 'full') as Record<string, unknown>;
    const noSlug = withoutKey(venue, 'slug');
    expect(noSlug).not.toHaveProperty('slug');
    expect(venue).toHaveProperty('slug');
    expect(validateResponseData('GET', '/venues/by-slug/laugar', 200, noSlug).valid).toBe(false);
    const badName = withValue(venue, 'name', 42);
    expect(badName.name).toBe(42);
    expect(withValue({ a: [{ b: 1 }] }, 'a.0.b', 2)).toEqual({ a: [{ b: 2 }] });
    expect(withoutKey({ a: [1, 2, 3] }, ['a', 1])).toEqual({ a: [1, 3] });
  });
});
