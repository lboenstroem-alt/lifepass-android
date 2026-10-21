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
import { registerSignOutCleaner } from '../../app/signOut';

import { resetCompanyContext } from './companyContext';

registerSignOutCleaner('account.companyContext', () => {
  resetCompanyContext();
});
