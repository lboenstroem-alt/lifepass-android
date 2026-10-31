/**
 * The client half of the target weight rules (`SPEC` 4.4, 6.1): the port of
 * iOS TargetWeightValidationTests, all 23 cases, same vectors.
 *
 * The phone checks a target before anything is sent, in the server's order,
 * so the server rarely has to refuse one. Two things here are easy to get
 * subtly wrong and each has a test: the one-kilo gap is measured in tenths
 * (floating point says 72.9 - 1.0 is not 71.9), and the lowest target a
 * height allows is rounded UP, so the number shown is one the member can save.
 */
import { HttpStatusError, ProblemError, decodeProblemDetails } from '../../../../api';
import { encodeBody } from '../../../../api/wire';
import { isMissingRoute, targetWeightBody } from '../../../../api/targetWeight';
import type { ProfileProgramSummary } from '../../../../api/profile';
import { decodeProgramSummary, livePlanGoal, mayTakeTarget, type ProgramSummary } from '../../../../health';
import { lookup } from '../../../../i18n';
import { decimal, parseDecimal } from '../../../../i18n/format';
import { tables } from '../../../../i18n/tables';
import { TargetWeightRules as Rules, type TargetProblem } from '../rules';

// ---------------------------------------------------------------------------
// The order of the checks

test('an empty field is not an error', () => {
  expect(Rules.validateText('', 'lose', 80, 170)).toBeNull();
  expect(Rules.validateText('   ', 'gain', null, null)).toBeNull();
});

test('unparseable or out of range is the range error', () => {
  expect(Rules.validateText('abc', 'lose', 80, 170)).toEqual({ kind: 'range' });
  expect(Rules.validateText('7,2,5', 'lose', 80, 170)).toEqual({ kind: 'range' });
  expect(Rules.validateText('29.9', 'lose', 80, 170)).toEqual({ kind: 'range' });
  expect(Rules.validateText('300.1', 'gain', 80, 170)).toEqual({ kind: 'range' });
  // Range comes before everything else, a missing weight included.
  expect(Rules.validateText('500', 'gain', null, null)).toEqual({ kind: 'range' });
});

test('no weight means no target', () => {
  expect(Rules.validateText('72', 'lose', null, 170)).toEqual({ kind: 'needsWeight' });
});

test('a lose target must be a kilo below the weight', () => {
  expect(Rules.validateText('80', 'lose', 80, 170)).toEqual({ kind: 'loseDirection' });
  expect(Rules.validateText('79.1', 'lose', 80, 170)).toEqual({ kind: 'loseDirection' });
  expect(Rules.validateText('79', 'lose', 80, 170)).toBeNull();
  expect(Rules.validateText('85', 'lose', 80, 170)).toEqual({ kind: 'loseDirection' });
});

test('a gain target must be a kilo above the weight', () => {
  expect(Rules.validateText('60.9', 'gain', 60, 178)).toEqual({ kind: 'gainDirection' });
  expect(Rules.validateText('61', 'gain', 60, 178)).toBeNull();
  expect(Rules.validateText('55', 'gain', 60, 178)).toEqual({ kind: 'gainDirection' });
});

/**
 * `SPEC` 9.1: 79.0 against a target of 78.0 is fine; 78.1 is too close. In
 * floating point `79.0 - 1.0 >= 78.0` happens to hold, but `72.9 - 1.0` is
 * 71.9000000001, which would refuse a correct 71.9.
 */
test('the gap is measured in tenths', () => {
  expect(Rules.validate(78.0, 'lose', 79.0, null)).toBeNull();
  expect(Rules.validate(78.1, 'lose', 79.0, null)).toEqual({ kind: 'loseDirection' });
  expect(Rules.validate(71.9, 'lose', 72.9, null)).toBeNull();
  expect(Rules.validate(73.9, 'gain', 72.9, null)).toBeNull();
});

/** 170 cm: 53.5 is the lowest healthy target, 53.4 is refused. */
test('a lose target below a healthy weight is refused with the lowest one that is not', () => {
  expect(Rules.minHealthyKg(170)).toBe(53.5);
  expect(Rules.validateText('53.4', 'lose', 80, 170)).toEqual({ kind: 'bmiLow', minKg: 53.5 });
  expect(Rules.validateText('53.5', 'lose', 80, 170)).toBeNull();
});

/** 178 cm: 126.7 is fine for a gain goal, 126.8 is BMI 40. */
test('a gain target at BMI forty is refused', () => {
  expect(Rules.validateText('126.7', 'gain', 100, 178)).toBeNull();
  expect(Rules.validateText('126.8', 'gain', 100, 178)).toEqual({ kind: 'bmiHigh' });
});

/** A BMI exactly on a bound: 18.5 is healthy ("below 18.5"), 40 is refused ("40 or over"). */
test('the bounds themselves', () => {
  // 150 cm: 18.5 * 2.25 = 41.625 -> 41.7 is the lowest; 40 * 2.25 = 90.0 exactly.
  expect(Rules.minHealthyKg(150)).toBe(41.7);
  expect(Rules.validate(90.0, 'gain', 60, 150)).toEqual({ kind: 'bmiHigh' });
  expect(Rules.validate(89.9, 'gain', 60, 150)).toBeNull();
  // 200 cm: 18.5 * 4 = 74.0 exactly, which is healthy.
  expect(Rules.minHealthyKg(200)).toBe(74.0);
  expect(Rules.validate(74.0, 'lose', 90, 200)).toBeNull();
});

/** Unknown height: accepted (the server later flags a target outside a healthy weight once a height is known). */
test('an unknown height skips the healthy weight check', () => {
  expect(Rules.validateText('40', 'lose', 80, null)).toBeNull();
});

/** The direction check comes before the BMI check, as on the server. */
test('the direction is checked before the healthy weight', () => {
  expect(Rules.validateText('130', 'lose', 120, 178)).toEqual({ kind: 'loseDirection' });
});

// ---------------------------------------------------------------------------
// Input and display

test('comma and dot both mean the same target', () => {
  expect(Rules.validateText('72,5', 'lose', 80, 170)).toBeNull();
  expect(Rules.validateText('72.5', 'lose', 80, 170)).toBeNull();
  expect(parseDecimal('72,5')).toBe(parseDecimal('72.5'));
});

test('the lowest target is formatted in the account language', () => {
  const minKg = Rules.minHealthyKg(170);
  expect(decimal(minKg, 'is')).toBe('53,5');
  expect(decimal(minKg, 'en')).toBe('53.5');
  const line = lookup('target.err.bmi_low', 'en').replace('{kg}', decimal(minKg, 'en'));
  expect(line).toContain('53.5 kg');
});

test('every problem has copy in both languages', () => {
  const problems: TargetProblem[] = [
    { kind: 'range' },
    { kind: 'needsWeight' },
    { kind: 'loseDirection' },
    { kind: 'gainDirection' },
    { kind: 'bmiLow', minKg: 53.5 },
    { kind: 'bmiHigh' },
  ];
  for (const problem of problems) {
    const key = Rules.problemKey(problem);
    expect(lookup(key, 'en')).not.toBe(key);
    // The Icelandic table itself, not the English fallback `lookup` gives.
    expect(tables.is[key]).toEqual(expect.any(String));
    expect(tables.is[key]).not.toBe(tables.en[key]);
  }
});

test('directions follow the goal', () => {
  expect(Rules.directionForProgramGoal('lose_weight')).toBe('lose');
  expect(Rules.directionForProgramGoal('gain_weight')).toBe('gain');
  expect(Rules.directionForProgramGoal('build_muscle')).toBeNull();
  expect(Rules.directionForProgramGoal('get_fitter')).toBeNull();
  expect(Rules.directionForProgramGoal(null)).toBeNull();
  expect(Rules.directionForCalorieGoal('lose')).toBe('lose');
  expect(Rules.directionForCalorieGoal('gain')).toBe('gain');
  expect(Rules.directionForCalorieGoal('maintain')).toBeNull();
  expect(Rules.directionForCalorieGoal(null)).toBeNull();
});

test("values are kept on the server's tenth of a kilo grid", () => {
  expect(Rules.rounded(72.46)).toBe(72.5);
  expect(Rules.rounded(72.44)).toBe(72.4);
  expect(Rules.tenths(71.9)).toBe(719);
});

// ---------------------------------------------------------------------------
// What travels

/** `PUT /health/target-weight` always carries the key: null removes. */
test('the target weight body always carries its key', () => {
  expect(encodeBody(targetWeightBody(null))).toBe('{"targetWeightKg":null}');
  expect(encodeBody(targetWeightBody(72.46))).toBe('{"targetWeightKg":72.5}');
});

/**
 * A route that does not exist on the server (an HTML 404) is the stale
 * feature list; a `health_program_not_found` problem is not.
 */
test('only a plain 404 counts as a missing route', () => {
  expect(isMissingRoute(new HttpStatusError(404, '<html>'))).toBe(true);
  expect(isMissingRoute(new HttpStatusError(500, ''))).toBe(false);
  const details = decodeProblemDetails({
    type: 'https://lifepass.is/problems/health_program_not_found',
    title: 'x',
    status: 404,
  });
  expect(details).not.toBeNull();
  expect(isMissingRoute(new ProblemError(details!, 404))).toBe(false);
});

// ---------------------------------------------------------------------------
// A running plan whose goal is not in hand (review fix)

function dayProgram(id = 'prog-1', status = 'active', goal = 'lose_weight'): ProgramSummary {
  return decodeProgramSummary({ id, status, goal }, 'program');
}

function profileProgram(id = 'prog-1', status: 'active' | 'paused' | 'completed' = 'active'): ProfileProgramSummary {
  return { id, status, weekNo: null, weeks: null, summaryTitle: null, today: null };
}

/** The Today read gives the goal; the profile only says a plan runs. */
test("the day's goal is used when it is the live plan", () => {
  const lose = livePlanGoal(dayProgram(), profileProgram());
  expect(lose).toEqual({ kind: 'known', goal: 'lose_weight' });
  expect(mayTakeTarget(lose)).toBe(true);

  const fitter = livePlanGoal(dayProgram('prog-1', 'active', 'get_fitter'), profileProgram());
  expect(fitter).toEqual({ kind: 'known', goal: 'get_fitter' });
  // A plan that takes no target does not keep one.
  expect(mayTakeTarget(fitter)).toBe(false);

  // No profile read yet: the day alone is enough.
  expect(livePlanGoal(dayProgram(), null)).toEqual({ kind: 'known', goal: 'lose_weight' });
});

/**
 * Body and goals opened before Plan loaded, or offline: the profile says a
 * plan runs and nothing says what for. Unknown, and unknown keeps the target.
 */
test('a live plan with no day is unknown and may take a target', () => {
  const goal = livePlanGoal(null, profileProgram());
  expect(goal).toEqual({ kind: 'unknown' });
  // Removing the calorie goal must not clear a target the plan may use.
  expect(mayTakeTarget(goal)).toBe(true);

  expect(livePlanGoal(null, profileProgram('prog-1', 'paused'))).toEqual({ kind: 'unknown' });
});

/** A day that names another plan (or an ended one) says nothing about the plan the profile says is running. */
test('a day about another plan is unknown', () => {
  expect(livePlanGoal(dayProgram('prog-old'), profileProgram('prog-new'))).toEqual({ kind: 'unknown' });
  expect(livePlanGoal(dayProgram('prog-1', 'completed'), profileProgram())).toEqual({ kind: 'unknown' });
});

test('no plan anywhere takes no target', () => {
  expect(livePlanGoal(null, null)).toEqual({ kind: 'noLivePlan' });
  expect(livePlanGoal(dayProgram('prog-1', 'completed'), profileProgram('prog-1', 'completed'))).toEqual({
    kind: 'noLivePlan',
  });
  expect(mayTakeTarget({ kind: 'noLivePlan' })).toBe(false);
});

/**
 * With the goal unknown, the typed value picks the checks: under the weight
 * is a lose target (the gap and the healthy-weight floor apply), over it a
 * gain target.
 */
test('an unknown goal checks the value the way it points', () => {
  expect(Rules.inferredDirection(70, 80)).toBe('lose');
  expect(Rules.inferredDirection(80, 80)).toBe('lose');
  expect(Rules.inferredDirection(80.1, 80)).toBe('gain');
  expect(Rules.inferredDirection(null, 80)).toBe('lose');

  const under = Rules.inferredDirection(79.5, 80);
  expect(Rules.validate(79.5, under, 80, 170)).toEqual({ kind: 'loseDirection' });
  const low = Rules.inferredDirection(50, 80);
  expect(Rules.validate(50, low, 80, 170)).toEqual({ kind: 'bmiLow', minKg: Rules.minHealthyKg(170) });
  const over = Rules.inferredDirection(80.5, 80);
  expect(Rules.validate(80.5, over, 80, 170)).toEqual({ kind: 'gainDirection' });
  expect(Rules.validate(85, Rules.inferredDirection(85, 80), 80, 170)).toBeNull();
});
