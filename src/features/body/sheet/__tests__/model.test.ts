/**
 * The body sheet's rules (iOS BodySheet's derived values): which line a field
 * shows, when the button works, what each save sends, and which copy a
 * refusal reads.
 */
import { encodeBody } from '../../../../api/wire';
import { nutritionGoalBody } from '../../../../api/nutritionGoal';
import { lookup } from '../../../../i18n';
import { tables } from '../../../../i18n/tables';
import {
  bodyCanSubmit,
  clearGoalInput,
  customKcalError,
  detailsSnapshot,
  goalSaveInput,
  heightFieldError,
  programBodyUpdate,
  refusalKeyFor,
  targetAnalyticsWord,
  targetValueOf,
  weightErrorKey,
  weightFieldError,
} from '../model';
import { givesTarget } from '../types';

describe('the field lines', () => {
  it('a weight takes a comma or a dot, 30 to 300 kg, and an empty field is not an error', () => {
    expect(weightFieldError('')).toBe(false);
    expect(weightFieldError('72,5')).toBe(false);
    expect(weightFieldError('72.5')).toBe(false);
    expect(weightFieldError('29.9')).toBe(true);
    expect(weightFieldError('300.1')).toBe(true);
    expect(weightFieldError('7 2')).toBe(true);
  });

  it('a height is a whole number from 120 to 230 cm', () => {
    expect(heightFieldError('')).toBe(false);
    expect(heightFieldError('120')).toBe(false);
    expect(heightFieldError('230')).toBe(false);
    expect(heightFieldError('119')).toBe(true);
    expect(heightFieldError('170.5')).toBe(true);
  });

  it("the member's own number is 1000 to 5000, checked only while switched on", () => {
    expect(customKcalError(false, '12')).toBe(false);
    expect(customKcalError(true, '')).toBe(false);
    expect(customKcalError(true, '999')).toBe(true);
    expect(customKcalError(true, '1000')).toBe(false);
    expect(customKcalError(true, '5000')).toBe(false);
    expect(customKcalError(true, '5001')).toBe(true);
    expect(customKcalError(true, '2000.5')).toBe(true);
  });

  it('a height-only edit is blocked with the needs-weight line, not the weight line', () => {
    const base = { weightText: '', heightText: '180', prefilledHeightCm: 175, isIntake: false };
    expect(weightErrorKey(base)).toBe('body.err.height_needs_weight');
    // The same height as on file is no edit.
    expect(weightErrorKey({ ...base, heightText: '175' })).toBeNull();
    // A weight beside it makes it travel.
    expect(weightErrorKey({ ...base, weightText: '80' })).toBeNull();
    // A wrong weight is the weight line, whatever the height.
    expect(weightErrorKey({ ...base, weightText: '20' })).toBe('body.err.weight');
    // The intake sends nothing, so it never asks for a weight on its own.
    expect(weightErrorKey({ ...base, isIntake: true })).toBeNull();
  });
});

describe('the button', () => {
  const ok = {
    weightErrorKey: null,
    heightError: false,
    customError: false,
    targetErrorKey: null,
    weightText: '80',
    heightText: '180',
    needsAgeBand: false,
    ageBand: null,
    goal: null,
  } as const;

  it('any error holds it', () => {
    expect(bodyCanSubmit({ ...ok, kind: 'update' })).toBe(true);
    expect(bodyCanSubmit({ ...ok, kind: 'update', weightErrorKey: 'body.err.weight' })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'update', heightError: true })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'update', customError: true })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'update', targetErrorKey: 'target.err.range' })).toBe(false);
  });

  it('the intake needs a weight and a height, and an age band when the kennitala is not verified', () => {
    expect(bodyCanSubmit({ ...ok, kind: 'intake' })).toBe(true);
    expect(bodyCanSubmit({ ...ok, kind: 'intake', heightText: '' })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'intake', weightText: '' })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'intake', needsAgeBand: true })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'intake', needsAgeBand: true, ageBand: '25_34' })).toBe(true);
  });

  it('the goal needs a chip, and an age band when the kennitala is not verified; a weight is optional', () => {
    expect(bodyCanSubmit({ ...ok, kind: 'goal' })).toBe(false);
    expect(bodyCanSubmit({ ...ok, kind: 'goal', goal: 'maintain', weightText: '', heightText: '' })).toBe(true);
    expect(bodyCanSubmit({ ...ok, kind: 'goal', goal: 'lose', needsAgeBand: true })).toBe(false);
  });
});

describe('what a save sends', () => {
  it('the programme hears only what changed, and nothing at all when nothing did', () => {
    const initial = detailsSnapshot({ sex: null, ageBand: null, activity: 'light' }, false);
    expect(programBodyUpdate(initial, initial)).toBeNull();
    expect(programBodyUpdate(initial, { ...initial, sex: 'female' })).toEqual({ body: { sex: 'female' } });
    expect(programBodyUpdate(initial, { ...initial, activity: 'active', ageBand: '45_54' })).toEqual({
      body: { ageBand: '45_54', activity: 'active' },
    });
  });

  it('an age band never travels for a verified kennitala', () => {
    const verified = detailsSnapshot({ sex: null, ageBand: '25_34', activity: 'light' }, true);
    expect(verified.ageBand).toBeNull();
    const input = goalSaveInput({
      goal: 'lose',
      sex: 'male',
      ageBand: '25_34',
      kennitalaVerified: true,
      activity: 'light',
      customOn: false,
      customKcalText: '',
      targetTouched: false,
      targetValue: null,
    });
    expect(nutritionGoalBody(input)).not.toHaveProperty('ageBand');
  });

  it('the goal body always carries goal, customKcal null when switched off, and targetWeightKg only when touched', () => {
    const base = {
      goal: 'lose',
      sex: 'female' as const,
      ageBand: '35_44' as const,
      kennitalaVerified: false,
      activity: 'moderate' as const,
      customOn: false,
      customKcalText: '2100',
      targetTouched: false,
      targetValue: 72,
    };
    expect(encodeBody(nutritionGoalBody(goalSaveInput(base)))).toBe(
      '{"goal":"lose","sex":"female","ageBand":"35_44","activity":"moderate","customKcal":null}',
    );
    expect(nutritionGoalBody(goalSaveInput({ ...base, customOn: true }))).toMatchObject({ customKcal: 2100 });
    expect(nutritionGoalBody(goalSaveInput({ ...base, targetTouched: true }))).toMatchObject({ targetWeightKg: 72 });
    // Emptying a prefilled target is a touch that removes it.
    expect(nutritionGoalBody(goalSaveInput({ ...base, targetTouched: true, targetValue: null }))).toMatchObject({
      targetWeightKg: null,
    });
  });

  it('Remove goal clears the target only when no live plan could still use it', () => {
    const clears = { supportsTargetWeight: true, hasStoredTarget: true, liveProgramTakesTarget: false };
    expect(encodeBody(nutritionGoalBody(clearGoalInput(clears)))).toBe('{"goal":null,"targetWeightKg":null}');
    expect(encodeBody(nutritionGoalBody(clearGoalInput({ ...clears, liveProgramTakesTarget: true })))).toBe(
      '{"goal":null}',
    );
    expect(encodeBody(nutritionGoalBody(clearGoalInput({ ...clears, hasStoredTarget: false })))).toBe('{"goal":null}');
    // An older server answers the key with 400, so it is never sent there.
    expect(encodeBody(nutritionGoalBody(clearGoalInput({ ...clears, supportsTargetWeight: false })))).toBe(
      '{"goal":null}',
    );
  });
});

describe('refusals', () => {
  it('each program_refused reason maps to its copy key', () => {
    expect(refusalKeyFor('bmi_low_lose_weight')).toBe('goal.refused.bmi_low');
    expect(refusalKeyFor('bmi_high')).toBe('goal.refused.bmi_high');
    expect(refusalKeyFor('target_too_low')).toBe('goal.refused.target_low');
    expect(refusalKeyFor('target_weight_bmi_low')).toBe('program.refused.target_bmi_low');
    expect(refusalKeyFor('target_weight_bmi_high')).toBe('program.refused.target_bmi_high');
    // A reason this build does not know reads as the careful one.
    expect(refusalKeyFor('something_new')).toBe('goal.refused.bmi_high');
    expect(refusalKeyFor(undefined)).toBe('goal.refused.bmi_high');
  });

  it('every line the sheet can show exists in both languages', () => {
    const keys = [
      'goal.refused.bmi_low',
      'goal.refused.bmi_high',
      'goal.refused.target_low',
      'program.refused.target_bmi_low',
      'program.refused.target_bmi_high',
      'body.err.weight',
      'body.err.height',
      'body.err.height_needs_weight',
      'body.err.age',
      'goal.err.custom',
      'target.err.server',
      'health.offline.action_hint',
      'common.error_body',
    ];
    for (const key of keys) {
      expect(lookup(key, 'en')).not.toBe(key);
      expect(tables.is[key]).toEqual(expect.any(String));
    }
  });
});

describe('the target field', () => {
  it('a typed target is read on the 0.1 kg grid', () => {
    expect(targetValueOf('72,46')).toBe(72.5);
    expect(targetValueOf('')).toBeNull();
    expect(targetValueOf('abc')).toBeNull();
  });

  it('analytics hear set, cleared or unchanged, never the number', () => {
    expect(targetAnalyticsWord(false, 72)).toBe('unchanged');
    expect(targetAnalyticsWord(true, 72)).toBe('set');
    expect(targetAnalyticsWord(true, null)).toBe('cleared');
  });

  it('the bubble mentions a target only when one was touched and given (iOS testGivesTargetIsOnlyForATouchedValue)', () => {
    expect(givesTarget({ targetWeightKg: 72, targetWeightTouched: true })).toBe(true);
    expect(givesTarget({ targetWeightKg: 72, targetWeightTouched: false })).toBe(false);
    expect(givesTarget({ targetWeightKg: null, targetWeightTouched: true })).toBe(false);
  });
});
