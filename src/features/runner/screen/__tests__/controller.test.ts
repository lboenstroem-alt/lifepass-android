/**
 * The runner's view model: the port of the iOS WorkoutRunnerModel tests in
 * LifePassTests/PlanSectionTests.swift (testARestThatEndsInTheBackground...
 * through testAChangeoverMissedWhileAwayIsNotCuedLate), with the same fake
 * alerting seam, plus what Android adds around them: the keep-awake, Leave's
 * two answers, the local wipe and the Undo of a skip.
 */
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import { deleteRunner, loadRunner } from '../../persistence/runnerStore';
import { raiseRunnerWipeFence, runnerWipeEpoch } from '../../persistence/fence';
import { perSideHoldJSON, session, t0 } from '../../model/__tests__/fixtures';
import type { RunnerState } from '../../model/types';
import type { RunnerRestAlerting } from '../../restNotification';
import { FRESH_CUE_SECONDS, RunnerController, SKIP_UNDO_MS, type RunnerCloseResult } from '../controller';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

/** iOS FakeAlerts: what the runner asked of the notification and of TalkBack. */
class FakeAlerts implements RunnerRestAlerting {
  scheduled: Date[] = [];
  cancels = 0;
  announcements: string[] = [];
  schedule(endsAt: Date): void {
    this.scheduled.push(endsAt);
  }
  cancel(): void {
    this.cancels += 1;
  }
  announce(text: string): void {
    this.announcements.push(text);
  }
}

class Cues {
  ticks = 0;
  restsFinished = 0;
  switches = 0;
  setTicked = () => {
    this.ticks += 1;
  };
  restFinished = () => {
    this.restsFinished += 1;
  };
  switchSides = () => {
    this.switches += 1;
  };
}

let clockNow = t0;
let awake: boolean[] = [];
let events: { event: string; params: AnalyticsParams }[] = [];

function plus(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function model(
  options: { alerts?: FakeAlerts; cues?: Cues; blocks?: string; restored?: RunnerState | null; wipeEpoch?: number } = {},
): { runner: RunnerController; alerts: FakeAlerts; cues: Cues; closes: RunnerCloseResult[] } {
  const alerts = options.alerts ?? new FakeAlerts();
  const cues = options.cues ?? new Cues();
  const runner = new RunnerController({
    session: session({ blocks: options.blocks }),
    restored: options.restored ?? null,
    profileId: MEMBER,
    language: 'en',
    entry: 'today',
    alerts,
    cues,
    keepAwake: (value) => awake.push(value),
    clock: () => clockNow,
    today: '2026-09-16',
    wipeEpoch: options.wipeEpoch,
  });
  const closes: RunnerCloseResult[] = [];
  runner.onClose = (result) => closes.push(result);
  return { runner, alerts, cues, closes };
}

beforeEach(() => {
  clockNow = t0;
  awake = [];
  events = [];
  RunnerProgressIndex.reset();
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(() => {
  setAnalyticsObserver(null);
});

describe('the rest alert (iOS 19.1)', () => {
  it('testARestThatEndsInTheBackgroundLeavesItsAlertOnTheLockScreen', () => {
    const { runner, alerts, cues } = model();
    runner.completeNextSet();
    const endsAt = runner.state.restEndsAt!;
    expect(endsAt).toEqual(plus(t0, 90));

    runner.appStateChanged(false);
    expect(alerts.scheduled).toEqual([endsAt]);
    const cancelsBefore = alerts.cancels;

    // The process is still alive when the rest ends (the seconds after the
    // phone locks): the state clears, the alert stays.
    runner.tick(plus(endsAt, 0.2));
    expect(runner.state.restEndsAt).toBeNull();
    expect(alerts.cancels).toBe(cancelsBefore);
    expect(alerts.announcements).toEqual([]);
    expect(runner.restFinishedCount).toBe(0);
    expect(cues.restsFinished).toBe(0);

    // Coming back removes it.
    clockNow = plus(endsAt, 30);
    runner.appStateChanged(true);
    expect(alerts.cancels).toBe(cancelsBefore + 1);
    expect(alerts.announcements).toEqual([]);
  });

  it('testARestThatEndsOnScreenIsAnnounced', () => {
    const { runner, alerts, cues } = model();
    runner.completeNextSet();
    const endsAt = runner.state.restEndsAt!;
    expect(alerts.scheduled).toEqual([]);
    runner.tick(plus(endsAt, 0.3));
    expect(alerts.announcements).toEqual(['Rest is over']);
    expect(runner.restFinishedCount).toBe(1);
    expect(cues.restsFinished).toBe(1);
    expect(alerts.cancels).toBeGreaterThan(0);
  });

  it('a rest ended on screen but noticed late (a stalled phone) is not announced', () => {
    const { runner, alerts } = model();
    runner.completeNextSet();
    runner.tick(plus(runner.state.restEndsAt!, FRESH_CUE_SECONDS));
    expect(runner.state.restEndsAt).toBeNull();
    expect(alerts.announcements).toEqual([]);
    expect(runner.restFinishedCount).toBe(0);
  });

  it('a rest that starts in the background (a hold that ran out) schedules its alert then', () => {
    const { runner, alerts } = model();
    runner.advance();
    runner.advance();
    runner.performPrimary(() => undefined);
    const timer = runner.state.timer!;
    runner.appStateChanged(false);
    expect(alerts.scheduled).toEqual([]);
    runner.tick(plus(timer.endsAt, 0.4));
    expect(runner.state.exercises[2]!.sets[0]!.done).toBe(true);
    expect(alerts.scheduled).toEqual([plus(timer.endsAt, 45)]);
    expect(runner.tickCount).toBe(0);
  });

  it('two reports of one departure schedule once', () => {
    const { runner, alerts } = model();
    runner.completeNextSet();
    runner.appStateChanged(false);
    runner.appStateChanged(false);
    expect(alerts.scheduled).toHaveLength(1);
  });

  it('skipping the rest and moving it to zero cancel the alert, and neither is announced', () => {
    const { runner, alerts } = model();
    runner.completeNextSet();
    const before = alerts.cancels;
    runner.adjustRest(-15);
    expect(runner.state.restEndsAt).toEqual(plus(t0, 75));
    expect(alerts.cancels).toBe(before);
    runner.adjustRest(15);
    runner.adjustRest(15);
    expect(runner.state.restTotalSeconds).toBe(105);
    runner.skipRest();
    expect(runner.state.restEndsAt).toBeNull();
    expect(alerts.cancels).toBe(before + 1);

    runner.completeNextSet();
    clockNow = plus(t0, 80);
    runner.adjustRest(-15);
    expect(runner.state.restEndsAt).toBeNull();
    expect(alerts.cancels).toBe(before + 2);
    expect(alerts.announcements).toEqual([]);
  });

  it('a set cannot be completed while resting', () => {
    const { runner } = model();
    runner.completeNextSet();
    runner.completeNextSet();
    expect(runner.state.exercises[0]!.sets.map((set) => set.done)).toEqual([true, false, false]);
  });

  it('the rest is spoken in 15 second steps, rounded up', () => {
    const { runner } = model();
    runner.completeNextSet();
    runner.tick(plus(t0, 1.2));
    expect(runner.restRemaining).toBe(89);
    expect(runner.restAccessibilityValue).toBe('1 minute 30 seconds left');
    runner.tick(plus(t0, 80.5));
    expect(runner.restAccessibilityValue).toBe('15 seconds left');
    expect(runner.restFraction).toBeCloseTo(10 / 90);
  });
});

describe('timed sets on screen', () => {
  it('testAHoldThatEndedWhileAwayDoesNotRestAgainOnTheReturn', () => {
    const { runner, alerts } = model();
    runner.advance();
    runner.advance();
    runner.performPrimary(() => undefined);
    const endsAt = runner.state.timer!.endsAt;

    // The plank (rest 45 s) ended while the app was suspended; the first
    // tick after the return comes 50 s later.
    runner.tick(plus(endsAt, 50));
    expect(runner.state.exercises[2]!.sets[0]!.done).toBe(true);
    expect(runner.state.exercises[2]!.sets[0]!.value).toBe(40);
    expect(runner.state.restEndsAt).toBeNull();
    expect(runner.isResting).toBe(false);
    expect(alerts.announcements).toEqual([]);
  });

  it('testTheChangeoverIsCuedOnceOnScreen', () => {
    const { runner, alerts, cues } = model({ blocks: perSideHoldJSON });
    runner.performPrimary(() => undefined);
    const timer = runner.state.timer!;
    expect(timer).not.toBeNull();
    const switchAt = plus(timer.startedAt, timer.sideSeconds!);

    runner.tick(plus(switchAt, -1));
    expect(runner.timerPhase(0, 0)).toEqual({ kind: 'side', side: 1, remaining: 1 });
    expect(alerts.announcements).toEqual([]);

    runner.tick(plus(switchAt, 0.4));
    expect(alerts.announcements).toEqual(['Switch sides']);
    expect(runner.switchSidesCount).toBe(1);
    expect(cues.switches).toBe(1);
    expect(runner.timerPhase(0, 0)).toEqual({ kind: 'switching', remaining: 5 });
    expect(runner.state.exercises[0]!.sets[0]!.done).toBe(false);

    runner.tick(plus(switchAt, 2));
    runner.tick(plus(switchAt, 6));
    expect(alerts.announcements).toEqual(['Switch sides']);
    expect(runner.timerPhase(0, 0)).toEqual({ kind: 'side', side: 2, remaining: 19 });

    runner.tick(plus(timer.endsAt, 0.2));
    expect(runner.state.exercises[0]!.sets[0]!.done).toBe(true);
    expect(runner.state.restEndsAt).toEqual(plus(timer.endsAt, 15));
  });

  it('testAChangeoverMissedWhileAwayIsNotCuedLate', () => {
    const { runner, alerts } = model({ blocks: perSideHoldJSON });
    runner.performPrimary(() => undefined);
    const timer = runner.state.timer!;
    const switchAt = plus(timer.startedAt, timer.sideSeconds!);
    runner.tick(plus(switchAt, 12));
    expect(alerts.announcements).toEqual([]);
    expect(runner.switchSidesCount).toBe(0);
    expect(runner.timerPhase(0, 0)).toEqual({ kind: 'side', side: 2, remaining: 13 });
  });

  it('a changeover reached in the background is not cued, then or on the return', () => {
    const { runner, alerts } = model({ blocks: perSideHoldJSON });
    runner.performPrimary(() => undefined);
    const timer = runner.state.timer!;
    const switchAt = plus(timer.startedAt, timer.sideSeconds!);
    runner.appStateChanged(false);
    runner.tick(plus(switchAt, 0.5));
    clockNow = plus(switchAt, 1);
    runner.appStateChanged(true);
    expect(alerts.announcements).toEqual([]);
    expect(runner.switchSidesCount).toBe(0);
  });

  it('a timed set stopped from its capsule logs nothing and stops counting', () => {
    const { runner } = model();
    runner.advance();
    runner.advance();
    runner.toggleTimer(2, 1);
    expect(runner.timerPhase(2, 1)).toEqual({ kind: 'single', remaining: 40 });
    expect(runner.timerPhase(2, 0)).toBeNull();
    runner.toggleTimer(2, 1);
    expect(runner.state.timer).toBeNull();
    expect(runner.state.exercises[2]!.sets[1]!.done).toBe(false);
  });

  it('the stopwatch reads whole seconds while it runs', () => {
    const { runner } = model();
    runner.toggleStopwatch(3);
    expect(runner.stopwatchSeconds(3)).toBe(0);
    runner.tick(plus(t0, 61.7));
    expect(runner.stopwatchSeconds(3)).toBe(61);
    expect(runner.stopwatchSeconds(0)).toBeNull();
  });
});

describe('keep-awake (7.4)', () => {
  it('is on only while a rest, a timed set or a stopwatch counts', () => {
    const { runner } = model();
    runner.appeared();
    expect(awake.at(-1)).toBe(false);

    runner.completeNextSet();
    expect(awake.at(-1)).toBe(true);
    runner.skipRest();
    expect(awake.at(-1)).toBe(false);

    runner.advance();
    runner.advance();
    runner.startNextTimer();
    expect(awake.at(-1)).toBe(true);
    runner.toggleTimer(2, 0);
    expect(awake.at(-1)).toBe(false);

    runner.toggleStopwatch(3);
    expect(awake.at(-1)).toBe(true);
    runner.toggleStopwatch(3);
    expect(awake.at(-1)).toBe(false);
  });

  it('is released when the screen goes and when the runner closes', () => {
    const { runner } = model();
    runner.completeNextSet();
    expect(awake.at(-1)).toBe(true);
    runner.disappeared();
    expect(awake.at(-1)).toBe(false);
    runner.completeNextSet();
    runner.leaveLater();
    expect(awake.at(-1)).toBe(false);
  });

  it('follows a rest that runs out on screen', () => {
    const { runner } = model();
    runner.completeNextSet();
    runner.tick(plus(t0, 91));
    expect(awake.at(-1)).toBe(false);
  });
});

describe('opening', () => {
  it('counts the start once, with the entry it was opened from', () => {
    const { runner } = model();
    runner.appeared();
    runner.appeared();
    expect(events).toEqual([{ event: 'workout_started', params: { kind: 'strength', entry: 'today' } }]);
  });

  it("resumes this session's saved workout as `resume`, and writes it down at once", async () => {
    const first = model().runner;
    first.completeNextSet();
    first.leaveLater();
    const saved = await loadRunner(MEMBER);
    expect(saved?.exercises[0]!.sets[0]!.done).toBe(true);

    clockNow = plus(t0, 4 * 3600);
    const { runner } = model({ restored: saved });
    expect(runner.entry).toBe('resume');
    // testAResumedWorkoutDoesNotClaimTheTimeAway: "later" credited nothing.
    expect(runner.elapsedSeconds).toBe(0);
    runner.appeared();
    expect(events.at(-1)).toEqual({ event: 'workout_started', params: { kind: 'strength', entry: 'resume' } });
    // The rest ran out during the four hours.
    expect(runner.state.restEndsAt).toBeNull();
  });

  it("another session's saved workout is not resumed", async () => {
    const saved = model().runner;
    saved.completeNextSet();
    const other = { ...saved.state, sessionId: 'sess-other' };
    const { runner } = model({ restored: other });
    expect(runner.entry).toBe('today');
    expect(runner.state.exercises[0]!.sets[0]!.done).toBe(false);
  });
});

describe('Leave (7.8)', () => {
  it('"Finish later today" stops the clock with no credit, keeps the file and closes', async () => {
    const { runner, alerts, closes } = model();
    runner.completeNextSet();
    clockNow = plus(t0, 20 * 60);
    runner.leaveLater();
    expect(closes).toEqual([{ kind: 'later' }]);
    expect(events.at(-1)).toEqual({ event: 'workout_left', params: { choice: 'later' } });
    expect(alerts.cancels).toBeGreaterThan(0);
    const saved = await loadRunner(MEMBER);
    expect(saved?.clockRunningSince).toBeNull();
    expect(saved?.clockAwaySince).toBeNull();
    expect(saved?.clockSeconds).toBe(20 * 60);
  });

  it('"Discard workout" deletes the file, cancels the alert and closes', async () => {
    const { runner, alerts, closes } = model();
    runner.completeNextSet();
    expect(await loadRunner(MEMBER)).not.toBeNull();
    runner.discard();
    expect(closes).toEqual([{ kind: 'discarded' }]);
    expect(events.at(-1)).toEqual({ event: 'workout_left', params: { choice: 'discard' } });
    expect(alerts.cancels).toBeGreaterThan(0);
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('closes once, and writes nothing after', async () => {
    const { runner, closes } = model();
    runner.discard();
    runner.leaveLater();
    runner.completeNextSet();
    expect(closes).toEqual([{ kind: 'discarded' }]);
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('Skip this workout is offered only before any set is done, on a session that can be skipped', () => {
    const { runner } = model();
    expect(runner.canSkipWorkout).toBe(true);
    runner.completeNextSet();
    expect(runner.canSkipWorkout).toBe(false);
  });
});

describe('the local wipe', () => {
  it('closes as discarded and writes nothing back', async () => {
    const { runner, alerts, closes } = model();
    runner.completeNextSet();
    await loadRunner(MEMBER);
    // The wipe: the folder goes, the fence goes up, the runner is told.
    await deleteRunner(MEMBER);
    raiseRunnerWipeFence();
    runner.wiped();
    expect(closes).toEqual([{ kind: 'discarded' }]);
    expect(alerts.cancels).toBeGreaterThan(0);
    expect(awake.at(-1)).toBe(false);
    // The rest runs out after it: still nothing written.
    runner.tick(plus(t0, 200));
    runner.appeared();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('a runner opened before a wipe writes nothing after it', async () => {
    const { runner } = model();
    raiseRunnerWipeFence();
    expect(runner.wasWiped).toBe(true);
    runner.completeNextSet();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('a runner built from a read the wipe overtook is fenced by the epoch before that read', async () => {
    const beforeRead = runnerWipeEpoch();
    raiseRunnerWipeFence();
    const { runner } = model({ wipeEpoch: beforeRead });
    expect(runner.wasWiped).toBe(true);
    runner.completeNextSet();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('a runner closed before it appeared is never counted as started', () => {
    const { runner } = model();
    runner.wiped();
    runner.appeared();
    expect(events.map((entry) => entry.event)).not.toContain('workout_started');
  });
});

describe('skip and Undo (7.6)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['Date'] }));
  afterEach(() => jest.useRealTimers());

  it('skips, moves on, offers Undo for four seconds, and Undo puts it back', () => {
    const { runner } = model();
    runner.skipExercise();
    expect(runner.state.index).toBe(1);
    expect(runner.state.exercises[0]!.skipped).toBe(true);
    expect(runner.getSnapshot().skipToastKey).toBe('runner.skipped_toast');
    expect(runner.getSnapshot().skipUndo).not.toBeNull();
    expect(events.at(-1)).toEqual({ event: 'workout_exercise_skipped', params: {} });

    runner.undoSkip();
    expect(runner.state.index).toBe(0);
    expect(runner.state.exercises[0]!.skipped).toBe(false);
    expect(runner.getSnapshot().skipUndo).toBeNull();
  });

  it('after a set it says only the rest was skipped, and the Undo goes after four seconds', () => {
    const { runner } = model();
    runner.completeNextSet();
    runner.skipRest();
    runner.skipExercise();
    expect(runner.state.exercises[0]!.endedEarly).toBe(true);
    expect(runner.getSnapshot().skipToastKey).toBe('runner.skipped_rest_toast');
    jest.advanceTimersByTime(SKIP_UNDO_MS - 1);
    expect(runner.getSnapshot().skipUndo).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(runner.getSnapshot().skipUndo).toBeNull();
  });

  it('a second skip restarts the four seconds', () => {
    const { runner } = model();
    runner.skipExercise();
    jest.advanceTimersByTime(3000);
    runner.skipExercise();
    jest.advanceTimersByTime(3000);
    expect(runner.getSnapshot().skipUndo?.exercise).toBe(1);
    expect(runner.getSnapshot().skipToastId).toBe(2);
  });
});

describe('the clock on screen', () => {
  it('publishes once per displayed second', () => {
    const { runner } = model();
    const seen: Date[] = [];
    runner.subscribe(() => seen.push(runner.now));
    runner.tick(plus(t0, 0.4));
    runner.tick(plus(t0, 0.9));
    runner.tick(plus(t0, 1.1));
    expect(seen).toEqual([plus(t0, 1.1)]);
    expect(runner.elapsedSeconds).toBe(1);
  });

  it('is written down every 30 seconds while it runs', async () => {
    const { runner } = model();
    runner.appeared();
    clockNow = plus(t0, 20);
    runner.tick(clockNow);
    expect((await loadRunner(MEMBER))?.lastSeenAt).toEqual(t0);
    clockNow = plus(t0, 31);
    runner.tick(clockNow);
    expect((await loadRunner(MEMBER))?.lastSeenAt).toEqual(plus(t0, 31));
  });

  it('leaving the app stops it, coming back credits the time away', () => {
    const { runner } = model();
    clockNow = plus(t0, 60);
    runner.appStateChanged(false);
    clockNow = plus(t0, 240);
    runner.appStateChanged(true);
    runner.tick(plus(t0, 240));
    expect(runner.elapsedSeconds).toBe(240);
  });
});
