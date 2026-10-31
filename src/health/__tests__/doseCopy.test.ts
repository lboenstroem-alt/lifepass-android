/**
 * The dose of a block, as Plan and the runner say it: the port of the iOS
 * PlanSectionTests cases `testAOneSetCardioBlockIsOneStopwatchRow`,
 * `testThePlanLineReadsEveryUnit` and `testATimedBlockDosedPerSideSaysEachSide`
 * (the Plan card's line, every unit: metres once reached nobody).
 */
import { translate, type Lang } from '../../i18n';
import { decodeExerciseBlock } from '../models';
import { blockDose, exerciseLine, loadWord, RunnerFormat, type DoseTranslate } from '../doseCopy';

const tIn =
  (lang: Lang): DoseTranslate =>
  (key, params) =>
    translate(key, lang, params);
const t = tIn('en');
const icelandic = tIn('is');

const block = (json: Record<string, unknown>) => decodeExerciseBlock(json, 'block');
const line = (json: Record<string, unknown>, translateWith: DoseTranslate = t) => exerciseLine(block(json), translateWith);

describe('the unit a block is run in', () => {
  it('a one-set cardio block is one stopwatch row', () => {
    expect(blockDose(1, null, 1200, 20, null)).toEqual({ unit: 'minutes', target: 1200 });
    expect(blockDose(1, null, 40, null, null).unit).toBe('seconds'); // a one-set plank is a timed set
    expect(blockDose(4, null, null, null, 50)).toEqual({ unit: 'meters', target: 50 });
  });

  it('minutes alone never make intervals one row', () => {
    expect(blockDose(6, null, 45, 1, null)).toEqual({ unit: 'seconds', target: 45 });
    expect(blockDose(3, null, null, 2, null)).toEqual({ unit: 'seconds', target: 120 });
    expect(blockDose(3, 10, null, null, null)).toEqual({ unit: 'reps', target: 10 });
    expect(blockDose(3, -2, null, null, null)).toEqual({ unit: 'reps', target: 0 });
  });
});

describe("the Plan card's line, every unit", () => {
  it('reads every unit', () => {
    expect(line({ sets: 3, reps: 10, loadHint: 'moderate' })).toBe('3 × 10 · Moderate');
    expect(line({ sets: 3, reps: 10, loadHint: 'unknown-hint' })).toBe('3 × 10');
    expect(line({ sets: 2, reps: 8, perSide: true, loadHint: 'bodyweight' })).toBe('2 × 8 each side · Bodyweight');
    expect(line({ sets: 2, seconds: 40 })).toBe('2 × 40 s');
    expect(line({ sets: 6, seconds: 45, minutes: 1 })).toBe('6 × 45 s');
    expect(line({ sets: 3, seconds: 120, minutes: 2 })).toBe('3 × 2 min');
    expect(line({ sets: 1, seconds: 600, minutes: 10 })).toBe('10 min'); // never 1 × 600 s
    expect(line({ sets: 4, meters: 50 })).toBe('4 × 50 m'); // never 4 × 0
    expect(line({ sets: 3 })).toBe('3 sets');
    expect(line({ sets: 1 })).toBe('1 set');

    expect(line({ sets: 4, meters: 50 }, icelandic)).toBe('4 × 50 m');
    expect(line({ sets: 1, seconds: 600, minutes: 10 }, icelandic)).toBe('10 mín');
    expect(line({ sets: 2, reps: 8, perSide: true, loadHint: 'bodyweight' }, icelandic)).toBe(
      `2 × 8 hvor hlið · ${translate('plan.load.bodyweight', 'is')}`,
    );
  });

  it('a timed block dosed per side says each side', () => {
    const sidePlank = { exerciseId: 'side-plank', sets: 2, seconds: 30, perSide: true, loadHint: 'bodyweight' };
    expect(line(sidePlank)).toBe('2 × 30 s each side');
    expect(line({ sets: 2, seconds: 120, perSide: true })).toBe('2 × 2 min each side');
    expect(line({ sets: 1, seconds: 600, minutes: 10, perSide: true })).toBe('10 min each side');
    expect(line(sidePlank, icelandic)).toBe('2 × 30 sek. hvor hlið');
    // Not per side: unchanged.
    expect(line({ sets: 2, seconds: 30, perSide: false })).toBe('2 × 30 s');
  });

  it('an unknown load hint prints nothing rather than a raw key', () => {
    expect(loadWord('feather', t)).toBe('');
    expect(loadWord(null, t)).toBe('');
    expect(loadWord('heavy', t)).toBe('Heavy');
  });

  it("the runner's own words come from the same module", () => {
    expect(RunnerFormat.planLine('seconds', 45, 6, false, (key, params) => t(key, params))).toBe('6 × 45 s');
    expect(RunnerFormat.dose('seconds', 500, false, 'en')).toBe('8 minutes 20 seconds');
  });
});
