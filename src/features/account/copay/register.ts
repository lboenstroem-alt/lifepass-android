/**
 * The co-pay session hooks: what the phone forgets at sign-out, what it does
 * when a co-pay page Android closed the app behind is settled at the next
 * launch, and when a dunning episode ends.
 *
 * Loaded by the Account slots that use the flows (their import puts these in
 * place at app start, since the Account route is imported with the
 * navigator), and meant to be loaded by Account's own register file too
 * (`import './copay/register'` in src/features/account/register.ts, ACCT-1's:
 * contract request), so the hooks never depend on a screen. A module runs
 * once however many files import it, and the cleaner and the presenter are
 * registered under fixed ids.
 */
import { isSubscriptionPastDue } from '../../../api/subscriptions';
import { registerSignOutCleaner } from '../../../app/signOut';
import { registerPaymentOutcomePresenter } from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import { endRetryEpisodesExcept } from '../../../supabase/services/companyPlans';

import { reloadCopayContext, resetCopayContext } from './contextSource';

/**
 * Sign-out: the context names the member's employer and what it pays for
 * them, and a dunning episode's key is theirs. The next person to sign in on
 * this phone sees neither, and never replays the last member's payment page.
 */
registerSignOutCleaner('account.copay', () => {
  resetCopayContext();
  endRetryEpisodesExcept(null);
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
 * month's page).
 */
useAppStore.subscribe((state, previous) => {
  if (state.subscription === previous.subscription) return;
  const subscription = state.subscription;
  endRetryEpisodesExcept(subscription && isSubscriptionPastDue(subscription) ? subscription.id : null);
});
