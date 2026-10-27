/**
 * The co-pay session hooks: what the phone forgets at sign-out, what it does
 * when a co-pay page Android closed the app behind is settled at the next
 * launch, and when a dunning episode ends.
 *
 * Loaded at startup by Account's own register file
 * (src/features/account/register.ts, in its own try), so the hooks never
 * depend on a screen, and by the Account slots that use the flows. A module
 * runs once however many files import it. It reaches no screen: the flows'
 * state comes from ./flowState.ts, not the flows (which import the Kenni
 * sheet's barrel and the UI kit's dialog).
 */
import { isSubscriptionPastDue } from '../../../api/subscriptions';
import { registerSignOutCleaner } from '../../../app/signOut';
import { registerPaymentOutcomePresenter } from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import { endRetryEpisodesExcept } from '../../../supabase/services/companyPlans';

import { reloadCopayContext, resetCopayContext } from './contextSource';
import { forgetCopayFlows } from './flowState';

/** The store subscription below, once per process. */
let unsubscribeEpisodes: (() => void) | null = null;

/**
 * Puts the co-pay hooks in place (at load; tests call it again after they
 * reset the registries). Each is registered under a fixed id, so calling it
 * twice replaces rather than doubles them.
 */
export function installCopayHooks(): void {
  /**
   * Sign-out: the context names the member's employer and what it pays for
   * them, and a dunning episode's key is theirs. The next person to sign in on
   * this phone sees neither, and never replays the last member's payment page.
   * The buttons are theirs too: a flow of the last member's still settling
   * leaves "Processing…" behind on neither. (Once ACCT-1's store is the
   * context store, its own cleaner resets it as well; twice is harmless.)
   */
  registerSignOutCleaner('account.copay', () => {
    resetCopayContext();
    endRetryEpisodesExcept(null);
    forgetCopayFlows();
  });

  /**
   * A co-pay page settled by the recovery after Android closed the app behind
   * it (F8 has already pulled the payment and re-read the membership and the
   * profile). Quiet, as on iOS: Account re-renders from what it reads. An
   * accepted plan takes the banner away, so the context is read again.
   */
  registerPaymentOutcomePresenter('copay', (resolution) => {
    if (resolution.rail !== 'copay') return;
    if (resolution.record.purpose === 'activate') void reloadCopayContext();
  });

  /**
   * A dunning episode ends once the plan reads as no longer past due, whoever
   * read it (the settle after the page, a pull-to-refresh, the daily retry
   * seen on the next launch). iOS clears its key only after its own settle;
   * here any read counts, so a plan cured behind the app's back and past due
   * again a month later never reuses last month's key (and replays last
   * month's page). It also ends with the Account visit, as iOS's key ends
   * with its AccountView (copayFlows `useRetryEpisodeVisit`).
   */
  if (!unsubscribeEpisodes) {
    unsubscribeEpisodes = useAppStore.subscribe((state, previous) => {
      if (state.subscription === previous.subscription) return;
      const subscription = state.subscription;
      endRetryEpisodesExcept(subscription && isSubscriptionPastDue(subscription) ? subscription.id : null);
    });
  }
}

installCopayHooks();
