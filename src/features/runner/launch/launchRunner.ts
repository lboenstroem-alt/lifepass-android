/**
 * Opening the workout runner: the Android port of iOS PlanView's
 * `presentRunner`, `resumeSavedRunner` and `launchRunner`, and of the
 * `runnerConflictAlert` (Views/Plan/PlanView.swift,
 * Views/Workout/WorkoutRunnerView.swift).
 *
 * Every door to the runner comes through here (`openRunner` in ../index.ts):
 * Start on the Today card and in the session preview, Home's Start (parked
 * for Plan), "Do it now" on a missed row, and Resume.
 *
 *   1. SAVED ON THIS PHONE, WAITING TO SYNC. A finished workout still in the
 *      outbox is done as far as the member is concerned, and a second run
 *      would log it twice: "Saved on this phone. It will sync when you're
 *      back online." and nothing opens.
 *   2. ONE FILE, SO NEVER A SILENT OVERWRITE. `runner.json` is read and the
 *      pure rule (./decision.ts) decides: open (restored when the file is
 *      this session's), replace another session's untouched file, or ask
 *      about another session's workout with sets logged ("Resume that
 *      workout" / "Discard it and start this one" / Cancel).
 *   3. RESUME FROM THE FILE (only the session's id is known, iOS
 *      `resumeSavedRunner`): a file that has gone or outlived its day opens
 *      nothing, and the Resume row is read again.
 *
 * THE ENTRY. Given the whole session (Plan's rows), the entry is worked out
 * from it as iOS `launchRunner` does: `resume` when the file is restored,
 * `missed` for a missed row or one dated before today ("Do it now", whose
 * file is then kept until the day after TODAY), else `today`. Given only an
 * id, the caller's entry stands.
 *
 * The session itself is handed to the runner screen (its route carries only
 * the id), so the exact row the member tapped opens, a past date's too.
 *
 * Starting offline is allowed: the session comes from the cached read or
 * from `runner.json`, never from the network.
 */
// The dialog alone (not the UI kit barrel): the runner's index, which every
// Plan and launch module imports, must not load the kit's icon fonts.
import { showDialog } from '../../../components/ui/Dialog';
import { useHealthStore } from '../../../health/store';
import type { SessionView } from '../../../health/models';
import { currentLanguage, translate } from '../../../i18n';
import { shortDay, todayServerDay } from '../../../i18n/format';
import { errorDescription, track } from '../../../lib/analytics';
import { openRootModal, rootRouteName } from '../../../navigation/navigationRef';
import { useAppStore } from '../../../stores/appStore';
import { RunnerAnalytics } from '../model/analytics';
import type { RunnerEntry, RunnerState } from '../model/types';
import { activateWorkoutOutbox, hasPendingWorkoutNow, useWorkoutOutbox } from '../outbox/workoutOutbox';
import { runnerWipeEpoch, wipedSince } from '../persistence/fence';
import { deleteRunner, loadRunner, refreshRunnerProgress } from '../persistence/runnerStore';
import { onRunnerWiped } from '../persistence/wiped';
import { handRunnerSession } from '../screen/sessionSource';

import { decideRunnerLaunch, runnerEntryFor } from './decision';

/** What `openRunner` needs of a session: its id (a full session is handed to the screen as well). */
export interface RunnerSessionRef {
  readonly id: string;
}

/** What became of a request to open the runner (for tests and the caller's own bookkeeping). */
export type RunnerLaunchOutcome =
  /** The runner route was opened. */
  | 'opened'
  /** The session waits in the outbox: the toast says so, nothing opens. */
  | 'pending'
  /** Another session's workout has sets logged: the member was asked. */
  | 'asked'
  /** A runner is already up, the member is being asked, or another request is still deciding. */
  | 'busy'
  /** Nothing to open: no member, a Resume with no file, a wipe while the file was read, or no navigator. */
  | 'nothing';

/** The route name, as navigation's root state names it. */
const RUNNER_ROUTE = 'WorkoutRunner';

/** A request is reading the file or the queue: a second tap waits for it rather than opening twice. */
let deciding = false;
/** "Another workout is in progress" is on screen (iOS `runnerConflict != nil`). */
let asking = false;
let stopHearingWipe: (() => void) | null = null;

/** The signed-in member's id, as their health folder is named (the runner screen reads the same). */
function memberId(): string | null {
  const app = useAppStore.getState();
  return app.profile?.id ?? app.userId ?? null;
}

/** A whole session (Plan's rows), as opposed to only its id (Resume from the file). */
function isSessionView(session: RunnerSessionRef | SessionView): session is SessionView {
  return 'blocks' in session && 'status' in session;
}

/** The outbox holds a Save for this session (the member's queue is loaded first when it is not). */
async function waitsInOutbox(sessionId: string, profileId: string): Promise<boolean> {
  const id = profileId.toLowerCase();
  if (useWorkoutOutbox.getState().loadedProfileId !== id) await activateWorkoutOutbox(id);
  return hasPendingWorkoutNow(sessionId);
}

/** Hands the session over (when there is one) and opens the runner route. */
function present(session: RunnerSessionRef | SessionView, entry: RunnerEntry): boolean {
  if (isSessionView(session)) handRunnerSession(session);
  return openRootModal('WorkoutRunner', { sessionId: session.id, entry });
}

/** The question is answered, dismissed, or its member's data was wiped. */
function stopAsking(): void {
  asking = false;
  stopHearingWipe?.();
  stopHearingWipe = null;
}

/**
 * "Another workout is in progress": the member chooses between the workout
 * with sets logged and the one just asked for (iOS `RunnerConflictAlert`).
 * A choice made after a local wipe (a sign-out, a withdrawal) does nothing:
 * the workout it names is gone.
 */
function askAboutOther(saved: RunnerState, next: RunnerSessionRef | SessionView, nextEntry: RunnerEntry, profileId: string): void {
  const language = currentLanguage();
  const epoch = runnerWipeEpoch();
  const title = saved.session.title ?? translate('plan.today.rest_title', language);
  const date = saved.session.scheduledFor ? shortDay(saved.session.scheduledFor, language) : '';
  asking = true;
  // A sign-out closes every dialog without an answer: the question goes with it.
  stopHearingWipe = onRunnerWiped(stopAsking);
  showDialog({
    title: translate('runner.conflict.title', language),
    message: translate('runner.conflict.body', language, { title, date }),
    testID: 'runner.conflict',
    onDismiss: stopAsking,
    buttons: [
      {
        label: translate('runner.conflict.resume', language),
        testID: 'runner.conflict.resume',
        onPress: () => {
          stopAsking();
          if (wipedSince(epoch) || rootRouteName() === RUNNER_ROUTE) return;
          present(saved.session, 'resume');
        },
      },
      {
        label: translate('runner.conflict.discard', language),
        role: 'destructive',
        testID: 'runner.conflict.discard',
        onPress: () => {
          stopAsking();
          if (wipedSince(epoch)) return;
          RunnerAnalytics.left('discard');
          // Busy until the discard is carried out: another door (Resume)
          // tapped while the file is deleted must not open a runner first.
          deciding = true;
          void deleteRunner(profileId)
            .catch((error: unknown) => track('service_error', { op: 'runner_discard', error: errorDescription(error) }))
            .then(() => {
              // iOS checks again that no runner is up right before presenting.
              if (!wipedSince(epoch) && rootRouteName() !== RUNNER_ROUTE) present(next, nextEntry);
            })
            .finally(() => {
              deciding = false;
            });
        },
      },
      { label: translate('common.cancel', language), role: 'cancel', testID: 'runner.conflict.cancel', onPress: stopAsking },
    ],
  });
}

/**
 * Opens the runner on `session` (see the top of this file). `entry` is where
 * it was opened from (`today`, `missed`, or `resume` for the saved workout);
 * a whole session works its own entry out, and a restored file always opens
 * as `resume`.
 */
export async function launchRunner(session: RunnerSessionRef | SessionView, entry: RunnerEntry): Promise<RunnerLaunchOutcome> {
  if (deciding || asking || rootRouteName() === RUNNER_ROUTE) return 'busy';
  const profileId = memberId();
  if (!profileId) return 'nothing';
  deciding = true;
  try {
    // Taken before the queue is read: a wipe while it is read forgets the
    // queue (so the session reads as not pending) and must stop the launch.
    const epoch = runnerWipeEpoch();
    const pending = await waitsInOutbox(session.id, profileId);
    if (wipedSince(epoch)) return 'nothing';
    if (pending) {
      useHealthStore.getState().setToast('health.saved_offline');
      return 'pending';
    }
    const today = todayServerDay();
    const saved = await loadRunner(profileId);
    // The member's data was wiped while the file was read: nothing to open.
    if (wipedSince(epoch)) return 'nothing';
    const decision = decideRunnerLaunch(saved, session.id, today);
    const fresh = (): RunnerEntry => (isSessionView(session) ? runnerEntryFor(session, { restored: false, today }) : entry);
    switch (decision.kind) {
      case 'open':
        if (decision.restore) return present(session, 'resume') ? 'opened' : 'nothing';
        if (!isSessionView(session) && entry === 'resume') {
          // Resume, but the file is gone or outlived its day: the row is read again.
          await refreshRunnerProgress(profileId, today);
          return 'nothing';
        }
        return present(session, fresh()) ? 'opened' : 'nothing';
      case 'replaceOther':
        // Nothing logged in the other file: the new runner writes over it.
        return present(session, fresh()) ? 'opened' : 'nothing';
      case 'askAboutOther':
        askAboutOther(decision.saved, session, fresh(), profileId);
        return 'asked';
    }
  } catch (error) {
    // A file or a queue that cannot be read must not open a runner over it.
    track('service_error', { op: 'runner_launch', error: errorDescription(error) });
    return 'nothing';
  } finally {
    deciding = false;
  }
}

/** Tests: no request deciding, no question on screen. */
export function resetRunnerLaunchForTests(): void {
  deciding = false;
  stopAsking();
}
