/**
 * The second half of a withdrawal (iOS `finishWithdrawalIfNeeded`): this
 * phone's own copy goes (the cached day, the outboxes, the reminders and
 * their stored choices, the feedback's flags, any export left behind), and
 * the profile is read back.
 *
 * It runs when the "Deleted" sheet has gone, and only once. It cannot run any
 * earlier: on Plan's stack the wipe pops Body and goals (PLAN-1's wipe hook,
 * iOS `planPath = NavigationPath()`), and the page has to live long enough to
 * say what was deleted. Nothing is at risk in the gap: the server has already
 * deleted every row, this phone's copy is a cache, and an app killed with the
 * sheet up meets the reconcile on its next profile read, which wipes a phone
 * whose consent is gone.
 */
import { useHealthStore } from '../../../health';
import { useAppStore } from '../../../stores/appStore';

/**
 * `afterWipe` runs between the wipe and the profile read: the page reads its
 * reminder rows back, which are now the defaults every other screen reads,
 * not what they showed before.
 */
export async function finishWithdrawal(profileId: string | null, afterWipe?: () => void | Promise<void>): Promise<void> {
  await useHealthStore.getState().wipeLocal({ profileId, reason: 'withdrawn' });
  try {
    await afterWipe?.();
  } catch {
    // The rows are the page's; the profile read below still runs.
  }
  await useAppStore.getState().loadProfile();
}
