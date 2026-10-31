/**
 * What the target sheet derives (iOS TargetWeightSheet's computed values):
 * the goal a target serves in the server's order, the unknown-plan case that
 * keeps the field, the goal word, and what the field opens with.
 */
import type { LivePlanGoal, TargetWeightView } from '../../../../health';
import {
  acceptsTarget,
  bodyShowsReachedNote,
  bodyTargetPrefillKg,
  goalWordKey,
  showsReachedNote,
  targetDirection,
  targetGoalUnknown,
  targetPrefillKg,
  validationDirection,
  type TargetSheetFacts,
} from '../logic';

function target(overrides: Partial<TargetWeightView> = {}): TargetWeightView {
  return {
    targetWeightKg: 72.04,
    direction: 'lose',
    setAt: null,
    reachedAt: null,
    outsideHealthyRange: false,
    appliesTo: null,
    eta: null,
    ...overrides,
  };
}

const known = (goal: string | null): LivePlanGoal => ({ kind: 'known', goal });
const unknown: LivePlanGoal = { kind: 'unknown' };
const none: LivePlanGoal = { kind: 'noLivePlan' };

function save(livePlan: LivePlanGoal, storedTarget: TargetWeightView | null, standingGoal: string | null): TargetSheetFacts {
  return { mode: { kind: 'save' }, livePlan, storedTarget, standingGoal };
}

describe('the goal a target serves', () => {
  it("a live lose or gain plan's goal comes first", () => {
    expect(targetDirection(save(known('lose_weight'), null, 'gain'))).toBe('lose');
    expect(targetDirection(save(known('gain_weight'), null, 'lose'))).toBe('gain');
    expect(goalWordKey(save(known('lose_weight'), null, null))).toBe('program.goal.lose_weight');
  });

  it("a plan that takes no target falls back to the calorie goal", () => {
    expect(targetDirection(save(known('build_muscle'), null, 'gain'))).toBe('gain');
    expect(goalWordKey(save(known('build_muscle'), null, 'gain'))).toBe('goal.gain');
    expect(targetDirection(save(none, null, 'lose'))).toBe('lose');
    expect(goalWordKey(save(none, null, 'lose'))).toBe('goal.lose');
  });

  it('no goal that takes a target: the field is not offered, and says why', () => {
    const facts = save(none, null, 'maintain');
    expect(targetDirection(facts)).toBeNull();
    expect(targetGoalUnknown(facts)).toBe(false);
    expect(acceptsTarget(facts)).toBe(false);
    expect(goalWordKey(facts)).toBeNull();
  });

  it("a plan whose goal is not in hand: the stored target's appliesTo may say, else the field still shows", () => {
    const viaProgram = save(unknown, target({ appliesTo: 'program', direction: 'gain' }), null);
    expect(targetDirection(viaProgram)).toBe('gain');
    expect(goalWordKey(viaProgram)).toBe('program.goal.gain_weight');

    const viaGoal = save(unknown, target({ appliesTo: 'goal' }), 'lose');
    expect(targetDirection(viaGoal)).toBe('lose');

    const nothing = save(unknown, null, 'lose');
    expect(targetDirection(nothing)).toBeNull();
    expect(targetGoalUnknown(nothing)).toBe(true);
    expect(acceptsTarget(nothing)).toBe(true);
    expect(goalWordKey(nothing)).toBeNull();
    // The typed value picks the checks.
    expect(validationDirection(nothing, 70, 80)).toBe('lose');
    expect(validationDirection(nothing, 85, 80)).toBe('gain');
  });

  it('pick mode follows the wizard goal and is never unknown', () => {
    const facts: TargetSheetFacts = { mode: { kind: 'pick', goal: 'gain_weight' }, livePlan: unknown, storedTarget: null, standingGoal: null };
    expect(targetDirection(facts)).toBe('gain');
    expect(targetGoalUnknown(facts)).toBe(false);
    expect(goalWordKey(facts)).toBe('program.goal.gain_weight');
  });
});

describe('what the field opens with', () => {
  it('the stored target, on the grid, when it points the same way and is not reached', () => {
    expect(targetPrefillKg(save(known('lose_weight'), target(), null))).toBe(72);
    expect(targetPrefillKg(save(known('gain_weight'), target(), null))).toBeNull();
    expect(targetPrefillKg(save(unknown, target(), null))).toBe(72);
  });

  it('a reached target opens empty, with the note', () => {
    const reached = target({ reachedAt: new Date('2026-10-01T00:00:00Z') });
    const facts = save(known('lose_weight'), reached, null);
    expect(targetPrefillKg(facts)).toBeNull();
    expect(showsReachedNote(facts)).toBe(true);
    expect(showsReachedNote(save(known('gain_weight'), reached, null))).toBe(false);
    expect(showsReachedNote(save(unknown, reached, null))).toBe(true);
  });

  it('the body sheet prefills only a target that matches the chip and is not reached', () => {
    expect(bodyTargetPrefillKg('lose', target())).toBe(72);
    expect(bodyTargetPrefillKg('gain', target())).toBeNull();
    expect(bodyTargetPrefillKg(null, target())).toBeNull();
    expect(bodyTargetPrefillKg('lose', target({ reachedAt: new Date() }))).toBeNull();
    expect(bodyShowsReachedNote(true, 'lose', target({ reachedAt: new Date() }))).toBe(true);
    expect(bodyShowsReachedNote(false, 'lose', target({ reachedAt: new Date() }))).toBe(false);
    expect(bodyShowsReachedNote(true, 'gain', target({ reachedAt: new Date() }))).toBe(false);
  });
});
