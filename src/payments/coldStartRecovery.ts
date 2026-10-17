/**
 * Resolving a hosted payment the app lost track of: after Android closed the
 * app behind the page, or a screen that went away before its payment
 * settled. Plan F8, critic-hosted-payment-process-death.
 *
 * HOW A RETURN REACHES IT
 * - The link: `handlePaymentReturnUrl(url)`, which F4's deep-link router
 *   calls for every `lifepass://payment-*` and `card-setup-*` link
 *   (`Linking.getInitialURL()` at launch and the `url` event after). A page
 *   still open in this process takes its own link (./hostedPage). Any other
 *   link is remembered as the return's leg (success or cancel) for the
 *   recovery below. Until F4's router exists, the launch link is also read
 *   here, once per process, when the first profile has loaded.
 * - The member: recovery needs to know who paid (the records are per
 *   member), so it runs from F3's activation hook: once the first profile of
 *   a launch or sign-in has loaded, and on every return to the foreground.
 *
 * WHAT IT DOES. For each saved attempt (./inflight) that no flow in this
 * process holds, oldest first: claim it, run its rail's confirm (./resolve:
 * the Done leg, or the cancel leg when the cancel link came back), show the
 * outcome through the rail's presenter (./presenters), and clear the record
 * once the server has answered for good. Claiming first means each attempt
 * is resolved exactly once, however many triggers fire together.
 *
 * WHEN IT SPEAKS. A final outcome is shown once. "Confirming your payment"
 * is shown once per attempt; later returns to the app check again quietly
 * and speak only when the payment settles. A confirm (or a plan's status
 * check) that did not answer is said only right after the page (the member
 * is waiting for it); on a later return it is retried quietly, so a phone
 * that is offline is not nagged. Nothing is shown to anyone but the member
 * who paid, and only once the app's tabs are on screen (./presenters).
 * While it confirms after a return link or at launch, the member sees
 * "Confirming your payment…" (./recoveryProgress), as iOS shows on the
 * screen that waits.
 *
 * ONE AT A TIME. Every settling here (a recovery run, a presenter's Check
 * again) runs in one queue per member, so `recoveryIdle` waits for all of
 * it: a new attempt that waits for it then sees what it found (./attempts).
 */
import { Linking } from 'react-native';

import { useAppStore } from '../stores/appStore';

import { noteResolved } from './earlier';
import { noteReturnUrl } from './hostedPage';
import {
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  railFamily,
  readInflight,
  releaseAbandonedHolds,
  releaseAttempt,
  updateInflight,
  type InflightRecord,
} from './inflight';
import { presentResolution, shouldPresent } from './presenters';
import { endRecoveryProgress, startRecoveryProgress } from './recoveryProgress';
import { settleRecord, stillSettling, unanswered, type Settled } from './resolve';
import { parseReturnUrl, type ParsedReturn } from './returnUrls';

/** What started a recovery: a return link, a launch (first profile), or a return to the foreground. */
export type RecoveryTrigger = 'return' | 'launch' | 'foreground';

/** A return link older than this no longer says anything about how a page closed. */
export const RETURN_HINT_MAX_AGE_MS = 15 * 60 * 1000;

interface ReturnHint extends ParsedReturn {
  readonly at: number;
}

let pendingReturn: ReturnHint | null = null;
let launchLinkRead = false;
/** The tail of each member's queue of settling work. */
const running = new Map<string, Promise<unknown>>();

/** What a recovery did, for tests and logs. */
export interface RecoveryReport {
  /** Attempts settled for good (their records cleared). */
  readonly resolved: number;
  /** Attempts still settling (records kept). */
  readonly pending: number;
  /** Attempts another owner in this process holds. */
  readonly skipped: number;
}

const NOTHING: RecoveryReport = Object.freeze({ resolved: 0, pending: 0, skipped: 0 });

/** The signed-in member whose profile has loaded, or null. */
function signedInMember(): string | null {
  const { isAuthenticated, isLoading, profile, userId } = useAppStore.getState();
  if (!isAuthenticated || isLoading || !profile) return null;
  return (userId ?? profile.id).toLowerCase();
}

/** True while `memberId` is the member signed in (an outcome is only ever theirs). */
function stillSignedIn(memberId: string): boolean {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  return isAuthenticated && (userId ?? profile?.id ?? '').toLowerCase() === memberId;
}

/**
 * A `lifepass://payment-*` or `card-setup-*` link reached the app. Returns
 * false for any other URL (the router handles those). A link for a page open
 * in this process is that page's; a link while a FLOW here is settling a
 * payment of that family belongs to that flow (it already knows how its page
 * closed). Otherwise it is the leg of a payment the app lost: kept, and the
 * recovery runs as soon as the member is known. A recovery already settling
 * an older attempt does not own it: it waits for the attempt it belongs to.
 */
export function handlePaymentReturnUrl(url: string | null | undefined): boolean {
  const link = parseReturnUrl(url);
  if (!link) return false;
  if (noteReturnUrl(link)) return true;
  if (hasLiveAttempt(link.family, 'flow')) return true;
  pendingReturn = { ...link, at: Date.now() };
  const memberId = signedInMember();
  if (memberId) void recoverPayments(memberId, 'return');
  return true;
}

/**
 * Reads the link the app was launched with, once per process. F4's router
 * does this too and hands it to `handlePaymentReturnUrl`; reading it twice
 * is harmless (the link is only a hint, and each attempt is claimed once).
 */
export async function readLaunchReturnOnce(): Promise<void> {
  if (launchLinkRead) return;
  launchLinkRead = true;
  let url: string | null = null;
  try {
    url = await Linking.getInitialURL();
  } catch {
    return;
  }
  const link = parseReturnUrl(url);
  if (!link || noteReturnUrl(link) || hasLiveAttempt(link.family, 'flow')) return;
  pendingReturn ??= { ...link, at: Date.now() };
}

/** Takes the return link's leg for `family`, when a fresh one is waiting. */
function takeReturnLeg(family: 'payment' | 'cardSetup', now: number): 'done' | 'cancel' | null {
  const hint = pendingReturn;
  if (!hint) return null;
  if (now - hint.at > RETURN_HINT_MAX_AGE_MS) {
    pendingReturn = null;
    return null;
  }
  if (hint.family !== family) return null;
  pendingReturn = null;
  return hint.leg === 'canceled' ? 'cancel' : 'done';
}

/** Runs `work` after everything already queued for `memberId` (see "ONE AT A TIME"). */
function enqueue<T>(memberId: string, work: () => Promise<T>): Promise<T> {
  const id = memberId.toLowerCase();
  const previous = running.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  running.set(id, run);
  void run
    .catch(() => undefined)
    .finally(() => {
      if (running.get(id) === run) running.delete(id);
    });
  return run;
}

/**
 * Settles every saved attempt of `memberId` that nothing in this process
 * holds. Runs one at a time per member: a trigger that arrives while one
 * runs waits for it, then finds what is left.
 */
export function recoverPayments(memberId: string, trigger: RecoveryTrigger): Promise<RecoveryReport> {
  const id = memberId.toLowerCase();
  return enqueue(id, () => recover(id, trigger));
}

/** Waits for everything the recovery is settling for `memberId` (a new attempt waits for an old one to settle). */
export async function recoveryIdle(memberId: string): Promise<void> {
  const id = memberId.toLowerCase();
  // Work queued while waiting is waited for too.
  for (let run = running.get(id); run; run = running.get(id)) {
    await run.catch(() => undefined);
    if (running.get(id) === run) break;
  }
}

async function recover(memberId: string, trigger: RecoveryTrigger): Promise<RecoveryReport> {
  if (!stillSignedIn(memberId)) return NOTHING;
  // A screen that held an attempt for Check again and is gone lets go of it
  // here (it had shown "Confirming your payment"), so it is settled below.
  const abandoned = releaseAbandonedHolds();
  for (const attemptId of abandoned) {
    await updateInflight(memberId, attemptId, (saved) => ({ ...saved, presentedProcessing: true }));
  }
  const records = await readInflight(memberId);
  if (records.length === 0) {
    // A link with nothing saved behind it (an attempt already settled, or a
    // page opened by an older build): nothing to say.
    pendingReturn = null;
    return NOTHING;
  }
  // The return link belongs to the newest attempt of its family: only one
  // page is ever open, and it is the last one saved.
  const now = Date.now();
  const newestByFamily = new Map<string, string>();
  for (const record of records) newestByFamily.set(railFamily(record.rail), record.attemptId);

  let resolved = 0;
  let pending = 0;
  let skipped = 0;
  for (const record of records) {
    if (!claimAttempt(record.attemptId, railFamily(record.rail), 'recovery')) {
      // A flow here holds it: the link, if one came, is that flow's too.
      if (newestByFamily.get(railFamily(record.rail)) === record.attemptId) {
        takeReturnLeg(railFamily(record.rail), now);
      }
      skipped += 1;
      continue;
    }
    try {
      const family = railFamily(record.rail);
      const linkLeg = newestByFamily.get(family) === record.attemptId ? takeReturnLeg(family, now) : null;
      const leg = linkLeg ?? 'done';
      const context: SpeakContext = { trigger, afterLink: linkLeg !== null };
      if (showsProgress(record, leg, context)) startRecoveryProgress({ attemptId: record.attemptId, rail: record.rail });
      const settled = await settleRecord(record, leg);
      const says = shouldSpeak(record, settled, context);
      if (settled.record === 'clear') {
        // Noted before the record goes, so a new attempt that finds it gone
        // always finds what it came to (./attempts).
        noteResolved(record, settled.resolution, says);
        await clearInflight(memberId, record.attemptId);
        resolved += 1;
      } else {
        pending += 1;
      }
      endRecoveryProgress(record.attemptId);
      if (says) await speak(record, settled);
    } catch (error) {
      // One attempt that could not be settled must not stop the others; its
      // record stays for the next return to the app.
      pending += 1;
      if (__DEV__ && process.env.NODE_ENV !== 'test') console.warn('[payments] recovery failed', error);
    } finally {
      endRecoveryProgress(record.attemptId);
      releaseAttempt(record.attemptId);
    }
  }
  return { resolved, pending, skipped };
}

interface SpeakContext {
  readonly trigger: RecoveryTrigger;
  /** The member just came back from this attempt's page (its link arrived). */
  readonly afterLink: boolean;
}

/**
 * Whether the member sees "Confirming your payment…" while `record` settles:
 * a booking, walk-in or plan, after its return link or at launch (the member
 * may have just paid), unless its "still confirming" was already said. Not a
 * plan's cancel link, which asks nothing.
 */
function showsProgress(record: InflightRecord, leg: 'done' | 'cancel', context: SpeakContext): boolean {
  if (record.rail === 'card_setup' || record.rail === 'copay') return false;
  if (record.rail === 'plan' && leg === 'cancel') return false;
  if (record.presentedProcessing) return false;
  return context.afterLink || context.trigger !== 'foreground';
}

/** Whether what `settled` says should be said now (see the file comment). */
function shouldSpeak(record: InflightRecord, settled: Settled, context: SpeakContext): boolean {
  const { resolution } = settled;
  if (!shouldPresent(resolution) || !stillSignedIn(record.memberId)) return false;
  if (unanswered(resolution) && !context.afterLink && context.trigger !== 'return') return false;
  return !(stillSettling(resolution) && record.presentedProcessing);
}

/** Says it ("still confirming" is marked as said, so later returns are quiet). */
async function speak(record: InflightRecord, settled: Settled): Promise<void> {
  if (stillSettling(settled.resolution)) {
    await updateInflight(record.memberId, record.attemptId, (saved) => ({ ...saved, presentedProcessing: true }));
  }
  presentResolution(settled.resolution, { checkAgain: () => void checkRecordAgain(record) });
}

/**
 * The presenter's Check again: the same key, the Done leg, and whatever it
 * says now (including "still confirming", which the member asked for).
 *
 * The dialog it sits in can be stale: shown, then the app went to the
 * background, and a later return settled the attempt, cleared it and said
 * so. Asking again then would say the outcome twice (and schedule the
 * reminders twice), so it first checks the attempt is still saved, and does
 * nothing when it is not (its outcome is already on its way). Queued with
 * the recovery, so a new attempt waiting for the recovery waits for it too.
 */
export function checkRecordAgain(record: InflightRecord): Promise<void> {
  return enqueue(record.memberId, () => recheck(record));
}

async function recheck(shown: InflightRecord): Promise<void> {
  const memberId = shown.memberId.toLowerCase();
  if (!stillSignedIn(memberId)) return;
  const record = (await readInflight(memberId)).find((saved) => saved.attemptId === shown.attemptId);
  if (!record) return;
  if (!claimAttempt(record.attemptId, railFamily(record.rail), 'recovery')) return;
  try {
    const settled = await settleRecord(record, 'done');
    const says = shouldPresent(settled.resolution) && stillSignedIn(memberId);
    if (settled.record === 'clear') {
      noteResolved(record, settled.resolution, says);
      await clearInflight(memberId, record.attemptId);
    }
    if (says) presentResolution(settled.resolution, { checkAgain: () => void checkRecordAgain(record) });
  } finally {
    releaseAttempt(record.attemptId);
  }
}

/**
 * Forget the waiting link: at sign-out (the records themselves are wiped by
 * the cleaner), and when a new page opens (no earlier link can be its).
 */
export function forgetPendingReturn(): void {
  pendingReturn = null;
}

/** Tests only: the state a fresh process starts with. */
export function resetRecoveryForTests(): void {
  pendingReturn = null;
  launchLinkRead = false;
  running.clear();
}
