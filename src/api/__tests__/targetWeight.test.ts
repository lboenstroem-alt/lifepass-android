/**
 * `PUT /health/target-weight` and `POST /health/programs/{id}/revise`: what
 * they send (the key always present on the first, tri-state on the second,
 * on the server's 0.1 kg grid), checked against the contract, and how their
 * answers decode (fail soft, as iOS TargetWeightService does).
 */
import { api, Reply } from '@test/server';

import { HttpStatusError } from '..';
import {
  decodeTargetWeightResponse,
  isMissingRoute,
  programRevisionBody,
  reviseProgram,
  roundTargetKg,
  setTargetWeight,
  targetTenths,
} from '../targetWeight';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';
import { encodeBody } from '../wire';

stubApiClientPerTest();

describe('the grid', () => {
  it('rounds half away from zero, as Swift does', () => {
    expect(targetTenths(72.45)).toBe(725);
    expect(targetTenths(72.449)).toBe(724);
    expect(roundTargetKg(66.04)).toBe(66);
    expect(roundTargetKg(66.05)).toBe(66.1);
  });
});

describe('PUT /health/target-weight', () => {
  it('sends the target in the account language with the caller key', async () => {
    api.on('PUT', '/health/target-weight', Reply.ok({ targetWeight: null, goal: null, features: ['target_weight'] }));
    const answer = await setTargetWeight(72.46, 'key-target-01', 'is');
    const sent = expectSentToMatchContract('PUT', '/health/target-weight');
    expect(sent.body).toEqual({ targetWeightKg: 72.5 });
    expect(sent.query).toEqual({ locale: 'is' });
    expect(sent.headers['idempotency-key']).toBe('key-target-01');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(answer.features).toEqual(['target_weight']);
  });

  it('removes with an explicit null', async () => {
    api.on('PUT', '/health/target-weight', Reply.ok({ targetWeight: null, goal: null, features: [] }));
    await setTargetWeight(null, 'key-target-02', 'en');
    const sent = expectSentToMatchContract('PUT', '/health/target-weight');
    expect(sent.rawBody).toBe('{"targetWeightKg":null}');
  });

  it('decodes fail soft: a malformed target or goal never fails the answer', () => {
    const answer = decodeTargetWeightResponse(
      { targetWeight: '72 kg', goal: { goal: 7 }, features: 'all of them' },
      'targetWeight',
    );
    expect(answer).toEqual({ targetWeight: null, goal: null, features: null });

    const full = decodeTargetWeightResponse(
      {
        targetWeight: { targetWeightKg: 72, direction: 'lose', appliesTo: 'goal' },
        goal: { goal: 'lose', sex: null, ageBand: null, activity: 'light', customKcal: null },
        features: ['target_weight', 'plan_revision'],
      },
      'targetWeight',
    );
    expect(full.targetWeight?.direction).toBe('lose');
    expect(full.goal?.goal).toBe('lose');
    expect(full.features).toEqual(['target_weight', 'plan_revision']);
  });

  it('an HTML 404 is a missing route: the feature list was stale', async () => {
    api.on('PUT', '/health/target-weight', Reply.raw(404, '<html>Not found</html>'));
    const failure = await setTargetWeight(70, 'key-target-03', 'en').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpStatusError);
    expect(isMissingRoute(failure)).toBe(true);
  });
});

describe('POST /health/programs/{id}/revise', () => {
  it('sends only what changes, the target tri-state', () => {
    expect(encodeBody(programRevisionBody({ goal: 'lose_weight' }))).toBe('{"goal":"lose_weight"}');
    expect(encodeBody(programRevisionBody({ daysPerWeek: 3, trainingDays: [1, 3, 5], targetWeightKg: null }))).toBe(
      '{"daysPerWeek":3,"trainingDays":[1,3,5],"targetWeightKg":null}',
    );
    expect(encodeBody(programRevisionBody({ goal: 'gain_weight', weeks: 8, targetWeightKg: 80.04 }))).toBe(
      '{"goal":"gain_weight","weeks":8,"targetWeightKg":80}',
    );
  });

  it('posts with the account language and decodes the proposal', async () => {
    api.on(
      'POST',
      '/health/programs/:id/revise',
      Reply.ok({ program: { id: 'prog-2', status: 'proposed', goal: 'lose_weight' }, replayed: false }),
    );
    const programId = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const answer = await reviseProgram(programId, { weeks: 8 }, 'key-revise-01', 'en');
    const sent = expectSentToMatchContract('POST', `/health/programs/${programId}/revise`);
    expect(sent.body).toEqual({ weeks: 8 });
    expect(sent.query).toEqual({ locale: 'en' });
    expect(sent.headers['idempotency-key']).toBe('key-revise-01');
    expect(answer.program.program.id).toBe('prog-2');
    expect(answer.replayed).toBe(false);
  });
});
