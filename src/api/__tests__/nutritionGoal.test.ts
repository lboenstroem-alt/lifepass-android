/**
 * `PUT /health/nutrition-goal` (OP-48): what the body sheet sends. The port
 * of the body-sheet half of iOS ProgramAnswersTests ("What the body sheet
 * sends", ios-ux.md 6.5, and the target weight's tri-state, `SPEC` 2.5, 6.2),
 * plus the request itself checked against the contract.
 *
 * A missing key and a null are different answers, and only one of them
 * clears a goal: `goal` is REQUIRED and may be null. A body that left the key
 * out posted `{}` and was answered 400.
 */
import { api, Reply } from '@test/server';

import { isProblem } from '..';
import { nutritionGoalBody, setNutritionGoal } from '../nutritionGoal';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';
import { encodeBody } from '../wire';

stubApiClientPerTest();

const json = (input: Parameters<typeof nutritionGoalBody>[0]) => encodeBody(nutritionGoalBody(input));

describe('what the body sheet sends (iOS ProgramAnswersTests)', () => {
  it('clearing the goal sends an explicit null and not an empty body', () => {
    const body = json({ goal: null });
    expect(body).toContain('"goal":null');
    expect(body).not.toBe('{}');
    // Nothing else is claimed: the contract only asks for an activity WITH a goal.
    expect(body).not.toContain('activity');
    expect(body).not.toContain('customKcal');
  });

  it('turning the custom number off sends an explicit null', () => {
    const body = json({ goal: 'maintain', sex: 'female', ageBand: null, activity: 'light', customKcal: null });
    expect(body).toContain('"customKcal":null');
    expect(body).toContain('"goal":"maintain"');
    // An age band the kennitala already proves is never sent.
    expect(body).not.toContain('ageBand');
  });

  it('a custom number is sent as itself', () => {
    expect(json({ goal: 'lose', activity: 'moderate', customKcal: 2100 })).toContain('"customKcal":2100');
  });

  it("the goal body's target is tri-state", () => {
    const untouched = json({ goal: 'lose', activity: 'light' });
    expect(untouched).not.toContain('targetWeightKg');

    const cleared = json({ goal: null, targetWeightKg: null });
    expect(cleared).toContain('"targetWeightKg":null');
    expect(cleared).toContain('"goal":null');

    const set = json({ goal: 'gain', activity: 'light', targetWeightKg: 66.04 });
    expect(set).toContain('"targetWeightKg":66');
  });

  it("keys go in iOS's order and a target travels on the 0.1 kg grid", () => {
    expect(
      json({
        goal: 'lose',
        sex: 'male',
        ageBand: '35_44',
        activity: 'active',
        customKcal: undefined,
        targetWeightKg: 72.46,
      }),
    ).toBe('{"goal":"lose","sex":"male","ageBand":"35_44","activity":"active","targetWeightKg":72.5}');
  });
});

describe('the request', () => {
  it('is a PUT with the caller key and no locale, valid for the contract, answering the envelope', async () => {
    api.on(
      'PUT',
      '/health/nutrition-goal',
      Reply.ok({
        goal: null,
        targetWeight: { targetWeightKg: 72, direction: 'lose', setAt: '2026-10-01T09:00:00Z' },
        features: ['target_weight'],
      }),
    );
    const envelope = await setNutritionGoal(
      { goal: 'lose', sex: 'female', activity: 'light', customKcal: null, targetWeightKg: 72 },
      'key-goal-0001',
    );
    const sent = expectSentToMatchContract('PUT', '/health/nutrition-goal');
    expect(sent.headers['idempotency-key']).toBe('key-goal-0001');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.query).toEqual({});
    expect(sent.body).toEqual({ goal: 'lose', sex: 'female', activity: 'light', customKcal: null, targetWeightKg: 72 });
    expect(envelope.targetWeight?.targetWeightKg).toBe(72);
    expect(envelope.features).toEqual(['target_weight']);
  });

  it('decodes the contract sample', async () => {
    api.on('PUT', '/health/nutrition-goal', replyFromContract('PUT', '/health/nutrition-goal', 200, 'full'));
    const envelope = await setNutritionGoal({ goal: null }, 'key-goal-0002');
    expect(envelope).toEqual(expect.objectContaining({ features: expect.any(Array) }));
    expect(api.sent('/health/nutrition-goal', 'PUT').body).toEqual({ goal: null });
  });

  it('a refusal reaches the caller with its reason', async () => {
    api.on('PUT', '/health/nutrition-goal', Reply.problem(422, 'program_refused', { reason: 'bmi_low_lose_weight' }));
    const failure = await setNutritionGoal({ goal: 'lose', activity: 'light' }, 'key-goal-0003').catch(
      (error: unknown) => error,
    );
    expect(isProblem(failure, 'program_refused')).toBe(true);
    expect((failure as { reason?: string }).reason).toBe('bmi_low_lose_weight');
  });
});
