/**
 * The runner's stub server for development builds: the Android twin of iOS
 * `-LPRunnerStub <mode>` (`RunnerFixtures`, `FixtureWorkoutSessionPosting`,
 * Views/Workout/WorkoutRunnerView.swift).
 *
 *   EXPO_PUBLIC_FIXTURE="runnerStub=offline-then-online" npx expo start
 *
 * WHY. Every build talks to production (DECISIONS: no staging), and a Save,
 * a Skip or a rest-of-plan swap is a production write. With this switch the
 * runner's three session calls (and the workout outbox's flush, which uses
 * the same seam) never leave the phone, so the finish sheet, the outbox and
 * the skip can be checked on a device:
 *
 *   ok                    every call answers, as the server would
 *   offline               no call ever answers (no network)
 *   offline-then-online   no answer until the app has been in the
 *                         background once (then the outbox flush sends)
 *   changed               a Save that is not an extra: "changed on another
 *                         device" (then Save as extra goes through)
 *   notactive             a Save: the plan is paused or has ended
 *
 * The answer is the session the call is about (the runner's file, or the
 * health store's read), with the status the call would set.
 *
 * A FIXTURE LAUNCH STARTS CLEAN (iOS `RunnerFixtures.resets`): with the stub
 * on, the member's `runner.json` and `outbox.json` are deleted at the first
 * activation of the launch, before the activation reads or flushes them, so
 * one run's leftovers never change another run's screen. `runnerKeep` keeps
 * them (the relaunch after a kill, the Resume frame); `runnerReset` asks for
 * the reset without the stub too. (iOS resets on any `-LPScreenshotState`
 * launch, whose profile is a fixture one; on Android the stub runs against
 * the signed-in member, so only the runner's own switches reset.)
 *
 * A SAVE THE STUB SAW NEVER REACHES THE SERVER. Plan's reads still come from
 * production, so every session the stub answers about is a real member's.
 * A Save queued under the stub (`offline`, or `offline-then-online` killed
 * before its first trip to the background) stays in `outbox.json`, and a
 * later development launch WITHOUT the stub would flush it to production as
 * a fabricated workout. So the stub writes down every Save it is handed (its
 * session and moment, which a conversion to an extra keeps, and its key)
 * before it answers, and a development launch without the stub puts a guard
 * in front of the live posting that refuses those Saves as a reused key:
 * the outbox then drops the item ("changed on another device") and a
 * resumed runner says the Save failed. The guard steps aside for the rest
 * of the launch when the stub never saw a Save.
 *
 * SAFETY. Everything here starts from `installRunnerDevStub`, which does
 * nothing unless `__DEV__` is true; a release bundle has `__DEV__ === false`
 * (and `fixtureArg` is null there), so nothing here can stand in for the
 * server, guard it or delete a file in production.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { ProblemError, TransportError } from '../../../api/errors';
import type { SessionActionResponse, SessionView, SkipReason } from '../../../health/models';
import { fixtureArg, hasFixture } from '../../../dev/fixtures';
import { useAppStore } from '../../../stores/appStore';
import type { WorkoutDoneBody } from '../model/performed';
import { wipeRunnerLocal } from '../outbox/localWipe';
import {
  liveWorkoutSessionPosting,
  setWorkoutSessionPosting,
  workoutSessionPosting,
  type WorkoutSessionPosting,
} from '../outbox/posting';
import { loadRunner } from '../persistence/runnerStore';
import { sessionFromHealthStore } from '../screen/sessionSource';

/** The modes iOS's stub knows. */
export const RUNNER_STUB_MODES = ['ok', 'offline', 'offline-then-online', 'changed', 'notactive'] as const;
export type RunnerStubMode = (typeof RUNNER_STUB_MODES)[number];

function isStubMode(mode: string): mode is RunnerStubMode {
  return (RUNNER_STUB_MODES as readonly string[]).includes(mode);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function problem(slug: string, status: number, reason?: string): ProblemError {
  return new ProblemError(
    { type: `https://lifepass.is/problems/${slug}`, status, ...(reason !== undefined ? { reason } : {}) },
    status,
  );
}

// ---------------------------------------------------------------------------
// The Saves the stub saw (development builds only)

/**
 * AsyncStorage key: the Saves a stub launch was handed. Development builds
 * only, never cleared by a sign-out (it holds opaque ids and moments, no
 * health data), so a leftover can never slip through after one.
 */
export const RUNNER_STUB_SAVES_KEY = 'dev.runner.stubSaves';

/** The newest marks kept. */
const STUB_SAVES_LIMIT = 200;

/**
 * What names one Save: its key, and its session and moment
 * (`clientCompletedAt`, fixed at the first attempt and kept by every retry
 * and by the outbox's conversion to an extra, which mints a new key).
 */
export function stubSaveMarks(sessionId: string, body: WorkoutDoneBody, idempotencyKey?: string): string[] {
  const marks: string[] = [];
  if (idempotencyKey) marks.push(`key:${idempotencyKey}`);
  const at = body.clientCompletedAt instanceof Date ? body.clientCompletedAt.getTime() : Number.NaN;
  if (Number.isFinite(at)) marks.push(`save:${sessionId}@${new Date(at).toISOString()}`);
  return marks;
}

/** The marks on this phone (empty when there are none or they cannot be read). */
export async function readRunnerStubSaves(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(RUNNER_STUB_SAVES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((mark): mark is string => typeof mark === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Marks are written one after another, so two Saves never lose each other's. */
let markChain: Promise<void> = Promise.resolve();

/** Writes `marks` down (resolves once they are on disk, or the write failed). */
export function markRunnerStubSave(marks: readonly string[]): Promise<void> {
  const run = markChain.then(async () => {
    const saved = await readRunnerStubSaves();
    const before = saved.size;
    for (const mark of marks) saved.add(mark);
    if (saved.size === before) return;
    await AsyncStorage.setItem(RUNNER_STUB_SAVES_KEY, JSON.stringify([...saved].slice(-STUB_SAVES_LIMIT)));
  });
  markChain = run.catch(() => undefined);
  return markChain;
}

// ---------------------------------------------------------------------------
// The stub

export interface RunnerStubOptions {
  /** The session a call is about, or null (the call then fails as an unreadable answer would). */
  readonly lookup: (sessionId: string) => Promise<SessionView | null>;
  /** `offline-then-online`: the app has been in the background since the stub started. */
  readonly hasBeenAway: () => boolean;
  /** How long a call takes (iOS: 400 ms for a Save, 300 ms for a skip). */
  readonly delays?: { readonly done: number; readonly skip: number };
  /** Writes a Save's marks down before it is answered (`markRunnerStubSave` in a stub launch). */
  readonly mark?: (marks: readonly string[]) => Promise<void>;
}

/** iOS `FixtureWorkoutSessionPosting`. */
export class RunnerStubPosting implements WorkoutSessionPosting {
  constructor(
    readonly mode: RunnerStubMode,
    private readonly options: RunnerStubOptions,
  ) {}

  async done(sessionId: string, body: WorkoutDoneBody, idempotencyKey?: string): Promise<SessionActionResponse> {
    // Before any answer: a Save this sends to the outbox is marked on disk first.
    await this.options.mark?.(stubSaveMarks(sessionId, body, idempotencyKey));
    await sleep(this.options.delays?.done ?? 400);
    const online = this.options.hasBeenAway();
    if (this.mode === 'offline') throw new TransportError('offline');
    if (this.mode === 'offline-then-online' && !online) throw new TransportError('offline');
    if (this.mode === 'changed' && body.asExtra !== true) throw problem('session_action_not_allowed', 409, 'not_planned');
    if (this.mode === 'notactive') throw problem('session_action_not_allowed', 409, 'program_not_active');
    return this.answer(sessionId, {
      status: 'done',
      doneSource: 'member',
      canUndo: true,
      undoAction: 'done',
      ...(body.minutes !== undefined ? { doneMinutes: body.minutes } : {}),
      ...(body.feeling !== undefined ? { feeling: body.feeling as SessionView['feeling'] } : {}),
    });
  }

  async skip(sessionId: string, reason: SkipReason): Promise<SessionActionResponse> {
    await sleep(this.options.delays?.skip ?? 300);
    if (this.mode === 'offline') throw new TransportError('offline');
    return this.answer(sessionId, { status: 'skipped', skipReason: reason, canUndo: true, undoAction: 'skip' });
  }

  async swapForRestOfPlan(sessionId: string): Promise<SessionActionResponse> {
    return this.answer(sessionId, { status: 'planned' });
  }

  /** The session the runner holds, with the status the call would set. */
  private async answer(sessionId: string, patch: Partial<SessionView>): Promise<SessionActionResponse> {
    const known = await this.options.lookup(sessionId);
    if (!known) throw new TransportError('network');
    return {
      session: { ...known, ...patch },
      changed: [],
      remark: null,
      tomorrow: null,
      nextWeekChange: null,
      week: null,
      upcoming: null,
      replayed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// The guard (a development launch without the stub)

/**
 * The live posting, except for a Save the stub saw: that one is refused as
 * a reused key, so the outbox drops it (`dropChanged`) and the finish sheet
 * says it could not be saved. Skips and swaps pass straight through.
 */
export class RunnerStubLeftoverGuard implements WorkoutSessionPosting {
  constructor(
    private readonly live: WorkoutSessionPosting,
    private readonly marked: () => Promise<ReadonlySet<string>>,
  ) {}

  async done(sessionId: string, body: WorkoutDoneBody, idempotencyKey: string): Promise<SessionActionResponse> {
    const marked = await this.marked();
    if (stubSaveMarks(sessionId, body, idempotencyKey).some((mark) => marked.has(mark))) {
      throw problem('idempotency_key_reused', 422);
    }
    return this.live.done(sessionId, body, idempotencyKey);
  }

  skip(sessionId: string, reason: SkipReason, idempotencyKey: string): Promise<SessionActionResponse> {
    return this.live.skip(sessionId, reason, idempotencyKey);
  }

  swapForRestOfPlan(
    sessionId: string,
    exerciseId: string,
    toExerciseId: string,
    idempotencyKey: string,
  ): Promise<SessionActionResponse> {
    return this.live.swapForRestOfPlan(sessionId, exerciseId, toExerciseId, idempotencyKey);
  }
}

// ---------------------------------------------------------------------------
// Install

/** The signed-in member's runner file, or the health store's read, for the stub's answers. */
async function liveLookup(sessionId: string): Promise<SessionView | null> {
  const app = useAppStore.getState();
  const memberId = app.profile?.id ?? app.userId;
  if (memberId) {
    const saved = await loadRunner(memberId.toLowerCase());
    if (saved?.sessionId === sessionId) return saved.session;
  }
  return sessionFromHealthStore(sessionId);
}

/** What this launch put in: the stub (and its mode), the guard, or nothing yet. */
let installed: { readonly kind: 'stub'; readonly mode: RunnerStubMode } | { readonly kind: 'guard' } | null = null;

/** The stub's mode in this launch, or null. */
export function runnerStubMode(): RunnerStubMode | null {
  return installed?.kind === 'stub' ? installed.mode : null;
}

/**
 * In a development build, once per launch: puts the stub in for the runner's
 * calls when the build was started with `runnerStub=<mode>` (and returns the
 * mode), else the guard in front of the live posting (and returns null).
 * Does nothing in a release bundle. `overrides` are for tests.
 */
export function installRunnerDevStub(
  mode: string | null = fixtureArg('runnerStub'),
  overrides: Partial<RunnerStubOptions> = {},
): RunnerStubMode | null {
  if (!__DEV__ || installed) return null;
  if (mode !== null && isStubMode(mode)) {
    installed = { kind: 'stub', mode };
    let away = false;
    AppState.addEventListener('change', (status) => {
      if (status === 'background') away = true;
    });
    setWorkoutSessionPosting(
      new RunnerStubPosting(mode, { lookup: liveLookup, hasBeenAway: () => away, mark: markRunnerStubSave, ...overrides }),
    );
    return mode;
  }
  installed = { kind: 'guard' };
  // Read once: nothing adds a mark in a launch without the stub.
  const marks = readRunnerStubSaves();
  const guard = new RunnerStubLeftoverGuard(liveWorkoutSessionPosting, () => marks);
  setWorkoutSessionPosting(guard);
  void marks.then((saved) => {
    // The stub never saw a Save: the live posting, as it is, for the rest of the launch.
    if (saved.size === 0 && workoutSessionPosting() === guard) setWorkoutSessionPosting(null);
  });
  return null;
}

/** iOS `RunnerFixtures.resets`, for this launch's switches (see the top of this file). */
export function runnerFixtureResets(): boolean {
  if (!__DEV__) return false;
  if (hasFixture('runnerReset')) return true;
  return hasFixture('runnerStub') && !hasFixture('runnerKeep');
}

/** The members whose files this launch has reset already. */
const resetMembers = new Set<string>();

/**
 * iOS `WorkoutRunnerSupport.activate`'s fixture reset: on a fixture launch,
 * the member's `runner.json` and `outbox.json` go before the activation
 * reads or flushes them, once per member per launch, and the queue and the
 * Resume row are forgotten. It is the runner's own local wipe (the fence
 * first, so a read already in flight adopts nothing). Null when there is
 * nothing to do, so the activation does not wait in any other launch.
 */
export function resetRunnerFilesForFixtureLaunch(memberId: string): Promise<void> | null {
  if (!runnerFixtureResets()) return null;
  const profileId = memberId.toLowerCase();
  if (resetMembers.has(profileId)) return null;
  resetMembers.add(profileId);
  // The reason is read by no runner listener; the runner's sign-out step is the same files-only wipe.
  return wipeRunnerLocal({ profileId, reason: 'signout' }, 'files');
}

/** Tests: the stub (or the guard) may be put in again, and a reset may run again. */
export function resetRunnerDevStubForTests(): void {
  installed = null;
  resetMembers.clear();
  markChain = Promise.resolve();
  setWorkoutSessionPosting(null);
}
