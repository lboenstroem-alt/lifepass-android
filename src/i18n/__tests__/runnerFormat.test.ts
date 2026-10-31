// The workout runner's words (iOS RunnerFormat). Ports
// PlanSectionTests.testTheDoseReadsAsWordsInBothLanguages,
// testTheCountingCapsuleNamesTheSide and testTheSummaryIsCountedInBothLanguages
// with the same vectors, and the RunnerFormat assertions of
// testIntervalBlocksKeepEverySetAndTheirSeconds,
// testATimedBlockDosedPerSideSaysEachSide,
// testAHoldDosedEachSideCountsDownOncePerSide and the dead bug's plan line.
import { translate } from '..';
import { RunnerFormat, type RunnerTranslate } from '../runnerFormat';

/** The Swift tests' `t`: English lookup and fill. */
const t: RunnerTranslate = (key, params) => translate(key, 'en', params);
/** The Swift tests' `icelandic`. */
const icelandic: RunnerTranslate = (key, params) => translate(key, 'is', params);

describe('the dose in words (testTheDoseReadsAsWordsInBothLanguages)', () => {
  it('reads every unit in both languages, with the Icelandic plural rule', () => {
    expect(RunnerFormat.dose('reps', 1, false, 'en')).toBe('1 rep');
    expect(RunnerFormat.dose('reps', 12, true, 'en')).toBe('12 reps each side');
    expect(RunnerFormat.dose('seconds', 40, false, 'en')).toBe('40 seconds');
    expect(RunnerFormat.dose('meters', 100, false, 'en')).toBe('100 metres');
    expect(RunnerFormat.dose('minutes', 1200, false, 'en')).toBe('20 minutes');
    expect(RunnerFormat.dose('reps', 21, false, 'is')).toBe('21 endurtekning');
    expect(RunnerFormat.dose('reps', 11, false, 'is')).toBe('11 endurtekningar');
    expect(RunnerFormat.dose('reps', 8, true, 'is')).toBe('8 endurtekningar hvor hlið');
    expect(RunnerFormat.dose('seconds', 120, false, 'is')).toBe('2 mínútur');
    expect(RunnerFormat.clock(65)).toBe('1:05');
    expect(RunnerFormat.timerAmount(45)).toBeNull();
    expect(RunnerFormat.timerAmount(120)).toBe('2:00');
  });

  it('says a timed set of a minute or more in minutes, never as 500 seconds (testIntervalBlocksKeepEverySetAndTheirSeconds)', () => {
    expect(RunnerFormat.dose('seconds', 120, false, 'en')).toBe('2 minutes');
    expect(RunnerFormat.dose('seconds', 500, false, 'en')).toBe('8 minutes 20 seconds');
  });

  it('says each side for reps and seconds only (testATimedBlockDosedPerSideSaysEachSide)', () => {
    expect(RunnerFormat.dose('seconds', 30, true, 'en')).toBe('30 seconds each side');
    expect(RunnerFormat.dose('seconds', 30, true, 'is')).toBe('30 sekúndur hvor hlið');
    expect(RunnerFormat.dose('meters', 100, true, 'en')).toBe('100 metres');
    expect(RunnerFormat.dose('seconds', 20, true, 'en')).toBe('20 seconds each side');
    expect(t('runner.next_set_line', { n: '1', total: '2', dose: RunnerFormat.dose('seconds', 20, true, 'en') })).toBe(
      'Set 1 of 2: 20 seconds each side',
    );
  });

  it('groups a count in the account language', () => {
    expect(RunnerFormat.dose('meters', 1200, false, 'is')).toBe('1.200 metrar');
    expect(RunnerFormat.dose('meters', 1200, false, 'en')).toBe('1,200 metres');
    expect(RunnerFormat.counted('runner.dose.reps', 101, 'is')).toBe('101 endurtekning');
  });
});

describe('the clock and the spoken duration', () => {
  it('writes m:ss under an hour and h:mm:ss from one', () => {
    expect(RunnerFormat.clock(9)).toBe('0:09');
    expect(RunnerFormat.clock(600)).toBe('10:00');
    expect(RunnerFormat.clock(3605)).toBe('1:00:05');
    expect(RunnerFormat.clock(-4)).toBe('0:00');
    // A fraction of a second (ms / 1000) is never printed.
    expect(RunnerFormat.clock(65.4)).toBe('1:05');
  });

  it('says the minutes and the seconds in words for TalkBack', () => {
    expect(RunnerFormat.spokenDuration(90, 'en')).toBe('1 minute 30 seconds');
    expect(RunnerFormat.spokenDuration(120, 'en')).toBe('2 minutes');
    expect(RunnerFormat.spokenDuration(0, 'en')).toBe('0 seconds');
    expect(RunnerFormat.spokenDuration(81, 'is')).toBe('1 mínúta 21 sekúnda');
  });
});

describe('the plan line (PlanSectionTests)', () => {
  it('reads every unit (testIntervalBlocksKeepEverySetAndTheirSeconds and the per-side holds)', () => {
    expect(RunnerFormat.planLine('seconds', 45, 6, false, t)).toBe('6 × 45 s');
    expect(RunnerFormat.planLine('seconds', 120, 3, false, t)).toBe('3 × 2 min');
    expect(RunnerFormat.planLine('seconds', 500, 3, false, t)).toBe('3 × 500 s');
    expect(RunnerFormat.planLine('seconds', 30, 2, true, t)).toBe('2 × 30 s each side');
    expect(RunnerFormat.planLine('seconds', 20, 2, true, t)).toBe('2 × 20 s each side');
    expect(RunnerFormat.planLine('reps', 10, 2, true, t)).toBe('2 × 10 each side');
  });

  it('writes metres, stopwatch minutes and the load word as the Swift does', () => {
    expect(RunnerFormat.planLine('reps', 10, 3, false, t)).toBe('3 × 10');
    expect(RunnerFormat.planLine('meters', 50, 4, false, t)).toBe('4 × 50 m');
    expect(RunnerFormat.planLine('minutes', 1200, 1, false, t)).toBe('20 min');
    expect(RunnerFormat.planLine('minutes', 10, 1, false, t)).toBe('1 min');
    expect(RunnerFormat.planLine('seconds', 120, 2, true, icelandic)).toBe('2 × 2 mín hvor hlið');
    expect(RunnerFormat.planLine('reps', 10, 3, false, t, 'moderate')).toBe('3 × 10 · moderate');
    // The load word follows reps and seconds only.
    expect(RunnerFormat.planLine('meters', 50, 4, false, t, 'moderate')).toBe('4 × 50 m');
  });
});

describe('the counting capsule (testTheCountingCapsuleNamesTheSide)', () => {
  it('names the side, in both languages and for TalkBack', () => {
    expect(RunnerFormat.timerTitle({ kind: 'single', remaining: 25 }, t)).toBe('25 s left');
    expect(RunnerFormat.timerTitle({ kind: 'single', remaining: 65 }, t)).toBe('1:05 left');
    expect(RunnerFormat.timerTitle({ kind: 'side', side: 1, remaining: 25 }, t)).toBe('Side 1: 25 s left');
    expect(RunnerFormat.timerTitle({ kind: 'side', side: 2, remaining: 65 }, t)).toBe('Side 2: 1:05 left');
    expect(RunnerFormat.timerTitle({ kind: 'switching', remaining: 4 }, t)).toBe('Switch sides: 4 s');
    expect(RunnerFormat.timerTitle({ kind: 'side', side: 1, remaining: 25 }, icelandic)).toBe('Hlið 1: 25 sek. eftir');
    expect(RunnerFormat.timerTitle({ kind: 'switching', remaining: 4 }, icelandic)).toBe('Skiptu um hlið: 4 sek.');
    expect(RunnerFormat.timerSpoken({ kind: 'side', side: 2, remaining: 25 }, 'en', t)).toBe('Side 2: 25 seconds left');
    expect(RunnerFormat.timerSpoken({ kind: 'side', side: 1, remaining: 21 }, 'is', icelandic)).toBe('Hlið 1: 21 sekúnda eftir');
    expect(RunnerFormat.timerSpoken({ kind: 'switching', remaining: 3 }, 'en', t)).toBe('Switch sides');
  });

  it('reads zero when the countdown is over', () => {
    expect(RunnerFormat.timerTitle({ kind: 'ended' }, t)).toBe('0 s left');
    expect(RunnerFormat.timerSpoken({ kind: 'ended' }, 'en', t)).toBe('0 seconds left');
  });
});

describe('the finish line (testTheSummaryIsCountedInBothLanguages)', () => {
  it('counts exercises and sets in both languages', () => {
    expect(RunnerFormat.summary({ exercises: 1, total: 5, sets: 2 }, 'en')).toBe('1 of 5 exercises · 2 sets');
    expect(RunnerFormat.summary({ exercises: 1, total: 4, sets: 1 }, 'en')).toBe('1 of 4 exercises · 1 set');
    expect(RunnerFormat.summary({ exercises: 1, total: 1, sets: 3 }, 'en')).toBe('1 of 1 exercise · 3 sets');
    expect(RunnerFormat.summary({ exercises: 0, total: 4, sets: 0 }, 'en')).toBe('0 of 4 exercises · 0 sets');
    expect(RunnerFormat.summary({ exercises: 2, total: 4, sets: 5 }, 'is')).toBe('2 af 4 æfingum · 5 sett');
    expect(RunnerFormat.summary({ exercises: 1, total: 1, sets: 1 }, 'is')).toBe('1 af 1 æfingu · 1 sett');
    expect(RunnerFormat.summary({ exercises: 3, total: 21, sets: 21 }, 'is')).toBe('3 af 21 æfingu · 21 sett');
  });

  it('writes a load with the Icelandic comma', () => {
    expect(RunnerFormat.kg(12.5, 'is')).toBe('12,5');
    expect(RunnerFormat.kg(12.5, 'en')).toBe('12.5');
    expect(RunnerFormat.kg(20, 'en')).toBe('20');
  });
});
