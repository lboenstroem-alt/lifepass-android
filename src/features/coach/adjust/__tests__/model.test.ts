/**
 * Adjust my plan's model (`SPEC` 6.7): what a change sends, what it says,
 * and when a submit is a retry rather than a new request. A port of iOS
 * `CoachAdjustFlowTests`, case for case, plus the parsing of the chip values.
 *
 * The key rule is the wizard's: the revise route answers a reused
 * Idempotency-Key with the revision it already made, so reusing the key
 * after an EDIT would show the member the plan they just changed away from,
 * and minting a new one on a plain retry would spend a revision on nothing
 * (there are six in 30 days).
 */
import { programRevisionBody } from '../../../../api/targetWeight';
import { decodeProgramSummary } from '../../../../health';
import { isForbidden } from '../../../../lib/analytics';
import { defaultTrainingDays, type ProgramGoal, type ProgramLength } from '../../program/model';
import {
  ADJUST_CHANGE_KINDS,
  adjustCurrentFrom,
  changeAdjust,
  changeKinds,
  daysChange,
  isEmpty,
  isTargetOnly,
  keyForSubmit,
  newAdjustFlow,
  parseAdjustAnswer,
  revisionInput,
  summaryLines,
  TARGET_REMOVE,
  TARGET_UNCHANGED,
  targetOnlyValue,
  targetSet,
  type AdjustFlowState,
} from '../model';

function flowOf(goal: ProgramGoal = 'lose_weight', days = 3, weeks: ProgramLength = 4): AdjustFlowState {
  return newAdjustFlow('prog-1', {
    goal,
    daysPerWeek: days,
    trainingDays: defaultTrainingDays(days),
    weeks,
    summaryTitle: 'Lose weight, 3 days a week',
  });
}

/** The revise body as it goes on the wire (`JSON.stringify` of the API client's body). */
function wire(flow: AdjustFlowState): Record<string, unknown> {
  const input = revisionInput(flow);
  if (!input) throw new Error('no revision body');
  return JSON.parse(JSON.stringify(programRevisionBody(input))) as Record<string, unknown>;
}

function wireText(flow: AdjustFlowState): string {
  const input = revisionInput(flow);
  if (!input) throw new Error('no revision body');
  return JSON.stringify(programRevisionBody(input));
}

describe('what is sent', () => {
  it('sends nothing when nothing was chosen', () => {
    const flow = flowOf();
    expect(isEmpty(flow)).toBe(true);
    expect(isTargetOnly(flow)).toBe(false);
    expect(revisionInput(flow)).toBeNull();
  });

  it('carries the default weekdays for a new number of days', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, daysPerWeek: 4 }));
    const body = wire(flow);
    expect(body.daysPerWeek).toBe(4);
    expect(body.trainingDays).toEqual([1, 2, 4, 6]);
    expect(body).not.toHaveProperty('goal');
    expect(body).not.toHaveProperty('weeks');
    // An untouched target is not sent at all.
    expect(body).not.toHaveProperty('targetWeightKg');
  });

  it('lets picked weekdays win over the defaults', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, daysPerWeek: 2, trainingDays: [2, 6] }));
    expect(wire(flow).trainingDays).toEqual([2, 6]);
  });

  it('does not treat the same number of days as a revision', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, daysPerWeek: 3 }));
    expect(daysChange(flow)).toBe(false);
    expect(revisionInput(flow)).toBeNull();
  });

  it('sends only the weeks for a length change', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, weeks: 8 }));
    const body = wire(flow);
    expect(body.weeks).toBe(8);
    expect(Object.keys(body)).toHaveLength(1);
  });

  it('sends a null for "No target" with a new goal, not a missing key', () => {
    // The plan the member switches to clears the standing target.
    const flow = changeAdjust(flowOf('build_muscle'), (f) => ({ ...f, goal: 'lose_weight', target: TARGET_REMOVE }));
    const text = wireText(flow);
    expect(text).toContain('"targetWeightKg":null');
    expect(text).toContain('"goal":"lose_weight"');
  });

  it('sends nothing about the target for "Keep my current target"', () => {
    // The standing target carries across to the new plan.
    const flow = changeAdjust(flowOf('build_muscle'), (f) => ({ ...f, goal: 'lose_weight', target: TARGET_UNCHANGED }));
    expect(wire(flow)).not.toHaveProperty('targetWeightKg');
  });

  it('sends a new target with a new goal as a number on the 0.1 kg grid', () => {
    const flow = changeAdjust(flowOf('get_fitter'), (f) => ({ ...f, goal: 'gain_weight', target: targetSet(66.04) }));
    expect(wire(flow).targetWeightKg).toBe(66.0);
  });

  it('never sends a target with a goal that takes none', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, goal: 'build_muscle', target: targetSet(70) }));
    expect(wire(flow)).not.toHaveProperty('targetWeightKg');
  });
});

describe('target only', () => {
  it('treats the same goal with a new target as target-only', () => {
    let flow = changeAdjust(flowOf(), (f) => ({ ...f, target: targetSet(70) }));
    expect(isTargetOnly(flow)).toBe(true);
    // A target alone is PUT /health/target-weight, not a revision.
    expect(revisionInput(flow)).toBeNull();
    expect(targetOnlyValue(flow)).toBe(70);

    flow = changeAdjust(flow, (f) => ({ ...f, target: TARGET_REMOVE }));
    expect(isTargetOnly(flow)).toBe(true);
    expect(targetOnlyValue(flow)).toBeNull();
  });

  it('never treats a goal change as target-only', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, goal: 'gain_weight', target: targetSet(80) }));
    expect(isTargetOnly(flow)).toBe(false);
    expect(revisionInput(flow)).not.toBeNull();
  });

  it('saves nothing when the target is not changing', () => {
    expect(targetOnlyValue(flowOf())).toBeUndefined();
  });

  it('rounds a picked target onto the grid', () => {
    expect(targetOnlyValue(changeAdjust(flowOf(), (f) => ({ ...f, target: targetSet(71.26) })))).toBe(71.3);
  });
});

describe('what the confirmation says', () => {
  it('has one line per change, in the menu order, and no weight', () => {
    const flow = changeAdjust(flowOf('build_muscle'), (f) => ({
      ...f,
      goal: 'lose_weight',
      daysPerWeek: 4,
      weeks: 12,
      target: targetSet(72.5),
    }));
    const lines = summaryLines(flow);
    expect(lines.map((line) => line.key)).toEqual([
      'program.adjust.line.goal',
      'program.adjust.line.days',
      'program.adjust.line.weekdays',
      'program.adjust.line.length',
      'program.adjust.line.target',
    ]);
    expect(lines[0]!.paramKeys).toEqual({ new: 'program.goal.lose_weight', old: 'program.goal.build_muscle' });
    expect(lines[1]!.params).toEqual({ new: '4', old: '3' });
    expect(lines[2]!.weekdays).toEqual([1, 2, 4, 6]);
    expect(lines[3]!.params).toEqual({ new: '12', old: '4' });
    // The target line is words: "a new target", never 72.5.
    const everything = lines.flatMap((line) => [...Object.values(line.params), ...Object.values(line.paramKeys)]).join(' ');
    expect(everything).not.toContain('72');
  });

  it('reads "none" when the target is removed', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, target: TARGET_REMOVE }));
    expect(summaryLines(flow).map((line) => line.key)).toEqual(['program.adjust.line.target_none']);
  });

  it('reports fixed words for the kinds of change', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, daysPerWeek: 5, weeks: 8, target: TARGET_REMOVE }));
    expect(changeKinds(flow)).toEqual(['days', 'length', 'target']);
    for (const kind of ADJUST_CHANGE_KINDS) expect(isForbidden('change', kind)).toBe(false);
  });
});

describe('the key', () => {
  it('keeps the key for a retry with no change', () => {
    const minted = keyForSubmit(changeAdjust(flowOf(), (f) => ({ ...f, weeks: 8 })));
    // Try again must resend the same revision.
    expect(keyForSubmit(minted.flow).key).toBe(minted.key);
  });

  it('clears the key on any change', () => {
    const minted = keyForSubmit(changeAdjust(flowOf(), (f) => ({ ...f, weeks: 8 })));
    const changed = changeAdjust(minted.flow, (f) => ({ ...f, daysPerWeek: 4 }));
    expect(changed.idempotencyKey).toBeNull();
    expect(keyForSubmit(changed).key).not.toBe(minted.key);
  });

  it('keeps the key for a change that changes nothing, and for an open question', () => {
    const minted = keyForSubmit(changeAdjust(flowOf(), (f) => ({ ...f, weeks: 8 })));
    const same = changeAdjust(minted.flow, (f) => ({ ...f, weeks: 8 }));
    expect(same.idempotencyKey).toBe(minted.key);
    // An open question is not part of the request either.
    const pending = changeAdjust(same, (f) => ({ ...f, pendingGoal: 'gain_weight' }));
    expect(pending.idempotencyKey).toBe(minted.key);
  });

  it('keeps the key when the same target is chosen again, and clears it for another one', () => {
    const minted = keyForSubmit(changeAdjust(flowOf(), (f) => ({ ...f, target: targetSet(70) })));
    expect(changeAdjust(minted.flow, (f) => ({ ...f, target: targetSet(70) })).idempotencyKey).toBe(minted.key);
    expect(changeAdjust(minted.flow, (f) => ({ ...f, target: targetSet(69) })).idempotencyKey).toBeNull();
  });

  it('never lets a change set the key itself', () => {
    const flow = changeAdjust(flowOf(), (f) => ({ ...f, idempotencyKey: 'smuggled' }));
    expect(flow.idempotencyKey).toBeNull();
  });
});

describe('where the flow starts', () => {
  it('reads the current plan from the live summary', () => {
    const program = decodeProgramSummary(
      {
        id: 'prog-1',
        status: 'active',
        goal: 'gain_weight',
        daysPerWeek: 4,
        weeks: 8,
        trainingDays: [6, 1, 2, 4],
        summaryTitle: 'Gain weight, 4 days a week',
      },
      'program',
    );
    expect(adjustCurrentFrom(program)).toEqual({
      goal: 'gain_weight',
      daysPerWeek: 4,
      trainingDays: [1, 2, 4, 6],
      weeks: 8,
      summaryTitle: 'Gain weight, 4 days a week',
    });
  });

  it('trains a plan with no weekdays of its own on the defaults, and refuses one without days', () => {
    const base = { goal: 'get_fitter', daysPerWeek: 2, trainingDays: null, weeks: 12, summaryTitle: null };
    expect(adjustCurrentFrom(base)?.trainingDays).toEqual([1, 4]);
    expect(adjustCurrentFrom({ ...base, daysPerWeek: null })).toBeNull();
  });

  it('reads an unknown goal or length as none rather than guessing', () => {
    const current = adjustCurrentFrom({ goal: 'run_a_marathon', daysPerWeek: 3, trainingDays: [1, 3, 5], weeks: 6, summaryTitle: null });
    expect(current?.goal).toBeNull();
    expect(current?.weeks).toBeNull();
  });
});

describe('the revise body on the wire', () => {
  it('leaves out what does not change', () => {
    expect(JSON.stringify(programRevisionBody({ weeks: 12 }))).toBe('{"weeks":12}');
  });
});

describe('the chip values', () => {
  it('parses the answers of the goal, days and length questions', () => {
    expect(parseAdjustAnswer('adjust.goal.lose_weight')).toEqual({ kind: 'goal', goal: 'lose_weight' });
    expect(parseAdjustAnswer('adjust.days.4')).toEqual({ kind: 'days', days: 4 });
    expect(parseAdjustAnswer('adjust.length.12')).toEqual({ kind: 'length', length: 12 });
  });

  it('refuses a value outside the choices', () => {
    for (const value of ['adjust.goal.sleep_more', 'adjust.days.6', 'adjust.days.4.5', 'adjust.days. 4', 'adjust.length.6', 'adjust.goal', 'adjust.show']) {
      expect(parseAdjustAnswer(value)).toBeNull();
    }
  });
});
