// Session hooks for Body and goals: what this phone must forget when the member
// signs out (plan 3.0, rule 7). Imported once at startup by
// src/app/registrations.ts, so a hook registered here is in place before any
// sign-in or sign-out can happen.
//
// - A data export left in the cache folder (`lifepass-export-*.json`, the
//   member's whole account in one file). It goes a few minutes after the
//   share answered (./export/cleanup.ts), and the health wipe at sign-out
//   removes any left behind; this covers the sign-out that names nobody (no
//   profile and no session user, so no member wipe runs), as iOS clears the
//   exports on every wipe, and drops the wait for a share that answered.
//
// This file loads once as the app starts (src/app/signOut.ts
// `loadRegistrations`), which is also the app-start backstop for an export
// left on disk by a run Android killed before its file could go.
//
// Nothing else here outlives the screen: the reminder choices are health use
// and go with the health wipe (src/health/localKeys.ts `ReminderKeys`), and
// the "notifications refused" flag stays on the phone, as on iOS (a yes or no
// about this phone, never a health value).
import { registerSignOutCleaner } from '../../app/signOut';

import { clearAllExports, clearLeftoverExports } from './export/cleanup';

registerSignOutCleaner('body.exports', () => clearAllExports());

void clearLeftoverExports().catch(() => undefined);
