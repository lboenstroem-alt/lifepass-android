/**
 * The runner's wipe fence: what stops work that was already on its way when
 * the local wipe ran from sending, applying or writing anything more for the
 * workout the wipe discarded.
 *
 * WHY IT EXISTS. iOS runs its wipe in ONE main-actor turn: the folder's
 * delete is queued and `.healthLocalDataWiped` is posted together, so the
 * outbox and the runner forget before any other continuation can queue a
 * write (HealthStore.swift `wipeLocal`). Android's wipe (src/health/store.ts
 * `wipeLocal`) awaits its other cleanup (the notifications, the background
 * task, the keys) between queueing the delete and running its hooks, so a
 * continuation can run in between: a flush whose answer lands, a Save that
 * queues, the runner's 30-second clock write. Each of those used to queue a
 * write behind the delete, and the write recreated the folder and the file.
 *
 * WHAT IT DOES. Every wipe the runner hears of raises the fence (an epoch:
 * ../outbox/localWipe.ts). Work that began before it reads the epoch back
 * after each await and stops there:
 *
 * - the outbox's flush, its Save as extra and its activation read send,
 *   apply and write nothing more (no conversion goes to the server);
 * - Plan's Resume row ignores a runner.json read from before the wipe;
 * - `saveRunner` / `persistRunner` and a queued Save with `since` (the epoch
 *   the runner screen opened in, `runnerWipeEpoch()`) write nothing.
 *
 * And the wipe's own runner step queues the removal of runner.json and
 * outbox.json BEHIND any write already queued (the health file store runs
 * every disk touch in order), so a write that slipped in before the fence
 * went up is deleted too.
 *
 * The fence goes up when the wipe's hooks run. iOS raises it in the delete's
 * own turn; the F7 contract request for a hook that runs then (before
 * `wipeLocal` awaits the rest) is in RUN-1's result. Until it lands, what is
 * written in that window is removed by the step above, and what is sent in
 * it the server refuses for a member without consent or a session.
 */

let epoch = 0;

/** The current epoch: capture it when a runner opens, pass it back as `since`. */
export function runnerWipeEpoch(): number {
  return epoch;
}

/** True when a wipe ran after `since` was captured: the work it belongs to is discarded. */
export function wipedSince(since: number): boolean {
  return epoch !== since;
}

/** A wipe reached the runner: everything begun before now stops at its next check. */
export function raiseRunnerWipeFence(): void {
  epoch += 1;
}
