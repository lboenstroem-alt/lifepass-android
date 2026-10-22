// Session hooks for the Plan tab: what this phone must forget when the member
// signs out (plan 3.0, rule 7). Imported once at startup by
// src/app/registrations.ts, so a hook registered here is in place before any
// sign-in or sign-out can happen.
//
// - The shell (PLAN-1): a parked action, a scroll request, the adopted banner,
//   a failed-outbox list and whose bookings hint is showing all belong to the
//   member who left; none of it may greet the next one (iOS drops PlanView's
//   state with the signed-in views).
// - The intro card's Not now, as remembered in memory: the stored flag
//   (`plan.intro.collapsed.<id>`) is health use and goes with the health wipe
//   (src/health/localKeys.ts), and the memory goes with it, so a member who
//   withdrew and consented again is offered the full card, as on iOS.
// - On a health wipe, Plan's stack goes back to its first screen (iOS
//   `wipeLocal` resets `planPath`): a Diary, a report or the measurements
//   open there close, and the gate or the under-18 card shows instead of
//   what the member just withdrew. Nothing aimed at the wiped day (a scroll,
//   a held action, the adopt suppression) fires later.
//
// - The programmes (PLAN-4): the workouts the history list read (memory, held
//   only while the list is open, and dropped here too), and the proposal
//   card's reminder choice and outcome listeners.
//
// Kept on the phone, as on iOS: the bookings hint's visit count and "found
// Profile" flag (per member, not health data).
import { registerSignOutCleaner } from '../../app/signOut';
import { registerHealthWipeHook } from '../../health';

import { forgetHistoryItems } from './history/historyCache';
import { forgetIntroCollapse } from './intro/introCollapse';
import { forgetProposalDrafts, resetProposalBridges } from './proposal/proposalActions';
import { planHealthWiped, resetPlanShell } from './shell/planShell';

registerSignOutCleaner('plan.shell', () => {
  resetPlanShell();
  forgetIntroCollapse();
});

registerSignOutCleaner('plan.programs', () => {
  resetProposalBridges();
  forgetHistoryItems();
});

registerHealthWipeHook('plan.intro-collapse', () => forgetIntroCollapse());
registerHealthWipeHook('plan.programs', () => {
  forgetProposalDrafts();
  forgetHistoryItems();
});
registerHealthWipeHook('plan.shell', () => planHealthWiped());
