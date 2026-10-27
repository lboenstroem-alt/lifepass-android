// Session hooks for the Account screen: what this phone must forget when the
// member signs out.
//
// Pre-created by F3 (plan 3.0, rule 7) and imported once at startup by
// src/app/registrations.ts, so the hook is in place before any sign-in or
// sign-out can happen.
//
// The Account screen keeps one thing per member outside the screen itself:
// the company-plan context (./companyContext.ts), which names the member's
// employer and the plan it pays for. The next person to sign in on this
// phone must never see it, even for the moment before their own read
// answers. Everything else Account shows is the app store's (F3 clears it)
// or lives and dies with the screen (the referral link, the language
// dialog). The cached account language is F3's own cleaner.
//
// THE CO-PAY HOOKS load from here too (./copay/register.ts: the
// 'account.copay' sign-out cleaner that forgets the employer context and the
// dunning key, the 'copay' payment outcome presenter, the dunning-episode
// subscription), so they never depend on the Account screen's slots being in
// the navigator's import graph. The slots still import it; a module runs
// once. It loads no screen (./__tests__/register.test.ts checks), and it is
// loaded AFTER Account's own cleaner and in its own try, as
// src/app/registrations.ts loads each register file: a co-pay import that
// fails to load on a phone (a native module, the payments layer) must cost
// the co-pay hooks only, never the company-context cleaner. The failure is
// reported (`service_error`, op `register_account_copay`), not swallowed.
import { registerSignOutCleaner } from '../../app/signOut';
import { errorDescription, track } from '../../lib/analytics';

import { resetCompanyContext } from './companyContext';

registerSignOutCleaner('account.companyContext', () => {
  resetCompanyContext();
});

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded in its own try (see above)
  require('./copay/register');
} catch (error) {
  try {
    track('service_error', { op: 'register_account_copay', error: errorDescription(error) });
  } catch {
    // The report must never be what loses Account's own cleaner.
  }
}
