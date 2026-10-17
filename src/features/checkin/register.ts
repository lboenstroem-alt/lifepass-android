// Session hooks for the Scan tab, check-in links and the walk-in flow: what this phone must forget when the member
// signs out, claim when they sign in, or flush when the app comes back.
//
// Pre-created by F3 (plan 3.0, rule 7). Imported once at startup by src/app/registrations.ts, so a hook registered
// here is in place before any sign-in or sign-out can happen. The helpers and their rules are in src/app/signOut.ts.
//
// THE SCAN TAB, LINKS AND THE PROOF (CHECKIN-1) KEEP NOTHING OF THE MEMBER'S that outlives a sign-out:
// - a parked check-in link lives in the intent store, whose own cleaner (`nav.intents`) forgets it, as iOS's
//   sign-out clears `pendingScanVenueId`;
// - what a scanner remembers of the codes it has seen (./scan/qrRead.ts) is in memory, per mounted scanner, and is
//   not the member's: a foreign menu code is foreign whoever is signed in;
// - Home's re-offered proof is a snapshot in the banner's own state, which goes with the signed-in screens.
//
// The walk-in flow (CHECKIN-2) registers its hooks from ./walkin/register.ts (`registerWalkInHooks()`), which its
// host also calls when it mounts; once that file is on the branch, call it here as well so the hooks are in place
// before the Scan tab is ever opened.
export {};
