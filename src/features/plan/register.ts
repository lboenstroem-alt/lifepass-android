// Session hooks for the Plan tab: what this phone must forget when the member
// signs out (plan 3.0, rule 7). Imported once at startup by
// src/app/registrations.ts, so a hook registered here is in place before any
// sign-in or sign-out can happen.
//
// - The shell (PLAN-1): a parked action, a scroll request, the adopted banner,
//   a failed-outbox list and whose bookings hint is showing all belong to the
//   member who left; none of it may greet the next one (iOS drops PlanView's
//   state with the signed-in views).
//
// Kept on the phone, as on iOS: the bookings hint's visit count and "found
// Profile" flag (per member, not health data). The intro card's Not now
// (`plan.intro.collapsed.<id>`) is health use and goes with the health wipe
// (src/health/localKeys.ts).
import { registerSignOutCleaner } from '../../app/signOut';

import { resetPlanShell } from './shell/planShell';

registerSignOutCleaner('plan.shell', () => resetPlanShell());
