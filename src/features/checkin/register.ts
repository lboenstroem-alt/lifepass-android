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
// THE WALK-IN FLOW (CHECKIN-2) registers its hooks with `registerWalkInHooks()` (idempotent): the sign-out cleaner
// that drops a consent or a proof left up for the member who left, and the walk_in payment presenter F8 needs when it
// recovers a walk-in paid on the hosted page after a cold start. Its host also calls it when it mounts, but a member
// who never opens the Scan tab must still be covered, as iOS's sign-out calls every wipe by name, so it is called
// here at startup.
//
// The slot's F4 stub (./walkin/index.ts) does not export it yet; it arrives with CHECKIN-2. It is read as optional so
// this file is right on either side of that merge. Once both packages are in, this can be a plain named import.
import * as walkIn from './walkin';

/** CHECKIN-2's hook registration, where the walk-in package has landed. */
type WalkInHooks = { readonly registerWalkInHooks?: () => void };

(walkIn as WalkInHooks).registerWalkInHooks?.();
