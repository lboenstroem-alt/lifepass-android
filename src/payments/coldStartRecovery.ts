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
 * and speak only when the payment settles. A confirm that did not answer is
 * said only right after the page (the member is waiting for it); on a
 * later return it is retried quietly, so a phone that is offline is not
 * nagged. Nothing is shown to anyone but the member who paid.
 */
import { Linking } from 'react-native';

import { useAppStore } from '../stores/appStore';

import { noteReturnUrl } from './hostedPage';
import {
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  railFamily,
  readInflight,
  releaseAttempt,
  updateInflight,
  type InflightRecord,
} from './inflight';
import { presentResolution, shouldPresent, type PaymentResolution } from './presenters';
import { settleRecord, type Settled } from './resolve';
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
const running = new Map<string, Promise<RecoveryReport>>();

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
 * in this process is that page's; a link while a flow here is settling a
 * payment of that family belongs to that flow (it already knows how its page
 * closed). Otherwise it is the leg of a payment the app lost: kept, and the
 * recovery runs as soon as the member is known.
 */
export function handlePaymentReturnUrl(url: string | null | undefined): boolean {
  const link = parseReturnUrl(url);
  if (!link) return false;
  if (noteReturnUrl(link)) return true;
  if (hasLiveAttempt(link.family)) return true;
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
  if (!link || noteReturnUrl(link) || hasLiveAttempt(link.family)) return;
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

/**
 * Settles every saved attempt of `memberId` that nothing in this process
 * holds. Runs one at a time per member: a trigger that arrives while one
 * runs waits for it, then finds what is left.
 */
export function recoverPayments(memberId: string, trigger: RecoveryTrigger): Promise<RecoveryReport> {
  const id = memberId.toLowerCase();
  const previous = running.get(id) ?? Promise.resolve(NOTHING);
  const run = previous.catch(() => NOTHING).then(() => recover(id, trigger));
  running.set(id, run);
  void run.finally(() => {
    if (running.get(id) === run) running.delete(id);
  });
  return run;
}

/** Waits for any recovery of `memberId` in progress (a new attempt waits for an old one to settle). */
export async function recoveryIdle(memberId: string): Promise<void> {
  const run = running.get(memberId.toLowerCase());
  if (run) await run.catch(() => undefined);
}

async function recover(memberId: string, trigger: RecoveryTrigger): Promise<RecoveryReport> {
  if (!stillSignedIn(memberId)) return NOTHING;
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
      const settled = await settleRecord(record, linkLeg ?? 'done');
      if (settled.record === 'clear') {
        await clearInflight(memberId, record.attemptId);
        resolved += 1;
      } else {
        pending += 1;
      }
      await speak(record, settled, { trigger, afterLink: linkLeg !== null });
    } catch (error) {
      // One attempt that could not be settled must not stop the others; its
      // record stays for the next return to the app.
      pending += 1;
      if (__DEV__ && process.env.NODE_ENV !== 'test') console.warn('[payments] recovery failed', error);
    } finally {
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

function isProcessing(resolution: PaymentResolution): boolean {
  return (
    (resolution.rail === 'booking' || resolution.rail === 'walk_in') &&
    resolution.settlement.kind === 'outcome' &&
    resolution.settlement.outcome.kind === 'processing'
  );
}

function isFailedConfirm(resolution: PaymentResolution): boolean {
  return (resolution.rail === 'booking' || resolution.rail === 'walk_in') && resolution.settlement.kind === 'failed';
}

/** Shows what `settled` says, when it should be said (see the file comment). */
async function speak(record: InflightRecord, settled: Settled, context: SpeakContext): Promise<void> {
  const { resolution } = settled;
  if (!shouldPresent(resolution) || !stillSignedIn(record.memberId)) return;
  if (isFailedConfirm(resolution) && !context.afterLink && context.trigger !== 'return') return;
  if (isProcessing(resolution)) {
    if (record.presentedProcessing) return;
    await updateInflight(record.memberId, record.attemptId, (saved) => ({ ...saved, presentedProcessing: true }));
  }
  presentResolution(resolution, { checkAgain: () => void checkRecordAgain(record) });
}

/**
 * The presenter's Check again: the same key, the Done leg, and whatever it
 * says now (including "still confirming", which the member asked for).
 */
export async function checkRecordAgain(record: InflightRecord): Promise<void> {
  if (!claimAttempt(record.attemptId, railFamily(record.rail), 'recovery')) return;
  try {
    const settled = await settleRecord(record, 'done');
    if (settled.record === 'clear') await clearInflight(record.memberId, record.attemptId);
    if (shouldPresent(settled.resolution) && stillSignedIn(record.memberId)) {
      presentResolution(settled.resolution, { checkAgain: () => void checkRecordAgain(record) });
    }
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
