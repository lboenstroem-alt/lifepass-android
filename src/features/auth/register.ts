// Session hooks for email sign-in, sign-up and auth links: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7); filled by AUTH-1. Imported once at
// startup by src/app/registrations.ts, so a hook registered here is in place
// before any sign-in or sign-out can happen.
//
// - The set-new-password screen holds the Kenni nudge back while it is up
//   (./recovery.ts).
// - A sign-out closes the set-new-password screen: it changes the password
//   of the session a reset link opened, and with that session gone there is
//   nothing it could change (iOS leaves it up, failing on Update until
//   "Later").
//
// Nothing else of AUTH-1's is per member: the "reset requested" marker
// belongs to the phone (it is written while signed out) and lasts an hour,
// and the list of auth links already tried (./spentLinks.ts) holds only
// hashes of links that stay spent whoever signs in next.
import { registerSignOutCleaner } from '../../app/signOut';

import { endPasswordRecovery, installRecoveryBlocker } from './recovery';

installRecoveryBlocker();

registerSignOutCleaner('auth.passwordRecovery', () => endPasswordRecovery());
