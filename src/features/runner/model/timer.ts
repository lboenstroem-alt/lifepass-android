/**
 * A timed set counting down in place: the Android port of iOS `RunnerTimer`
 * (Views/Workout/WorkoutRunnerView.swift). Every phase is read from dates,
 * so a countdown restored after a relaunch is where it would have been.
 */
import { roundHalfAwayFromZero } from '../../../i18n/format';

import { TIMER_SWITCH_SECONDS, type RunnerTimer, type RunnerTimerPhase } from './types';

/** A countdown for `seconds` (one side's), each side or once. */
export function startRunnerTimer(options: {
  readonly exercise: number;
  readonly set: number;
  readonly seconds: number;
  readonly perSide: boolean;
  readonly now: Date;
}): RunnerTimer {
  const side = Math.max(1, options.seconds);
  const total = options.perSide ? side * 2 + TIMER_SWITCH_SECONDS : side;
  return {
    exercise: options.exercise,
    set: options.set,
    startedAt: options.now,
    endsAt: new Date(options.now.getTime() + total * 1000),
    sideSeconds: options.perSide ? side : null,
  };
}

export function isPerSideTimer(timer: RunnerTimer): boolean {
  return timer.sideSeconds !== null;
}

/** When the changeover starts; null for a hold done once. */
export function switchStartsAt(timer: RunnerTimer): Date | null {
  return timer.sideSeconds === null ? null : new Date(timer.startedAt.getTime() + timer.sideSeconds * 1000);
}

/** When side 2 starts; null for a hold done once. */
export function secondSideStartsAt(timer: RunnerTimer): Date | null {
  return timer.sideSeconds === null
    ? null
    : new Date(timer.startedAt.getTime() + (timer.sideSeconds + TIMER_SWITCH_SECONDS) * 1000);
}

/** Whole seconds from `now` to `end`, rounded up. */
function secondsLeft(end: Date, now: Date): number {
  return Math.ceil((end.getTime() - now.getTime()) / 1000);
}

/** Where a counting set is at `now`: one hold, side 1, the changeover, side 2, or over. */
export function timerPhase(timer: RunnerTimer, now: Date): RunnerTimerPhase {
  if (timer.endsAt.getTime() <= now.getTime()) return { kind: 'ended' };
  const switchAt = switchStartsAt(timer);
  const secondAt = secondSideStartsAt(timer);
  if (!switchAt || !secondAt) return { kind: 'single', remaining: secondsLeft(timer.endsAt, now) };
  if (now.getTime() < switchAt.getTime()) return { kind: 'side', side: 1, remaining: secondsLeft(switchAt, now) };
  if (now.getTime() < secondAt.getTime()) return { kind: 'switching', remaining: secondsLeft(secondAt, now) };
  return { kind: 'side', side: 2, remaining: secondsLeft(timer.endsAt, now) };
}

/**
 * The seconds to log for a set ended at `now`: what was held, and for a set
 * dosed each side the mean of the two sides (what the set's `seconds`
 * means), so stopping during side 1 never logs side 1 as if both were done.
 */
export function timerHeld(timer: RunnerTimer, now: Date): number {
  const end = Math.min(now.getTime(), timer.endsAt.getTime());
  const elapsed = Math.max(0, (end - timer.startedAt.getTime()) / 1000);
  if (timer.sideSeconds === null) return roundHalfAwayFromZero(elapsed);
  const side = timer.sideSeconds;
  const first = Math.min(elapsed, side);
  const second = Math.min(side, Math.max(0, elapsed - side - TIMER_SWITCH_SECONDS));
  return roundHalfAwayFromZero((first + second) / 2);
}
