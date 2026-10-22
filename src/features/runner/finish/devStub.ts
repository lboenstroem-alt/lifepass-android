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
 * SAFETY. `fixtureArg` is null in a release bundle (`__DEV__` is false), so
 * nothing here can stand in for the server in production.
 */
import { AppState } from 'react-native';

import { ProblemError, TransportError } from '../../../api/errors';
import type { SessionActionResponse, SessionView, SkipReason } from '../../../health/models';
import { fixtureArg } from '../../../dev/fixtures';
import { useAppStore } from '../../../stores/appStore';
import type { WorkoutDoneBody } from '../model/performed';
import { setWorkoutSessionPosting, type WorkoutSessionPosting } from '../outbox/posting';
import { loadRunner } from '../persistence/runnerStore';
import { sessionFromHealthStore } from '../screen/sessionSource';

/** The modes iOS's stub knows. */
export const RUNNER_STUB_MODES = ['ok', 'offline', 'offline-then-online', 'changed', 'notactive'] as const;
export type RunnerStubMode = (typeof RUNNER_STUB_MODES)[number];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function problem(slug: string, reason: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status: 409, reason }, 409);
}

export interface RunnerStubOptions {
  /** The session a call is about, or null (the call then fails as an unreadable answer would). */
  readonly lookup: (sessionId: string) => Promise<SessionView | null>;
  /** `offline-then-online`: the app has been in the background since the stub started. */
  readonly hasBeenAway: () => boolean;
  /** How long a call takes (iOS: 400 ms for a Save, 300 ms for a skip). */
  readonly delays?: { readonly done: number; readonly skip: number };
}

/** iOS `FixtureWorkoutSessionPosting`. */
export class RunnerStubPosting implements WorkoutSessionPosting {
  constructor(
    readonly mode: RunnerStubMode,
    private readonly options: RunnerStubOptions,
  ) {}

  async done(sessionId: string, body: WorkoutDoneBody): Promise<SessionActionResponse> {
    await sleep(this.options.delays?.done ?? 400);
    const online = this.options.hasBeenAway();
    if (this.mode === 'offline') throw new TransportError('offline');
    if (this.mode === 'offline-then-online' && !online) throw new TransportError('offline');
    if (this.mode === 'changed' && body.asExtra !== true) throw problem('session_action_not_allowed', 'not_planned');
    if (this.mode === 'notactive') throw problem('session_action_not_allowed', 'program_not_active');
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

let installed = false;

/**
 * Puts the stub in for the runner's calls when the development build was
 * started with `runnerStub=<mode>`; does nothing otherwise (and always in a
 * release bundle). Returns the mode put in, or null.
 */
export function installRunnerDevStub(mode: string | null = fixtureArg('runnerStub')): RunnerStubMode | null {
  if (installed || mode === null || !(RUNNER_STUB_MODES as readonly string[]).includes(mode)) return null;
  installed = true;
  let away = false;
  AppState.addEventListener('change', (status) => {
    if (status === 'background') away = true;
  });
  const stubMode = mode as RunnerStubMode;
  setWorkoutSessionPosting(new RunnerStubPosting(stubMode, { lookup: liveLookup, hasBeenAway: () => away }));
  return stubMode;
}

/** Tests: the stub may be put in again. */
export function resetRunnerDevStubForTests(): void {
  installed = false;
  setWorkoutSessionPosting(null);
}
